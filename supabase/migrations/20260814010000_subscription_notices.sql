-- ---------------------------------------------------------------------------
-- الغرض: صندوقُ إشعاراتِ دورةِ حياةِ الاشتراك. ثلاثُ لحظاتٍ كانت تمرّ على السائق
--   بلا كلمةٍ واحدة، وكلُّها تمسّ رزقه:
--     ١) دفَع فتفعّل اشتراكه — ولا أحد يُخبره. فيظنّ الدفعَ ضائعاً ويفتح تذكرة.
--     ٢) انتهت تجربتُه المجانية — فتتوقّف الطلبات عنه بلا سبب ظاهر. الأسوأ أنّه
--        لا يعرف أنّ أمامه بابين: أن يشترك، أو أن ينتقل إلى قروب غير المشتركين.
--     ٣) انتهى اشتراكه المدفوع أو نفَذ إلغاؤه — نفس الصمت.
--   قطعُ الرزق بلا إشعارٍ ليس نقصَ ميزةٍ بل عيبٌ تجاريّ: يُنتج سائقاً يظنّ المنصّة
--   عاطلة، وتذكرةَ دعمٍ لكلّ حالة، وانسحاباً صامتاً لا يُقاس.
-- الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: packages/application/subscription/deliver-notices.ts،
--   packages/infrastructure/subscription/notice-adapters.ts،
--   apps/workers/src/jobs/deliver-subscription-notices.ts
-- ملاحظات مستقبلية: أيُّ لحظةٍ أخرى تستحقّ إشعاراً (تجديدٌ تلقائي، ردُّ مبلغ) تُضاف
--   نوعاً في `subscription_notice_kind` وتستدعي `enqueue_subscription_notice` من
--   داخل معاملتها — لا من طبقةِ التطبيق، وإلّا عاد الصمتُ عند سقوطِ الشوط.
--
-- لماذا صندوقٌ في القاعدة لا إرسالٌ مباشر: الإشعارُ يُكتب في نفسِ معاملةِ تغيُّرِ
-- الحالة. لو أُرسل من طبقةِ التطبيق بعد نجاح الـRPC، لكان سقوطُ العامل بين
-- الاثنين يعني اشتراكاً منتهياً بلا إشعارٍ إلى الأبد — وهي الحالة التي لا يكتشفها
-- أحد. والعكس (إشعارٌ بلا تغيُّرِ حالة) يمنعه أنّ الاثنين في معاملةٍ واحدة.
-- ---------------------------------------------------------------------------

create type subscription_notice_kind as enum (
  'activated',
  'trial_expired',
  'expired',
  'cancelled'
);

create type subscription_notice_status as enum (
  'pending',
  'sending',
  'sent',
  'failed'
);

create table subscription_notices (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities(id) on delete cascade,
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  driver_id uuid not null references drivers(id) on delete cascade,
  kind subscription_notice_kind not null,
  chat_id bigint not null,
  -- اللغةُ تُلتقط لحظةَ الإنشاء لا لحظةَ الإرسال: من غيّر لغتَه بعد انتهاء
  -- اشتراكه يستحقّ إشعاراً بلغةٍ يفهمها، والالتقاطُ هنا يمنع اختلافَ نصّ
  -- الإشعار عن النصّ الذي حُسب عليه.
  language_code text not null,
  payload jsonb not null default '{}'::jsonb,
  status subscription_notice_status not null default 'pending',
  attempts integer not null default 0,
  claim_token uuid,
  next_attempt_at timestamptz not null default now(),
  message_id bigint,
  error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  -- إشعارٌ واحدٌ لكلّ (اشتراك، نوع): «انتهى اشتراكك» مرّتين على نفس الصفّ يجعل
  -- السائق يشكّ في المنصّة كلّها. والتجديدُ يُنشئ صفَّ اشتراكٍ جديداً فلا يُحجب.
  constraint subscription_notices_once unique (subscription_id, kind),
  constraint subscription_notices_sent_shape check (
    (status <> 'sent') or (sent_at is not null and message_id is not null)
  )
);

