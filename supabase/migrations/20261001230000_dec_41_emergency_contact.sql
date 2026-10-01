-- migration-phase: expand
-- ────────────────────────────────────────────────────────────────────────────
-- DEC-41 · جهةُ اتصالٍ للطوارئ — `GET/PUT /v1/me/emergency-contact`
--
-- الغرض: عمودانِ على `users` لاسمِ ورقمِ جهةِ الاتصالِ في الطوارئ،
--   ودالّتانِ: `upsert_emergency_contact` و`read_emergency_contact`.
--   الكتابةُ مُقيَّدةٌ بمستخدمِ تيليجرامَ. القراءةُ كذلك.
--   لا حذفَ منفصلٌ: القيمةُ الفارغةُ تعني «لا جهةَ».
--
-- الحالة: منفَّذ.
-- ينتمي إلى: supabase/migrations
-- الحاكم: البند `F2-02` · `SR-12` — خطوةٌ نحو تنشيطِ `emergencyContact`.
-- ────────────────────────────────────────────────────────────────────────────

alter table users add column if not exists emergency_contact_name text;
alter table users add column if not exists emergency_contact_phone text;

create or replace function upsert_emergency_contact(
  p_telegram_id text,
  p_name text,
  p_phone text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if p_telegram_id !~ '^[0-9]{1,19}$' then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  if length(trim(p_name)) < 1 or length(trim(p_name)) > 120 then
    return jsonb_build_object('ok', false, 'error', 'MALFORMED');
  end if;

  if p_phone !~ '^[0-9]{4,20}$' then
    return jsonb_build_object('ok', false, 'error', 'MALFORMED');
  end if;

  select u.id into v_user_id from users u where u.telegram_id = p_telegram_id::bigint;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  update users
    set emergency_contact_name = trim(p_name),
        emergency_contact_phone = p_phone,
        updated_at = now()
    where id = v_user_id;

  return jsonb_build_object('ok', true, 'status', 'saved');
end;
$$;

create or replace function read_emergency_contact(
  p_telegram_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  if p_telegram_id !~ '^[0-9]{1,19}$' then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select u.emergency_contact_name, u.emergency_contact_phone
    into v_row
    from users u
    where u.telegram_id = p_telegram_id::bigint;

  if v_row is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'found',
    'name', v_row.emergency_contact_name,
    'phone', v_row.emergency_contact_phone
  );
end;
$$;

grant execute on function upsert_emergency_contact(text, text, text) to service_role;
revoke execute on function upsert_emergency_contact(text, text, text) from public, anon, authenticated;

grant execute on function read_emergency_contact(text) to service_role;
revoke execute on function read_emergency_contact(text) from public, anon, authenticated;
