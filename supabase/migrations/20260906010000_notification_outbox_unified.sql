-- ============================================================================
-- الغرض: BUG-004 — توحيدُ صندوقِ الصادرِ: الجدولُ نفسُه يحملُ كلَّ نوعِ إشعارٍ
--   يقعُ أثرُه بعدَ تغيّرِ حالةٍ، لا نوعَ العرضِ وحدَه. العقدُ الموحَّدُ ثلاثةُ
--   أشياءَ: (1) الإيداعُ داخلَ معاملةِ تغييرِ الحالةِ نفسِها عبر
--   enqueue_notification، (2) لا أثرَ صادرٌ قبلَ الـcommit، (3) الالتقاطُ
--   والإتمامُ والتخلّي بالرمزِ عبرَ الدوالِّ القائمةِ نفسِها بلا تقنيةِ طابورٍ
--   جديدةٍ. والحمولةُ معرّفاتٌ لا نصوصٌ ولا بياناتُ اتصالٍ مخزَّنةٌ: كلُّ ما
--   يُقرأُ لحظةَ الإرسالِ يُقرأُ حيًّا في claim من مصدرِه الواحدِ، كما يفعلُ
--   مسارُ العرضِ اليومَ بـorder_offers.
-- الحالة: منفّذ فعلياً — 2026-09-06. النوعُ الأولُ المضافُ: قرارُ الدعمِ على
--   التذكرةِ (resolve_support_ticket). وبقيّةُ الأنواعِ تُضافُ كلٌّ بهجرتِه
--   ومنادِيه واختبارِه — لا نوعَ مُعلَنٌ في القيدِ بلا منادٍ يكتبُه.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: enqueue_notification (المنادَى من دوالِّ تغييرِ الحالةِ)،
--   claim_notification_delivery (الالتقاطُ الموحَّدُ بإغناءٍ حيٍّ لكلِّ نوعٍ).
-- ملاحظات مستقبلية: dedup_key هو مفتاحُ منعِ التكرارِ للأنواعِ غيرِ العرضِ،
--   ونوعُ العرضِ يمنعُ تكرارَه بقيدِ offer_id الفريدِ القائمِ منذ هجرتِه.
-- ============================================================================

-- 1) الحمولةُ ومفتاحُ منعِ التكرارِ، وتحريرُ الأعمدةِ الخاصّةِ بالعرضِ من الإلزامِ
--    لأنَّ نوعاً كقرارِ الدعمِ لا طلبَ له ولا سائقَ.
alter table notification_outbox add column if not exists payload jsonb not null default '{}'::jsonb;
alter table notification_outbox add column if not exists dedup_key text;
alter table notification_outbox alter column order_id drop not null;
alter table notification_outbox alter column driver_id drop not null;

-- 2) القيدُ على الأنواعِ يُوسَّع نوعاً واحداً — وله منادٍ يكتبُه في هذه الهجرةِ نفسِها.
alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check
  check (kind in ('offer', 'dispute_resolution'));

-- 3) ثوابتُ النوعِ مفروضةٌ في القاعدةِ لا في الكودِ: نوعُ العرضِ يلزمُه ثلاثيُّ
--    العرضِ، وما سواه يلزمُه مفتاحُ منعِ تكرارٍ ويُمنَعُ منه معرّفُ العرضِ.
alter table notification_outbox drop constraint if exists notification_offer_shape;
alter table notification_outbox add constraint notification_offer_shape check (
  (kind <> 'offer')
  or (offer_id is not null and order_id is not null and driver_id is not null)
);
alter table notification_outbox drop constraint if exists notification_nonoffer_shape;
alter table notification_outbox add constraint notification_nonoffer_shape check (
  (kind = 'offer') or (offer_id is null and dedup_key is not null)
);

-- 4) منعُ التكرارِ للأنواعِ غيرِ العرضِ: صفٌّ واحدٌ لكلِّ (نوعٍ، مفتاحٍ).
--    والـnull متمايزٌ في PostgreSQL فصفوفُ العرضِ (بلا مفتاحٍ) لا تتصادمُ ههنا،
--    ومنعُ تكرارِها قائمٌ بقيدِ offer_id الفريدِ من هجرتِها.
create unique index if not exists notification_outbox_dedup_uidx
  on notification_outbox(kind, dedup_key);