create index subscription_notices_due
  on subscription_notices (city_id, next_attempt_at)
  where status = 'pending';

alter table subscription_notices enable row level security;

create policy subscription_notices_service_all on subscription_notices
  for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- إعداداتُ التسليم لكلّ مدينة — لا ثوابتَ في الكود
-- ---------------------------------------------------------------------------

insert into platform_settings (city_id, key, value, value_type, description_ar)
select id, 'subscription_notice_batch_limit', '25'::jsonb, 'number',
       'عدد إشعارات الاشتراك التي يُسلّمها شوطُ العامل الواحد في المدينة'
from cities on conflict (city_id, key) do nothing;
insert into platform_settings (city_id, key, value, value_type, description_ar)
select id, 'subscription_notice_retry_seconds', '90'::jsonb, 'number',
       'الفاصل بين محاولات تسليم إشعار اشتراك أخفق لسببٍ عابر'
from cities on conflict (city_id, key) do nothing;
insert into platform_settings (city_id, key, value, value_type, description_ar)
select id, 'subscription_notice_max_attempts', '5'::jsonb, 'number',
       'أقصى عدد محاولات لتسليم إشعار اشتراك قبل وسمه فاشلاً'
from cities on conflict (city_id, key) do nothing;

-- رابطُ قروب السائقين غير المشتركين: معرّفُ القروب في `cities` لا ينفع
-- سائقاً يريد الدخول — لا يُفتح بالمعرّف. يُترك فارغاً وموسوماً مبدئيّاً
-- حتّى يضعه المالك من لوحة الإعدادات؛ والإشعار يذكره إن وُجد ويُحيل إلى
-- الدعم إن لم يوجد — ولا يدّعي وجود رابطٍ ليس عنده.
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select id, 'unsubscribed_drivers_group_link', '""'::jsonb, 'string',
       'رابط دعوة قروب السائقين غير المشتركين — يُرسل لمن انتهت فترته ولم يشترك',
       true
