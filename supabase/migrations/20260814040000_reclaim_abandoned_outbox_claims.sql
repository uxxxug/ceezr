-- =============================================================================
-- الغرض: استرجاعُ الحجوزِ المتروكة في صندوقَي الصادر — البثُّ الجماعي وإشعاراتُ
--   الاشتراك. عاملٌ حجز صفّاً ثمّ مات قبل أن يُعلن نتيجته يترك الصفَّ في
--   `sending` إلى الأبد: `claim` لا تلتقط إلّا `pending`، والإلغاءُ لا يمسّ
--   `sending`، والحملةُ لا تُختم لأنّ الختمَ محسوبٌ على «لا معلَّقٌ ولا جارٍ».
--   فرسالةٌ لا تصل، وحملةٌ معلَّقةٌ في اللوحة أبداً، وسائقٌ لا يُشعَر بتفعيله.
-- الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: claim_broadcast_recipients، claim_subscription_notices
-- ملاحظات مستقبلية: الاسترجاعُ داخل `claim` نفسها لا في مهمّةٍ ثانية: صندوقُ
--   صادرٍ يحتاج جارِفاً منفصلاً كي يعمل هو صندوقٌ ينتظر أن يُنسى ذلك الجارف.
--
-- الدلالةُ المقصودة: تسليمٌ مرّةً على الأقلّ. حجزٌ استُرجع بعد مهلته قد يكون
-- إرسالُه نجح فعلاً قبل موتِ العامل، فتصل الرسالةُ مرّتين. هذا مقبولٌ هنا لأنّ
-- المحتوى إخباريّ لا ماليّ: لا تفعيلَ ولا خصمَ يُبنى على وصول الرسالة، والبديلُ
-- — أن لا تصل أبداً — أسوأ. والمحاولاتُ تُعدّ عند الاسترجاع، فسقفُ المحاولات
-- يحدّ التكرارَ ولا يجعله بلا نهاية.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ١) لحظةُ الحجز عمودٌ صريح لا `updated_at` مُستنتَج
-- ---------------------------------------------------------------------------
-- `updated_at` يتحرّك بأيّ تعديلٍ لاحق، فبناءُ المهلة عليه يعني أنّ تعديلاً
-- إداريّاً على الصفّ يُجدّد حجزاً ميّتاً. العمودُ الصريح يقول ما يقصده.

alter table broadcast_recipients
  add column if not exists claimed_at timestamptz;
alter table subscription_notices
  add column if not exists claimed_at timestamptz;

-- صفوفٌ عالقةٌ من قبل هذه الترحيلة لا لحظةَ حجزٍ لها، فتُعطى الآن كي تدخل
-- المهلةَ بدلاً من أن تبقى خارج كلّ حساب.
update broadcast_recipients set claimed_at = updated_at
 where status = 'sending' and claimed_at is null;
-- إشعاراتُ الاشتراك لا `updated_at` لها، فتُؤخذ لحظةُ الإنشاء: أقدمُ ممّا جرى
-- فعلاً، فتدخل المهلةَ فوراً — وهذا هو المطلوب لصفٍّ عالقٍ منذ ما قبل الترحيلة.
update subscription_notices set claimed_at = created_at
 where status = 'sending' and claimed_at is null;

create index if not exists broadcast_recipients_abandoned_idx
  on broadcast_recipients(city_id, claimed_at) where status = 'sending';
create index if not exists subscription_notices_abandoned_idx
  on subscription_notices(city_id, claimed_at) where status = 'sending';

-- ---------------------------------------------------------------------------
-- ٢) المهلة — إعدادُ مدينةٍ لا رقمٌ في الكود
-- ---------------------------------------------------------------------------
-- يجب أن تكون أطولَ بكثيرٍ من زمنِ شوطٍ كامل: مهلةٌ قصيرةٌ تسحب الصفَّ من عاملٍ
-- ما زال يعمل عليه، فتُرسله مرّتين بلا سببٍ حقيقيّ.

insert into platform_settings (city_id, key, value, value_type, description_ar)
select id, 'broadcast_claim_timeout_seconds', '300'::jsonb, 'number',
       'المهلة التي بعدها يُعدّ حجزُ رسالةِ بثٍّ متروكاً فيُعاد إلى الانتظار'
