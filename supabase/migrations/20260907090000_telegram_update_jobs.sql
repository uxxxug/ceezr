-- ============================================================================
-- 20260907090000_telegram_update_jobs.sql
--   النصفُ الحاملُ للحمولةِ في صنفِ domain-ingress receipt — يربطُ التحديثَ
--   الخامَّ (تحديثُ grammY كـJSONB) بالإيصالِ عبرَ (bot, update_id) ربطاً 1:1،
--   ويفصلُ المعالجةَ عن مسارِ HTTP: الويبهوكُ يُودعُ الإيصالَ والوظيفةَ ذرّيًّا
--   ويعيدُ ACK فوراً، والدرينرُ الخلفيُّ يلتقطُ الوظيفةَ ويُعالجُها لاحقاً.
--
--   هذا هو إغلاقُ BUG-002 / F6-02: ACK سريع + طابورٌ صامدٌ ذرّيٌّ + إيجارٌ +
--   استرجاعٌ + ختمٌ برمز. القرارُ في
--   [ADR 0057](../docs/adr/0057-telegram-ingress-bound-payload-carrier-and-worker.md).
--   القرارُ المعماريُّ: الدرينرُ يعملُ داخلَ عمليةِ البوابةِ (gateway background
--   drainer) لا في apps/workers — نقلُهُ إلى خدمةٍ منفصلةٍ (SCL-007 / F5-04) لم
--   يُغلَقْ بعد.
--
--   ملاحظاتٌ:
--   * لا يحملُ city_id — صنفُ domain-ingress receipt معفيٌّ (الملحقُ الحاكمُ
--     2026-09-04 وملحقُه 2026-09-07 الذي يُلحقُ «حاملَ الحمولةِ المربوطَ» عضواً
--     ثانياً في الصنفِ المغلقِ).
--   * لا يخزّنُ أسراراً ولا رموزَ دخولٍ — الحمولةُ تحديثُ تيليجرام وحده.
--   * الحذفُ تقنيٌّ لا يحملُ city_id.
--   * domain-ingress-receipt: telegram_update_jobs   ← تعريفٌ صريحٌ للموحِّد.
-- ============================================================================
-- domain-ingress-receipt: telegram_update_jobs

create table if not exists telegram_update_jobs (
  -- الربطُ 1:1 بالإيصالِ: المفتاحُ الأساسيُّ هو نفسُه (bot, update_id)، وزيادةً
  -- عليه قيدُ مفتاحٍ خارجيٍّ يُلزمُ كلَّ وظيفةٍ بإيصالٍ موجودٍ — ربطٌ حقيقيٌّ لا
  -- اتفاقٌ اسميٌّ. لا يُسمحُ بوظيفةٍ بلا إيصالٍ، ولا اثنتانِ على التحديثِ الواحد.
  bot          text not null,
  update_id    bigint not null,
  -- حمولةُ التحديثِ الخامِّ كاملةً: لا يمكنُ إعادةُ بنائها من المُعرِّفاتِ، فهي
  -- التي تُمكِّنُ الدرينرَ من المعالجةِ بعدَ ACK دونَ إعادةِ استلامٍ من تيليجرام.
  payload      jsonb not null,
  status       text not null default 'pending',
  attempts     integer not null default 0,
  claim_token  uuid,
  claimed_at   timestamptz,
  error_code   text,
  -- متى يصبحُ معلَّقاً مؤهَّلاً لإعادة الالتقاطِ. null يعني «الآن»، فلا تأخيرَ
  -- عندَ أولِ إيداعٍ. يُضبَطُ على now()+فترةٍ احتياطيّةٍ عندَ الفشلِ لئلّا يلتقطَه
  -- الدرينرُ فوراً في الشوطِ نفسه فيستنفدَ المحاولاتِ كلَّها دفعةً واحدة بلا احتياطٍ.
  next_attempt_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  completed_at timestamptz,
  primary key (bot, update_id),
  -- المفتاحُ الخارجيُّ: الوظيفةُ مربوطةٌ بإيصالٍ موجودٍ. حذفُ الإيصالِ يُحذفُ
  -- الوظيفةَ تبعاً (cascade) لأنّها نصفُه لا كيانٌ مستقلٌّ.
  constraint telegram_update_jobs_receipt_fk
    foreign key (bot, update_id)
    references telegram_update_receipts (bot, update_id)
    on delete cascade,
  constraint telegram_update_jobs_bot_known check (bot in ('driver', 'rider')),
  constraint telegram_update_jobs_status_known
    check (status in ('pending', 'claimed', 'done', 'dead')),
  -- المختومُ لا يحملُ حجزاً وله وقتُ ختمٍ.
  constraint telegram_update_jobs_done_is_sealed
    check (
      status <> 'done'
      or (claim_token is null and claimed_at is null and completed_at is not null)
    ),
  -- الميّتُ مختومٌ كذلك: لا حجزَ معلَّقٌ عليه.
  constraint telegram_update_jobs_dead_is_sealed
    check (
      status <> 'dead'
      or (claim_token is null and claimed_at is null and completed_at is not null)
    ),
  -- الحاجزُ والوقتُ زوجٌ لا ينفصلُ.
  constraint telegram_update_jobs_claim_is_paired
    check ((claim_token is null) = (claimed_at is null))
);

