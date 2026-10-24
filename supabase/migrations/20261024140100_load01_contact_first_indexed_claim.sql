-- migration-phase: expand

-- LOAD-01 (فجوةُ السعةِ 2026-10-24، الدورةُ الثانية) — إعادةُ خطةِ الفهرسِ إلى التقاطِ
-- أولويةِ contact بعدَ أن كسرها تعبيرُ الترتيبِ في `20261024120000`.
--
-- السياقُ المُقاسُ (موجةُ m5-1500 على رأسِ #645، التشغيلُ 40082574451، VALID):
-- التنبؤُ المُسجَّلُ انكسرَ — G1 هبطتْ من 63.14% (خطُّ الأساسِ) إلى 40.25%. السببُ
-- المُقاسُ: تعبيرُ الأولويةِ في ORDER BY كسرَ خطةَ فهرسِ الالتقاطِ — عقدةُ Sort كاملةٌ
-- فوقَ مجموعةِ المعلَّقِ (ذروةُ الطابورِ ~1,700 في m5-1500) معَ تقييمٍ غيرِ كسولٍ
-- لتعبيرِ jsonb لكلِّ صفٍّ قبلَ الفرزِ، فصارَ `claim_telegram_update_jobs_for_bot`
-- ‏10.13ms/نداءً بعدَ <4.7ms في خطِّ الأساسِ، وارتفعَ انتظارُ p50 من 18.26ث إلى
-- 23.16ث فوقَ مهلةِ إثباتِ الهاتفِ (20ث).
--
-- الإصلاحُ: تجزئةُ الترتيبِ المُعلَنِ نفسِهِ (الفئةُ العليا = contact ∪ متقادمٌ
-- >120ث، ثمّ created_at داخلَ الفئة) إلى **ثلاثِ مراحلَ مُفهرسةٍ متعاقبةٍ** لا تغيّرُ
-- الدلالةَ شيئًا:
--   المرحلةُ 1: المتقادمُ >120ث (أيَّ نوعٍ) — مسحُ `telegram_update_jobs_pending_idx`
--              بحدٍّ علويٍّ على created_at (Incremental Sort لا Sort كاملٌ).
--   المرحلةُ 2: contact الطازجُ (≥ الحدِّ) — فهرسٌ جزئيٌّ جديدٌ
--              `telegram_update_jobs_contact_pending_idx` (مسحٌ خالصٌ بلا فرزٍ).
--   المرحلةُ 3: تعويضٌ FIFO خالصٌ (كخطِّ الأساسِ قبلَ #645) معَ استبعادِ ما التُقطَ
--              في المرحلتينِ السابقتينِ (في الدُّفعيِّ) — مسحُ الفهرسِ القائمِ.
-- التكافؤُ الرياضيُّ: كلُّ صفٍّ متقادمٍ أقدمُ من كلِّ صفٍّ طازجٍ (الحدُّ 120ث)، لذا
-- ترتيبُ (الفئةُ العليا ثمّ created_at) = المراحلُ الثلاثُ على الترتيبِ، وبطولِ
-- created_at داخلَ كلِّ مرحلةٍ. ترقيةُ التقادمِ ودلالةُ الأولويةِ وD4 (تقييمٌ كسولٌ
-- لا يتقيّمُ إلا للمرشَّحينِ في المسحِ المرتَّبِ) وسقفُ الدُّفعةِ (≤100) وسقفُ
-- المحاولاتِ والاسترجاعُ والإماتةُ ومرآةُ الإيصالِ — كلُّها كما هي حرفيًّا.
-- **لا رفعَ سعةٍ ولا حدٍّ محميٍّ يُمسُّ.**
--
-- الحتميةُ: `now()` في حدِّ التقادمِ مُقصدٌ (نافذةٌ زمنيةٌ) كما في `20261024120000`
-- ومستقرٌّ داخلَ المعاملةِ الواحدةِ فتتسقُ المراحلُ الثلاثُ على حدٍّ واحدٍ.
--
-- فهرسٌ جديدٌ واحدٌ: جزئيٌّ على المعلَّقِ منَ contact فقط، بمحمولٍ لا يعتمدُ معاملاتٍ
-- (حرفيٌّ كاملٌ) فتُثبتهُ الخطةُ العامةُ بعدَ تحوّلِ plpgsql إليها كما تُثبتهُ الخاصةُ.

-- الفهرسُ الجزئيُّ يُنشأُ في الملفِ السابقِ `20261024140000` (طورُ index، متزامنٌ)
-- — وهذا الملفُّ دوالٌ فقط: لا فهرسَ فيهُ ولا معاملةً صريحةً.


create or replace function claim_telegram_update_job(
  p_lease_timeout_seconds integer default 30,
  p_max_attempts integer default 5
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
  v_bot   text;
  v_uid   bigint;
  v_payload jsonb;
  v_attempts integer;
begin
  if p_lease_timeout_seconds is null or p_lease_timeout_seconds <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LEASE_TIMEOUT');
  end if;
  if p_max_attempts is null or p_max_attempts <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_MAX_ATTEMPTS');
  end if;

  with reclaimed as (
    update telegram_update_jobs
       set status = 'pending', claim_token = null, claimed_at = null, error_code = null
     where status = 'claimed'
       and claimed_at < now() - make_interval(secs => p_lease_timeout_seconds)
       and attempts < p_max_attempts
    returning bot, update_id
  )
  update telegram_update_receipts
     set status = 'pending', claim_token = null, claimed_at = null
   where (bot, update_id) in (select bot, update_id from reclaimed);

  with expired as (
    update telegram_update_jobs
       set status = 'dead', claim_token = null, claimed_at = null,
           completed_at = now(), error_code = coalesce(error_code, 'LEASE_EXPIRED')
     where status = 'claimed'
       and claimed_at < now() - make_interval(secs => p_lease_timeout_seconds)
       and attempts >= p_max_attempts
    returning bot, update_id
  )
  update telegram_update_receipts
     set status = 'failed', claim_token = null, claimed_at = null, completed_at = now()
   where (bot, update_id) in (select bot, update_id from expired);

  -- المرحلةُ 1: المتقادمُ >120ث (أيَّ نوعٍ) — مسحُ فهرسِ المعلَّقِ بحدٍّ علويٍّ.
  select j.bot, j.update_id, j.payload, j.attempts
    into v_bot, v_uid, v_payload, v_attempts
    from telegram_update_jobs j
   where j.status = 'pending' and j.attempts < p_max_attempts
     and j.next_attempt_at <= now()
     and j.created_at < now() - interval '120 seconds'
     -- D4: لا تُلتقَطُ وظيفةُ مستخدمٍ وأمامَها وظيفةٌ أقدمُ له معلَّقةٌ (ولو في فترةِ احتياطٍ) أو محجوزة.
     and (j.lane_key is null or not exists (
           select 1 from telegram_update_jobs e
            where e.lane_key = j.lane_key
              and e.status in ('pending', 'claimed') and e.attempts < p_max_attempts
              and (e.created_at, e.update_id) < (j.created_at, j.update_id)))
   order by j.created_at, j.update_id
   for update skip locked
   limit 1;

  if not found then
    -- المرحلةُ 2: contact الطازجُ — الفهرسُ الجزئيُّ الجديدُ.
    select j.bot, j.update_id, j.payload, j.attempts
      into v_bot, v_uid, v_payload, v_attempts
      from telegram_update_jobs j
     where j.status = 'pending' and j.attempts < p_max_attempts
       and j.next_attempt_at <= now()
       and j.created_at >= now() - interval '120 seconds'
       and j.payload #> '{message,contact}' is not null
       and (j.lane_key is null or not exists (
             select 1 from telegram_update_jobs e
              where e.lane_key = j.lane_key
                and e.status in ('pending', 'claimed') and e.attempts < p_max_attempts
                and (e.created_at, e.update_id) < (j.created_at, j.update_id)))
     order by j.created_at, j.update_id
     for update skip locked
     limit 1;
  end if;

  if not found then
    -- المرحلةُ 3: تعويضٌ FIFO خالصٌ كخطِّ الأساسِ (ما تبقّى لا يكونُ إلا رسائلَ طازجةً).
    select j.bot, j.update_id, j.payload, j.attempts
      into v_bot, v_uid, v_payload, v_attempts
      from telegram_update_jobs j
     where j.status = 'pending' and j.attempts < p_max_attempts
       and j.next_attempt_at <= now()
       and (j.lane_key is null or not exists (
             select 1 from telegram_update_jobs e
              where e.lane_key = j.lane_key
                and e.status in ('pending', 'claimed') and e.attempts < p_max_attempts
                and (e.created_at, e.update_id) < (j.created_at, j.update_id)))
     order by j.created_at, j.update_id
     for update skip locked
     limit 1;
  end if;

  if not found then
    return jsonb_build_object('ok', true, 'delivery', null);
  end if;

  v_token := gen_random_uuid();

  update telegram_update_jobs
     set status = 'claimed', claim_token = v_token,
         claimed_at = now(), attempts = attempts + 1
   where bot = v_bot and update_id = v_uid;

  update telegram_update_receipts
     set status = 'claimed', claim_token = v_token,
         claimed_at = now(), attempts = attempts + 1
   where bot = v_bot and update_id = v_uid;

  return jsonb_build_object(
    'ok', true,
    'delivery', jsonb_build_object(
      'bot', v_bot,
      'update_id', v_uid,
      'payload', v_payload,
      'claim_token', v_token,
      'attempts', v_attempts + 1,
      'max_attempts', p_max_attempts
    )
  );
end $$;

create or replace function claim_telegram_update_job_for_bot(
  p_lease_timeout_seconds integer,
  p_max_attempts integer,
  p_bot text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
  v_bot   text;
  v_uid   bigint;
  v_payload jsonb;
  v_attempts integer;
begin
  if p_lease_timeout_seconds is null or p_lease_timeout_seconds <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LEASE_TIMEOUT');
  end if;
  if p_max_attempts is null or p_max_attempts <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_MAX_ATTEMPTS');
  end if;

  with reclaimed as (
    update telegram_update_jobs
       set status = 'pending', claim_token = null, claimed_at = null, error_code = null
     where status = 'claimed'
       and claimed_at < now() - make_interval(secs => p_lease_timeout_seconds)
       and attempts < p_max_attempts
    returning bot, update_id
  )
  update telegram_update_receipts
     set status = 'pending', claim_token = null, claimed_at = null
   where (bot, update_id) in (select bot, update_id from reclaimed);

  with expired as (
    update telegram_update_jobs
       set status = 'dead', claim_token = null, claimed_at = null,
           completed_at = now(), error_code = coalesce(error_code, 'LEASE_EXPIRED')
     where status = 'claimed'
       and claimed_at < now() - make_interval(secs => p_lease_timeout_seconds)
       and attempts >= p_max_attempts
    returning bot, update_id
  )
  update telegram_update_receipts
     set status = 'failed', claim_token = null, claimed_at = null, completed_at = now()
   where (bot, update_id) in (select bot, update_id from expired);

  -- المرحلةُ 1: المتقادمُ >120ث (أيَّ نوعٍ) — مسحُ فهرسِ المعلَّقِ بحدٍّ علويٍّ.
  select j.bot, j.update_id, j.payload, j.attempts
    into v_bot, v_uid, v_payload, v_attempts
    from telegram_update_jobs j
   where j.status = 'pending' and j.attempts < p_max_attempts
     and j.next_attempt_at <= now()
     and j.bot = p_bot
     and j.created_at < now() - interval '120 seconds'
     and (j.lane_key is null or not exists (
           select 1 from telegram_update_jobs e
            where e.lane_key = j.lane_key
              and e.status in ('pending', 'claimed') and e.attempts < p_max_attempts
              and (e.created_at, e.update_id) < (j.created_at, j.update_id)))
   order by j.created_at, j.update_id
   for update skip locked
   limit 1;

  if not found then
    -- المرحلةُ 2: contact الطازجُ — الفهرسُ الجزئيُّ الجديدُ.
    select j.bot, j.update_id, j.payload, j.attempts
      into v_bot, v_uid, v_payload, v_attempts
      from telegram_update_jobs j
     where j.status = 'pending' and j.attempts < p_max_attempts
       and j.next_attempt_at <= now()
       and j.bot = p_bot
       and j.created_at >= now() - interval '120 seconds'
       and j.payload #> '{message,contact}' is not null
       and (j.lane_key is null or not exists (
             select 1 from telegram_update_jobs e
              where e.lane_key = j.lane_key
                and e.status in ('pending', 'claimed') and e.attempts < p_max_attempts
                and (e.created_at, e.update_id) < (j.created_at, j.update_id)))
     order by j.created_at, j.update_id
     for update skip locked
     limit 1;
  end if;

  if not found then
    -- المرحلةُ 3: تعويضٌ FIFO خالصٌ كخطِّ الأساسِ.
    select j.bot, j.update_id, j.payload, j.attempts
      into v_bot, v_uid, v_payload, v_attempts
      from telegram_update_jobs j
     where j.status = 'pending' and j.attempts < p_max_attempts
       and j.next_attempt_at <= now()
       and j.bot = p_bot
       and (j.lane_key is null or not exists (
             select 1 from telegram_update_jobs e
              where e.lane_key = j.lane_key
                and e.status in ('pending', 'claimed') and e.attempts < p_max_attempts
                and (e.created_at, e.update_id) < (j.created_at, j.update_id)))
     order by j.created_at, j.update_id
     for update skip locked
     limit 1;
  end if;

  if not found then
    return jsonb_build_object('ok', true, 'delivery', null);
  end if;

  v_token := gen_random_uuid();

  update telegram_update_jobs
     set status = 'claimed', claim_token = v_token,
         claimed_at = now(), attempts = attempts + 1
   where bot = v_bot and update_id = v_uid;

  update telegram_update_receipts
     set status = 'claimed', claim_token = v_token,
         claimed_at = now(), attempts = attempts + 1
   where bot = v_bot and update_id = v_uid;

  return jsonb_build_object(
    'ok', true,
    'delivery', jsonb_build_object(
      'bot', v_bot,
      'update_id', v_uid,
      'payload', v_payload,
      'claim_token', v_token,
      'attempts', v_attempts + 1,
      'max_attempts', p_max_attempts
    )
  );
end $$;

create or replace function claim_telegram_update_jobs_for_bot(
  p_lease_timeout_seconds integer,
  p_max_attempts integer,
  p_bot text,
  p_limit integer default 10
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jobs jsonb;
begin
  if p_lease_timeout_seconds is null or p_lease_timeout_seconds <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LEASE_TIMEOUT');
  end if;
  if p_max_attempts is null or p_max_attempts <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_MAX_ATTEMPTS');
  end if;
  if p_limit is null or p_limit <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LIMIT');
  end if;

  with reclaimed as (
    update telegram_update_jobs
       set status = 'pending', claim_token = null, claimed_at = null, error_code = null
     where status = 'claimed'
       and claimed_at < now() - make_interval(secs => p_lease_timeout_seconds)
       and attempts < p_max_attempts
    returning bot, update_id
  )
  update telegram_update_receipts
     set status = 'pending', claim_token = null, claimed_at = null
   where (bot, update_id) in (select bot, update_id from reclaimed);

  with expired as (
    update telegram_update_jobs
       set status = 'dead', claim_token = null, claimed_at = null,
           completed_at = now(), error_code = coalesce(error_code, 'LEASE_EXPIRED')
     where status = 'claimed'
       and claimed_at < now() - make_interval(secs => p_lease_timeout_seconds)
       and attempts >= p_max_attempts
    returning bot, update_id
  )
  update telegram_update_receipts
     set status = 'failed', claim_token = null, claimed_at = null, completed_at = now()
   where (bot, update_id) in (select bot, update_id from expired);

  with
  -- المرحلةُ 1: المتقادمُ >120ث (أيَّ نوعٍ) — مسحُ فهرسِ المعلَّقِ بحدٍّ علويٍّ على created_at.
  picked_aged as (
    select j.bot, j.update_id
      from telegram_update_jobs j
     where j.status = 'pending' and j.attempts < p_max_attempts
       and j.next_attempt_at <= now()
       and j.bot = p_bot
       and j.created_at < now() - interval '120 seconds'
       -- D4 (كما في الالتقاطِ المفردِ): لا تُلتقَطُ وظيفةُ مستخدمٍ وأمامَها وظيفةٌ
       -- أقدمُ له معلَّقةٌ أو محجوزةٌ. يخدمُه الفهرسُ (lane_key, created_at, update_id).
       and (j.lane_key is null or not exists (
             select 1 from telegram_update_jobs e
              where e.lane_key = j.lane_key
                and e.status in ('pending', 'claimed') and e.attempts < p_max_attempts
                and (e.created_at, e.update_id) < (j.created_at, j.update_id)))
     order by j.created_at, j.update_id
     for update of j skip locked
     limit least(p_limit, 100)
  ),
  -- المرحلةُ 2: contact الطازجُ (≥ الحدِّ) — الفهرسُ الجزئيُّ الجديدُ، مسحٌ خالصٌ بلا فرزٍ.
  picked_contacts as (
    select j.bot, j.update_id
      from telegram_update_jobs j
     where j.status = 'pending' and j.attempts < p_max_attempts
       and j.next_attempt_at <= now()
       and j.bot = p_bot
       and j.created_at >= now() - interval '120 seconds'
       and j.payload #> '{message,contact}' is not null
       and (j.lane_key is null or not exists (
             select 1 from telegram_update_jobs e
              where e.lane_key = j.lane_key
                and e.status in ('pending', 'claimed') and e.attempts < p_max_attempts
                and (e.created_at, e.update_id) < (j.created_at, j.update_id)))
     order by j.created_at, j.update_id
     for update of j skip locked
     limit greatest(least(p_limit, 100) - (select count(*) from picked_aged), 0)
  ),
  -- المرحلةُ 3: تعويضٌ FIFO خالصٌ كخطِّ الأساسِ، معَ استبعادِ ما الُتقطَ آنفًا
  -- (المتبقّي لا يكونُ إلا رسائلَ طازجةً غيرَ مُلتقَطةٍ).
  picked_fill as (
    select j.bot, j.update_id
      from telegram_update_jobs j
     where j.status = 'pending' and j.attempts < p_max_attempts
       and j.next_attempt_at <= now()
       and j.bot = p_bot
       and (j.lane_key is null or not exists (
             select 1 from telegram_update_jobs e
              where e.lane_key = j.lane_key
                and e.status in ('pending', 'claimed') and e.attempts < p_max_attempts
                and (e.created_at, e.update_id) < (j.created_at, j.update_id)))
       and (j.bot, j.update_id) not in (
             select bot, update_id from picked_aged
             union all
             select bot, update_id from picked_contacts)
     order by j.created_at, j.update_id
     for update of j skip locked
     limit greatest(least(p_limit, 100)
                    - (select count(*) from picked_aged)
                    - (select count(*) from picked_contacts), 0)
  ),
  -- اتحادُ المراحلِ الثلاثِ (منفصلةٌ بنيويًّا: الحدُّ الزمنيُّ يفصلُ 1 عن 2/3،
  -- والمحمولُ يفصلُ 2 عن 3) — هذا ما يُختمُ فعليًّا.
  picked as (
    select bot, update_id from picked_aged
    union all
    select bot, update_id from picked_contacts
    union all
    select bot, update_id from picked_fill
  ),
  claimed as (
    update telegram_update_jobs j
       set status = 'claimed', claim_token = gen_random_uuid(),
           claimed_at = now(), attempts = j.attempts + 1
      from picked p
     where j.bot = p.bot and j.update_id = p.update_id
    returning j.bot, j.update_id, j.payload, j.claim_token, j.attempts, j.created_at
  ),
  mirrored as (
    update telegram_update_receipts r
       set status = 'claimed', claim_token = c.claim_token,
           claimed_at = now(), attempts = r.attempts + 1
      from claimed c
     where r.bot = c.bot and r.update_id = c.update_id
    returning r.update_id
  )
  -- الترتيبُ المعادُ يطابقُ ترتيبَ الأولويةِ المُعلَنَ (فئةٌ عليا ثمّ created_at)
  -- كي يعالجَ المستنزفُ contact أولًا داخلَ الدفعةِ.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'bot', c.bot,
               'update_id', c.update_id,
               'payload', c.payload,
               'claim_token', c.claim_token,
               'attempts', c.attempts,
               'max_attempts', p_max_attempts
             ) order by ((c.payload #> '{message,contact}') is not null
                         or c.created_at < now() - interval '120 seconds') desc,
                        c.created_at, c.update_id
           ),
           '[]'::jsonb)
    into v_jobs
    from claimed c;

  return jsonb_build_object('ok', true, 'jobs', v_jobs);
end $$;

grant execute on function claim_telegram_update_jobs_for_bot(integer, integer, text, integer) to service_role;
revoke execute on function claim_telegram_update_jobs_for_bot(integer, integer, text, integer) from public, anon, authenticated;
