-- =============================================================================
-- F6-03 المرحلة 3 — توحيد مستقبِلي البثّ (broadcast_recipients) في صندوق
-- الصادر الموحَّد. المستقبِلون يصبحون صفوفًا من نوع `broadcast_recipient` في
-- `notification_outbox`، وتُعيد دوالُ البثِّ الأربع تعريفَ نفسها كأغلفةٍ على
-- الصندوق الموحَّد محافظةً على تواقيعها القديمة تمامًا. الحملةُ نفسها
-- (`broadcast_campaigns`) تبقى جدولَ الحقيقة للحملة.
--
-- نسخةٌ موسِّعة (expand) من نهج expand-then-contract: الجدول القديم يُترك
-- مكانَه وحدَه في هذه الهجرة، والإسقاط مؤجَّلٌ إلى هجرة التقليص بعد استقرار
-- التسليم من المصدر الموحَّد. لذا التراجع (rollback) ممكنٌ بأمان: الغلافُ
-- القديم يعمل لأنّ الجدول القديم ما زال موجودًا.
--
-- يتقدّم هذا الملفّ على:
--   20260906010000_notification_outbox_unified.sql (الصندوق الأساسي)
--   20260814000000_admin_broadcast.sql (البثّ الأصلي)
--   20260814040000_reclaim_abandoned_outbox_claims.sql (استرجاع الحجوز المتروكة)
-- =============================================================================
-- الحالة: موسِّعة — أُضيف 2026-09-08 ضمن F6-03 المرحلة 3.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ١) نوعُ المستقبِلِ وحالةُ الإلغاء
-- ---------------------------------------------------------------------------

-- نوع `broadcast_recipient` جديدٌ على الصندوق: مستقبِلُ حملةٍ واحدة. لا
-- نُسقط القيد القديم أولاً (إن وُجد) ثمّ نُعيد تعريفه موسَّعًا.
alter table notification_outbox
  drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox
  add constraint notification_outbox_kind_check check (
    kind in (
      'offer','dispute_resolution','negotiation_turn_opened',
      'negotiation_turn_closed','negotiation_agreed','wider_circle_opened',
      'no_driver_found','order_cancelled','safety_incident',
      'subscription_notice','broadcast_recipient'
    )
  );

-- الإلغاء حالةٌ تشغيليّةٌ مستقلّةٌ (يُستخدمها `cancel_broadcast` على المستقبِلين
-- المعلَّقين)؛ الفشل حالةٌ نهائيّةٌ أخرى (فشل التسليم بعد استنفاد المحاولات).
alter table notification_outbox
  drop constraint if exists notification_outbox_status_check;
alter table notification_outbox
  add constraint notification_outbox_status_check check (
    status in ('pending','sending','delivered','dead','failed','canceled')
  );

-- ---------------------------------------------------------------------------
-- ٢) أعمدةُ التشغيل للمستقبِل — campaign_id وuser_id في أعمدة لا في payload
-- ---------------------------------------------------------------------------

alter table notification_outbox
  add column if not exists broadcast_campaign_id uuid
    references broadcast_campaigns(id) on delete cascade;
alter table notification_outbox
  add column if not exists recipient_user_id uuid
    references users(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- ٣) قيدُ الشكلِ الجزئيّ — مستقبِلٌ بلا حملةٍ أو مستقبِلٍ أو محادثةٍ
--    رسالةٌ ناقصة لا تصدر
-- ---------------------------------------------------------------------------

alter table notification_outbox
  add constraint notification_broadcast_shape check (
    kind <> 'broadcast_recipient'
    or (
      broadcast_campaign_id is not null
      and recipient_user_id is not null
      and chat_id is not null
      and chat_id <> 0
      and language_code is not null
    )
  );

-- ---------------------------------------------------------------------------
-- ٤) التفريدُ الماديّ — لا مستقبِلَ مرّتين في حملةٍ واحدة (يحفظ معنى
--    `broadcast_recipients_once` القديم) وindex جزئيّ على (campaign, user)
-- ---------------------------------------------------------------------------

-- التفريد عبر dedup_key يحفظه القيد الموحَّد (kind, dedup_key). نُلزم هنا
-- صياغةً ثابتةً للتفريد كي يتطابق التحقّقُ القديمُ مع الجديد.
alter table notification_outbox
  add constraint notification_broadcast_dedup_shape check (
    kind <> 'broadcast_recipient'
    or dedup_key = 'broadcast:' || broadcast_campaign_id::text
                       || ':' || recipient_user_id::text
  );

