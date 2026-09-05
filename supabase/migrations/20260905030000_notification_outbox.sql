-- ============================================================================
-- الغرض: BUG-004 — Outbox معاملاتي موحّد لإشعارات التوزيع. صفّ التسليم يُكتَب في
--   نفس معاملة تغيّر الحالة (داخل open_offer_round)، فلا يقع «تغيّر الحالة بلا
--   إشعار» ولا «إشعار بلا تغيّر حالة». الإرسال الفعلي لتيليجرام يجري من عاملٍ
--   منفصلٍ يستولي على الصفّ بـclaim_token وFOR UPDATE SKIP LOCKED، فيُعاد
--   إرسالُه عند الفشل بلا تكرار الأثر: الصفّ المُسلَّم لا يُلتقط ثانيةً.
-- الحالة: منفّذ فعلياً — 2026-09-05 (§11-أ من ROADMAP-MASTER، البند BUG-004).
-- ينتمي إلى: supabase/migrations
-- يُتوقّع أن يستخدمه: claim_notification_delivery، finish_notification_delivery،
--   abandon_notification_delivery، open_offer_round (كتابة الصفوف في معاملتها).
-- ملاحظات مستقبلية: عمود kind يسمح بتوسيع الإشعارات لاحقاً (إلغاءٌ وغيره) بلا
--   تغيير المخطط؛ لكن BUG-004 يكتفي بإشعار العرض. لا يُسمى هذا «مُحَلَّلًا» إلّا
--   باختبارٍ على قاعدة PostgreSQL حقيقية يُثبت الذرّية وإعادة الإرسال بلا تكرار.
-- ============================================================================