from cities on conflict (city_id, key) do nothing;

insert into platform_settings (city_id, key, value, value_type, description_ar)
select id, 'subscription_notice_claim_timeout_seconds', '300'::jsonb, 'number',
       'المهلة التي بعدها يُعدّ حجزُ إشعارِ اشتراكٍ متروكاً فيُعاد إلى الانتظار'
from cities on conflict (city_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- ٣) حجزُ البثّ: يُسترجع المتروكَ أوّلاً ثمّ يحجز المستحقّ
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

  -- الاسترجاعُ يُبطل رمزَ الحجز القديم: لو عاد العاملُ الميّت إلى الحياة وأعلن
  -- نتيجته، ردَّته `finish` بـNOT_CLAIMED_BY_CALLER ولم يُعلن فوق حجزٍ ليس له.
  update broadcast_recipients r
     set status = 'pending', claim_token = null, claimed_at = null,
         error_code = 'CLAIM_ABANDONED', next_attempt_at = now()
   where r.city_id = p_city_id
     and r.status = 'sending'
     and r.claimed_at is not null
     and r.claimed_at < now() - make_interval(secs => v_timeout);

  with due as (
    select r.id
      from broadcast_recipients r
      join broadcast_campaigns k on k.id = r.campaign_id
     where r.city_id = p_city_id
       and r.status = 'pending'
       and r.next_attempt_at <= now()
       and k.status = 'sending'
     order by r.next_attempt_at, r.created_at
     for update of r skip locked
     limit v_limit
  ),
  claimed as (
    update broadcast_recipients r
       set status = 'sending', attempts = r.attempts + 1,
           claim_token = v_token, claimed_at = now()
     where r.id in (select id from due)
    returning r.id, r.campaign_id, r.chat_id, r.language_code, r.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'recipient_id', c.id, 'chat_id', c.chat_id::text,
           'language_code', c.language_code, 'attempts', c.attempts,
           'max_attempts', v_max, 'claim_token', v_token,
           'audience', k.audience, 'body', k.body, 'silent', k.silent,
           'link_label', k.link_label, 'link_url', k.link_url)), '[]'::jsonb)
    into v_rows
    from claimed c join broadcast_campaigns k on k.id = c.campaign_id;

  return jsonb_build_object('ok', true, 'recipients', v_rows);
end $$;

revoke all on function claim_broadcast_recipients(uuid) from public;
grant execute on function claim_broadcast_recipients(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- ٤) إعلانُ نتيجةِ البثّ يُخلي لحظةَ الحجز
-- ---------------------------------------------------------------------------
-- بقاءُ `claimed_at` بعد الإعلان يجعل صفّاً مُعلَناً يبدو محجوزاً لو أُعيد يوماً
-- إلى `sending`، فيُسترجع بمهلةٍ محسوبةٍ من حجزٍ قديم.

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
  v_row broadcast_recipients%rowtype;
  v_retry integer;
  v_max integer;
  v_final boolean;
