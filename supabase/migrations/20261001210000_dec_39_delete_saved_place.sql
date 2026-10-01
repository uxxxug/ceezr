-- migration-phase: expand
-- ────────────────────────────────────────────────────────────────────────────
-- DEC-39 · حذفُ مكانٍ محفوظٍ فرادى — `DELETE /v1/me/places/:id`
--
-- الغرض: دالّةٌ تُحذِفُ مكاناً محفوظاً واحداً بالمعرّفِ لمستخدمِ تيليجرامَ.
--   تُعيدُ jsonb: {ok: true, status: "deleted"} أو {ok: false, error: "PLACE_NOT_FOUND"}.
--   **لا تُفرِقُ بينَ «غيرِ موجودٍ» و«لِغيرِك»**: كلاهما `PLACE_NOT_FOUND` —
--   فالكشفُ عن وجودِ معرّفٍ لغيرِ المالِكِ تسريبٌ.
--
-- الحالة: منفَّذ.
-- ينتمي إلى: supabase/migrations
-- الحاكم: البند `F2-02` · `SR-12` (إدارةُ الأماكنِ) — خطوةٌ نحو التنشيطِ.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function delete_saved_place(
  p_telegram_id text,
  p_place_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_place_uuid uuid;
  v_deleted integer;
begin
  -- معرّفُ تيليجرامَ غيرُ رقميٍّ لا يُرسَلُ إلى bigint أصلاً.
  if p_telegram_id !~ '^[0-9]{1,19}$' then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  -- معرّفُ المكانِ غيرُ UUID صالحٍ لا يُرسَلُ إلى القاعدةِ.
  if p_place_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok', false, 'error', 'PLACE_NOT_FOUND');
  end if;

  select u.id into v_user_id from users u where u.telegram_id = p_telegram_id::bigint;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  v_place_uuid := p_place_id::uuid;

  -- الحذفُ مُقيَّدٌ بالمستخدمِ: لا يُحذَفُ مكانُ غيرِك.
  delete from saved_places
    where id = v_place_uuid and user_id = v_user_id
    returning 1 into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('ok', false, 'error', 'PLACE_NOT_FOUND');
  end if;

  return jsonb_build_object('ok', true, 'status', 'deleted');
end;
$$;

grant execute on function delete_saved_place(text, text) to service_role;
revoke execute on function delete_saved_place(text, text) from anon, authenticated;
