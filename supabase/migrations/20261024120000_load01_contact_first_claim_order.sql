-- migration-phase: expand

-- LOAD-01 (فجوةُ السعةِ 2026-10-24) — أولويةُ وظائفِ contact في التقاطِ وظائفِ تحديثِ تيليجرام.
--
-- السياقُ المُقاسُ (خطُّ الأساسِ m5-1500، التشغيلُ 40072049298): إخفاقُ G1 كلُّه
-- `phoneProofJob: timeout` — وظائفُ إثباتِ الهاتفِ (contact) مسارٌ حرجٌ ذو مهلةٍ (20ث
-- في المولّدِ)، بينما وظائفُ الرسائلِ والأزرارِ لا مهلةَ عليها. الالتقاطُ FIFO خالصٌ
-- (`order by created_at`) ففي الحملِ المختلطِ قد تنتظرُ إثباتاتُ الهاتفِ خلفَ طابورٍ
-- من الوظائفِ غيرِ الحرجةِ.
--
-- الإصلاحُ: ترتيبُ أولويةٍ نوعيٌّ في دوالِّ الالتقاطِ الثلاثِ — وظائفُ contact أولًا،
-- ثمّ FIFO داخلَ كلِّ فئةٍ (created_at, update_id). **لا رفعَ سعةٍ**: القبعةُ والمساراتُ
-- والمجمّعُ والدلاءُ وكلُّ الحدودِ المحميّةِ كما هي؛ هذا إعادةُ ترتيبٍ فقط.
--
-- منعُ التجويعِ المستمرِّ (ترقيةُ التقادمِ): أيُّ وظيفةٍ (أيَّ نوعٍ) معلَّقةٌ أكثرَ من
-- 120ث تُرقَّى إلى الفئةِ العليا — فلا تُجوَّعُ الرسائلُ إلى ما لا نهايةَ إن فاضَتْ
-- إثباتاتُ الهاتفِ. العتبةُ 120ث توافقُ عتبةَ G4 القائمةَ (`stale_pending_outbox`).
-- ملاحظةٌ صريحةٌ: في التشبّعِ الحقيقيِّ لا يُغيّرُ الترتيبُ الإنتاجيةَ (قيدُ خطِّ
-- الأساسِ: ~120ms/وظيفةٍ عبرَ المجمّعِ المتنازعِ عليهِ) — وهذا الإصلاحُ يحمي المسارَ
-- الحرجَ في الحملِ المختلطِ، لا يرفعُ السعةَ.
--
-- D4 (ترتيبُ المستخدمِ الواحدِ) محفوظٌ كما هو: قيدُ lane_key في WHERE لا يمسُّه
-- الترتيبُ؛ الأولويةُ تعيدُ ترتيبَ العرضِ بينَ المستخدمينَ لا داخلَ مستخدمٍ واحدٍ.
-- الحتميةُ: التعبيرُ يحتوي `now()` (عتبةُ التقادمِ) — مقصودٌ وليس مصدرَ عشوائيةٍ.
--
-- كلفةٌ معلنة: تعبيرُ jsonb (`#>`) لكلِّ مرشَّحٍ في فرزِ مجموعةِ المعلَّقِ (ذروةُ
-- الطابورِ ~1,700 في m5-1500) — فرزٌ هينٌ بجانبِ فحصِ not exists القائمِ أصلًا.

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

  select j.bot, j.update_id, j.payload, j.attempts
    into v_bot, v_uid, v_payload, v_attempts
    from telegram_update_jobs j
   where j.status = 'pending' and j.attempts < p_max_attempts
     and j.next_attempt_at <= now()
     -- D4: لا تُلتقَطُ وظيفةُ مستخدمٍ وأمامَها وظيفةٌ أقدمُ له معلَّقةٌ (ولو في فترةِ احتياطٍ) أو محجوزة.
     and (j.lane_key is null or not exists (
           select 1 from telegram_update_jobs e
            where e.lane_key = j.lane_key
              and e.status in ('pending', 'claimed') and e.attempts < p_max_attempts
              and (e.created_at, e.update_id) < (j.created_at, j.update_id)))
     -- أولويةُ contact (المسارُ الحرجُ ذو المهلةِ) معَ ترقيةِ تقادمِ 120ث لمنعِ التجويعِ.
   order by ((j.payload #> '{message,contact}') is not null
             or j.created_at < now() - interval '120 seconds') desc,
            j.created_at, j.update_id
   for update skip locked
   limit 1;

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

  select j.bot, j.update_id, j.payload, j.attempts
    into v_bot, v_uid, v_payload, v_attempts
    from telegram_update_jobs j
   where j.status = 'pending' and j.attempts < p_max_attempts
     and j.next_attempt_at <= now()
     and j.bot = p_bot
     -- D4: لا تُلتقَطُ وظيفةُ مستخدمٍ وأمامَها وظيفةٌ أقدمُ له معلَّقةٌ (ولو في فترةِ احتياطٍ) أو محجوزة.
     and (j.lane_key is null or not exists (
           select 1 from telegram_update_jobs e
            where e.lane_key = j.lane_key
              and e.status in ('pending', 'claimed') and e.attempts < p_max_attempts
              and (e.created_at, e.update_id) < (j.created_at, j.update_id)))
     -- أولويةُ contact (المسارُ الحرجُ ذو المهلةِ) معَ ترقيةِ تقادمِ 120ث لمنعِ التجويعِ.
   order by ((j.payload #> '{message,contact}') is not null
             or j.created_at < now() - interval '120 seconds') desc,
            j.created_at, j.update_id
   for update skip locked
   limit 1;

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

  with picked as (
    select j.bot, j.update_id
      from telegram_update_jobs j
     where j.status = 'pending' and j.attempts < p_max_attempts
       and j.next_attempt_at <= now()
       and j.bot = p_bot
       -- D4 (كما في الالتقاطِ المفرد `20261015000200`): لا تُلتقَطُ وظيفةُ مستخدمٍ وأمامَها وظيفةٌ
       -- أقدمُ له معلَّقةٌ (ولو في فترةِ احتياطٍ) أو محجوزة. يخدمُه الفهرسُ
       -- (lane_key, created_at, update_id) من `20261016120300`.
       and (j.lane_key is null or not exists (
             select 1 from telegram_update_jobs e
              where e.lane_key = j.lane_key
                and e.status in ('pending', 'claimed') and e.attempts < p_max_attempts
                and (e.created_at, e.update_id) < (j.created_at, j.update_id)))
     -- أولويةُ contact (المسارُ الحرجُ ذو المهلةِ) معَ ترقيةِ تقادمِ 120ث لمنعِ التجويعِ.
     -- التعبيرُ في الترتيبِ يحتاجُ payload وcreated_at وهما عمودانِ في الجدولِ نفسِهِ.
     order by ((j.payload #> '{message,contact}') is not null
               or j.created_at < now() - interval '120 seconds') desc,
              j.created_at, j.update_id
     for update of j skip locked
     limit least(p_limit, 100)
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
  -- الترتيبُ المعادُ يطابقُ ترتيبَ الأولويةِ كي يعالجَ المستنزفُ contact أولًا داخلَ الدفعةِ.
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
