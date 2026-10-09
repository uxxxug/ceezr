-- migration-phase: expand
-- ────────────────────────────────────────────────────────────────────────────
-- PD-042 · مراجعةُ وثائقِ السائقِ من لوحةِ الإدارةِ الرسميّة (ADR 0256)
--
-- الغرض: قرارُ المالكِ 2026-10-10: مراجعةُ الوثائقِ وقبولُها ورفضُها في لوحةِ الإدارةِ
--   المحميّة، بسجلِّ تدقيقٍ يُعرَفُ به من راجعَ ومتى. وقبلَ هذه الهجرةِ **لا دالّةَ تنقلُ
--   وثيقةً إلى `accepted` أو `rejected` أو `incomplete`**: السائقُ يرفعُ ويرسلُ
--   (`submit_driver_documents_for_review` ⇒ `under_review`) ولا شيءَ بعدَها، و
--   `admin_set_driver_verification` ترفضُ `verified` ما لم تُقبَل كلُّ الوثائقِ الإلزاميّة
--   (`F12-21`). أي أنَّ اعتمادَ سائقٍ جديدٍ عبرَ المسارِ الرسميِّ كانَ مستحيلاً.
--
-- ## ما تضيفُه
--
-- - `driver_documents.reviewed_by` (معدوم، `on delete set null`): من راجع. و`reviewed_at`
--   قائمٌ لم يكن يُكتَب.
-- - `admin_review_driver_document(actor, driver, doc_type, decision, note)`:
--   · المراجِعُ مسؤولٌ (`role = 'admin'`) غيرُ محظور، وإلّا `NOT_ADMIN`.
--   · القرارُ `accepted` · `rejected` · `incomplete` وحدَها (`INVALID_DECISION`).
--   · الرفضُ والنقصُ يُسمّيانِ سببَهما (`NOTE_REQUIRED`، والقيدُ القائمُ للرفضِ)، والسببُ
--     ≤ 500 حرف (`NOTE_TOO_LONG`). القبولُ لا يحملُ سبباً.
--   · الوثيقةُ المُرسَلةُ للمراجعةِ وحدَها (`under_review`)، وإلّا `NOT_UNDER_REVIEW` —
--     فلا تُقبَلُ وثيقةٌ لم يُرسِلْها صاحبُها، ولا يُعادُ حكمٌ صامتاً.
--   · لا قبولَ بلا تاريخِ انتهاءٍ (`EXPIRY_REQUIRED`، والقيدُ القائم) ولا لمنتهيةٍ
--     (`DOCUMENT_EXPIRED`).
--   · تدقيقُ `admin.driver_document_reviewed` بالمراجِعِ والنوعِ والحالتَين. **بلا السببِ
--     النصّيِّ وبلا مسارِ الملفّ**: السببُ قد يحملُ بيانةً شخصيّةً وموضعُه الصفُّ نفسُه.
-- - المنحُ لـ`service_role` وحدَه، كبقيّةِ دوالِّ الإدارة.
--
-- ## أقلُّ الصلاحيّات — منحُ «مراجِعِ الوثائق» صريحٌ ومحصورٌ بمدينة (مراجعةُ PR #463)
--
-- صفةُ `admin` وحدَها **لا تكفي** لقراءةِ وثيقةٍ أو الحكمِ عليها:
-- - `driver_document_reviewers`: منحٌ صريحٌ لكلِّ (مستخدمٍ · مدينة)، بمن منحَ ومتى،
--   ويُسحَبُ بختمِ سحبٍ لا بحذفِ صفّ. مقفلٌ بـRLS للخدمةِ وحدَها.
-- - `admin_set_document_reviewer(actor, target, city, enabled)`: **لا مسارَ ويبَ يناديها**؛
--   تُنادى من سكربتِ التشغيلِ `scripts/ops/document-reviewer.ts` بصلاحيّةِ الخدمة. فلا
--   مسؤولَ في اللوحةِ يوسّعُ دائرةَ المراجِعينَ ولا يمنحُ نفسَه. المستفيدُ مسؤولٌ غيرُ
--   محظور، والمدينةُ قائمة، والتدقيقُ `admin.document_reviewer_granted|revoked`.
-- - `admin_open_driver_document(actor, driver, doc_type)`: البابُ الوحيدُ لمسارِ الملفّ —
--   يتحقّقُ من المنحِ لمدينةِ الوثيقة، ويكتبُ `admin.driver_document_viewed` (السائقُ
--   والنوعُ والحالةُ فقط — لا مسارَ ولا رابط)، ثمَّ يُعيدُ المسارَ للبوّابةِ لتوقيعِه.
-- - `admin_review_driver_document`: تشترطُ المنحَ لمدينةِ الوثيقةِ (`NOT_DOCUMENT_REVIEWER`).
--
-- ## ما لا تفعلُه عن قصد
--
-- - لا تُغيّرُ `drivers.verification_status`: الاعتمادُ قرارٌ ثانٍ صريحٌ
--   (`admin_set_driver_verification` بحارسِ `F12-21`)، والحجبُ عندَ الرفضِ أو الانتهاءِ
--   ساعةٌ تحسبُها `driver_document_block_reasons` لا رايةٌ تُقلَب (ADR 0115).
-- - لا ترسلُ الوثيقةَ ولا صورتَها إلى أيِّ قروب.
--
-- مسارُ العودة: `drop function` للدوالِّ الأربعِ (`admin_review_driver_document` ·
--   `admin_open_driver_document` · `admin_set_document_reviewer` · `is_document_reviewer`)؛
--   العمودُ والجدولُ يبقيانِ (طورُ `contract` منفصل إن لزم) ولا يقرؤهما إصدارٌ سابق.
-- ────────────────────────────────────────────────────────────────────────────