create unique index if not exists notification_outbox_broadcast_recipient_uidx
  on notification_outbox(broadcast_campaign_id, recipient_user_id)
  where kind = 'broadcast_recipient';

-- ---------------------------------------------------------------------------
-- ٥) فهارسُ التسليم للمستقبِلين — بالحملة والحالة (لمراجعة الإكمال) وبالمدينة
--    للحجز (كما كان في الجدول القديم)
-- ---------------------------------------------------------------------------

create index if not exists notification_outbox_broadcast_campaign_status_idx
  on notification_outbox(broadcast_campaign_id, status)
  where kind = 'broadcast_recipient';

create index if not exists notification_outbox_broadcast_due_idx
  on notification_outbox(city_id, next_attempt_at)
  where kind = 'broadcast_recipient' and status = 'pending';

create index if not exists notification_outbox_broadcast_abandoned_idx
  on notification_outbox(city_id, claimed_at)
  where kind = 'broadcast_recipient' and status = 'sending';

-- ---------------------------------------------------------------------------
-- ٦) غلاف الإنشاء — create_broadcast: نفس التوقيع، يكتب المستقبِلين في
--    notification_outbox بدل broadcast_recipients
-- ---------------------------------------------------------------------------

create or replace function create_broadcast(
  p_actor_user_id uuid,
  p_city_id uuid,
  p_audience text,
  p_filters jsonb,
  p_body text,
  p_link_label text,
  p_link_url text,
  p_silent boolean,
  p_send_after timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor users%rowtype;
  v_batch uuid := gen_random_uuid();
  v_start timestamptz := coalesce(p_send_after, now());
  v_total integer := 0;
  v_cities jsonb := '[]'::jsonb;
  v_city record;
  v_campaign_id uuid;
  v_count integer;
begin
  select * into v_actor from users where id = p_actor_user_id;
  if not found or v_actor.role <> 'admin' or v_actor.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;
  if p_audience not in ('drivers', 'riders') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_AUDIENCE');
  end if;
  if coalesce(length(btrim(p_body)), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'EMPTY_BODY');
  end if;
  if length(btrim(p_body)) > 3500 then
    return jsonb_build_object('ok', false, 'error', 'BODY_TOO_LONG');
  end if;
  if (p_link_label is null) <> (p_link_url is null) then
    return jsonb_build_object('ok', false, 'error', 'INCOMPLETE_LINK');
  end if;
  if p_link_url is not null and p_link_url !~ '^https://[^\\s]{3,}$' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LINK_URL');
  end if;
  if p_city_id is not null and not exists (select 1 from cities where id = p_city_id) then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_FOUND');
  end if;

  for v_city in
    select a.city_id as id, count(*)::integer as recipients
      from broadcast_audience(p_city_id, p_audience, p_filters) a
     group by a.city_id
     order by a.city_id
  loop
    insert into broadcast_campaigns (
      city_id, batch_id, audience, filters, body, link_label, link_url, silent,
      recipients_total, created_by_user_id
    ) values (
      v_city.id, v_batch, p_audience, coalesce(p_filters, '{}'::jsonb), btrim(p_body),
      p_link_label, p_link_url, coalesce(p_silent, false), v_city.recipients, v_actor.id
    ) returning id into v_campaign_id;

    insert into notification_outbox (
      city_id, kind, status, broadcast_campaign_id, recipient_user_id,
      chat_id, language_code, next_attempt_at, dedup_key, payload
    )
    select a.city_id, 'broadcast_recipient', 'pending',
           v_campaign_id, a.user_id, a.chat_id, a.language_code, v_start,
           'broadcast:' || v_campaign_id::text || ':' || a.user_id::text,
           jsonb_build_object('audience', p_audience)
    from broadcast_audience(p_city_id, p_audience, p_filters) a
    where a.city_id = v_city.id
    on conflict (broadcast_campaign_id, recipient_user_id)
      where kind = 'broadcast_recipient' do nothing;

    v_count := v_city.recipients;
    v_total := v_total + v_count;
    v_cities := v_cities || jsonb_build_array(jsonb_build_object(
      'city_id', v_city.id, 'campaign_id', v_campaign_id, 'recipients', v_count));

    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    values (v_city.id, v_actor.id, 'broadcast.created', 'broadcast', v_campaign_id,
            jsonb_build_object('batch_id', v_batch, 'audience', p_audience,
                               'filters', coalesce(p_filters, '{}'::jsonb),
                               'recipients', v_count, 'silent', coalesce(p_silent, false),
                               'send_after', v_start));
  end loop;

  if v_total = 0 then
    return jsonb_build_object('ok', false, 'error', 'EMPTY_AUDIENCE');
  end if;

  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'total', v_total,
                            'cities', v_cities, 'send_after', v_start);
