-- migration-phase: expand
-- =============================================================================
-- `F3-01` · `SD-01` + `SD-02` — وثائقُ السائقِ بحالاتِها وتواريخِ انتهائِها.
--
-- الحالة: منفَّذٌ فعليّاً — البند `F3-01` (ومعَه `F12-14` إنفاذاً).
-- ينتمي إلى: supabase/migrations
-- يحرسُه: tests/integration/driver-documents.test.ts ·
--          scripts/check-driver-documents-contract.ts
-- الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
--
-- ## لِمَ جدولٌ للوثائقِ ولا تكفي أعمدةٌ في `drivers`
--
-- ستُّ وثائقَ منصوصةٌ في اللائحةِ (رخصةُ القيادةِ · الفحصُ الطبيُّ · خلوُّ
-- السوابقِ · رخصةُ السيرِ · التأمينُ · الفحصُ الدوريُّ)، ولكلِّ واحدةٍ **حالةٌ
-- وتاريخُ انتهاءٍ وسببُ رفضٍ**. وستُّ ثلاثيّاتٍ في `drivers` ثمانيةَ عشرَ
-- عموداً، وكلُّ وثيقةٍ تُضيفُها اللائحةُ غداً هجرةُ `alter table` على جدولٍ
-- حارٍّ. فالصفُّ لكلِّ وثيقةٍ، والنوعُ المعدودُ يمنعُ اسماً مُختَرَعاً.
--
-- ## ولِمَ الحجبُ **ساعةٌ لا رايةٌ**
--
-- الرايةُ (`is_blocked boolean`) تحتاجُ من يقلبُها في اللحظةِ الصحيحةِ: مهمّةٌ
-- دوريّةٌ تتأخّرُ، أو إداريٌّ ينسى — وبينَهما سائقٌ يعملُ برخصةٍ منتهيةٍ.
-- **والتاريخُ يقولُ الحقَّ بنفسِه**: `expires_at < now()` جوابٌ لا يحتاجُ
-- مهمّةً، فلا لحظةَ تكونُ فيها القاعدةُ تعرفُ الانتهاءَ ولا تُنفِذُه. وهذا
-- **نصُّ `F12-14`**: «حجبٌ تلقائيٌّ بلا تدخُّلٍ يدويٍّ».
--
-- ## وما لا يُخزَّنُ ههنا عن قصدٍ — (`ح-5`)
--
--   ــ **لا بايتَ صورةٍ ولا مِلفَّ**: العمودُ `object_path` **مسارٌ في مخزنِ
--      الكائناتِ** لا محتوىً. مِلفُّ رخصةٍ في `bytea` يُضخِّمُ كلَّ نسخةٍ
--      احتياطيّةٍ ويُسرِّبُ صورةً في كلِّ سجلٍّ يُطبَعُ فيه الصفُّ.
--   ــ **لا رقمَ رخصةٍ ولا رقمَ هويّةٍ**: لا يحتاجُهما الحجبُ، وتخزينُهما
--      مسؤوليّةُ حمايةٍ بلا مقابلٍ (`PDPL` · `ADR 0078`).
--   ــ **لا قرارَ قبولٍ آليٍّ**: القبولُ فعلُ إنسانٍ في اللوحةِ، والقاعدةُ
--      تحرسُ الأثرَ لا تحكمُ بالعينِ.
-- =============================================================================

-- ── ١) نوعُ الوثيقةِ — ستٌّ منصوصةٌ في اللائحةِ لا أكثرَ ولا أقلَّ ──────────
do $$ begin
  create type driver_document_type as enum (
    'driving_license',       -- رخصةُ القيادةِ
    'medical_exam',          -- الفحصُ الطبيُّ
    'criminal_record',       -- شهادةُ خلوِّ السوابقِ (تُحدَّثُ سنويّاً)
    'vehicle_registration',  -- رخصةُ السيرِ
    'insurance',             -- التأمينُ
    'periodic_inspection'    -- الفحصُ الفنّيُّ الدوريُّ
  );
exception when duplicate_object then null; end $$;

-- ── ٢) حالةُ الوثيقةِ — مراحلُ `SD-02` حرفاً ────────────────────────────────
-- «مُستلَم / قيد المراجعة / ناقص (بتحديد الناقص) / مقبول / مرفوض بسبب».
-- و«ناقصٌ» **حالةُ وثيقةٍ مُستلَمةٍ ناقصةٍ** (صورةٌ مقطوعةٌ، تاريخٌ غيرُ ظاهرٍ)
-- لا غيابَ صفٍّ: الغيابُ يُقرأُ من `driver_required_document_types` لا من صفٍّ
-- مكتوبٍ بحالةٍ تقولُ «لم يُرسَلْ».
do $$ begin
  create type driver_document_status as enum (
    'received', 'under_review', 'incomplete', 'accepted', 'rejected'
  );
exception when duplicate_object then null; end $$;

