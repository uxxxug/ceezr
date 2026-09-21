-- migration-phase: expand
-- ----------------------------------------------------------------------------
-- SEC-18-ب — مسارُ إبطالِ جلساتِ Mini App منَ اللوحةِ وسجلُّ قرارِه
--
-- الفجوةُ المُسمّاةُ: محرِّكُ الإبطالِ بُنيَ في `SEC-18` وقُرِئَ في كلِّ تحقُّقٍ،
-- لكن `SessionRevocationStore.revoke` بقِيَ **بلا موضعِ نداءٍ إنتاجيٍّ واحدٍ**:
-- فجلسةٌ مسروقةٌ لا يُبطِلُها أحدٌ. و`admin_set_user_blocked` يُبطِلُ جلساتَ
-- اللوحةِ (`admin_sessions.revoked_at`) **ولا يمسُّ جلسةَ Mini App** — فالمحظورُ
-- يبقى عاملاً حتّى انتهاءِ سقفِ جلستِه.
--
-- وهذه الدالّةُ **سجلُّ القرارِ لا الإنفاذُ**: الإنفاذُ عتبةٌ في Redis يكتبُها
-- الخادمُ، وقيمتُهُ تفنى بانتهاءِ العمرِ فلا تصلُحُ سجلّاً. فالأثرُ الدائمُ ههنا
-- في `audit_log`: مَن أبطَلَ، ولِمَن، ولِمَ، ومتى.
--
-- والسببُ **إلزاميٌّ من معجمٍ مغلقٍ** (سابقةُ `PD-021`): سببٌ حرٌّ يُكتَبُ فراغاً
-- أو «test» فيصيرُ العمودُ يقبلُ ما يُمرَّرُ، والسجلُّ الذي لا يُميِّزُ عدّادٌ.
--
-- رجوعٌ آمنٌ (rollback-safe): إضافةٌ محضةٌ — دالّةٌ جديدةٌ ولا عمودَ يُحذَفُ ولا
-- قيدَ يُشدَّدُ ولا دالّةَ قائمةً تُبدَّلُ. وإسقاطُها يُعيدُ الحالَ كما كان.
-- الحاكم: `ADR 0174` · `ADR 0080` (سجلُّ أفعالِ التدقيقِ) · `ح-8`
-- ----------------------------------------------------------------------------

create or replace function admin_revoke_miniapp_sessions(
  p_actor_user_id  uuid,
  p_target_user_id uuid,
  p_reason         text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  users%rowtype;
  v_target users%rowtype;
begin
  select * into v_actor from users where id = p_actor_user_id;
  if not found or v_actor.role <> 'admin' or v_actor.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;

  -- معجمٌ مغلقٌ محصورٌ في الجسمِ نفسِه: نطاقُ السببِ لا يُمرَّرُ من خارجٍ.
  if p_reason is null or p_reason not in (
    'stolen_device',
    'credential_compromise',
    'suspicious_activity',
    'user_request',
    'support_investigation'
  ) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_REASON');
  end if;

  select * into v_target from users where id = p_target_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_target.city_id, v_actor.id, 'admin.miniapp_sessions_revoked', 'user', v_target.id,
          jsonb_build_object('reason', p_reason, 'telegram_id', v_target.telegram_id::text));

  -- `telegram_id` يُردُّ لأنَّ مفتاحَ الإنفاذِ في Redis هو مُعرِّفُ تيليجرام لا `users.id`.
  return jsonb_build_object(
    'ok', true,
    'telegram_id', v_target.telegram_id::text,
    'reason', p_reason
  );
end;
$$;

revoke all on function admin_revoke_miniapp_sessions(uuid, uuid, text) from public, anon, authenticated;