-- فهرسٌ جزئيٌّ على المعلَّقِ وحدَه: هو ما يلتقطُه الدرينرُ. المختومُ والميّتُ لا
-- يُقرآنِ بهذا السؤالِ أبداً.
create index if not exists telegram_update_jobs_pending_idx
  on telegram_update_jobs (created_at)
  where status = 'pending';

-- فهرسٌ جزئيٌّ على المحجوزِ: هو ما يُسترجَعُ عندَ انتهاءِ الإيجار.
create index if not exists telegram_update_jobs_claimed_idx
  on telegram_update_jobs (claimed_at)
  where status = 'claimed';

comment on table telegram_update_jobs is
  'حاملُ حمولةِ تحديثِ تيليجرام المربوطُ بالإيصالِ 1:1 عبرَ (bot, update_id) — النصفُ المعالَجُ في صنفِ domain-ingress receipt (ADR 0057). الدرينرُ الخلفيُّ يلتقطُ المعلَّقَ منها ويُعالجُه خارجَ مسارِ HTTP. لا يحملُ city_id، ولا يخزّنُ أسراراً.';

-- ---------------------------------------------------------------------------
-- RLS: صنفُ domain-ingress receipt لا يُكتبُ ولا يُقرأُ إلّا بخدمةِ القاعدةِ
--   (service_role) عبرَ الدوالِّ الذرّيّةِ. تفعيلُه ثمّ سحبُ العامِّ وغيرِ المسجَّل.
-- ---------------------------------------------------------------------------
alter table telegram_update_jobs enable row level security;

