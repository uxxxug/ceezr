-- migration-phase: contract

-- ════════════════════════════════════════════════════════════════════════════
-- F12-10: امتثال PDPL — أساس المعالجة، حقوق أصحاب البيانات، تقييم الأثر،
--          وضوابط نقل البيانات خارج المملكة
-- ════════════════════════════════════════════════════════════════════════════
--
-- الأساسُ النظاميُّ:
--   المادةُ ٤ (حقوقُ أصحابِ البياناتِ) · المادةُ ١٠ (معالجةٌ من مصدرَين) ·
--   المادةُ ١٣ (الإعلامُ عند الجمعِ) · المادةُ ١٨ (الإتلافُ والاستبقاءُ) ·
--   المادةُ ٢٢ (تقويمُ الأثرِ) · المادةُ ٢٩ (النقلُ خارجَ المملكةِ) ·
--   المادةُ ٣١ (سجلّاتُ أنشطةِ المعالجةِ)
--
-- والتصميمُ: سجلٌّ قابلٌ للقياسِ لا نظامُ إدارةِ امتثالٍ كاملٌ.
--   أربعةُ جداولَ تُغطّي المحاورَ الأربعةَ، وقيودٌ في القاعدةِ لا في TypeScript.
--   ولا إرسالَ خارجيَّ ولا واجهةَ مستخدمٍ — ذلك قدرةٌ تشغيليّةٌ لإدارةِ الامتثالِ.
-- ════════════════════════════════════════════════════════════════════════════

-- ── ١) الأنواعُ المُعدَّدةُ ──────────────────────────────────────────────────

create type if not exists pdpl_processing_basis as enum (
  'consent',
  'publicly_available',
  'public_interest_security',
  'vital_interests',
  'public_health_safety',
  'anonymised_form',
  'legitimate_interests',
  'legal_obligation',
  'judicial_requirement'
);

create type if not exists pdpl_activity_status as enum (
  'draft',
  'active',
  'suspended',
  'retired'
);

create type if not exists pdpl_subject_right as enum (
  'be_informed',
  'access',
  'obtain_copy',
  'correct',
  'complete',
  'update',
  'destroy',
  'object_processing',
  'withdraw_consent'
);

create type if not exists pdpl_right_request_status as enum (
  'received',
  'in_progress',
  'fulfilled',
  'refused',
  'partially_fulfilled'
);

create type if not exists pdpl_dpia_risk_level as enum (
  'high_risk',
  'medium_risk',
  'low_risk'
);

create type if not exists pdpl_dpia_status as enum (
  'required',
  'in_progress',
  'completed',
  'approved',
  'rejected'
);

create type if not exists pdpl_transfer_basis as enum (
  'treaty_obligation',
  'ksa_interests',
  'subject_contractual_obligation',
  'other_regulated_purpose'
);

create type if not exists pdpl_transfer_status as enum (
  'requested',
  'approved',
  'rejected',
  'expired',
  'revoked'
);

-- ── ٢) جدولُ أنشطةِ المعالجةِ — المادةُ ٣١ ────────────────────────────────

create table if not exists pdpl_processing_activities (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities(id),

  -- المادةُ ٣١(١): تفاصيلُ الاتصالِ الخاصةُ بجهةِ التحكمِ
  controller_contact text not null,

  -- المادةُ ٣١(٢): الغرضُ من المعالجةِ
  purpose text not null,

  -- المادةُ ١٣(٢): تحديدُ البياناتِ الإلزاميّةِ والاختياريّةِ
  mandatory_data_categories text[] not null default '{}',
  optional_data_categories text[] not null default '{}',

  -- المادةُ ٣١(٣): وصفُ فئاتِ أصحابِ البياناتِ
  subject_categories text[] not null default '{}',

  -- أساسُ المعالجةِ (المادةُ ١٠)
  processing_basis pdpl_processing_basis not null,

  -- المادةُ ١٣(٤): الجهاتُ التي ستُفشى لها البياناتُ
  disclosure_recipients text[] not null default '{}',

  -- المادةُ ٣١(٥): هل نُقِلَت البياناتُ خارجَ المملكةِ
  involves_cross_border_transfer boolean not null default false,

  -- المادةُ ٣١(٦): المدةُ الزمنيّةُ المتوقَّعةُ للاحتفاظِ
  expected_retention_period text not null,

  -- هل يتطلَّبُ تقييمَ أثرٍ (المادةُ ٢٢)
  requires_dpia boolean not null default false,

  status pdpl_activity_status not null default 'draft',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references users(id),
  updated_by uuid not null references users(id)
);

-- ── ٣) جدولُ طلباتِ أصحابِ البياناتِ — المادةُ ٤ ──────────────────────────

