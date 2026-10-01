-- migration-phase: expand
-- ────────────────────────────────────────────────────────────────────────────
-- DEC-40 · تعديلُ مكانٍ محفوظٍ فرادى — `PATCH /v1/me/places/:id`
--
-- الغرض: دالّةٌ تُعدِّلُ مكاناً محفوظاً واحداً بالمعرّفِ لمستخدمِ تيليجرامَ.
--   تُعيدُ jsonb: {ok: true, status: "updated", place_id, kind, label, lat, lng, updated_at}
--   أو {ok: false, error: "PLACE_NOT_FOUND"} أو {ok: false, error: "USER_NOT_FOUND"}.
--   **لا تُفرِقُ بينَ «غيرِ موجودٍ» و«لِغيرِك»**: كلاهما `PLACE_NOT_FOUND`.
--
-- الحالة: منفَّذ.
-- ينتمي إلى: supabase/migrations
-- الحاكم: البند `F2-02` · `SR-12` (إدارةُ الأماكنِ) — خطوةٌ نحو التنشيطِ.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function update_saved_place(
  p_telegram_id text,
  p_place_id text,
  p_kind text,
  p_label text,
  p_lat double precision,
  p_lng double precision
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_place_uuid uuid;
  v_updated record;
begin
  if p_telegram_id !~ '^[0-9]{1,19}$' then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  if p_place_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok', false, 'error', 'PLACE_NOT_FOUND');
  end if;

  if p_kind not in ('home', 'work', 'other') then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_PLACE_KIND');
  end if;

  if length(trim(p_label)) < 1 or length(trim(p_label)) > 120 then
    return jsonb_build_object('ok', false, 'error', 'MALFORMED');
  end if;

  select u.id into v_user_id from users u where u.telegram_id = p_telegram_id::bigint;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  v_place_uuid := p_place_id::uuid;

  update saved_places
    set kind = p_kind,
        label = p_label,
        point = st_setsrid(st_makepoint(p_lng, p_lat), 4326),
        updated_at = now()
    where id = v_place_uuid and user_id = v_user_id
    returning id, kind, label, st_x(point) as lng, st_y(point) as lat, updated_at
    into v_updated;

  if v_updated is null then
    return jsonb_build_object('ok', false, 'error', 'PLACE_NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'updated',
    'place_id', v_updated.id,
    'kind', v_updated.kind,
    'label', v_updated.label,
    'lat', v_updated.lat,
    'lng', v_updated.lng,
    'updated_at', v_updated.updated_at
  );
end;
$$;

grant execute on function update_saved_place(text, text, text, text, double precision, double precision) to service_role;
revoke execute on function update_saved_place(text, text, text, text, double precision, double precision) from public, anon, authenticated;