-- ---------------------------------------------------------------------------
-- ١) claim_and_enqueue_telegram_update: الإيداعُ الذرّيُّ للإيصالِ والوظيفةِ في
--   معاملةٍ واحدة. هذا هو «ACK سريع»: قرارُ الاستلامِ ومنعُ التكرارِ وإيداعُ
--   الحمولةِ في نداءٍ واحدٍ لا ثلاثة. إعادةُ تسليمٍ مكرَّرةٌ لا تُعيدُ ضبطَ
--   وظيفةٍ موجودةٍ — الموجودُ غيرُ المنتهي = in_progress، والمختومُ = duplicate.
-- ---------------------------------------------------------------------------
create or replace function claim_and_enqueue_telegram_update(
  p_bot text,
  p_update_id bigint,
  p_payload jsonb,
  p_claim_timeout_seconds integer default 30
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fresh          boolean;
  v_receipt_status text;
begin
  if p_bot is null or p_bot not in ('driver', 'rider') then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_BOT');
  end if;
  if p_update_id is null then
    return jsonb_build_object('ok', false, 'error', 'MISSING_UPDATE_ID');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PAYLOAD');
  end if;

  -- منعُ التكرارِ ذرّيًّا: insert on conflict do nothing. (xmax = 0) يميِّزُ
  -- الإدراجَ الفعليَّ من التعارضِ — فنعلمُ هل هذا وصولٌ جديدٌ أم مكرَّر.
  with ins as (
    insert into telegram_update_receipts (bot, update_id, status, attempts, first_seen_at)
    values (p_bot, p_update_id, 'pending', 0, now())
    on conflict (bot, update_id) do nothing
    returning (xmax = 0) as inserted
  )
  select coalesce((select inserted from ins), false) into v_fresh;

  if v_fresh then
    -- وصولٌ جديدٌ: أودعُ الوظيفةَ بالحمولةِ. on conflict do nothing حمايةٌ ضدَّ
    -- أيِّ سباقٍ نادرٍ (إيصالٌ أُدرجَ ثمّ انهارتِ المعاملةُ قبلَ الوظيفةِ).
    insert into telegram_update_jobs (bot, update_id, payload, status, attempts)
    values (p_bot, p_update_id, p_payload, 'pending', 0)
    on conflict (bot, update_id) do nothing;
    return jsonb_build_object('ok', true, 'outcome', 'enqueued');
  end if;

  -- الإيصالُ موجودٌ سلفاً: لا أُعيدُ ضبطَ شيءٍ. المختومُ = duplicate، وما عداه
  -- (معلَّقٌ أو محجوزٌ أو ميّتٌ) = in_progress — فلا يُنشأُ عملٌ ثانٍ ولا يُصفَّرُ.
  select status into v_receipt_status
    from telegram_update_receipts
   where bot = p_bot and update_id = p_update_id;

  if v_receipt_status = 'done' then
    return jsonb_build_object('ok', true, 'outcome', 'duplicate');
  end if;

  -- إيصالٌ قديمٌ بلا وظيفةٍ (إرثٌ): أضمنُ وجودَ الوظيفةِ دونَ ضبطٍ لوظيفةٍ جارية.
  insert into telegram_update_jobs (bot, update_id, payload, status, attempts)
  values (p_bot, p_update_id, p_payload, 'pending', 0)
  on conflict (bot, update_id) do nothing;
  return jsonb_build_object('ok', true, 'outcome', 'in_progress');
end $$;

-- ---------------------------------------------------------------------------
-- ٢) claim_telegram_update_job: إيجارُ الدرينرِ. يسترجعُ الوظائفَ ذاتَ الإيجارِ
--   المنتهي أوّلاً (إعادةُ تسليمٍ آمنة)، ثمّ يلتقطُ وظيفةً معلَّقةً واحدةً بـ
--   FOR UPDATE SKIP LOCKED + claim_token، ويزيدُ المحاولاتِ. يُحدِّثُ الإيصالَ
--   كذلك ليكونَ في «claimed» مُعاكساً للوظيفةِ — فالحالةُ متناسقةٌ بينَ النصفين.
-- ---------------------------------------------------------------------------
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
  select bot, update_id, payload, attempts
    into v_bot, v_uid, v_payload, v_attempts
    from telegram_update_jobs
   where status = 'pending' and attempts < p_max_attempts
     and next_attempt_at <= now()
   order by created_at
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