-- ── ٣) الجدولُ ──────────────────────────────────────────────────────────────
-- التفرُّدُ `(driver_id, doc_type)` **داخلَ `create table`** لا فهرساً مستقلّاً:
-- الوثيقةُ الجديدةُ من النوعِ نفسِه **تُحِلُّ** محلَّ سابقتِها (`on conflict do
-- update`) ولا تُكوِّمُ صفوفاً يُسألُ أيُّها الحاكمُ. وتاريخُ الإحلالِ يبقى في
-- `audit_log` فلا يُمحى أثرٌ (`ح-8`).
create table if not exists driver_documents (
  id           uuid primary key default gen_random_uuid(),
  city_id      uuid not null references cities(id),
  driver_id    uuid not null references drivers(id) on delete cascade,
  doc_type     driver_document_type not null,
  status       driver_document_status not null default 'received',
  object_path  text not null,
  -- تاريخٌ لا وقتٌ: الوثائقُ تنتهي بيومٍ لا بساعةٍ، و`timestamptz` يُوهِمُ
  -- بدقّةٍ لا تملكُها ويجعلُ منتصفَ الليلِ سؤالَ منطقةٍ زمنيّةٍ.
  expires_at   date,
  review_note  text,
  submitted_at timestamptz,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (driver_id, doc_type)
);

do $$ begin
  create trigger driver_documents_set_updated_at before update on driver_documents
  for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;

-- ── ٤) القيودُ — `not valid` ثمَّ تُصادَقُ في طورِها (`CAP-007`) ─────────────
-- **مسارُ الكائنِ لا يكونُ فراغاً**: صفٌّ بمسارٍ فارغٍ وثيقةٌ لا تُفتَحُ، وهي
-- أسوأُ من غيابِ صفٍّ لأنَّها تُحسَبُ مُستلَمةً.
do $$ begin
  alter table driver_documents
    add constraint driver_documents_object_path_present
    check (btrim(object_path) <> '') not valid;
exception when duplicate_object then null; end $$;

-- **المرفوضُ يُعلِنُ سببَه**: «مرفوض بسبب» نصُّ `SD-02`، ورفضٌ بلا سببٍ يجعلُ
-- الشاشةَ تقولُ للسائقِ «رُفِضَت» ولا تقولُ ماذا يفعلُ.
do $$ begin
  alter table driver_documents
    add constraint driver_documents_rejection_has_reason
    check (status <> 'rejected' or btrim(coalesce(review_note, '')) <> '') not valid;
exception when duplicate_object then null; end $$;

-- **المقبولُ يُعلِنُ انتهاءَه**: وثيقةٌ مقبولةٌ بلا تاريخِ انتهاءٍ **تُعطِّلُ
-- الحجبَ** — فالساعةُ بلا عقربٍ لا تُنبِّهُ، وهذا خرقُ `F12-14` من داخلِه.
do $$ begin
  alter table driver_documents
    add constraint driver_documents_accepted_has_expiry
    check (status <> 'accepted' or expires_at is not null) not valid;
exception when duplicate_object then null; end $$;

comment on table driver_documents is
  'وثائقُ السائقِ: صفٌّ لكلِّ نوعٍ بحالتِه وتاريخِ انتهائِه، والمِلفُّ في مخزنِ الكائناتِ لا في العمودِ (F3-01 · ADR 0115).';

-- ── ٥) الإعداداتُ — لا رقمَ صلباً في الشِفرةِ (`م0-5`) ───────────────────────
-- تُكتَبُ لكلِّ مدينةٍ قائمةٍ الآنَ، وتصلُ المدينةَ الجديدةَ من
-- `seed_city_settings` نسخاً عن أختِها فلا كتالوجَ ثانٍ يَنزلِقُ.
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, v.key, v.value, v.value_type, v.description_ar, true
  from cities c
  cross join (values
    ('driver_required_document_types',
     '["driving_license","medical_exam","criminal_record","vehicle_registration","insurance","periodic_inspection"]'::jsonb,
     'array', 'أنواعُ الوثائقِ الإلزاميّةُ للسائقِ — منصوصةٌ في لائحةِ التوجيهِ'),
    ('driver_document_expiry_warning_days', '30'::jsonb, 'number',
     'عددُ الأيّامِ التي يُنبَّهُ فيها السائقُ قبلَ انتهاءِ وثيقةٍ'),
    ('driver_document_max_bytes', '5242880'::jsonb, 'number',
     'أقصى حجمٍ لمِلفِّ وثيقةٍ بالبايتِ'),
    ('driver_document_allowed_content_types',
     '["image/jpeg","image/png","application/pdf"]'::jsonb, 'array',
     'أنواعُ المحتوى المقبولةُ لمِلفِّ وثيقةٍ'),
    ('driver_document_upload_url_ttl_seconds', '900'::jsonb, 'number',
     'عمرُ رابطِ الرفعِ الموقَّعِ بالثواني — قصيرٌ عن قصدٍ')
  ) as v(key, value, value_type, description_ar)
on conflict (city_id, key) do nothing;
