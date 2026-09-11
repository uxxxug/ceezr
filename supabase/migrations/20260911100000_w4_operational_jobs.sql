-- migration-phase: expand
-- =============================================================================
-- W-4: نموذجُ المهمّةِ التشغيليّةِ القانونيُّ — `operational_jobs`.
-- الحالة: منفّذ (توسيعٌ محضٌ: جدولٌ جديدٌ، ولا عمودَ حُذِفَ ولا قيدَ ضُيِّقَ).
-- ينتمي إلى: supabase/migrations.
-- يبني على: عقودَ CORE في `docs/contracts/core/` (المنقولةُ عندَ `511624b`).
-- يُستخدم من: هجرةِ `W-5` (`20260911100100`) ومن
--   `packages/infrastructure/wasla/operational-job-repository.ts`.
--
-- ## ما هذا الجدولُ وما ليسَ هو
--
-- هوَ **تمثيلُ MOVE للتنفيذِ الذي طلبَه CORE**، ومفتاحُه الخارجيُّ الوحيدُ
-- `fulfillment_id` — معرّفٌ **مُعتِمٌ** صادرٌ عن CORE. وليسَ هوَ `orders`:
-- `orders` جدولُ الطلبِ التجاريِّ القديمِ في MOVE (راكبٌ وسائقٌ وأجرةٌ ومدينةٌ
-- وحالاتُ بحثٍ ومطابقةٍ)، وجردُ الحدِّ (`W-1`، `ADR-0080`) يصنّفُه
-- `REFACTOR`/`MOVE_TO_CORE` في أجزائِه التجاريّةِ. **فلا مرجعَ من هذا الجدولِ
-- إلى `orders` ولا بالعكسِ**: الربطُ بينَهما — يومَ يُنفَّذُ `W-2` — يكونُ بقرارٍ
-- موثَّقٍ وهجرةٍ خاصّةٍ، لا بعمودٍ يُدَسُّ اليومَ بلا مُنادٍ.
--
-- **ولا بياناتَ تجاريّةً هنا**: لا سعرٌ ولا أجرةٌ ولا هويّةُ عميلٍ ولا عنوانٌ.
-- `order_reference` نصٌّ مُعتِمٌ كما وصلَ من CORE، لا يُفسَّرُ ولا يُفكَّكُ.
--
-- ## آلةُ الحالاتِ — ومطابقتُها لحالةِ CORE
--
-- CORE يحملُ لكلِّ `fulfillment` حالةً من:
-- `coordinating | dispatched | completed | failed | cancelled`.
-- وحالةُ المهمّةِ عندَ MOVE:
--
--   coordinating ──accept──▶ assigned ──complete──▶ completed
--        │                      │
--        │                      ├──fail─────────▶ failed  (failure_stage='execution')
--        ├──reject────────────────────────────▶ failed  (failure_stage='rejected')
--        │                      │
--        └──cancel──────────────┴────────────▶ cancelled
--
-- بالعربيّةِ: **قيدَ التنسيقِ → مُسندٌ → مكتملٌ / فاشلٌ / ملغىً**.
--
-- والانتقالاتُ **مغلقةٌ**: لا `assigned` إلَّا من `coordinating`، ولا `completed`
-- إلَّا من `assigned`، ولا خروجَ من حالةٍ نهائيّةٍ ألبتّةَ. والإنفاذُ في دوالِّ
-- هجرةِ `W-5` لا في كودِ التطبيقِ، **والقيودُ ههنا تحرسُ شكلَ الصفِّ** حتى لو
-- كتبَ فيه كاتبٌ آخرُ: لا `assigned` بلا `assigned_at`، ولا حالةَ نهائيّةَ بلا
-- `closed_at`، ولا `outcome` إلَّا في النهائيَّينِ اللذَينِ يُبلَّغانِ إلى CORE،
-- ولا سببَ إلغاءٍ في غيرِ الملغى.
--
-- ## لماذا `failed` تحملُ مرحلتَينِ
--
-- لأنَّ العقدَ يُفرِّقُ بينَهما: **الرفضُ** يُنشرُ `move.job.rejected` (ولا
-- `job_id` فيه، فـCORE لم يَعُدْ ينتظرُ تنفيذاً)، **والإخفاقُ بعدَ الإسنادِ**
-- يُنشرُ `move.job.completed` بـ`outcome='failed'` (وفيه `job_id`، فالتنفيذُ بدأَ
-- ثمَّ انتهى إلى فشلٍ). فحالةٌ واحدةٌ في القاعدةِ وحدثانِ مختلفانِ في العقدِ،
-- **والفرقُ مُخزَّنٌ لا مُستنتَجٌ** — ولا يُستنتَجُ من `assigned_at is null`
-- لأنَّ ذاك استنتاجٌ يسقطُ يومَ يُضافُ مسارٌ ثالثٌ.
--
-- ## ما لا تُغيّره هذه الهجرةُ
--
-- لا جدولاً قائماً ولا دالّةً قائمةً ولا سياسةَ RLS قائمةً. ولا تُنشئُ صندوقَ
-- صادرٍ ولا واردٍ — ذاكَ في `20260911100100`.
-- =============================================================================

