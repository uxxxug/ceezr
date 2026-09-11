-- migration-phase: expand
-- =============================================================================
-- W-5: صندوقُ واردٍ لأحداثِ CORE، وصندوقُ صادرٍ معاملاتيٌّ لأحداثِ MOVE، ودوالُّ
--   دورةِ حياةِ المهمّةِ التشغيليّةِ ذرّيّةً.
-- الحالة: منفّذ (توسيعٌ محضٌ: جدولانِ جديدانِ ودوالُّ جديدةٌ؛ ولا عمودَ حُذِفَ
--   ولا قيدَ ضُيِّقَ ولا دالّةً قائمةً عُدِّلَت).
-- ينتمي إلى: supabase/migrations.
-- يبني على: `20260911100000_w4_operational_jobs.sql` وعقودِ CORE المنقولةِ في
--   `docs/contracts/core/` عندَ `511624b`، و`ADR-0061` (نمطُ صندوقِ الصادرِ:
--   الإيداعُ في معاملةِ تغييرِ الحالةِ، والإرسالُ من عاملٍ، والالتقاطُ برمزِ حجزٍ).
-- يُستخدم من: `packages/infrastructure/wasla/*` و`packages/application/wasla/*`.
--
-- ## القاعدةُ الحاكمةُ: التسليمُ مرّةً على الأقلِّ، فالإسلامُ فرضٌ لا تحسينٌ
--
-- عقدُ CORE يُعلِنُ **at-least-once**: الحدثُ نفسُه قد يصلُ مرّتَينِ أو عشراً.
-- فالحمايةُ في القاعدةِ لا في الكودِ، وفي **ثلاثةِ مواضعَ** لا موضعٍ:
--   ١) `core_event_inbox.event_id` مفتاحٌ أوّليٌّ — فالحدثُ الواصلُ ثانيةً
--      **يُرَدُّ عندَ الإدراجِ**، ولا يُقرأُ صفٌّ لِيُقارَنَ ثمَّ يُكتَبَ (وذاكَ
--      سباقٌ بينَ عمليّتَينِ).
--   ٢) `operational_jobs.fulfillment_id` فريدٌ — فحدثُ إنشاءٍ مكرَّرٌ لا يُنشئُ
--      مهمّةً ثانيةً حتى لو أُفلِتَ من الواردِ.
--   ٣) `move_event_outbox.dedup_key` فريدٌ — فأثرُ الحدثِ الصادرِ **واحدٌ لكلِّ
--      (نوعٍ، مهمّةٍ)** ولو نُودِيَت الدالّةُ مرّتَينِ.
-- **ولا موضعَ رابعٌ يُعتَمَدُ عليه**: لا قفلٌ في التطبيقِ ولا مفتاحٌ في Redis.
--
-- ## ولماذا لا يُنشَرُ شيءٌ من هذه الدوالِّ
--
-- لأنَّ الإرسالَ الشبكيَّ إلى CORE **محجوبٌ اليومَ**: `DEP-CORE-001` — CORE لا
-- يملكُ مَدخلاً شبكيّاً لأحداثِ `move.job.*`، يستهلكُها على ناقلٍ داخليٍّ في
-- عمليّتِه وحدَها. فالمُنفَّذُ ههنا **كلُّ ما يملكُه MOVE**: الحدثُ يُودَعُ في
-- صندوقِ الصادرِ **في معاملةِ تغييرِ الحالةِ نفسِها**، فلا حالةَ تتغيَّرُ بلا
-- حدثٍ ولا حدثٌ يوجَدُ بلا حالةٍ. **والناقلُ يُوصَلُ يومَ يفتحُ CORE مَدخلَه،
-- ولا يُغيَّرُ شيءٌ ههنا حينَها.** ولا يُدَّعى أنَّ CORE بلغَه شيءٌ.
--
-- ## آلةُ الحالاتِ مُنفَذةٌ ههنا لا في التطبيقِ
--
-- كلُّ انتقالٍ دالّةٌ واحدةٌ تقفلُ الصفَّ `for update` ثمَّ تفحصُ الحالةَ ثمَّ
-- تكتبُ الحالةَ والحدثَ معاً. **ومحاولةُ انتقالٍ ممنوعٍ تُرَدُّ برمزٍ**، ولا
-- تُصحَّحُ ولا تُتجاوَزُ. **وإعادةُ انتقالٍ وقعَ سلفاً تُرَدُّ ناجحةً بـ
-- `duplicate: true`** — فالمُنادي المُعادُ عليه (عاملٌ أُعيدَ تشغيلُه، حدثٌ
-- وصلَ ثانيةً) لا يُخفِقُ ولا يُنشئُ أثراً ثانياً.
--
-- ## ما لا تُغيّره هذه الهجرةُ
--
-- لا `notification_outbox` ولا دوالَّه — ذاكَ صندوقُ **تسليمِ إشعاراتٍ** إلى
-- تلغرامَ (`ADR-0061`)، وهذا صندوقُ **أحداثِ تكاملٍ** إلى نظامٍ آخرَ؛ توحيدُهما
-- يجعلُ الالتقاطَ يخدمُ عقدَينِ مختلفَينِ فيُفسِدُ كليهما. ولا `orders` ولا
-- `drivers` ولا مسارَ المطابقةِ ولا الإرسالَ. ولا صفَّ يُحذَفُ.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ١) صندوقُ الواردِ: كلُّ حدثِ CORE يُقيَّدُ قبلَ أن يُطبَّقَ.
-- -----------------------------------------------------------------------------
create table if not exists core_event_inbox (
  -- المفتاحُ الأوّليُّ هوَ معرّفُ الحدثِ نفسُه: هذا هوَ الإسلامُ.
  event_id uuid primary key,

  event_type text not null
    check (event_type in ('core.fulfillment.created', 'core.fulfillment.cancelled')),
  version integer not null check (version >= 1),
  producer text not null check (producer = 'wasla-core'),
  occurred_at timestamptz not null,
  correlation_id text not null check (length(btrim(correlation_id)) > 0),
  causation_id text,
  entity_type text not null check (length(btrim(entity_type)) > 0),
  entity_id text not null check (length(btrim(entity_id)) > 0),
  payload jsonb not null,

  received_at timestamptz not null default now(),
  processed_at timestamptz,

  -- `applied`: أثَّرَ في مهمّةٍ. `ignored`: صحيحٌ عقداً ولا أثرَ له (إلغاءُ مهمّةٍ
  -- منتهيةٍ سلفاً مثلاً) — **ويُقيَّدُ سببُه** فلا يُبتلَعُ صامتاً.
  outcome text check (outcome in ('applied', 'ignored')),
  outcome_note text,

  constraint core_event_inbox_processed_shape
    check (
      (processed_at is null and outcome is null and outcome_note is null)
      or (processed_at is not null and outcome is not null)
    ),
  constraint core_event_inbox_ignored_needs_note
    check (outcome is distinct from 'ignored' or outcome_note is not null)
);