from cities on conflict (city_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- الإدراج — تُستدعى من داخل معاملة تغيُّر الحالة
-- ---------------------------------------------------------------------------

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

  -- لا صفَّ سائق، أو محظور: لا إشعار. المحظورُ قُطع تواصلُه بقرارٍ إداريّ،
  -- وإشعارُه بانتهاء اشتراكه يفتح معه محادثةً قُصد إغلاقها.
  if not found or v_row.is_blocked then
    return null;
  end if;

  insert into subscription_notices
    (city_id, subscription_id, driver_id, kind, chat_id, language_code, payload)
  values
    (v_row.city_id, p_subscription_id, v_row.driver_id, p_kind,
     v_row.telegram_id, v_row.language_code,
     coalesce(p_payload, '{}'::jsonb)
       -- رابطُ القروب يُلتقط لحظةَ الإنشاء مع بقية الحمولة: قراءته لحظةَ
       -- الإرسال كانت تعني استعلاماً لكلّ إشعار من طبقة التطبيق.
       || jsonb_build_object('group_link',
            coalesce(get_setting(v_row.city_id, 'unsubscribed_drivers_group_link') #>> '{}', '')))
  on conflict (subscription_id, kind) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- الحجز — دفعةٌ بحدّ المدينة، بلا تنازعٍ بين شوطين
-- ---------------------------------------------------------------------------

create or replace function claim_subscription_notices(p_city_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_max_attempts integer;
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

  with due as (
    select n.id
      from subscription_notices n
     where n.city_id = p_city_id
       and n.status = 'pending'
       and n.next_attempt_at <= now()
     order by n.next_attempt_at
     limit v_limit
     -- SKIP LOCKED لا قفلٌ تطبيقيّ: عاملان في مدينةٍ واحدة يجب أن يتقاسما
     -- الصفوف لا أن يُرسل كلٌّ منهما نفس الإشعار.
     for update skip locked
  ),
  claimed as (
    update subscription_notices n
       set status = 'sending',
           attempts = n.attempts + 1,
           claim_token = v_token
      from due
     where n.id = due.id
    returning n.id, n.kind, n.chat_id, n.language_code, n.payload, n.attempts
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

-- ---------------------------------------------------------------------------
-- الإعلان عن النتيجة — لا «أُرسل» بلا معرّف رسالة
-- ---------------------------------------------------------------------------

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
  v_notice subscription_notices%rowtype;
  v_max_attempts integer;
  v_retry integer;
begin
  select * into v_notice
    from subscription_notices
   where id = p_notice_id and claim_token = p_claim_token and status = 'sending'
   for update;
  if not found then
    -- شوطٌ آخر يملك الصفّ، أو الصفُّ أُعلن سابقاً: الإعلانُ فوقه يُنتج إرسالاً
    -- ثانياً على نفس الإشعار.
    return jsonb_build_object('ok', false, 'error', 'NOT_CLAIMED_BY_CALLER');
  end if;

  if p_delivered then
    if p_message_id is null then
      return jsonb_build_object('ok', false, 'error', 'MESSAGE_ID_REQUIRED');
    end if;
    update subscription_notices
       set status = 'sent', message_id = p_message_id, sent_at = now(),
           error_code = null, claim_token = null
     where id = p_notice_id;
    return jsonb_build_object('ok', true, 'status', 'sent');
  end if;

  v_max_attempts := get_setting_number(v_notice.city_id, 'subscription_notice_max_attempts');
  if v_max_attempts is null then
    return jsonb_build_object('ok', false, 'error', 'NOTICE_ATTEMPTS_SETTING_MISSING');
  end if;

  if p_permanent or v_notice.attempts >= v_max_attempts then
    update subscription_notices
       set status = 'failed', error_code = p_error_code, claim_token = null
     where id = p_notice_id;
    return jsonb_build_object('ok', true, 'status', 'failed');
  end if;

  v_retry := get_setting_number(v_notice.city_id, 'subscription_notice_retry_seconds');
  if v_retry is null then
    return jsonb_build_object('ok', false, 'error', 'NOTICE_RETRY_SETTING_MISSING');
  end if;

  update subscription_notices
     set status = 'pending', claim_token = null, error_code = p_error_code,
         next_attempt_at = now() + make_interval(secs => v_retry)
   where id = p_notice_id;
  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

-- ---------------------------------------------------------------------------
-- وصلُ اللحظات الثلاث: التفعيل، والانتهاء، والإلغاء
-- ---------------------------------------------------------------------------

-- التفعيل المدفوع: نفس الجسم القائم، ويُضاف إليه سطرُ الإشعار داخل المعاملة.
create or replace function activate_subscription(
  p_driver_id uuid,
  p_plan subscription_plan,
  p_days integer default 30
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_price numeric;
  v_currency text;
  v_ends timestamptz;
  v_id uuid;
  v_key text;
begin
  select * into v_driver from drivers where id = p_driver_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  v_key := 'subscription_price_' || p_plan::text;
  v_price := get_setting_number(v_driver.city_id, v_key);
  v_currency := get_setting(v_driver.city_id, 'currency') #>> '{}';
  v_ends := now() + make_interval(days => p_days);

  update subscriptions
     set status = 'expired'
   where driver_id = p_driver_id and status in ('trialing', 'active');

  insert into subscriptions
    (city_id, driver_id, plan, status, current_period_end, price_amount, currency)
  values
    (v_driver.city_id, p_driver_id, p_plan, 'active', v_ends, v_price, v_currency)
  returning id into v_id;

  perform sync_driver_capabilities_to_plan(p_driver_id, p_plan);

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_driver.city_id, v_driver.user_id, 'subscription.activated', 'subscription', v_id,
          jsonb_build_object('plan', p_plan, 'price', v_price, 'currency', v_currency,
                             'period_end', v_ends));

  -- الوعدُ الذي كان يُخلَف: «يُفعَّل اشتراكك تلقائياً بعد نجاح الدفع» تُقال في
  -- رسالة الدفع، ثمّ يُفعَّل بصمت. فيعود السائق يسأل الدعمَ عن مصير نقوده.
  perform enqueue_subscription_notice(v_id, 'activated',
    jsonb_build_object('plan', p_plan::text, 'period_end', v_ends,
                       'price', v_price, 'currency', v_currency));

  return jsonb_build_object('ok', true, 'subscription_id', v_id,
                            'price', v_price, 'currency', v_currency, 'period_end', v_ends);
end;
$$;

-- الإنهاء الدوري: نفس منطق الهجرة 20260812130000، ويُضاف إشعارٌ لكلّ صفٍّ أُغلق.
create or replace function expire_due_subscriptions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired integer;
  v_cancelled integer;
begin
  with due as (
    select s.id, s.city_id, s.driver_id, s.status, s.plan, s.cancel_at_period_end,
           case when s.status = 'trialing' then s.trial_ends_at else s.current_period_end end as ends_at
      from subscriptions s
     where s.status in ('trialing', 'active')
  ),
  ripe as (
    select * from due where ends_at is not null and ends_at <= now()
  ),
  updated as (
    update subscriptions s
       set status = case when r.cancel_at_period_end then 'cancelled'::subscription_status
                         else 'expired'::subscription_status end
      from ripe r
     where s.id = r.id
    returning s.id, s.city_id, s.driver_id, r.status as previous_status, r.plan,
              r.ends_at, r.cancel_at_period_end, s.status as new_status
  ),
  logged as (
    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    select u.city_id, null,
           case when u.cancel_at_period_end then 'subscription.cancelled'
                else 'subscription.expired' end,
           'subscription', u.id,
           jsonb_build_object(
             'driver_id', u.driver_id,
             'previous_status', u.previous_status,
             'plan', u.plan,
             'ends_at', u.ends_at,
             'cancelled_by_request', u.cancel_at_period_end
           )
      from updated u
    returning entity_id as subscription_id,
              (payload->>'cancelled_by_request')::boolean as was_cancelled,
              payload->>'previous_status' as previous_status,
              payload->>'plan' as plan,
              payload->>'ends_at' as ends_at
  ),
  -- الإشعارُ يُميّز نهايةَ التجربة من نهايةِ اشتراكٍ مدفوع: الأولى دعوةٌ إلى
  -- الاشتراك، والثانية دعوةٌ إلى التجديد. رسالةٌ واحدةٌ للحالتين تُربك الاثنين.
  notified as (
    select enqueue_subscription_notice(
             l.subscription_id,
             (case
                when l.was_cancelled then 'cancelled'
                when l.previous_status = 'trialing' then 'trial_expired'
                else 'expired'
              end)::subscription_notice_kind,
             jsonb_build_object('plan', l.plan, 'ends_at', l.ends_at)
           ) as notice_id, l.was_cancelled
      from logged l
  )
  select count(*) filter (where not was_cancelled),
         count(*) filter (where was_cancelled)
    into v_expired, v_cancelled
    from notified;

  return jsonb_build_object('ok', true,
    'expired_subscriptions', v_expired,
    'cancelled_subscriptions', v_cancelled);
end;
$$;

-- ---------------------------------------------------------------------------
-- سطحُ الصلاحيات: كلُّ دالّةٍ أُنشئت أو استُبدلت أعلاه تعود مفتوحةً لـPUBLIC،
-- فتُسحب صراحةً. اختبار database-privilege-surface يحرس هذا.
-- ---------------------------------------------------------------------------

do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'enqueue_subscription_notice(uuid, subscription_notice_kind, jsonb)',
    'claim_subscription_notices(uuid)',
    'finish_subscription_notice(uuid, uuid, bigint, boolean, boolean, text)',
    'activate_subscription(uuid, subscription_plan, integer)',
    'expire_due_subscriptions()'
  ] loop
    execute format('revoke all on function %s from public', v_sig);
    execute format('revoke all on function %s from anon, authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end $$;