create table if not exists pdpl_data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities(id),

  -- نوعُ الحقِّ المطلوبِ (المادةُ ٤)
  right_type pdpl_subject_right not null,

  -- مَن صاحبُ الطلبِ: معرّفُ تيليجرامَ لا الداخليُّ (أمنيٌّ — انظر ADR 0112)
  requester_telegram_id text not null,

  -- مرجعٌ اختياريٌّ لإيصالِ export/erasure الموجودِ (F2-11)
  related_export_receipt text,
  related_erasure_receipt text,

  status pdpl_right_request_status not null default 'received',

  received_at timestamptz not null default now(),
  due_at timestamptz not null default (now() + interval '30 days'),

  completed_at timestamptz,
  result_summary text,
  refusal_reason text,

  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

-- ── ٤) جدولُ تقييماتِ الأثرِ — المادةُ ٢٢ ─────────────────────────────────

create table if not exists pdpl_dpia_assessments (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities(id),

  processing_activity_id uuid not null references pdpl_processing_activities(id),

  -- وصفُ المعالجةِ محلَّ التقييمِ
  processing_description text not null,

  -- المخاطرُ على أصحابِ البياناتِ
  identified_risks text not null,

  -- الضوابطُ والإجراءاتُ التخفيفيّةُ
  mitigation_measures text not null,

  -- مستوى الخطرِ المتبقّي بعدَ التخفيفِ
  residual_risk_level pdpl_dpia_risk_level not null,

  status pdpl_dpia_status not null default 'required',

  assessed_by uuid not null references users(id),
  approved_by uuid references users(id),
  assessed_at timestamptz not null default now(),
  approved_at timestamptz,

  -- المراجعةُ الدوريّةُ: كلَّ سنتَينِ على الأقلِّ
  next_review_due timestamptz not null default (now() + interval '2 years'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── ٥) جدولُ النقلِ خارجَ المملكةِ — المادةُ ٢٩ ────────────────────────────

create table if not exists pdpl_cross_border_transfers (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities(id),

  processing_activity_id uuid not null references pdpl_processing_activities(id),

  -- البلدُ أو الجهةُ المستقبلةُ
  recipient_country text not null,
  recipient_entity text not null,

  -- فئاتُ البياناتِ المنقولةِ
  transferred_data_categories text[] not null default '{}',

  -- أساسُ النقلِ (المادةُ ٢٩(١))
  transfer_basis pdpl_transfer_basis not null,

  -- الضماناتُ (المادةُ ٢٩(٢): مستوى الحمايةِ، الحدُّ الأدنى من البياناتِ)
  protection_safeguards text not null,

  status pdpl_transfer_status not null default 'requested',

  -- تاريخُ الاعتمادِ والانتهاءِ
  approved_at timestamptz,
  expires_at timestamptz not null default (now() + interval '1 year'),

  approved_by uuid references users(id),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

-- ── ٦) RLS ──────────────────────────────────────────────────────────────────

alter table pdpl_processing_activities enable row level security;
create policy "service_role full access" on pdpl_processing_activities
  for all using (true) with check (true);
revoke all on pdpl_processing_activities from public, anon, authenticated;
grant select, insert, update on pdpl_processing_activities to service_role;

alter table pdpl_data_subject_requests enable row level security;
create policy "service_role full access" on pdpl_data_subject_requests
  for all using (true) with check (true);
revoke all on pdpl_data_subject_requests from public, anon, authenticated;
grant select, insert, update on pdpl_data_subject_requests to service_role;

alter table pdpl_dpia_assessments enable row level security;
create policy "service_role full access" on pdpl_dpia_assessments
  for all using (true) with check (true);
revoke all on pdpl_dpia_assessments from public, anon, authenticated;
grant select, insert, update on pdpl_dpia_assessments to service_role;

alter table pdpl_cross_border_transfers enable row level security;
create policy "service_role full access" on pdpl_cross_border_transfers
  for all using (true) with check (true);
revoke all on pdpl_cross_border_transfers from public, anon, authenticated;
grant select, insert, update on pdpl_cross_border_transfers to service_role;

-- ── ٧) الدوالُ: أساسُ المعالجةِ ─────────────────────────────────────────────

-- هل النشاطُ مسموحٌ به؟: يجبُ أن يكونَ له أساسٌ معلَنٌ وأن يكونَ نشطاً.
create or replace function pdpl_processing_activity_is_allowed(
  p_activity_id uuid
) returns boolean
language sql
immutable
as $$
  select exists(
    select 1 from pdpl_processing_activities
    where id = p_activity_id
      and processing_basis is not null
      and status = 'active'::pdpl_activity_status
  );
$$;

-- هل يتطلَّبُ النشاطُ تقييمَ أثرٍ؟
create or replace function pdpl_dpia_required(
  p_activity_id uuid
) returns boolean
language sql
immutable
as $$
  select requires_dpia from pdpl_processing_activities where id = p_activity_id;
