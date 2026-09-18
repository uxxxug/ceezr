-- ═══════════════════════════════════════════════════════════════════════════════
-- F12-08 — إبلاغُ الاختراقِ: سجلُّ حوادثِ البياناتِ الشخصيّةِ والمواعيدُ النظاميّةُ
-- ═══════════════════════════════════════════════════════════════════════════════
-- migration-phase: expand
--
-- البندُ: F12-08 في §16 — «سياسةُ خصوصيّةٍ موافقةٌ لأنظمةِ المملكة + إبلاغُ الاختراقِ».
-- هذا البندُ يبني **آليّةَ إبلاغِ الاختراقِ** وفقَ المادةِ ٢٤ من اللائحةِ التنفيذيّةِ
-- لنظامِ حمايةِ البياناتِ الشخصيّةِ (PDPL) — المعمولِ به منذُ ١٤ سبتمبرَ ٢٠٢٤.
--
-- ## ما تُلزِمُ به المادةُ ٢٤
--
-- ١) إبلاغُ الهيئةِ (SDAIA) **خلالَ ٧٢ ساعةً** من العلمِ بالاختراقِ إن كانَ قد
--    يُلحِقُ الضررَ بالبياناتِ الشخصيّةِ أو صاحبِها أو يُخالِفُ حقوقَه.
-- ٢) إبلاغُ أصحابِ البياناتِ **بلا تأخيرٍ غيرِ مُبرَّرٍ** إن كانَ الاختراقُ
--    قد يُلحِقُ الضررَ ببياناتِهم أو يُخالِفُ حقوقَهم.
-- ٣) الاحتفاظُ بنسخةٍ من البلاغاتِ والإجراءاتِ التصحيحيّةِ والأدلّةِ.
--
-- ## ما لا تُفعله هذه الهجرةُ عن قصدٍ
--
--   ــ **لا تُرسِلُ إبلاغاً خارجيّاً**: لا قناةَ ولا مزوِّدَ ولا طابورَ —
--      الهيئةُ تُبلَغُ عبرَ منصّةِ الحوكمةِ الوطنيّةِ للبياناتِ (National Data
--      Governance Platform) بيدِ الإنسان، لا بنداءِ HTTP.
--   ــ **لا تُصدِّقُ على الامتثالِ النظاميِّ**: بناءُ الآليّةِ لا يعني
--      اعتماداً تنظيميّاً.
--   ــ **لا تُنشئُ سياسةَ خصوصيّةٍ**: وثيقةُ سياسةِ الخصوصيّةِ موجودةٌ في
--      `consent-documents.ts` منذُ F2-01. هذا البندُ يبني **آليّةَ الإبلاغِ**.
--
-- قاعدةُ 0-4: city_id على كلِّ جدولٍ.
-- قاعدةُ 0-3: الإعداداتُ من platform_settings لا ثوابتَ.
-- قاعدةُ 0-6: المصدرُ واحدٌ، ولا يُكرَّر.
-- ح-8: لا يُمسُّ نصُّ بندٍ ولا توقيعُ دالّةٍ قائمة.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── ١) النوعُ: حالةُ الحادث ───────────────────────────────────────────────────

do $$ begin
  create type breach_incident_status as enum (
    'detected',           -- رُصِدَ الحادثُ ولم يُقيَّمْ بعدُ
    'assessed',           -- قُدِّرَ الخطرُ وصُنِّفَ
    'authority_notified', -- بُلِّغَت الهيئةُ
    'subjects_notified',  -- بُلِّغَ أصحابُ البياناتِ
    'contained',          -- احتوِيَ الحادثُ
    'resolved'            -- أُغلِقَ الحادثُ
  );
exception when duplicate_object then null; end $$;

-- ── ٢) النوعُ: شدّةُ الخطر ────────────────────────────────────────────────────

do $$ begin
  create type breach_severity as enum ('high_risk', 'medium_risk', 'low_risk');
exception when duplicate_object then null; end $$;

-- ── ٣) جدولُ حوادثِ الاختراق ──────────────────────────────────────────────────

create table if not exists breach_incidents (
  id                uuid primary key default gen_random_uuid(),
  city_id           uuid not null references cities(id) on delete restrict,

  -- من رصدَ الحادثَ
  detected_by       uuid not null references users(id) on delete restrict,

  -- وصفُ الحادثِ (المادةُ ٢٤/١/أ)
  description       text not null,
  breach_time       timestamptz,          -- وقتُ وقوعِ الاختراقِ
  awareness_time    timestamptz not null, -- وقتُ العلمِ بالاختراقِ

  -- التصنيفُ (المادةُ ٢٤/١/ب)
  severity          breach_severity not null default 'medium_risk',
  data_categories   text[] not null default '{}',  -- أصنافُ البياناتِ المتأثِّرة
  affected_count    integer,                        -- عددُ المتأثِّرين تقريباً
  personal_data_types text[] not null default '{}', -- أنواعُ البياناتِ الشخصيّة

  -- تقييمُ الخطرِ (المادةُ ٢٤/١/ج)
  risk_description  text,
  corrective_measures text,                -- الإجراءاتُ التصحيحيّةُ المُتَّخَذة
  prevention_measures text,               -- التدابيرُ المستقبليّةُ لمنعِ التكرار

  -- الإبلاغُ (المادةُ ٢٤/١/د)
  authority_notified_at   timestamptz,    -- وقتُ إبلاغِ الهيئةِ
  subjects_notified_at    timestamptz,    -- وقتُ إبلاغِ أصحابِ البياناتِ
  subjects_notification_required boolean not null default false,

  -- السجلُّ (المادةُ ٢٤/٣)
  status            breach_incident_status not null default 'detected',

  -- القاعدةُ 0-4
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── ٤) الفهارسُ ───────────────────────────────────────────────────────────────
-- ملاحظة: الفهارسُ على جدولٍ جديدٍ فارغٍ لا تُلزمُ `concurrently`، ولكنَّ
-- حاجزَ سلامةِ الهجراتِ يفحصُها صارماً بعدَ تاريخِ القطعِ، فتُفصَلُ في ملفٍّ لاحقٍ.

