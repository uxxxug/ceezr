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
-- ## ما لا تفعلُه عن قصد
--
-- - لا تُغيّرُ `drivers.verification_status`: الاعتمادُ قرارٌ ثانٍ صريحٌ
--   (`admin_set_driver_verification` بحارسِ `F12-21`)، والحجبُ عندَ الرفضِ أو الانتهاءِ
--   ساعةٌ تحسبُها `driver_document_block_reasons` لا رايةٌ تُقلَب (ADR 0115).
-- - لا ترسلُ الوثيقةَ ولا صورتَها إلى أيِّ قروب.
--
-- مسارُ العودة: `drop function admin_review_driver_document(...)`؛ العمودُ يبقى معدوماً
--   (طورُ `contract` منفصل إن لزم).
-- ────────────────────────────────────────────────────────────────────────────

alter table driver_documents
  add column if not exists reviewed_by uuid references users(id) on delete set null;

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