comment on table core_event_inbox is
  'W-5: صندوقُ واردِ أحداثِ CORE. المفتاحُ الأوّليُّ هوَ event_id، فالإسلامُ في القاعدةِ.';

alter table core_event_inbox enable row level security;
drop policy if exists core_event_inbox_service_all on core_event_inbox;
create policy core_event_inbox_service_all on core_event_inbox
  for all to service_role using (true) with check (true);

-- -----------------------------------------------------------------------------
-- ٢) صندوقُ الصادرِ: أحداثُ MOVE إلى CORE، بالمِغلافِ القانونيِّ كاملاً.
-- -----------------------------------------------------------------------------
create table if not exists move_event_outbox (
  id uuid primary key default gen_random_uuid(),

  -- حقولُ المِغلافِ العشرةُ كما في `docs/contracts/core/envelope.schema.json`:
  -- تُخزَّنُ **مفرودةً** لا في jsonb، ليحرسَها نوعُها وقيدُها في القاعدةِ.
  event_id uuid not null unique,
  event_type text not null
    check (event_type in ('move.job.accepted', 'move.job.rejected', 'move.job.completed')),
  version integer not null default 1 check (version >= 1),
  producer text not null default 'wasla-move' check (producer = 'wasla-move'),
  occurred_at timestamptz not null default now(),
  correlation_id text not null check (length(btrim(correlation_id)) > 0),
  causation_id text,
  entity_type text not null default 'fulfillment' check (length(btrim(entity_type)) > 0),
  entity_id text not null check (length(btrim(entity_id)) > 0),
  payload jsonb not null,

  -- منعُ التكرارِ: أثرٌ واحدٌ لكلِّ (نوعٍ، مهمّةٍ).
  dedup_key text not null unique,

  -- لحظةُ الإيداعِ — ترتيبٌ ثابتٌ للمراجعةِ وأساسٌ لأيِّ سياسةِ استبقاءٍ لاحقةٍ.
  -- ولا تُستعمَلُ للحجزِ: الحجزُ بالاستحقاقِ (`next_attempt_at`) لا بالقِدَمِ.
  created_at timestamptz not null default now(),

  -- حالةُ التسليمِ — بنيةُ `ADR-0061` نفسُها: محاولاتٌ وموعدٌ ورمزُ حجزٍ.
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  claimed_at timestamptz,
  delivered_at timestamptz,
  dead_at timestamptz,
  last_error text,

  constraint move_event_outbox_claim_pair
    check ((claim_token is null) = (claimed_at is null)),
  constraint move_event_outbox_terminal_pair
    check (delivered_at is null or dead_at is null)
);