end $$;

revoke all on function create_broadcast(uuid, uuid, text, jsonb, text, text, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function create_broadcast(uuid, uuid, text, jsonb, text, text, text, boolean, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- ٧) غلاف الحجز — claim_broadcast_recipients: يسترجع المتروك ثمّ يحجز المستحقّ
--    من notification_outbox. نفس التوقيع ونفس حقول الردّ القديمة.
-- ---------------------------------------------------------------------------

create or replace function claim_broadcast_recipients(p_city_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_max integer;
  v_timeout integer;
  v_token uuid := gen_random_uuid();
  v_rows jsonb;
begin
  if p_city_id is null or not exists (select 1 from cities where id = p_city_id) then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_FOUND');
  end if;
  select greatest(1, (value #>> '{}')::integer) into v_limit from platform_settings
   where city_id = p_city_id and key = 'broadcast_batch_limit';
  if v_limit is null then
    return jsonb_build_object('ok', false, 'error', 'BROADCAST_BATCH_SETTING_MISSING');
  end if;
  select greatest(1, (value #>> '{}')::integer) into v_max from platform_settings
   where city_id = p_city_id and key = 'broadcast_max_attempts';
  if v_max is null then
    return jsonb_build_object('ok', false, 'error', 'BROADCAST_ATTEMPTS_SETTING_MISSING');
  end if;
  select greatest(1, (value #>> '{}')::integer) into v_timeout from platform_settings
   where city_id = p_city_id and key = 'broadcast_claim_timeout_seconds';
  if v_timeout is null then
    return jsonb_build_object('ok', false, 'error', 'BROADCAST_TIMEOUT_SETTING_MISSING');
  end if;

  -- استرجاعُ الحجوز المتروكة: عاملٌ مات وترك الصفَّ في `sending`. نُعيده
  -- `pending` ونُبطل رمزَ حجزِه القديم كي لا يعلنَ فوقه لاحقًا.
  update notification_outbox r
     set status = 'pending', claim_token = null, claimed_at = null,
         error_code = 'CLAIM_ABANDONED', next_attempt_at = now()
   where r.city_id = p_city_id
     and r.kind = 'broadcast_recipient'
     and r.status = 'sending'
     and r.claimed_at is not null
     and r.claimed_at < now() - make_interval(secs => v_timeout);

  with due as (
    select r.id
      from notification_outbox r
      join broadcast_campaigns k on k.id = r.broadcast_campaign_id
     where r.city_id = p_city_id
       and r.kind = 'broadcast_recipient'
       and r.status = 'pending'
       and r.next_attempt_at <= now()
       and k.status = 'sending'
     order by r.next_attempt_at, r.created_at
     for update of r skip locked
     limit v_limit
  ),
  claimed as (
    update notification_outbox r
       set status = 'sending', attempts = r.attempts + 1,
           claim_token = v_token, claimed_at = now()
     where r.id in (select id from due)
    returning r.id, r.broadcast_campaign_id, r.chat_id, r.language_code, r.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'recipient_id', c.id, 'chat_id', c.chat_id::text,
           'language_code', c.language_code, 'attempts', c.attempts,
           'max_attempts', v_max, 'claim_token', v_token,
           'audience', k.audience, 'body', k.body, 'silent', k.silent,
           'link_label', k.link_label, 'link_url', k.link_url)), '[]'::jsonb)
    into v_rows
    from claimed c join broadcast_campaigns k on k.id = c.broadcast_campaign_id;

  return jsonb_build_object('ok', true, 'recipients', v_rows);
end $$;

revoke all on function claim_broadcast_recipients(uuid) from public, anon, authenticated;
grant execute on function claim_broadcast_recipients(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- ٨) غلاف إعلان النتيجة — finish_broadcast_delivery: يُحدِّث المستقبِل في
--    notification_outbox ثمّ يُختم الحملة حين لا يبقى معلَّقٌ ولا جارٍ. آثارُ
--    إكمال الحملة محفوظةٌ تمامًا كما في الأصل.
-- ---------------------------------------------------------------------------

create or replace function finish_broadcast_delivery(
  p_recipient_id uuid,
  p_claim_token uuid,
  p_message_id bigint,
  p_delivered boolean,
  p_permanent boolean,
  p_error_code text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row notification_outbox%rowtype;
  v_retry integer;
  v_max integer;
  v_final boolean;
begin
  select * into v_row from notification_outbox
   where id = p_recipient_id
     and kind = 'broadcast_recipient'
     and status = 'sending'
     and claim_token = p_claim_token
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_CLAIMED_BY_CALLER');
  end if;

  if p_delivered then
    if p_message_id is null then
      return jsonb_build_object('ok', false, 'error', 'MESSAGE_ID_REQUIRED');
    end if;
    update notification_outbox
       set status = 'delivered', delivered_message_id = p_message_id::text,
           delivered_at = now(), error_code = null,
           claim_token = null, claimed_at = null
     where id = v_row.id;
  else
    select greatest(1, (value #>> '{}')::integer) into v_retry from platform_settings
     where city_id = v_row.city_id and key = 'broadcast_retry_seconds';
    select greatest(1, (value #>> '{}')::integer) into v_max from platform_settings
     where city_id = v_row.city_id and key = 'broadcast_max_attempts';
    if v_retry is null or v_max is null then
      return jsonb_build_object('ok', false, 'error', 'BROADCAST_RETRY_SETTING_MISSING');
    end if;
    v_final := coalesce(p_permanent, false) or v_row.attempts >= v_max;
    if v_final then
      update notification_outbox
         set status = 'failed', error_code = p_error_code,
             claim_token = null, claimed_at = null
       where id = v_row.id;
    else
      update notification_outbox
         set status = 'pending', error_code = p_error_code,
             claim_token = null, claimed_at = null,
             next_attempt_at = now() + make_interval(secs => v_retry)
       where id = v_row.id;
    end if;
  end if;

  -- إكمالُ الحملة محسوبٌ من الصفوف لا مُعلَنٌ من العامل: لا تختم حملةً ناقصةً
  -- لو أعيد تشغيل العامل في منتصف الشوط. الحملةُ المُلغاةُ لا تُختم هنا.
  update broadcast_campaigns k
     set status = 'completed'
   where k.id = v_row.broadcast_campaign_id
     and k.status = 'sending'
     and not exists (
       select 1 from notification_outbox r
        where r.kind = 'broadcast_recipient'
          and r.broadcast_campaign_id = k.id
          and r.status in ('pending', 'sending')
     );

  return jsonb_build_object('ok', true);
end $$;

revoke all on function finish_broadcast_delivery(uuid, uuid, bigint, boolean, boolean, text)
  from public, anon, authenticated;
grant execute on function finish_broadcast_delivery(uuid, uuid, bigint, boolean, boolean, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- ٩) غلاف الإلغاء — cancel_broadcast: يُلغي المستقبِلين المعلَّقين في
--    notification_outbox (لا الجاري، فهو محجوزٌ بيدِ عامل) ويُلغي الحملة.
-- ---------------------------------------------------------------------------

create or replace function cancel_broadcast(
  p_actor_user_id uuid,
  p_batch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor users%rowtype;
  v_canceled integer := 0;
  v_campaign record;
begin
  select * into v_actor from users where id = p_actor_user_id;
  if not found or v_actor.role <> 'admin' or v_actor.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;
  if not exists (select 1 from broadcast_campaigns where batch_id = p_batch_id) then
    return jsonb_build_object('ok', false, 'error', 'BATCH_NOT_FOUND');
  end if;

  for v_campaign in
    select id, city_id from broadcast_campaigns
     where batch_id = p_batch_id and status = 'sending' for update
  loop
    with stopped as (
      update notification_outbox set status = 'canceled', claim_token = null,
             claimed_at = null
       where broadcast_campaign_id = v_campaign.id
         and kind = 'broadcast_recipient'
         and status = 'pending'
      returning 1
    )
    select v_canceled + count(*)::integer into v_canceled from stopped;

    update broadcast_campaigns set status = 'canceled' where id = v_campaign.id;

    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    values (v_campaign.city_id, v_actor.id, 'broadcast.canceled', 'broadcast', v_campaign.id,
            jsonb_build_object('batch_id', p_batch_id));
  end loop;

  return jsonb_build_object('ok', true, 'canceled', v_canceled);
end $$;

revoke all on function cancel_broadcast(uuid, uuid) from public, anon, authenticated;
grant execute on function cancel_broadcast(uuid, uuid) to service_role;