begin
  select * into v_row from broadcast_recipients
   where id = p_recipient_id and status = 'sending' and claim_token = p_claim_token
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_CLAIMED_BY_CALLER');
  end if;

  if p_delivered then
    -- معرّفُ رسالةٍ حقيقيّ شرطُ إعلانِ التسليم: بلا معرّفٍ ليس عندنا إلّا نيّة.
    if p_message_id is null then
      return jsonb_build_object('ok', false, 'error', 'MESSAGE_ID_REQUIRED');
    end if;
    update broadcast_recipients
       set status = 'sent', message_id = p_message_id, sent_at = now(),
           claim_token = null, claimed_at = null, error_code = null
     where id = v_row.id;
  else
    select greatest(1, (value #>> '{}')::integer) into v_retry from platform_settings
     where city_id = v_row.city_id and key = 'broadcast_retry_seconds';
    select greatest(1, (value #>> '{}')::integer) into v_max from platform_settings
     where city_id = v_row.city_id and key = 'broadcast_max_attempts';
    if v_retry is null or v_max is null then
      return jsonb_build_object('ok', false, 'error', 'BROADCAST_RETRY_SETTING_MISSING');
    end if;
    -- الفشلُ الدائم لا يُعاد: من حجب البوت أو أغلق محادثته لن يستقبلها بعد
    -- أربع محاولات، وإعادتُها تحرق حدَّ تلغرام على من لن يصله شيء.
    v_final := coalesce(p_permanent, false) or v_row.attempts >= v_max;
    if v_final then
      update broadcast_recipients
         set status = 'failed', claim_token = null, claimed_at = null,
             error_code = p_error_code
       where id = v_row.id;
    else
      update broadcast_recipients
         set status = 'pending', claim_token = null, claimed_at = null,
             error_code = p_error_code,
             next_attempt_at = now() + make_interval(secs => v_retry)
       where id = v_row.id;
    end if;
  end if;

  -- الحملةُ تُختم حين لا يبقى معلَّقٌ ولا جارٍ: الختمُ محسوبٌ من الصفوف لا
  -- مُعلَنٌ من العامل، فإعادةُ تشغيلٍ في منتصف الشوط لا تختم حملةً ناقصة.
  update broadcast_campaigns k
     set status = 'completed'
   where k.id = v_row.campaign_id
     and k.status = 'sending'
     and not exists (
       select 1 from broadcast_recipients r
        where r.campaign_id = k.id and r.status in ('pending', 'sending')
     );

  return jsonb_build_object('ok', true);
end $$;

revoke all on function finish_broadcast_delivery(uuid, uuid, bigint, boolean, boolean, text)
  from public;
grant execute on function finish_broadcast_delivery(uuid, uuid, bigint, boolean, boolean, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- ٥) حجزُ إشعاراتِ الاشتراك: نفسُ العلّة ونفسُ الدواء
-- ---------------------------------------------------------------------------
-- وهذه أخطرُ من البثّ: إشعارُ «فُعّل اشتراكك» عالقٌ في `sending` يعني سائقاً دفع
-- ولا يعلم أنّ دفعَه وصل.

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
  if p_city_id is null or not exists (select 1 from cities where id = p_city_id) then
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
  v_timeout := get_setting_number(p_city_id, 'subscription_notice_claim_timeout_seconds');
  if v_timeout is null then
    return jsonb_build_object('ok', false, 'error', 'NOTICE_TIMEOUT_SETTING_MISSING');
  end if;

  update subscription_notices n
     set status = 'pending', claim_token = null, claimed_at = null,
         error_code = 'CLAIM_ABANDONED', next_attempt_at = now()
   where n.city_id = p_city_id
     and n.status = 'sending'
     and n.claimed_at is not null
     and n.claimed_at < now() - make_interval(secs => v_timeout);

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
           claim_token = v_token,
           claimed_at = now()
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

revoke all on function claim_subscription_notices(uuid) from public;
grant execute on function claim_subscription_notices(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- ٦) إعلانُ نتيجةِ الإشعار يُخلي لحظةَ الحجز كذلك
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
           error_code = null, claim_token = null, claimed_at = null
     where id = p_notice_id;
    return jsonb_build_object('ok', true, 'status', 'sent');
  end if;

  v_max_attempts := get_setting_number(v_notice.city_id, 'subscription_notice_max_attempts');
  if v_max_attempts is null then
    return jsonb_build_object('ok', false, 'error', 'NOTICE_ATTEMPTS_SETTING_MISSING');
  end if;

  if p_permanent or v_notice.attempts >= v_max_attempts then
    update subscription_notices
       set status = 'failed', error_code = p_error_code,
           claim_token = null, claimed_at = null
     where id = p_notice_id;
    return jsonb_build_object('ok', true, 'status', 'failed');
  end if;

  v_retry := get_setting_number(v_notice.city_id, 'subscription_notice_retry_seconds');
  if v_retry is null then
    return jsonb_build_object('ok', false, 'error', 'NOTICE_RETRY_SETTING_MISSING');
  end if;

  update subscription_notices
     set status = 'pending', claim_token = null, claimed_at = null,
         error_code = p_error_code,
         next_attempt_at = now() + make_interval(secs => v_retry)
   where id = p_notice_id;
  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

revoke all on function finish_subscription_notice(uuid, uuid, bigint, boolean, boolean, text)
  from public;
grant execute on function finish_subscription_notice(uuid, uuid, bigint, boolean, boolean, text)
  to service_role;