comment on table move_event_outbox is
  'W-5: صندوقُ صادرِ أحداثِ MOVE إلى CORE. الإيداعُ في معاملةِ تغييرِ الحالةِ، والإرسالُ من عاملٍ. الناقلُ محجوبٌ بـDEP-CORE-001.';

alter table move_event_outbox enable row level security;
drop policy if exists move_event_outbox_service_all on move_event_outbox;
create policy move_event_outbox_service_all on move_event_outbox
  for all to service_role using (true) with check (true);

-- -----------------------------------------------------------------------------
-- ٣) الإيداعُ: بابٌ واحدٌ، يُنادى **داخلَ** معاملةِ تغييرِ الحالةِ.
--    يُرجعُ معرّفَ الصفِّ إن أُدرِجَ، وnull إن كانَ مودَعاً سلفاً.
-- -----------------------------------------------------------------------------
create or replace function enqueue_move_event(
  p_event_type text,
  p_entity_id text,
  p_payload jsonb,
  p_correlation_id text,
  p_causation_id text,
  p_dedup_key text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  insert into move_event_outbox (
    event_id, event_type, entity_id, payload, correlation_id, causation_id, dedup_key
  ) values (
    gen_random_uuid(), p_event_type, p_entity_id, p_payload, p_correlation_id,
    p_causation_id, p_dedup_key
  )
  on conflict (dedup_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- ٤) قيدُ الحدثِ الواردِ. يُرجعُ `{ok, duplicate}`.
--    لا يُطبِّقُ شيئاً: القيدُ أوّلاً، والتطبيقُ بنداءٍ ثانٍ — فلو مات المُنادي
--    بينَهما بقيَ الحدثُ مقيَّداً غيرَ مطبَّقٍ، وهذا **مرئيٌّ** لا مفقودٌ.
-- -----------------------------------------------------------------------------
create or replace function ingest_core_event(p_envelope jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missing text;
  v_inserted uuid;
begin
  -- حقولُ المِغلافِ العشرةُ إلزاميّةٌ حرفاً — والغيابُ يُسمّى لا يُبتلَعُ.
  foreach v_missing in array array[
    'event_id', 'event_type', 'version', 'producer', 'occurred_at',
    'correlation_id', 'entity_type', 'entity_id', 'payload'
  ] loop
    if not (p_envelope ? v_missing) then
      return jsonb_build_object('ok', false, 'error', 'ENVELOPE_FIELD_MISSING', 'field', v_missing);
    end if;
  end loop;

  -- `causation_id` مطلوبٌ **بمفتاحِه** ويجوزُ أن يكونَ null: هكذا نصَّ العقدُ
  -- (`required` وفيه `["string","null"]`)، فغيابُ المفتاحِ خطأٌ لا تسامحَ فيه.
  if not (p_envelope ? 'causation_id') then
    return jsonb_build_object('ok', false, 'error', 'ENVELOPE_FIELD_MISSING', 'field', 'causation_id');
  end if;

  if jsonb_typeof(p_envelope -> 'payload') <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'PAYLOAD_MUST_BE_OBJECT');
  end if;

  insert into core_event_inbox (
    event_id, event_type, version, producer, occurred_at,
    correlation_id, causation_id, entity_type, entity_id, payload
  ) values (
    (p_envelope ->> 'event_id')::uuid,
    p_envelope ->> 'event_type',
    (p_envelope ->> 'version')::integer,
    p_envelope ->> 'producer',
    (p_envelope ->> 'occurred_at')::timestamptz,
    p_envelope ->> 'correlation_id',
    p_envelope ->> 'causation_id',
    p_envelope ->> 'entity_type',
    p_envelope ->> 'entity_id',
    p_envelope -> 'payload'
  )
  on conflict (event_id) do nothing
  returning event_id into v_inserted;

  return jsonb_build_object(
    'ok', true,
    'duplicate', v_inserted is null,
    'event_id', p_envelope ->> 'event_id'
  );
end $$;

-- -----------------------------------------------------------------------------
-- ٥) تطبيقُ `core.fulfillment.created`: إنشاءُ مهمّةٍ في «قيدِ التنسيقِ».
--    لا يقبلُ ولا يرفضُ: القبولُ قرارٌ تشغيليٌّ له دالّتُه.
-- -----------------------------------------------------------------------------
create or replace function apply_core_fulfillment_created(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event core_event_inbox;
  v_payload jsonb;
  v_job operational_jobs;
  v_created boolean := false;
begin
  select * into v_event from core_event_inbox where event_id = p_event_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'EVENT_NOT_INGESTED');
  end if;
  if v_event.event_type <> 'core.fulfillment.created' then
    return jsonb_build_object('ok', false, 'error', 'EVENT_TYPE_MISMATCH', 'event_type', v_event.event_type);
  end if;

  v_payload := v_event.payload;
  if (v_payload ->> 'fulfillment_id') is null
     or (v_payload ->> 'organization_id') is null
     or (v_payload ->> 'order_reference') is null
     or (v_payload ->> 'requested_service') is null then
    return jsonb_build_object('ok', false, 'error', 'PAYLOAD_FIELD_MISSING');
  end if;

  -- الإسلامُ: الحدثُ المُعادُ لا يُنشئُ مهمّةً ثانيةً، والفريدُ يمنعُه لا الكودُ.
  insert into operational_jobs (fulfillment_id, organization_id, order_reference, requested_service)
  values (
    (v_payload ->> 'fulfillment_id')::uuid,
    (v_payload ->> 'organization_id')::uuid,
    v_payload ->> 'order_reference',
    v_payload ->> 'requested_service'
  )
  on conflict (fulfillment_id) do nothing
  returning * into v_job;

  if v_job.id is null then
    select * into v_job from operational_jobs
      where fulfillment_id = (v_payload ->> 'fulfillment_id')::uuid;
  else
    v_created := true;
  end if;

  update core_event_inbox
    set processed_at = now(),
        outcome = 'applied',
        outcome_note = case when v_created then null else 'مهمّةٌ قائمةٌ سلفاً لهذا التنفيذِ' end
    where event_id = p_event_id and processed_at is null;

  return jsonb_build_object(
    'ok', true, 'created', v_created,
    'job_id', v_job.id, 'state', v_job.state,
    'fulfillment_id', v_job.fulfillment_id
  );
