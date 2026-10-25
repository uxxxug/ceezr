-- migration-phase: switch

-- LOAD-01 (قرارُ المالكِ بعدَ PR #651، 2026-10-25) — إيقافُ أولويّةِ contact واستعادةُ عدالةِ
-- الالتقاطِ FIFO في دوالِّ التقاطِ وظائفِ تحديثِ تيليجرام الثلاث.
--
-- الدليلُ المُقاس (`docs/evidence/capacity/LOAD01M-MIXED-AB-20261025/RESULT.md`، التشغيلُ
-- 40150050817، حِملٌ مختلطٌ صالح، 8 موجاتٍ VALID وCOMPARABLE): تحتَ ترتيبِ #645/#647 انتظرتِ
-- الوظائفُ غيرُ contact قبلَ الالتقاطِ نحو 6.2 ضعفِ خطِّ الأساس (MECH_RULE: B_HIGHER) حتّى عتبةِ
-- التقادمِ 120ث، وهبطَ Jain إلى 0.7844–0.786؛ وقيمةُ الأولويّةِ لـcontact غيرُ مُثبَتة (UNDECIDED،
-- وسيطُ النسبة 0.96)، وأثرُها على G1 غيرُ محسوم (UNRESOLVED)، والالتقاطُ في PG أبطأ (3.91 مقابل 1.68ms).
--
-- ما تفعلُه: `create or replace` للدوالِّ الثلاثِ بنصِّها حرفيًّا كما كانت قبلَ #645 — أي كما
-- قِيسَت في ذراعِ A في الدورتينِ الثالثةِ والرابعة:
--   `claim_telegram_update_job` و`claim_telegram_update_job_for_bot` من `20261015000200`،
--   و`claim_telegram_update_jobs_for_bot` من `20261020090000`.
-- الترتيبُ `order by j.created_at` خالصًا؛ وقيدُ D4 (ترتيبُ المستخدمِ الواحد) وskip locked وسقفُ
-- الدفعة (≤100) وسقفُ المحاولاتِ والاسترجاعُ والإماتةُ ومرآةُ الإيصالِ وشكلُ الردّ — كلُّها كما هي.
-- استثناءٌ واحدٌ في التوقيع: `p_limit integer default 10` في الدُّفعيّةِ يبقى كما أضافَه #645، لأنّ
-- `create or replace` لا يُزيلُ قيمةً افتراضيّة (يلزمُ `drop function`، طورُ contract)؛ والمستدعونَ
-- يمرّرونَ الحدَّ صراحةً، فلا أثرَ سلوكيّ. المتنُ حرفيٌّ.
-- لا يُمسُّ حدٌّ محميّ. هجرةٌ أماميّة: لا يُعدَّلُ حرفٌ من هجراتِ #645/#647 المطبَّقة.
--
-- ما لا تفعلُه: لا تُسقِطُ الفهرسَ الجزئيَّ `telegram_update_jobs_contact_pending_idx`
-- (`20261024140000`). بعدَ هذه الهجرةِ لا تستعملُه دالّة؛ وإسقاطُه حذفٌ (طورُ contract)، و`drop index
-- concurrently` لا يُقبَلُ في معاملة، والمُطبِّقُ لا يُشغِّلُ بلا معاملةٍ إلّا طورَ index — فهو قرارٌ
-- مستقلٌّ في دورةٍ لاحقة. كلفتُه على الكتابةِ غيرُ مقيسة.
--
-- العودة: إعادةُ تطبيقِ نصِّ الدوالِّ في `20261024140100` (والفهرسُ باقٍ) — تراجعٌ سلوكيٌّ لا فقدُ عقد.

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

  -- (أ) استرجاعُ الإيجاراتِ المنتهيةِ. هذا هو ضمانُ «على الأقلِّ مرّةً»:
  --   الوظيفةُ التي ماتَ حائزُها لا تُهملُ. لكنّها تنقسمُ قسمَينِ:
  --     • retriable (attempts < max): تعودُ معلَّقةً قابلةً للالتقاطِ، ويُزامِنُها الإيصالُ.
  --     • exhausted (attempts >= max): تُختمُ dead مع إيصالِها failed — لا تبقى
  --       عالقةً «معلَّقةً» غيرَ قابلةٍ للالتقاطِ أبداً (ثغرةٌ صامتةٌ).
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

  -- (ب) التقاطُ وظيفةٍ معلَّقةٍ واحدةٍ مؤهَّلةٍ زمنيًّا بـ FOR UPDATE SKIP LOCKED:
  -- نسختانِ من الدرينرِ لا تلتقطانِ الصفَّ نفسَه. «مؤهَّلةٌ زمنيًّا» تعني أنّها ليست
  -- في فترةِ احتياطٍ بينَ المحاولتَين — فلا يلتقطُها الدرينرُ فورَ فشلِها فيستنفدَ
  -- المحاولاتِ كلَّها دفعةً واحدة بلا احتياطٍ.
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
   order by j.created_at
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

  -- مرآةٌ للإيصالِ: حالةٌ متناسقةٌ بينَ النصفينِ، والإيصالُ يعكسُ أنّه قيدُ المعالجةِ.
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

  -- (أ) استرجاعُ الإيجاراتِ المنتهيةِ. هذا هو ضمانُ «على الأقلِّ مرّةً»:
  --   الوظيفةُ التي ماتَ حائزُها لا تُهملُ. لكنّها تنقسمُ قسمَينِ:
  --     • retriable (attempts < max): تعودُ معلَّقةً قابلةً للالتقاطِ، ويُزامِنُها الإيصالُ.
  --     • exhausted (attempts >= max): تُختمُ dead مع إيصالِها failed — لا تبقى
  --       عالقةً «معلَّقةً» غيرَ قابلةٍ للالتقاطِ أبداً (ثغرةٌ صامتةٌ).
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

  -- (ب) التقاطُ وظيفةٍ معلَّقةٍ واحدةٍ مؤهَّلةٍ زمنيًّا بـ FOR UPDATE SKIP LOCKED:
  -- نسختانِ من الدرينرِ لا تلتقطانِ الصفَّ نفسَه. «مؤهَّلةٌ زمنيًّا» تعني أنّها ليست
  -- في فترةِ احتياطٍ بينَ المحاولتَين — فلا يلتقطُها الدرينرُ فورَ فشلِها فيستنفدَ
  -- المحاولاتِ كلَّها دفعةً واحدة بلا احتياطٍ.
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
   order by j.created_at
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

  -- مرآةٌ للإيصالِ: حالةٌ متناسقةٌ بينَ النصفينِ، والإيصالُ يعكسُ أنّه قيدُ المعالجةِ.
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
     order by j.created_at
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
  -- مرآةُ الإيصالِ: عبارةُ تعديلٍ في WITH تُنفَّذُ كاملةً مرّةً واحدةً وإن لم تُقرأ.
  mirrored as (
    update telegram_update_receipts r
       set status = 'claimed', claim_token = c.claim_token,
           claimed_at = now(), attempts = r.attempts + 1
      from claimed c
     where r.bot = c.bot and r.update_id = c.update_id
    returning r.update_id
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'bot', c.bot,
               'update_id', c.update_id,
               'payload', c.payload,
               'claim_token', c.claim_token,
               'attempts', c.attempts,
               'max_attempts', p_max_attempts
             ) order by c.created_at, c.update_id
           ),
           '[]'::jsonb)
    into v_jobs
    from claimed c;

  return jsonb_build_object('ok', true, 'jobs', v_jobs);
end $$;

grant execute on function claim_telegram_update_jobs_for_bot(integer, integer, text, integer) to service_role;
revoke execute on function claim_telegram_update_jobs_for_bot(integer, integer, text, integer) from public, anon, authenticated;