alter table driver_documents
  add column if not exists reviewed_by uuid references users(id) on delete set null;

create table if not exists driver_document_reviewers (
  id          uuid primary key default gen_random_uuid(),
  city_id     uuid not null references cities(id),
  user_id     uuid not null references users(id) on delete cascade,
  granted_by  uuid references users(id) on delete set null,
  granted_at  timestamptz not null default now(),
  revoked_by  uuid references users(id) on delete set null,
  revoked_at  timestamptz
);

comment on table driver_document_reviewers is
  'منحُ مراجعةِ وثائقِ السائقينَ لمسؤولٍ في مدينةٍ — أضيقُ من صفةِ admin (PD-042 · ADR 0256).';

alter table driver_document_reviewers enable row level security;
revoke all on table driver_document_reviewers from public, anon, authenticated;

create or replace function is_document_reviewer(p_user_id uuid, p_city_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from driver_document_reviewers g
      join users u on u.id = g.user_id
     where g.user_id = p_user_id
       and g.city_id = p_city_id
       and g.revoked_at is null
       and u.role = 'admin'
       and not u.is_blocked
  );
$$;

revoke all on function is_document_reviewer(uuid, uuid) from public;
revoke all on function is_document_reviewer(uuid, uuid) from anon, authenticated;
grant execute on function is_document_reviewer(uuid, uuid) to service_role;

create or replace function admin_set_document_reviewer(
  p_actor_user_id  uuid,
  p_target_user_id uuid,
  p_city_id        uuid,
  p_enabled        boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor  record;
  v_target record;
  v_grant  uuid;
begin
  select u.id, u.role, u.is_blocked into v_actor from users u where u.id = p_actor_user_id;
  if not found or v_actor.role <> 'admin' or v_actor.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;

  select u.id, u.role, u.is_blocked into v_target from users u where u.id = p_target_user_id;
  if not found or v_target.role <> 'admin' or v_target.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'TARGET_NOT_ADMIN');
  end if;

  if p_enabled is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_DECISION');
  end if;

  perform 1 from cities c where c.id = p_city_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_FOUND');
  end if;

  select g.id into v_grant
    from driver_document_reviewers g
   where g.user_id = p_target_user_id and g.city_id = p_city_id and g.revoked_at is null
   for update;

  if p_enabled then
    if v_grant is not null then
      return jsonb_build_object('ok', true, 'changed', false);
    end if;
    insert into driver_document_reviewers (city_id, user_id, granted_by)
    values (p_city_id, p_target_user_id, v_actor.id)
    returning id into v_grant;
    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    values (p_city_id, v_actor.id, 'admin.document_reviewer_granted', 'user', p_target_user_id,
            jsonb_build_object('grant_id', v_grant));
  else
    if v_grant is null then
      return jsonb_build_object('ok', true, 'changed', false);
    end if;
    update driver_document_reviewers
       set revoked_at = now(), revoked_by = v_actor.id
     where id = v_grant;
    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    values (p_city_id, v_actor.id, 'admin.document_reviewer_revoked', 'user', p_target_user_id,
            jsonb_build_object('grant_id', v_grant));
  end if;

  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

comment on function admin_set_document_reviewer(uuid, uuid, uuid, boolean) is
  'منحُ مراجعةِ الوثائقِ أو سحبُه لمسؤولٍ في مدينة — سكربتُ التشغيلِ وحدَه، لا مسارَ ويب (PD-042 · ADR 0256).';

revoke all on function admin_set_document_reviewer(uuid, uuid, uuid, boolean) from public;
revoke all on function admin_set_document_reviewer(uuid, uuid, uuid, boolean) from anon, authenticated;
grant execute on function admin_set_document_reviewer(uuid, uuid, uuid, boolean) to service_role;