end $$;

-- -----------------------------------------------------------------------------
-- ٦) القبولُ: «قيدَ التنسيقِ» → «مُسندٌ»، ويُودِعُ `move.job.accepted`.
-- -----------------------------------------------------------------------------
create or replace function accept_operational_job(
  p_fulfillment_id uuid,
  p_correlation_id text,
  p_causation_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job operational_jobs;
  v_now timestamptz := now();
  v_row uuid;
begin
  select * into v_job from operational_jobs where fulfillment_id = p_fulfillment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'JOB_NOT_FOUND');
  end if;

  if v_job.state = 'assigned' then
    -- وقعَ سلفاً: نجاحٌ بلا أثرٍ ثانٍ.
    return jsonb_build_object('ok', true, 'duplicate', true, 'job_id', v_job.id, 'state', v_job.state);
  end if;
  if v_job.state <> 'coordinating' then
    return jsonb_build_object('ok', false, 'error', 'ILLEGAL_TRANSITION', 'from', v_job.state, 'to', 'assigned');
  end if;

  update operational_jobs
    set state = 'assigned', assigned_at = v_now
    where id = v_job.id
    returning * into v_job;

  v_row := enqueue_move_event(
    'move.job.accepted',
    v_job.fulfillment_id::text,
    jsonb_build_object(
      'fulfillment_id', v_job.fulfillment_id,
      'job_id', v_job.id::text,
      'accepted_at', to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    p_correlation_id,
    p_causation_id,
    'move.job.accepted:' || v_job.fulfillment_id::text
  );

  return jsonb_build_object(
    'ok', true, 'duplicate', false, 'job_id', v_job.id, 'state', v_job.state,
    'outbox_row', v_row
  );
end $$;

-- -----------------------------------------------------------------------------
-- ٧) الرفضُ: «قيدَ التنسيقِ» → «فاشلٌ (رفضاً)»، ويُودِعُ `move.job.rejected`.
--    ولا `job_id` في الحمولةِ: العقدُ لا يحملُه، فـCORE لا ينتظرُ تنفيذاً.
-- -----------------------------------------------------------------------------
create or replace function reject_operational_job(
  p_fulfillment_id uuid,
  p_reason text,
  p_correlation_id text,
  p_causation_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job operational_jobs;
  v_now timestamptz := now();
  v_row uuid;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
  end if;

  select * into v_job from operational_jobs where fulfillment_id = p_fulfillment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'JOB_NOT_FOUND');
  end if;

  if v_job.state = 'failed' and v_job.failure_stage = 'rejected' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'job_id', v_job.id, 'state', v_job.state);
  end if;
  if v_job.state <> 'coordinating' then
    return jsonb_build_object('ok', false, 'error', 'ILLEGAL_TRANSITION', 'from', v_job.state, 'to', 'failed');
  end if;

  update operational_jobs
    set state = 'failed', failure_stage = 'rejected', failure_reason = p_reason,
        outcome = 'failed', closed_at = v_now
    where id = v_job.id
    returning * into v_job;

  v_row := enqueue_move_event(
    'move.job.rejected',
    v_job.fulfillment_id::text,
    jsonb_build_object(
      'fulfillment_id', v_job.fulfillment_id,
      'reason', p_reason,
      'rejected_at', to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    p_correlation_id,
    p_causation_id,
    'move.job.rejected:' || v_job.fulfillment_id::text
  );

  return jsonb_build_object(
    'ok', true, 'duplicate', false, 'job_id', v_job.id, 'state', v_job.state, 'outbox_row', v_row
  );
end $$;

-- -----------------------------------------------------------------------------
-- ٨) الإغلاقُ: «مُسندٌ» → «مكتملٌ» أو «فاشلٌ (تنفيذاً)»، ويُودِعُ
--    `move.job.completed` بـ`outcome` المطابقِ.
--    **ولا نجاحَ من «قيدِ التنسيقِ»**: من لم يُسنَدْ لم يُنفَّذْ فلا يُعلَنُ
--    مكتملاً — وهذا حرفُ الشرطِ السابعِ في تفويضِ MOVE.
-- -----------------------------------------------------------------------------
create or replace function close_operational_job(
  p_fulfillment_id uuid,
  p_outcome text,
  p_correlation_id text,
  p_failure_reason text default null,
  p_causation_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job operational_jobs;
  v_now timestamptz := now();
  v_row uuid;
  v_target_state text;
begin
  if p_outcome not in ('completed', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'OUTCOME_INVALID', 'outcome', p_outcome);
  end if;
  if p_outcome = 'failed' and (p_failure_reason is null or length(btrim(p_failure_reason)) = 0) then
    return jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
  end if;
  v_target_state := case when p_outcome = 'completed' then 'completed' else 'failed' end;

  select * into v_job from operational_jobs where fulfillment_id = p_fulfillment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'JOB_NOT_FOUND');
  end if;

  -- وقعَ سلفاً بالنتيجةِ نفسِها: نجاحٌ بلا أثرٍ ثانٍ.
  if v_job.state = v_target_state and v_job.failure_stage is distinct from 'rejected' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'job_id', v_job.id, 'state', v_job.state);
  end if;
  if v_job.state <> 'assigned' then
    return jsonb_build_object('ok', false, 'error', 'ILLEGAL_TRANSITION', 'from', v_job.state, 'to', v_target_state);
  end if;

  update operational_jobs
    set state = v_target_state,
        outcome = p_outcome,
        failure_stage = case when p_outcome = 'failed' then 'execution' else null end,
        failure_reason = case when p_outcome = 'failed' then p_failure_reason else null end,
        closed_at = v_now
    where id = v_job.id
    returning * into v_job;

  v_row := enqueue_move_event(
    'move.job.completed',
    v_job.fulfillment_id::text,
    jsonb_build_object(
      'fulfillment_id', v_job.fulfillment_id,
      'job_id', v_job.id::text,
      'outcome', p_outcome,
      'completed_at', to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    p_correlation_id,
    p_causation_id,
    'move.job.completed:' || v_job.fulfillment_id::text
  );

  return jsonb_build_object(
    'ok', true, 'duplicate', false, 'job_id', v_job.id, 'state', v_job.state, 'outbox_row', v_row
  );
end $$;

-- -----------------------------------------------------------------------------
-- ٩) تطبيقُ `core.fulfillment.cancelled`: إلغاءٌ من أيِّ حالةٍ غيرِ نهائيّةٍ.
--    **ولا حدثَ صادرٌ**: CORE هوَ من ألغى، فإبلاغُه بإلغائِه ضجيجٌ لا عقدٌ —
--    ولا حدثَ إلغاءٍ من MOVE في عقودِ CORE أصلاً.
--    والمهمّةُ المنتهيةُ سلفاً: `ignored` بسببٍ مكتوبٍ، لا تجاوزٌ صامتٌ.
-- -----------------------------------------------------------------------------
create or replace function apply_core_fulfillment_cancelled(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event core_event_inbox;
  v_payload jsonb;
  v_job operational_jobs;
  v_now timestamptz := now();
begin
  select * into v_event from core_event_inbox where event_id = p_event_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'EVENT_NOT_INGESTED');
  end if;
  if v_event.event_type <> 'core.fulfillment.cancelled' then
    return jsonb_build_object('ok', false, 'error', 'EVENT_TYPE_MISMATCH', 'event_type', v_event.event_type);
  end if;

  v_payload := v_event.payload;
  if (v_payload ->> 'fulfillment_id') is null
     or (v_payload ->> 'order_reference') is null
     or (v_payload ->> 'reason') is null
     or (v_payload ->> 'cancelled_at') is null then
    return jsonb_build_object('ok', false, 'error', 'PAYLOAD_FIELD_MISSING');
  end if;

  select * into v_job from operational_jobs
    where fulfillment_id = (v_payload ->> 'fulfillment_id')::uuid
    for update;

  if not found then
    -- إلغاءٌ لتنفيذٍ لم يبلغْنا إنشاؤه: **لا يُنشأُ صفٌّ لِيُلغى**. والقيدُ
    -- يبقى في الواردِ، فلو وصلَ الإنشاءُ بعدَه رآه مَن يُدقِّقُ.
    update core_event_inbox
      set processed_at = v_now, outcome = 'ignored',
          outcome_note = 'لا مهمّةَ لهذا التنفيذِ عندَ MOVE — لم يصلْ حدثُ إنشائِها'
      where event_id = p_event_id and processed_at is null;
    return jsonb_build_object('ok', true, 'applied', false, 'reason', 'JOB_NOT_FOUND');
  end if;

  if v_job.state = 'cancelled' then
    update core_event_inbox
      set processed_at = v_now, outcome = 'applied', outcome_note = 'المهمّةُ ملغاةٌ سلفاً'
      where event_id = p_event_id and processed_at is null;
    return jsonb_build_object('ok', true, 'applied', false, 'duplicate', true, 'job_id', v_job.id, 'state', v_job.state);
  end if;

  if v_job.state in ('completed', 'failed') then
    -- **لا تُقلَبُ نهايةٌ**: المهمّةُ انتهت وأُبلِغَ بها، وقلبُها إلى ملغاةٍ
    -- يُكذِّبُ حدثاً نُشِرَ. يُقيَّدُ التجاهلُ بسببِه ويُترَكُ للمُصالحةِ (`W-8`).
    update core_event_inbox
      set processed_at = v_now, outcome = 'ignored',
          outcome_note = 'المهمّةُ في حالةٍ نهائيّةٍ (' || v_job.state || ') وقد أُودِعَ حدثُها — لا تُقلَبُ نهايةٌ'
      where event_id = p_event_id and processed_at is null;
    return jsonb_build_object('ok', true, 'applied', false, 'reason', 'ALREADY_TERMINAL', 'state', v_job.state);
  end if;

  update operational_jobs
    set state = 'cancelled', cancel_reason = v_payload ->> 'reason', closed_at = v_now
    where id = v_job.id
    returning * into v_job;

  update core_event_inbox
    set processed_at = v_now, outcome = 'applied'
    where event_id = p_event_id and processed_at is null;

  return jsonb_build_object('ok', true, 'applied', true, 'job_id', v_job.id, 'state', v_job.state);