-- ── ٥) مُحدِّثُ updated_at ────────────────────────────────────────────────────

create trigger breach_incidents_set_updated_at before update on breach_incidents
  for each row execute function set_updated_at();

-- ── ٦) RLS ─────────────────────────────────────────────────────────────────────

alter table breach_incidents enable row level security;
create policy breach_incidents_service_role_all
  on breach_incidents
  for all
  to service_role
  using (true)
  with check (true);
revoke all on breach_incidents from public, anon, authenticated;
grant select, insert, update on breach_incidents to service_role;

-- ── ٦.٥) سلبُ التنفيذِ من الأدوارِ العامّةِ ───────────────────────────────────
-- `SEC-10` · `ADR 0140`: لا دالّةً تُنفَّذُ بلا سياسةٍ صريحةٍ. والافتراضُ في
-- PostgreSQL: `EXECUTE` لِـ`public` ما لم يُسلب. فهذه سلبٌ صريحٌ من ثلاثةِ أدوارٍ.
revoke execute on function authority_notification_deadline(timestamptz) from public, anon, authenticated;
revoke execute on function authority_notification_is_overdue(uuid) from public, anon, authenticated;
revoke execute on function subject_notification_required(uuid) from public, anon, authenticated;
revoke execute on function record_breach_incident(uuid, uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function assess_breach_incident(uuid, breach_severity, text[], integer, text[], text, text, text) from public, anon, authenticated;
revoke execute on function mark_authority_notified(uuid) from public, anon, authenticated;
revoke execute on function mark_subjects_notified(uuid) from public, anon, authenticated;

-- ── ٧) دالّةُ الموعدِ والانقضاءِ ─────────────────────────────────────────────

-- موعدُ إبلاغِ الهيئةِ: ٧٢ ساعةً من وقتِ العلمِ. دالّةٌ نقيّةٌ (`immutable`).
-- ولا يُعطى رقمٌ غيرُه.

create or replace function authority_notification_deadline(
  p_awareness_time timestamptz
) returns timestamptz
language sql
immutable
as $$
  select p_awareness_time + interval '72 hours';
$$;

-- هل تأخَّرَ إبلاغُ الهيئةِ؟ حكمٌ يُحسَبُ لا يُخزَّنُ.
create or replace function authority_notification_is_overdue(
  p_incident_id uuid
) returns boolean
language sql
stable
as $$
  select
    exists(select 1 from breach_incidents where id = p_incident_id)
    and not exists(
      select 1 from breach_incidents
      where id = p_incident_id and authority_notified_at is not null
    )
    and now() > authority_notification_deadline(
      (select awareness_time from breach_incidents where id = p_incident_id)
    );
$$;

-- هل يجب إبلاغُ أصحابِ البيانات؟ حكمٌ يُحسَبُ من شدّةِ الخطرِ.
create or replace function subject_notification_required(
  p_incident_id uuid
) returns boolean
language sql
stable
as $$
  select
    exists(select 1 from breach_incidents where id = p_incident_id)
    and exists(
      select 1 from breach_incidents
      where id = p_incident_id
        and severity in ('high_risk', 'medium_risk')
    );
$$;

-- ── ٨) دالّةُ تسجيلِ الحادث ───────────────────────────────────────────────────

create or replace function record_breach_incident(
  p_detected_by    uuid,
  p_city_id        uuid,
  p_description    text,
  p_awareness_time timestamptz,
  p_breach_time    timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident_id uuid;
begin
  insert into breach_incidents (
    detected_by, city_id, description, awareness_time, breach_time
  ) values (
    p_detected_by, p_city_id, p_description, p_awareness_time, p_breach_time
  )
  returning id into v_incident_id;

  return v_incident_id;
end;
$$;

-- ── ٩) دالّةُ تقييمِ الحادث ───────────────────────────────────────────────────

create or replace function assess_breach_incident(
  p_incident_id        uuid,
  p_severity           breach_severity,
  p_data_categories    text[],
  p_affected_count     integer,
  p_personal_data_types text[],
  p_risk_description   text,
  p_corrective_measures text,
  p_prevention_measures text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update breach_incidents set
    severity = p_severity,
    data_categories = p_data_categories,
    affected_count = p_affected_count,
    personal_data_types = p_personal_data_types,
    risk_description = p_risk_description,
    corrective_measures = p_corrective_measures,
    prevention_measures = p_prevention_measures,
    subjects_notification_required = subject_notification_required(p_incident_id),
    status = 'assessed'
  where id = p_incident_id;
end;
$$;

-- ── ١٠) دالّةُ تسجيلِ إبلاغِ الهيئة ─────────────────────────────────────────────

create or replace function mark_authority_notified(
  p_incident_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update breach_incidents set
    authority_notified_at = now(),
    status = case
      when status = 'subjects_notified'::breach_incident_status then 'contained'::breach_incident_status
      else 'authority_notified'::breach_incident_status
    end
  where id = p_incident_id;
end;
$$;

-- ── ١١) دالّةُ تسجيلِ إبلاغِ أصحابِ البيانات ───────────────────────────────────────────────────

create or replace function mark_subjects_notified(
  p_incident_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update breach_incidents set
    subjects_notified_at = now(),
    status = case
      when status = 'authority_notified'::breach_incident_status then 'contained'::breach_incident_status
      else 'subjects_notified'::breach_incident_status
    end
  where id = p_incident_id;
end;
$$;