-- ----------------------------------------------------------------------------
-- enqueue_notification: بابُ الإيداعِ الواحدُ. يُنادى **داخلَ** معاملةِ تغييرِ
--   الحالةِ، فإن رجعت المعاملةُ رجعَ الصفُّ معها ولا يبقى أثرٌ يتيمٌ ينتظرُ
--   تنفيذاً لم يقع. وإعادةُ الإيداعِ بالمفتاحِ نفسِه لا تُنشئُ أثراً ثانياً.
--   يُرجع معرّفَ الصفِّ إن أُدرِج، وnull إن كان مودَعاً سلفاً.
-- ----------------------------------------------------------------------------
create or replace function enqueue_notification(
  p_city_id uuid, p_kind text, p_payload jsonb, p_dedup_key text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  insert into notification_outbox (city_id, kind, payload, dedup_key)
  values (p_city_id, p_kind, coalesce(p_payload, '{}'::jsonb), p_dedup_key)
  on conflict (kind, dedup_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

-- ----------------------------------------------------------------------------
-- claim_notification_delivery: الالتقاطُ الموحَّدُ. البنيةُ كما كانت — استرجاعُ
--   المتروكِ ثمّ FOR UPDATE SKIP LOCKED ورمزُ حجزٍ — والجديدُ أنَّ الردَّ صار
--   عامّاً: (kind, payload) بدلَ حقولِ العرضِ المفرودةِ. والإغناءُ حيٌّ لكلِّ
--   نوعٍ من مصدرِه الواحدِ لا من نسخةٍ مخزَّنةٍ:
--     * offer: المسافةُ والانتهاءُ وحالةُ العرضِ من order_offers.
--     * dispute_resolution: معرّفُ تلغرامَ ولغتُه من users عبرَ التذكرةِ، فإن
--       تعذَّرَ رجعَ null فيتخلّى العاملُ عن الصفِّ نهائيّاً (dead) لا يُعادُ أبداً.
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
  v_timeout integer;
  v_payload jsonb;
  v_owner_telegram bigint;
  v_owner_language text;
  v_owner_kind text;
begin
  select greatest(1, (value #>> '{}')::integer) into v_timeout from platform_settings
   where key = 'notification_claim_timeout_seconds' limit 1;
  if v_timeout is null then v_timeout := 300; end if;

  -- استرجاعُ الحجوزِ المتروكة: عاملٌ مات قبل أن يُعلن نتيجته ترك الصفَّ في sending.
  -- يُلغى رمزُ الحجز القديم فلو عاد العاملُ الميّت أعلنَ نتيجته ردّته finish بـNOT_CLAIMED.
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

  if v_delivery.kind = 'offer' then
    select jsonb_build_object(
             'offer_id', o.id, 'order_id', o.order_id, 'driver_id', o.driver_id,
             'distance_km', o.distance_km::text, 'expires_at', o.expires_at,
             'offer_status', o.status::text
           )
      into v_payload
      from order_offers o where o.id = v_delivery.offer_id;
  elsif v_delivery.kind = 'dispute_resolution' then
    -- صنفُ صاحبِ التذكرةِ جزءٌ من الحمولةِ لا تفصيلٌ داخليٌّ: الرسالةُ الخاصّةُ يجبُ
    -- أن تصلَه من البوتِ الذي يحاورُه هو، فمن يُرسِلُ يُختارُ بصنفِه لا بواحدٍ ثابتٍ.
    select u.telegram_id, u.language_code,
           case when tk.driver_id is not null then 'driver' else 'rider' end
      into v_owner_telegram, v_owner_language, v_owner_kind
      from support_tickets tk
      left join drivers d on d.id = tk.driver_id
      left join riders r on r.id = tk.rider_id
      join users u on u.id = coalesce(d.user_id, r.user_id)
     where tk.id = (v_delivery.payload->>'ticket_id')::uuid;
    v_payload := v_delivery.payload || jsonb_build_object(
      'owner_telegram_id', v_owner_telegram::text,
      'owner_language', coalesce(v_owner_language, 'ar'),
      'owner_kind', v_owner_kind
    );
  else
    v_payload := v_delivery.payload;
  end if;

  return (
    select jsonb_build_object('ok', true, 'delivery', jsonb_build_object(
      'delivery_id', n.id, 'kind', n.kind, 'city_id', n.city_id,
      'claim_token', v_token, 'attempts', n.attempts, 'max_attempts', v_max,
      'payload', coalesce(v_payload, '{}'::jsonb)
    ))
    from notification_outbox n where n.id = v_delivery.id
  );
end $$;

grant execute on function enqueue_notification(uuid, text, jsonb, text) to service_role;
revoke execute on function enqueue_notification(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function claim_notification_delivery() to service_role;
revoke execute on function claim_notification_delivery() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- resolve_support_ticket: نفسُ القرارِ ونفسُ حساباتِه، والتغييرُ الوحيدُ أنَّ
--   التبليغَ صارَ صفًّا مودَعًا في صندوقِ الصادرِ داخلَ المعاملةِ بدلَ أن يُرسَلَ
--   من مسارِ التطبيقِ بعدَ الـcommit. الحقولُ المُرجَعةُ كما كانت ويُزادُ عليها
--   notification_enqueued. (create or replace يحفظُ صلاحيّاتِ الدالّةِ القائمةَ.)
-- ----------------------------------------------------------------------------
create or replace function resolve_support_ticket(
  p_ticket_id uuid,
  p_actor_telegram_id bigint,
  p_action text,
  p_note text default null,
  p_days integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor jsonb;
  v_actor_id uuid;
  v_ticket support_tickets%rowtype;
  v_days integer;
  v_activated jsonb;
  v_status support_ticket_status;
  v_owner_telegram bigint;
  v_owner_language text;
  v_terminated integer := 0;
  v_enqueued boolean := false;
begin
  if p_action not in ('activate', 'terminate', 'reject') then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_ACTION');
  end if;

  v_actor := is_support_actor(p_actor_telegram_id);
  if not (v_actor->>'ok')::boolean then
    return v_actor;
  end if;
  v_actor_id := (v_actor->>'user_id')::uuid;

  select * into v_ticket from support_tickets where id = p_ticket_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'TICKET_NOT_FOUND');
  end if;
  if v_ticket.status in ('resolved', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'TICKET_ALREADY_SETTLED');
  end if;

  if p_action in ('activate', 'terminate') and v_ticket.driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'TICKET_HAS_NO_DRIVER');
  end if;

  if p_action = 'activate' then
    v_days := coalesce(p_days, get_setting_number(v_ticket.city_id, 'support_activation_days')::integer);
    if v_days is null or v_days <= 0 then
      return jsonb_build_object('ok', false, 'error', 'ACTIVATION_DAYS_MISSING');
    end if;
    -- الخطّة: خطّة آخر اشتراك للسائق إن وُجدت، وإلا نقل. لا نخترع خطّة «both».
    v_activated := activate_subscription(
      v_ticket.driver_id,
      coalesce(
        (select plan from subscriptions where driver_id = v_ticket.driver_id
          order by created_at desc limit 1),
        'transport'::subscription_plan
      ),
      v_days
    );
    if not (v_activated->>'ok')::boolean then
      return v_activated;
    end if;
    v_status := 'resolved';

  elsif p_action = 'terminate' then
    update subscriptions
       set status = 'cancelled'
     where driver_id = v_ticket.driver_id and status in ('trialing', 'active');
    v_terminated := coalesce((select count(*) from subscriptions
                               where driver_id = v_ticket.driver_id
                                 and status = 'cancelled'), 0);
    v_status := 'resolved';

  else
    v_status := 'rejected';
  end if;

  update support_tickets
     set status = v_status,
         resolved_by_user_id = v_actor_id,
         resolved_at = now(),
         resolution = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_ticket_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_ticket.city_id, v_actor_id, 'support.ticket_' || p_action, 'support_ticket', p_ticket_id,
          jsonb_build_object('role', v_actor->>'role', 'days', v_days, 'note', p_note));

  -- معرّف تلغرام لصاحب التذكرة ولغته: البوت يحتاجهما ليبلّغه بالقرار بلغته
  -- بلا استعلام ثانٍ، ولأن التبليغ بلغة النظام لمن لا يقرؤها إخطارٌ ضائع.
  if v_ticket.driver_id is not null then
    select u.telegram_id, u.language_code into v_owner_telegram, v_owner_language
      from users u join drivers d on d.user_id = u.id where d.id = v_ticket.driver_id;
  else
    select u.telegram_id, u.language_code into v_owner_telegram, v_owner_language
      from users u join riders r on r.user_id = u.id where r.id = v_ticket.rider_id;
  end if;

  -- تبليغُ صاحبِ التذكرةِ يُودَعُ في صندوقِ الصادرِ **هنا** — داخلَ معاملةِ القرارِ
  -- نفسِها (BUG-004): فإن رجعت المعاملةُ رجعَ الصفُّ معها فلا يقرأُ أحدٌ «فُعِّل
  -- اشتراكُك» عن تفعيلٍ لم يقع؛ وإن نجحت لم يضعْ تبليغُه لو تعطّلَ تلغرامُ لحظتَها.
  -- والحمولةُ معرّفاتٌ فقط: معرّفُ تلغرامَ ولغتُه يُقرآنِ حيَّينِ في claim من users.
  -- والمفتاحُ (التذكرةُ) يمنعُ صفَّينِ لقرارٍ واحدٍ.
  v_enqueued := enqueue_notification(
    v_ticket.city_id,
    'dispute_resolution',
    jsonb_build_object('ticket_id', p_ticket_id, 'action', p_action),
    'dispute_resolution:' || p_ticket_id::text
  ) is not null;

  return jsonb_build_object(
    'ok', true,
    'ticket_id', p_ticket_id,
    'notification_enqueued', v_enqueued,
    'action', p_action,
    'status', v_status,
    'type', v_ticket.type,
    'owner_telegram_id', v_owner_telegram,
    'owner_language', v_owner_language,
    'subscription', v_activated,
    'terminated_count', v_terminated
  );
end;
$$;