end $$;

-- -----------------------------------------------------------------------------
-- ١٠) الالتقاطُ والإتمامُ والتخلّي — بنيةُ `ADR-0061` نفسُها: استرجاعُ المتروكِ،
--     ثمَّ `for update skip locked`، ثمَّ رمزُ حجزٍ. والإتمامُ **بالرمزِ** لا
--     بالصفِّ، فعاملٌ متأخّرٌ لا يُتِمُّ حجزَ غيرِه.
-- -----------------------------------------------------------------------------
create or replace function claim_move_event_delivery(
  -- بلا قيمةٍ افتراضيّةٍ: الحدُّ مُعلَنٌ في
  -- `packages/shared/config/move-event-outbox.ts` ويُمرَّرُ وسيطاً، فلا رقمَ
  -- محفورٌ في الدالّةِ يصيرُ موضعاً ثانياً للحدِّ (سجلُّ `F6-06`).
  p_stale_after_seconds integer
) returns table (
  row_id uuid, claim_token uuid, event_id uuid, event_type text, version integer,
  producer text, occurred_at timestamptz, correlation_id text, causation_id text,
  entity_type text, entity_id text, payload jsonb, attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
-- أسماءُ أعمدةِ الردِّ (`claim_token`, `event_id`, ...) تُطابِقُ أسماءَ أعمدةِ
-- الجدولِ، فبلا هذا التوجيهِ يقعُ `column reference is ambiguous` في كلِّ عبارةٍ
-- تذكرُ أحدَها. والقرارُ **العمودُ**: كلُّ ذكرٍ ههنا مقصودُه عمودُ الجدولِ لا
-- متغيّرُ الردِّ، والردُّ يُبنى بـ`return query` صريحاً.
#variable_conflict use_column
declare
  v_token uuid := gen_random_uuid();
  v_id uuid;
begin
  -- استرجاعُ المتروكِ: حجزٌ قديمٌ لعاملٍ مات لا يُقفِلُ الصفَّ إلى الأبدِ.
  update move_event_outbox
    set claim_token = null, claimed_at = null
    where claim_token is not null
      and claimed_at < now() - make_interval(secs => p_stale_after_seconds)
      and delivered_at is null and dead_at is null;

  select o.id into v_id
    from move_event_outbox o
    where o.delivered_at is null and o.dead_at is null
      and o.claim_token is null and o.next_attempt_at <= now()
    order by o.next_attempt_at
    for update skip locked
    limit 1;

  if v_id is null then
    return;
  end if;

  update move_event_outbox
    set claim_token = v_token, claimed_at = now(), attempts = attempts + 1
    where id = v_id;

  return query
    select o.id, o.claim_token, o.event_id, o.event_type, o.version, o.producer,
           o.occurred_at, o.correlation_id, o.causation_id, o.entity_type, o.entity_id,
           o.payload, o.attempts
      from move_event_outbox o where o.id = v_id;
end $$;

create or replace function finish_move_event_delivery(p_claim_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  update move_event_outbox
    set delivered_at = now(), claim_token = null, claimed_at = null, last_error = null
    where claim_token = p_claim_token and delivered_at is null and dead_at is null;
  get diagnostics v_count = row_count;
  return v_count = 1;
end $$;

create or replace function abandon_move_event_delivery(
  p_claim_token uuid,
  p_error text,
  -- كسابقتِها: الحدَّانِ مُعلَنانِ في الشيفرةِ ويُمرَّرانِ وسيطَينِ.
  p_max_attempts integer,
  p_backoff_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row move_event_outbox;
begin
  select * into v_row from move_event_outbox
    where claim_token = p_claim_token and delivered_at is null and dead_at is null
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'CLAIM_NOT_HELD');
  end if;

  if v_row.attempts >= p_max_attempts then
    update move_event_outbox
      set dead_at = now(), claim_token = null, claimed_at = null, last_error = p_error
      where id = v_row.id;
    return jsonb_build_object('ok', true, 'dead', true, 'attempts', v_row.attempts);
  end if;

  update move_event_outbox
    set claim_token = null, claimed_at = null, last_error = p_error,
        next_attempt_at = now() + make_interval(secs => p_backoff_seconds * v_row.attempts)
    where id = v_row.id;
  return jsonb_build_object('ok', true, 'dead', false, 'attempts', v_row.attempts);
end $$;