create table if not exists notification_outbox (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities(id) on delete restrict,
  kind text not null check (kind in ('offer')),
  offer_id uuid unique references order_offers(id) on delete restrict,
  order_id uuid not null references orders(id) on delete restrict,
  driver_id uuid not null references drivers(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'sending', 'delivered', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  claim_token uuid,
  claimed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  delivered_message_id text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_delivered_pair check (
    (status <> 'delivered') or (delivered_at is not null and delivered_message_id is not null)
  ),
  constraint notification_claim_pair check (
    (status <> 'sending') or (claim_token is not null and claimed_at is not null)
  )
);
create index if not exists notification_outbox_due_idx
  on notification_outbox(status, next_attempt_at) where status = 'pending';
create index if not exists notification_outbox_abandoned_idx
  on notification_outbox(city_id, claimed_at) where status = 'sending';
create index if not exists notification_outbox_offer_uidx
  on notification_outbox(offer_id) where offer_id is not null;
drop trigger if exists notification_outbox_set_updated_at on notification_outbox;
create trigger notification_outbox_set_updated_at before update on notification_outbox
  for each row execute function set_updated_at();

alter table notification_outbox enable row level security;
drop policy if exists notification_outbox_service_role on notification_outbox;
create policy notification_outbox_service_role on notification_outbox for all to service_role using (true) with check (true);

-- إعداداتُ المدينة: إعادةُ الإرسال، سقفُ المحاولات لكلّ شوط، ومهلةُ الحجز المتروك.
-- مرآةٌ لإعدادات SOS: لا رقمٌ في الكود، بل في platform_settings لكلّ مدينة.
insert into platform_settings (city_id, key, value, value_type, description_ar)
select id, 'notification_delivery_retry_seconds', '30'::jsonb, 'number',
       'الفاصل بين محاولات تسليم إشعار العرض بعد فشلٍ مؤقّت'
from cities on conflict (city_id, key) do nothing;
insert into platform_settings (city_id, key, value, value_type, description_ar)
select id, 'notification_delivery_max_attempts', '3'::jsonb, 'number',
       'عدد محاولات تسليم الإشعار التي ينفذها عامل واحد في شوطه'
from cities on conflict (city_id, key) do nothing;
insert into platform_settings (city_id, key, value, value_type, description_ar)
select id, 'notification_claim_timeout_seconds', '300'::jsonb, 'number',
       'المهلة التي بعدها يُعدّ حجزُ تسليم إشعارٍ متروكاً فيُعاد إلى الانتظار'
from cities on conflict (city_id, key) do nothing;

-- ----------------------------------------------------------------------------
-- claim_notification_delivery: يسترجعُ المتروكَ أوّلاً ثمّ يحجز المستحقَّ واحدًا.
--   مرآةٌ لـclaim_safety_incident_delivery: FOR UPDATE SKIP LOCKED + claim_token.
--   يُرجع بيانات العرض (المسافة، الانتهاء، الحالة) من order_offers لا من
--   تخزينٍ مكرّر: مصدرٌ واحدٌ للحقيقة. لو كان العرضُ ميّتًا (غير pending أو
--   منتهيًا) لم يُلتقط هنا — يقرره العامل: abandon (terminal) لا إعادةٌ أبدية.
-- ----------------------------------------------------------------------------
create or replace function claim_notification_delivery()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery notification_outbox%rowtype;
  v_token uuid := gen_random_uuid();
  v_max integer;
  v_retry integer;
  v_timeout integer;
begin
  select greatest(1, (value #>> '{}')::integer) into v_timeout from platform_settings
   where key = 'notification_claim_timeout_seconds' limit 1;
  if v_timeout is null then v_timeout := 300; end if;

  -- استرجاعُ الحجوزِ المتروكة: عاملٌ مات قبل أن يُعلن نتيجته ترك الصفَّ في sending.
  -- يُلغى رمزُ الحجز القديم فلو عاد العاملُ الميّت أعلنَ نتاجته ردّته finish بـNOT_CLAIMED.
  update notification_outbox n
     set status = 'pending', claim_token = null, claimed_at = null, next_attempt_at = now()
   where n.status = 'sending'
     and n.claimed_at is not null
     and n.claimed_at < now() - make_interval(secs => v_timeout);

  select n.* into v_delivery from notification_outbox n
   where n.status = 'pending' and n.next_attempt_at <= now()
   order by n.created_at
   for update skip locked limit 1;
  if not found then return jsonb_build_object('ok', true, 'delivery', null); end if;

  select greatest(1, (value #>> '{}')::integer) into v_max from platform_settings
    where city_id = v_delivery.city_id and key = 'notification_delivery_max_attempts';
  if v_max is null then v_max := 3; end if;

  update notification_outbox set status = 'sending', attempts = attempts + 1,
         claim_token = v_token, claimed_at = now()
   where id = v_delivery.id;

  return (
    select jsonb_build_object('ok', true, 'delivery', jsonb_build_object(
      'delivery_id', n.id, 'offer_id', o.id, 'order_id', o.order_id,
      'driver_id', o.driver_id, 'city_id', n.city_id, 'claim_token', v_token,
      'attempts', n.attempts, 'max_attempts', v_max,
      'distance_km', o.distance_km::text, 'expires_at', o.expires_at,
      'offer_status', o.status::text
    ))
    from notification_outbox n join order_offers o on o.id = n.offer_id
    where n.id = v_delivery.id
  );
end $$;

-- ----------------------------------------------------------------------------
-- finish_notification_delivery: يُعلن نتيجة التسليم بالرموز لا بالصفّ — من يملك
--   الرمزَ يملكُ القرار. تسليمٌ ناجح ⇒ delivered + معرّفُ الرسالة. فشلٌ مؤقّت ⇒
--   عودةٌ إلى pending بموعدٍ جديد. مرآةٌ لـfinish_safety_incident_delivery.
-- ----------------------------------------------------------------------------
create or replace function finish_notification_delivery(
  p_delivery_id uuid, p_claim_token uuid, p_message_id text, p_delivered boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_retry integer;
begin
  if p_delivered then
    update notification_outbox set status = 'delivered', delivered_message_id = p_message_id,
      delivered_at = now(), claim_token = null, claimed_at = null
     where id = p_delivery_id and status = 'sending' and claim_token = p_claim_token;
  else
    select greatest(1, (s.value #>> '{}')::integer) into v_retry
      from notification_outbox d join platform_settings s on s.city_id = d.city_id
     where d.id = p_delivery_id and s.key = 'notification_delivery_retry_seconds';
    if v_retry is null then v_retry := 30; end if;
    update notification_outbox set status = 'pending', claim_token = null, claimed_at = null,
      next_attempt_at = now() + make_interval(secs => v_retry)
     where id = p_delivery_id and status = 'sending' and claim_token = p_claim_token;
  end if;
  return jsonb_build_object('ok', found);
end $$;

-- ----------------------------------------------------------------------------
-- abandon_notification_delivery: مسارٌ نهائيّ للعرض الميّت — انتهت مهلته أو لم يعد
--   pending قبل أن يصلَه الإشعار. لا إعادةُ إرسالٍ أبديةٌ لصفٍّ لن يُقبل أبدًا.
--   يُستدعى بالرمز كالـfinish فلا يُسلبَ صفٌّ من حائزه.
-- ----------------------------------------------------------------------------
create or replace function abandon_notification_delivery(
  p_delivery_id uuid, p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update notification_outbox set status = 'dead', claim_token = null, claimed_at = null
   where id = p_delivery_id and status = 'sending' and claim_token = p_claim_token;
  return jsonb_build_object('ok', found);
end $$;

grant execute on function claim_notification_delivery() to service_role;
grant execute on function finish_notification_delivery(uuid, uuid, text, boolean) to service_role;
grant execute on function abandon_notification_delivery(uuid, uuid) to service_role;

-- SECURITY DEFINER لا يكفي وحده: الدالة الجديدة تُمنح PUBLIC افتراضياً عند إنشائها.
revoke execute on function claim_notification_delivery() from public, anon, authenticated;
revoke execute on function finish_notification_delivery(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke execute on function abandon_notification_delivery(uuid, uuid) from public, anon, authenticated;
