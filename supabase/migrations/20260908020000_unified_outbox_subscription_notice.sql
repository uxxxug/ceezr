-- =============================================================================
-- F6-03 / ADR-0061: توحيدُ صندوقِ إشعاراتِ الاشتراكِ في notification_outbox.
-- الحالة: منفّذ (مرحلةُ التوسيعِ — الشطرُ الثاني). ينتمي إلى: supabase/migrations.
-- يبني على: 20260908010000 (توحيدُ safety)، ADR-0061.
-- يُتوقع أن يستخدمه لاحقاً: apps/workers/src/jobs/deliver-subscription-notices.ts.
--
-- ## ما تُغيّره هذه الهجرة
--
-- `subscription_notices` كان صندوقَ صادرٍ مستقلًّا لإشعاراتِ دورةِ حياةِ الاشتراك:
-- إدراجٌ بـenqueue_subscription_notice يلتقطُ chat_id/language_code لحظةَ الإنشاء،
-- وحجزُ دفعةٍ بحدِّ المدينة بـclaim_subscription_notices وtokenٍ مشترك، وإعلانٌ
-- بـfinish_subscription_notice بحالاتِ sent/failed/pending. هذا يكسرُ معيارَ
-- F6-03 «موحّدٌ ظاهرٌ في القاعدة».
--
-- الآن يصيرُ `notification_outbox` مصدرَ حالةِ تسليمِ إشعاراتِ الاشتراكِ:
-- - يُضافُ نوعُ `subscription_notice` وقيدُ شكلٍ جزئيٌّ يُلزِمُ chat_id/language_code
--   وnotice_kind في الحمولةِ عند هذا النوع.
-- - تُضافُ أعمدةُ chat_id وlanguage_code وerror_code (قابلةٌ للفراغِ لأنواعٍ
--   تُثرى حيًّا كالعرضِ والاستغاثة).
-- - تُضافُ حالةُ `failed` (الفشلُ الدائمُ برمزٍ). والداخلُ «موحَّدٌ» على
--   `delivered` لا `sent` — الأغلفةُ تُرجِعُ واجهتَها القديمةَ، والقاعدةُ تقولُ
--   delivered.
-- - enqueue_subscription_notice وclaim_subscription_notices وfinish_subscription_notice
--   تصيرُ أغلفةً على notification_outbox محافظةً على تواقيعِها ومُرجَعاتِها.
--
-- ## ما لا تُغيّره
--
-- جدولُ `subscription_notices` لا يُسقَطُ ههنا (يُسقَطُ في هجرةِ التقليصِ). والدوالُّ
-- القديمةُ صارت أغلفةً فلا تنكسرُ شيفرةُ العاملِ ولا الاختباراتُ دفعةً واحدةً — لكنّ
-- الاختباراتِ التي تقرأُ من subscription_notices تُحدَّثُ لتقرأَ من notification_outbox
-- حيثُ kind='subscription_notice'.
--
-- ## العودة
--
-- توسيعٌ (expand) لا كسرٌ: إضافةُ نوعٍ وأعمدةٍ وحالةٍ وأغلفةٍ. والعودةُ بالكودِ وحدَه:
-- النسخةُ السابقةُ تُودِعُ وتقرأُ من subscription_notices فلا تجدُ ما أودَعَتْه النسخةُ
-- الجديدةُ في notification_outbox — فلا يُنشَرُ أحدُهما دونَ الآخر.
-- =============================================================================

-- ١. قيدُ النوعِ: إضافةُ subscription_notice.
alter table notification_outbox drop constraint notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check
  check (kind in (
    'offer', 'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found',
    'order_cancelled',
    'safety_incident',
    'subscription_notice'
  ));

-- ٢. قيدُ الحالةِ: إضافةُ failed (الفشلُ الدائمُ برمزٍ). canceled لاحقاً مع broadcast.
alter table notification_outbox drop constraint notification_outbox_status_check;
alter table notification_outbox add constraint notification_outbox_status_check
  check (status in ('pending', 'sending', 'delivered', 'dead', 'failed'));

-- ٣. أعمدةٌ جديدة: chat_id وlanguage_code (مُلتقطانِ لحظةَ الإدراجِ للإشعارِ والبثّ)،
--    وerror_code (رمزُ الفشلِ الدائمِ). قابلةٌ للفراغِ لأنواعٍ تُثرى حيًّا.
alter table notification_outbox add column if not exists chat_id bigint;
alter table notification_outbox add column if not exists language_code text;
alter table notification_outbox add column if not exists error_code text;