$$;

-- هل تقييمُ الأثرِ معتمدٌ؟
create or replace function pdpl_dpia_is_approved(
  p_activity_id uuid
) returns boolean
language sql
immutable
as $$
  select exists(
    select 1 from pdpl_dpia_assessments
    where processing_activity_id = p_activity_id
      and status = 'approved'::pdpl_dpia_status
      and (next_review_due is null or next_review_due > now())
  );
$$;

-- هل النشاطُ عاليُ الخطرِ ويحتاجُ تقييماً معتمداً؟
create or replace function pdpl_high_risk_requires_dpia(
  p_activity_id uuid
) returns boolean
language sql
immutable
as $$
  select
    case
      when pdpl_dpia_required(p_activity_id) and not pdpl_dpia_is_approved(p_activity_id)
        then true
      else false
    end;
$$;

-- ── ٨) الدوالُ: النقلُ خارجَ المملكةِ ──────────────────────────────────────

-- هل النقلُ مسموحٌ به؟: يجبُ أن يكونَ معتمداً وغيرَ منتهي.
create or replace function pdpl_cross_border_transfer_allowed(
  p_transfer_id uuid
) returns boolean
language sql
immutable
as $$
  select exists(
    select 1 from pdpl_cross_border_transfers
    where id = p_transfer_id
      and status = 'approved'::pdpl_transfer_status
      and expires_at > now()
  );
$$;

-- هل النقلُ منتهي الصلاحيّةِ؟
create or replace function pdpl_cross_border_transfer_is_expired(
  p_transfer_id uuid
) returns boolean
language sql
immutable
as $$
  select exists(
    select 1 from pdpl_cross_border_transfers
    where id = p_transfer_id
      and expires_at <= now()
  );
$$;

-- ── ٩) الدوالُ: طلباتُ أصحابِ البياناتِ ─────────────────────────────────────

-- مهلةُ الطلبِ: ٣٠ يوماً من الاستلامِ (اللائحةُ التنفيذيّةُ)
create or replace function pdpl_right_request_deadline(
  p_received_at timestamptz
) returns timestamptz
language sql
immutable
as $$
  select p_received_at + interval '30 days';
$$;

-- هل الطلبُ منقضي الموعدِ؟
create or replace function pdpl_right_request_is_overdue(
  p_request_id uuid
) returns boolean
language sql
as $$
  select exists(
    select 1 from pdpl_data_subject_requests
    where id = p_request_id
      and status not in ('fulfilled'::pdpl_right_request_status, 'refused'::pdpl_right_request_status, 'partially_fulfilled'::pdpl_right_request_status)
      and due_at < now()
  );
$$;

-- تسجيلُ طلبِ صاحبِ البياناتِ
create or replace function pdpl_record_right_request(
  p_city_id uuid,
  p_right_type pdpl_subject_right,
  p_requester_telegram_id text,
  p_created_by uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into pdpl_data_subject_requests (
    city_id, right_type, requester_telegram_id, created_by,
    received_at, due_at
  ) values (
    p_city_id, p_right_type, p_requester_telegram_id, p_created_by,
    now(), pdpl_right_request_deadline(now())
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- إغلاقُ الطلبِ بنتيجةٍ
create or replace function pdpl_close_right_request(
  p_request_id uuid,
  p_status pdpl_right_request_status,
  p_result_summary text,
  p_refusal_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update pdpl_data_subject_requests set
    status = p_status,
    result_summary = p_result_summary,
    refusal_reason = p_refusal_reason,
    completed_at = now()
  where id = p_request_id;
end;
$$;

-- ── ١٠) سلبُ التنفيذِ من الأدوارِ العامّةِ ──────────────────────────────────
-- SEC-10 · ADR 0140: لا دالّةً تُنفَّذُ بلا سياسةٍ صريحةٍ.
revoke execute on function pdpl_processing_activity_is_allowed(uuid) from public, anon, authenticated;
revoke execute on function pdpl_dpia_required(uuid) from public, anon, authenticated;
revoke execute on function pdpl_dpia_is_approved(uuid) from public, anon, authenticated;
revoke execute on function pdpl_high_risk_requires_dpia(uuid) from public, anon, authenticated;
revoke execute on function pdpl_cross_border_transfer_allowed(uuid) from public, anon, authenticated;
revoke execute on function pdpl_cross_border_transfer_is_expired(uuid) from public, anon, authenticated;
revoke execute on function pdpl_right_request_deadline(timestamptz) from public, anon, authenticated;
revoke execute on function pdpl_right_request_is_overdue(uuid) from public, anon, authenticated;
revoke execute on function pdpl_record_right_request(uuid, pdpl_subject_right, text, uuid) from public, anon, authenticated;
revoke execute on function pdpl_close_right_request(uuid, pdpl_right_request_status, text, text) from public, anon, authenticated;