create or replace function admin_open_driver_document(
  p_actor_user_id uuid,
  p_driver_id     uuid,
  p_doc_type      text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor record;
  v_doc   record;
begin
  select u.id, u.role, u.is_blocked into v_actor from users u where u.id = p_actor_user_id;
  if not found or v_actor.role <> 'admin' or v_actor.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;

  if p_doc_type is null or p_doc_type not in (
       select e.enumlabel from pg_enum e
        where e.enumtypid = 'driver_document_type'::regtype) then
    return jsonb_build_object('ok', false, 'error', 'DOCUMENT_NOT_FOUND');
  end if;

  select d.id, d.city_id, d.status, d.object_path
    into v_doc
    from driver_documents d
   where d.driver_id = p_driver_id
     and d.doc_type = p_doc_type::driver_document_type;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DOCUMENT_NOT_FOUND');
  end if;

  if not is_document_reviewer(v_actor.id, v_doc.city_id) then
    return jsonb_build_object('ok', false, 'error', 'NOT_DOCUMENT_REVIEWER');
  end if;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (
    v_doc.city_id, v_actor.id, 'admin.driver_document_viewed', 'driver_document', v_doc.id,
    jsonb_build_object('driver_id', p_driver_id, 'doc_type', p_doc_type, 'status', v_doc.status)
  );

  return jsonb_build_object('ok', true, 'object_path', v_doc.object_path);
end;
$$;

comment on function admin_open_driver_document(uuid, uuid, text) is
  'البابُ الوحيدُ لمسارِ ملفِّ وثيقةِ سائق: مراجِعٌ ممنوحٌ لمدينتِها، وكلُّ فتحٍ مدقَّقٌ بلا مسارٍ ولا رابط (PD-042 · ADR 0256).';

revoke all on function admin_open_driver_document(uuid, uuid, text) from public;
revoke all on function admin_open_driver_document(uuid, uuid, text) from anon, authenticated;
grant execute on function admin_open_driver_document(uuid, uuid, text) to service_role;

comment on column driver_documents.reviewed_by is
  'المسؤولُ الذي راجعَ الوثيقة (PD-042 · ADR 0256) — يُقرأُ معَ reviewed_at.';

create or replace function admin_review_driver_document(
  p_actor_user_id uuid,
  p_driver_id     uuid,
  p_doc_type      text,
  p_decision      text,
  p_note          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor  record;
  v_doc    record;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select u.id, u.role, u.is_blocked into v_actor from users u where u.id = p_actor_user_id;
  if not found or v_actor.role <> 'admin' or v_actor.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;

  if p_decision is null or p_decision not in ('accepted', 'rejected', 'incomplete') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_DECISION');
  end if;

  if p_doc_type is null or p_doc_type not in (
       select e.enumlabel from pg_enum e
        where e.enumtypid = 'driver_document_type'::regtype) then
    return jsonb_build_object('ok', false, 'error', 'DOCUMENT_NOT_FOUND');
  end if;

  if p_decision in ('rejected', 'incomplete') and v_note is null then
    return jsonb_build_object('ok', false, 'error', 'NOTE_REQUIRED');
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    return jsonb_build_object('ok', false, 'error', 'NOTE_TOO_LONG');
  end if;

  select d.id, d.city_id, d.status, d.expires_at
    into v_doc
    from driver_documents d
   where d.driver_id = p_driver_id
     and d.doc_type = p_doc_type::driver_document_type
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DOCUMENT_NOT_FOUND');
  end if;

  -- صفةُ admin لا تكفي: منحٌ صريحٌ لمدينةِ الوثيقةِ قبلَ أن يُكشَفَ حالُها.
  if not is_document_reviewer(v_actor.id, v_doc.city_id) then
    return jsonb_build_object('ok', false, 'error', 'NOT_DOCUMENT_REVIEWER');
  end if;

  if v_doc.status <> 'under_review' then
    return jsonb_build_object('ok', false, 'error', 'NOT_UNDER_REVIEW', 'status', v_doc.status);
  end if;

  if p_decision = 'accepted' then
    if v_doc.expires_at is null then
      return jsonb_build_object('ok', false, 'error', 'EXPIRY_REQUIRED');
    end if;
    if v_doc.expires_at < current_date then
      return jsonb_build_object('ok', false, 'error', 'DOCUMENT_EXPIRED');
    end if;
  end if;

  update driver_documents
     set status      = p_decision::driver_document_status,
         review_note = case when p_decision = 'accepted' then null else v_note end,
         reviewed_at = now(),
         reviewed_by = v_actor.id
   where id = v_doc.id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (
    v_doc.city_id, v_actor.id, 'admin.driver_document_reviewed', 'driver_document', v_doc.id,
    jsonb_build_object(
      'driver_id', p_driver_id,
      'doc_type', p_doc_type,
      'from', v_doc.status,
      'to', p_decision
    )
  );

  return jsonb_build_object('ok', true, 'changed', true, 'status', p_decision);
end;
$$;

comment on function admin_review_driver_document(uuid, uuid, text, text, text) is
  'مراجعةُ وثيقةِ سائقٍ مُرسَلةٍ من لوحةِ الإدارة: قبولٌ أو رفضٌ أو نقصٌ بسبب، بالمراجِعِ والوقتِ وسجلِّ تدقيق (PD-042 · ADR 0256).';

revoke all on function admin_review_driver_document(uuid, uuid, text, text, text) from public;
revoke all on function admin_review_driver_document(uuid, uuid, text, text, text) from anon, authenticated;
grant execute on function admin_review_driver_document(uuid, uuid, text, text, text) to service_role;