create table if not exists operational_jobs (
  id uuid primary key default gen_random_uuid(),

  -- معرّفُ CORE، وهوَ **مفتاحُ الإسلامِ**: حدثُ إنشاءٍ مكرَّرٌ لا يُنشئُ مهمّةً
  -- ثانيةً، لأنَّ الفريدَ ههنا يمنعُه في القاعدةِ لا في الكودِ.
  fulfillment_id uuid not null unique,

  -- معرّفُ المنظّمةِ عندَ CORE كما وصلَ. لا مرجعَ إلى جدولٍ محليٍّ: مِلكيّةُ
  -- المنظّماتِ لـCORE بحكمِ `W-1`، والمرجعُ يُنشئُ اقتراناً لا يُريدُه الحدُّ.
  organization_id uuid not null,

  -- مرجعُ الطلبِ التجاريِّ عندَ MARKET/CORE — **نصٌّ مُعتِمٌ لا يُفسَّرُ**.
  order_reference text not null,

  -- الخدمةُ المطلوبةُ كما سمّاها CORE. لا قيدَ تعدادٍ ههنا: التعدادُ مِلكُ CORE،
  -- وقيدٌ محليٌّ عليه يجعلُ إضافةَ خدمةٍ في CORE عطلاً في MOVE.
  requested_service text not null,

  state text not null default 'coordinating'
    check (state in ('coordinating', 'assigned', 'completed', 'failed', 'cancelled')),

  -- مرحلةُ الفشلِ: رفضٌ قبلَ الإسنادِ، أو إخفاقٌ بعدَه. مُخزَّنةٌ لا مُستنتَجةٌ.
  failure_stage text check (failure_stage in ('rejected', 'execution')),
  failure_reason text,

  -- سببُ الإلغاءِ كما وصلَ من CORE (CORE هوَ من يُلغي، لا MOVE).
  cancel_reason text,

  -- `outcome` هوَ **حرفُ العقدِ** في `move.job.completed`، ولا يُكتَبُ إلَّا حينَ
  -- يكونُ هناكَ ما يُبلَّغُ به: مكتملٌ أو فاشلٌ بعدَ إسنادٍ.
  outcome text check (outcome in ('completed', 'failed')),

  created_at timestamptz not null default now(),
  assigned_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz not null default now(),

  -- لا مُسندٌ بلا زمنِ إسنادٍ، ولا نهائيٌّ بلا زمنِ إغلاقٍ.
  constraint operational_jobs_assigned_shape
    check (state <> 'assigned' or assigned_at is not null),
  constraint operational_jobs_terminal_shape
    check (
      (state in ('coordinating', 'assigned') and closed_at is null)
      or (state in ('completed', 'failed', 'cancelled') and closed_at is not null)
    ),

  -- `outcome` حصراً في النهائيَّينِ المُبلَّغَينِ، ومطابقٌ لحالتِه حرفاً.
  constraint operational_jobs_outcome_shape
    check (
      (state = 'completed' and outcome = 'completed')
      or (state = 'failed' and outcome = 'failed')
      or (state in ('coordinating', 'assigned', 'cancelled') and outcome is null)
    ),

  -- مرحلةُ الفشلِ وسببُه حصراً في الفاشلِ، ومعاً لا فرادى.
  constraint operational_jobs_failure_shape
    check (
      (state = 'failed' and failure_stage is not null and failure_reason is not null)
      or (state <> 'failed' and failure_stage is null and failure_reason is null)
    ),

  -- الإخفاقُ بعدَ الإسنادِ يلزمُه إسنادٌ سابقٌ؛ والرفضُ يمنعُه.
  constraint operational_jobs_failure_stage_shape
    check (
      failure_stage is null
      or (failure_stage = 'execution' and assigned_at is not null)
      or (failure_stage = 'rejected' and assigned_at is null)
    ),

  -- سببُ الإلغاءِ حصراً في الملغى.
  constraint operational_jobs_cancel_shape
    check (
      (state = 'cancelled' and cancel_reason is not null)
      or (state <> 'cancelled' and cancel_reason is null)
    ),

  -- المُعتِمُ ليسَ فارغاً: عقدُ CORE يُلزِمُ `minLength: 1` فيُنفَذُ في القاعدةِ.
  constraint operational_jobs_opaque_refs_nonempty
    check (length(btrim(order_reference)) > 0 and length(btrim(requested_service)) > 0)
);

comment on table operational_jobs is
  'W-4: تمثيلُ MOVE لتنفيذٍ طلبَه CORE. مفتاحُه fulfillment_id المُعتِمُ، ولا يُربَطُ بـorders.';

alter table operational_jobs enable row level security;

-- لا سياسةَ لـanon ولا لـauthenticated: هذا جدولُ خدمةٍ يُكتَبُ من العاملِ
-- والبوّابةِ بدورِ الخدمةِ، ولا واجهةَ عميلٍ تقرؤه اليومَ. وحينَ تُوجَدُ واجهةٌ
-- تُضافُ سياستُها بهجرتِها ومُنادِيها واختبارِها.
drop policy if exists operational_jobs_service_all on operational_jobs;
create policy operational_jobs_service_all on operational_jobs
  for all to service_role using (true) with check (true);

-- `updated_at` لا يُترَكُ لأمانةِ الكاتبِ.
create or replace function touch_operational_job_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists operational_jobs_touch_updated_at on operational_jobs;
create trigger operational_jobs_touch_updated_at
  before update on operational_jobs
  for each row execute function touch_operational_job_updated_at();