-- ---------------------------------------------------------------------------
-- ٣) finish_telegram_update_job: الختمُ بالوظيفةِ لا بالإيصالِ. سُلطةُ الختمِ هي
--   رمزُ إيجارِ الوظيفةِ (claim_token)، لا رمزُ الإيصالِ — فالدرينرُ يملكُ إيجارَ
--   الوظيفةِ وحده. يختمُ النصفينِ ذرّيًّا: الوظيفةَ والإيصالَ معاً.
--   * delivered = true  → الوظيفةُ «done»، الإيصالُ «done».
--   * delivered = false:
--       attempts >= max → الوظيفةُ «dead»، الإيصالُ «failed» (موتٌ نهائيٌّ).
--       وإلّا            → الوظيفةُ «pending»، الإيصالُ «pending» (إعادةُ تسليمٍ).
-- ---------------------------------------------------------------------------
create or replace function finish_telegram_update_job(
  p_bot text,
  p_update_id bigint,
  p_claim_token uuid,
  p_delivered boolean,
  p_error_code text default null,
  p_max_attempts integer default 5,
  p_retry_delay_seconds integer default 5
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_attempts integer;
begin
  if p_bot is null or p_update_id is null or p_claim_token is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENT');
  end if;
  if p_max_attempts is null or p_max_attempts <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_MAX_ATTEMPTS');
  end if;
  if p_retry_delay_seconds is null or p_retry_delay_seconds < 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_RETRY_DELAY');
  end if;

  -- قفلُ صفِّ الوظيفةِ حتى نهايةِ المعاملةِ (FOR UPDATE): أيُّ إعادةِ التقاطٍ
  -- للإيجارِ المنتهي (stale reclaim يحدّثُ هذا الصفَّ) تنتظرُ حتى نُلتزمَ، فلا
  -- يُوسَمُ الإيصالُ من عاملٍ انتهى إيجارُه بينما الوظيفةُ تحت رمزٍ آخر.
  select attempts into v_attempts
    from telegram_update_jobs
   where bot = p_bot and update_id = p_update_id
     and status = 'claimed' and claim_token = p_claim_token
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_CLAIMED_BY_CALLER');
  end if;

  if p_delivered then
    update telegram_update_jobs
       set status = 'done', claim_token = null, claimed_at = null,
           completed_at = now(), error_code = null
     where bot = p_bot and update_id = p_update_id and claim_token = p_claim_token;
    update telegram_update_receipts
       set status = 'done', claim_token = null, claimed_at = null,
           completed_at = now()
     where bot = p_bot and update_id = p_update_id and claim_token = p_claim_token;
    return jsonb_build_object('ok', true, 'outcome', 'done');
  end if;

  if v_attempts >= p_max_attempts then
    update telegram_update_jobs
       set status = 'dead', claim_token = null, claimed_at = null,
           completed_at = now(), error_code = coalesce(p_error_code, 'MAX_ATTEMPTS')
     where bot = p_bot and update_id = p_update_id and claim_token = p_claim_token;
    update telegram_update_receipts
       set status = 'failed', claim_token = null, claimed_at = null,
           completed_at = now()
     where bot = p_bot and update_id = p_update_id and claim_token = p_claim_token;
    return jsonb_build_object('ok', true, 'outcome', 'dead');
  end if;

  -- إعادةُ تسليمٍ: لم تُستنفدِ المحاولاتُ بعدُ. تُؤجَّلُ إعادةُ الالتقاطِ بفترةٍ
  -- احتياطيّةٍ كي لا يلتقطَها الدرينرُ في الشوطِ نفسه فيستنفدَ المحاولاتِ دفعةً واحدة.
  update telegram_update_jobs
     set status = 'pending', claim_token = null, claimed_at = null,
         error_code = p_error_code,
         next_attempt_at = now() + make_interval(secs => p_retry_delay_seconds)
   where bot = p_bot and update_id = p_update_id and claim_token = p_claim_token;
  update telegram_update_receipts
     set status = 'pending', claim_token = null, claimed_at = null
   where bot = p_bot and update_id = p_update_id and claim_token = p_claim_token;
  return jsonb_build_object('ok', true, 'outcome', 'retried');
end $$;

-- ---------------------------------------------------------------------------
-- ٤) abandon_telegram_update_job: الموتُ النهائيُّ الصريحُ للوظيفةِ الفاشلةِ التي
--   لن تُقبلَ أبداً. مسارٌ نهائيٌّ بجانبِ finish(false): حيثُ يُعلَمُ الفشلُ
--   قاتلاً فوراً دونَ انتظارِ استنفادِ المحاولاتِ. يُستدعى بالرمزِ كالـfinish.
-- ---------------------------------------------------------------------------
create or replace function abandon_telegram_update_job(
  p_bot text,
  p_update_id bigint,
  p_claim_token uuid,
  p_error_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_bot is null or p_update_id is null or p_claim_token is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENT');
  end if;

  update telegram_update_jobs
     set status = 'dead', claim_token = null, claimed_at = null,
         completed_at = now(), error_code = coalesce(p_error_code, 'ABANDONED')
   where bot = p_bot and update_id = p_update_id
     and status = 'claimed' and claim_token = p_claim_token;
  update telegram_update_receipts
     set status = 'failed', claim_token = null, claimed_at = null,
         completed_at = now()
   where bot = p_bot and update_id = p_update_id
     and status = 'claimed' and claim_token = p_claim_token;
  return jsonb_build_object('ok', found);
end $$;

-- ---------------------------------------------------------------------------
-- صلاحياتُ الدوالِّ: service_role وحدَه. سحبُ العامِّ ومنهُ غيرِ المسجَّلِ كالإيصالِ.
-- ---------------------------------------------------------------------------
grant execute on function claim_and_enqueue_telegram_update(text, bigint, jsonb, integer) to service_role;
grant execute on function claim_telegram_update_job(integer, integer) to service_role;
grant execute on function finish_telegram_update_job(text, bigint, uuid, boolean, text, integer, integer) to service_role;
grant execute on function abandon_telegram_update_job(text, bigint, uuid, text) to service_role;

revoke execute on function claim_and_enqueue_telegram_update(text, bigint, jsonb, integer) from public, anon, authenticated;
revoke execute on function claim_telegram_update_job(integer, integer) from public, anon, authenticated;
revoke execute on function finish_telegram_update_job(text, bigint, uuid, boolean, text, integer, integer) from public, anon, authenticated;
revoke execute on function abandon_telegram_update_job(text, bigint, uuid, text) from public, anon, authenticated;