-- ٤. قيدُ شكلٍ جزئيٌّ: عندَ subscription_notice يُلزَمُ chat_id وlanguage_code
--    وnotice_kind في الحمولةِ ضمن الأنواعِ الأربعةِ المعلومةِ — فلا يُودَعُ إشعارٌ
--    بلا متلقٍّ ولا نوعٍ فرعيٍّ، ولا نوعٌ فرعيٌّ غيرُ معروفٍ يحجزه المحوّل ثم يسقطه.
alter table notification_outbox drop constraint if exists notification_subscription_shape;
alter table notification_outbox add constraint notification_subscription_shape
  check (kind <> 'subscription_notice'
        or (chat_id is not null and language_code is not null
            and payload->>'notice_kind' in
                ('activated', 'trial_expired', 'expired', 'cancelled')));;

-- فهرسُ الاستحقاقِ لإشعاراتِ الاشتراكِ لكلِّ مدينة.
create index if not exists notification_outbox_subscription_due_idx
  on notification_outbox (city_id, next_attempt_at)
  where kind = 'subscription_notice' and status = 'pending';

-- ٥. enqueue_subscription_notice: غلافٌ يُودِعُ في notification_outbox. يلتقطُ
--    chat_id/language_code كما كان، ويخزّنُ النوعَ الفرعيَّ في الحمولةِ (notice_kind)،
--    ويُفردُ بـdedup_key = 'subscription:'||subscription_id||':'||kind. التوقيعُ والمُرجَعُ
--    (uuid|null) كما كانا.
create or replace function enqueue_subscription_notice(
  p_subscription_id uuid,
  p_kind subscription_notice_kind,
  p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_id uuid;
begin
  select s.city_id, s.driver_id, u.telegram_id, u.language_code, u.is_blocked
    into v_row
    from subscriptions s
    join drivers d on d.id = s.driver_id
    join users u on u.id = d.user_id
   where s.id = p_subscription_id;

  if not found or v_row.is_blocked then
    return null;
  end if;

  insert into notification_outbox
    (city_id, kind, dedup_key, chat_id, language_code, payload)
  values
    (v_row.city_id, 'subscription_notice',
     'subscription:' || p_subscription_id::text || ':' || p_kind::text,
     v_row.telegram_id, v_row.language_code,
     coalesce(p_payload, '{}'::jsonb)
       || jsonb_build_object('notice_kind', p_kind::text,
            'subscription_id', p_subscription_id,
            'group_link',
              coalesce(get_setting(v_row.city_id, 'unsubscribed_drivers_group_link') #>> '{}', '')))
  on conflict (kind, dedup_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

-- ٦. claim_subscription_notices: غلافٌ يفحصُ notification_outbox حيثُ
--    kind='subscription_notice' وcity_id=المدينة. يسترجِعُ أوّلاً حجوزَ الإشعارِ
--    المتروكةَ (sending أقدمُ من المهلةِ) كما كان يفعلُ المسارُ القديمُ، ثمّ يطالبُ
--    بدفعةٍ بـSKIP LOCKED وtokenٍ مشترك. المُرجَعُ بنفسِ الحقولِ (notice_id، kind
--    من الحمولةِ، chat_id، language_code، payload، attempts، max_attempts، claim_token).
create or replace function claim_subscription_notices(p_city_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_max_attempts integer;
  v_timeout integer;
  v_token uuid := gen_random_uuid();
  v_rows jsonb;
begin
  if not exists (select 1 from cities where id = p_city_id) then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_FOUND');
  end if;

  v_limit := get_setting_number(p_city_id, 'subscription_notice_batch_limit');
  if v_limit is null then
    return jsonb_build_object('ok', false, 'error', 'NOTICE_BATCH_SETTING_MISSING');
  end if;
  v_max_attempts := get_setting_number(p_city_id, 'subscription_notice_max_attempts');
  if v_max_attempts is null then
    return jsonb_build_object('ok', false, 'error', 'NOTICE_ATTEMPTS_SETTING_MISSING');
  end if;

  -- استرجاعُ الحجوزِ المتروكةِ: عاملٌ حجز ثمّ مات. مهلةُ الإشعارِ العامةُ
  -- notification_claim_timeout_seconds (افتراضٌ ٣٠٠) كما في claim_notification_delivery.
  v_timeout := coalesce(get_setting_number(p_city_id, 'notification_claim_timeout_seconds'), 300);
  update notification_outbox
     set status = 'pending', claim_token = null, claimed_at = null, next_attempt_at = now()
   where kind = 'subscription_notice'
     and city_id = p_city_id
     and status = 'sending'
     and claimed_at is not null
     and claimed_at < now() - make_interval(secs => v_timeout);

  with due as (
    select n.id
      from notification_outbox n
     where n.kind = 'subscription_notice'
       and n.city_id = p_city_id
       and n.status = 'pending'
       and n.next_attempt_at <= now()
     order by n.next_attempt_at
     limit v_limit
     for update skip locked
  ),
  claimed as (
    update notification_outbox n
       set status = 'sending',
           attempts = n.attempts + 1,
           claim_token = v_token,
           claimed_at = now()
      from due
     where n.id = due.id
    returning n.id, n.payload->>'notice_kind' as kind, n.chat_id, n.language_code,
              n.payload, n.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'notice_id', c.id,
           'kind', c.kind,
           'chat_id', c.chat_id::text,
           'language_code', c.language_code,
           'payload', c.payload,
           'attempts', c.attempts,
           'max_attempts', v_max_attempts,
           'claim_token', v_token
         )), '[]'::jsonb)
    into v_rows
    from claimed c;

  return jsonb_build_object('ok', true, 'notices', v_rows);
end;
$$;

-- ٧. finish_subscription_notice: غلافٌ يُحدِّثُ notification_outbox. message_id bigint
--    يُخزَنُ نصًّا في delivered_message_id. السلوكُ محفوظٌ: النجاحُ delivered، والفشلُ
--    الدائمُ أو بلوغُ السقفِ failed برمزٍ، والعابرُ pending بموعدٍ جديد. المُرجَعُ
--    بنفسِ الحالاتِ النصّيّةِ القديمةِ (sent/failed/pending) لتبقى واجهةُ RPC كما هي.
create or replace function finish_subscription_notice(
  p_notice_id uuid,
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
  v_max_attempts integer;
  v_retry integer;
begin
  select * into v_row
    from notification_outbox
   where id = p_notice_id and claim_token = p_claim_token and status = 'sending'
     and kind = 'subscription_notice'
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
           delivered_at = now(), error_code = null, claim_token = null, claimed_at = null
     where id = p_notice_id;
    return jsonb_build_object('ok', true, 'status', 'sent');
  end if;

  v_max_attempts := get_setting_number(v_row.city_id, 'subscription_notice_max_attempts');
  if v_max_attempts is null then
    return jsonb_build_object('ok', false, 'error', 'NOTICE_ATTEMPTS_SETTING_MISSING');
  end if;

  if p_permanent or v_row.attempts >= v_max_attempts then
    update notification_outbox
       set status = 'failed', error_code = p_error_code, claim_token = null, claimed_at = null
     where id = p_notice_id;
    return jsonb_build_object('ok', true, 'status', 'failed');
  end if;

  v_retry := get_setting_number(v_row.city_id, 'subscription_notice_retry_seconds');
  if v_retry is null then
    return jsonb_build_object('ok', false, 'error', 'NOTICE_RETRY_SETTING_MISSING');
  end if;

  update notification_outbox
     set status = 'pending', claim_token = null, claimed_at = null, error_code = p_error_code,
         next_attempt_at = now() + make_interval(secs => v_retry)
   where id = p_notice_id;
  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

-- ٨. إعادةُ قفلِ سطحِ definer بعدَ create or replace.
revoke execute on function enqueue_subscription_notice(uuid, subscription_notice_kind, jsonb) from public, anon, authenticated;
grant execute on function enqueue_subscription_notice(uuid, subscription_notice_kind, jsonb) to service_role;
revoke execute on function claim_subscription_notices(uuid) from public, anon, authenticated;
grant execute on function claim_subscription_notices(uuid) to service_role;
revoke execute on function finish_subscription_notice(uuid, uuid, bigint, boolean, boolean, text) from public, anon, authenticated;
grant execute on function finish_subscription_notice(uuid, uuid, bigint, boolean, boolean, text) to service_role;
