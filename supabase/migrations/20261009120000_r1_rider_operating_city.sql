-- migration-phase: expand
-- ────────────────────────────────────────────────────────────────────────────
-- R1 · المدينةُ التشغيليّةُ للراكبِ من آخرِ موقعٍ صالحٍ (ADR 0252)
--
-- الغرض: يطلبُ الراكبُ في أيِّ مدينةٍ مفعَّلة دونَ اختيارٍ يدويٍّ للمدينة. يحدِّثُ
--   موقعَه، فتحدِّدُ القاعدةُ المدينةَ المفعَّلةَ التي يقعُ موقعُه داخلَ حدِّ خدمتِها
--   المفعَّل، وتكتبُها في `users.city_id` و`riders.city_id`. ويبقى إنشاءُ الطلبِ كما هوَ:
--   `request_ride()` تقرأُ المدينةَ من صفِّ المستخدمِ وحدَه (القاعدةُ السياديّةُ 0.4).
--
-- ## الدالّتان
--
-- - `read_rider_operating_city(p_telegram_id)`: قراءةٌ فقط لمدينةِ الراكبِ الحاليّة.
-- - `locate_rider_operating_city(p_telegram_id, p_lat, p_lng)`: الحكمُ والكتابة.
--   الأحكامُ: `INVALID_POINT` · `USER_NOT_FOUND` · `NOT_A_RIDER` (لا تُمَسُّ مدينةُ سائقٍ
--   أو مشرف) · `OUTSIDE_ACTIVE_CITIES` (لا تغيير) · `SAME_CITY` · `ACTIVE_RIDE` (رحلةٌ
--   قائمةٌ `searching`/`matched`/`in_progress`: لا تغييرَ حتّى تنتهي) · `CHANGED`.
--
-- ## ما لا تفعله عن قصد
--
-- - **لا تغيّرُ مدينةَ أيِّ طلبٍ قائمٍ أو سابق** (`orders.city_id` لا يُمَسّ)، ولا
--   الأماكنَ المحفوظةَ ولا التذاكرَ ولا الموافقات: كلٌّ منها يحملُ مدينتَه يومَ كُتب.
-- - **لا تقبلُ مدينةً من المُدخَل**: المُدخَلُ نقطةٌ، والمدينةُ حكمُ القاعدة.
-- - **لا تحفظُ الإحداثيّاتِ**: سجلُّ التدقيقِ يحملُ المدينتينِ ومصدرَ الحكمِ لا الموقع.
-- - لا عمودَ جديداً ولا تغييرَ في `GET /v1/me`.
--
-- مسارُ العودة: `drop function` للدالّتين (لا بياناتٍ جديدةَ غيرَ صفوفِ `audit_log`).
-- الحالة: منفَّذ ومُختبَر محلّيّاً؛ تطبيقُه على الإنتاجِ فعلُ نشر.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function read_rider_operating_city(
  p_telegram_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_city record;
begin
  if p_telegram_id !~ '^[0-9]{1,19}$' then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select c.code, c.name_ar, c.name_en, c.is_active
    into v_city
    from users u
    left join cities c on c.id = u.city_id
    where u.telegram_id = p_telegram_id::bigint
      and u.erased_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'city', case when v_city.code is null then null else jsonb_build_object(
      'code', v_city.code,
      'name_ar', v_city.name_ar,
      'name_en', v_city.name_en,
      'is_active', v_city.is_active
    ) end
  );
end;
$$;

revoke execute on function read_rider_operating_city(text) from public, anon, authenticated;
grant execute on function read_rider_operating_city(text) to service_role;

create or replace function locate_rider_operating_city(
  p_telegram_id text,
  p_lat         double precision,
  p_lng         double precision
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user     record;
  v_point    geography(Point, 4326);
  v_target   record;
  v_current  record;
  v_rider_id uuid;
begin
  if p_telegram_id !~ '^[0-9]{1,19}$' then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  if p_lat is null or p_lng is null
     or p_lat = 'NaN'::double precision or p_lng = 'NaN'::double precision
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_POINT');
  end if;

  -- القفلُ على صفِّ المستخدمِ يُسلسِلُ تحديثَين متزامنَين وإنشاءَ طلبٍ معهما.
  select u.id, u.city_id, u.role, u.is_blocked
    into v_user
    from users u
    where u.telegram_id = p_telegram_id::bigint
      and u.erased_at is null
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  if v_user.role <> 'rider' then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_RIDER');
  end if;

  select c.code, c.name_ar, c.name_en, c.is_active
    into v_current
    from cities c
    where c.id = v_user.city_id;

  v_point := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;

  -- المدينةُ المفعَّلةُ التي يغطّي حدُّ خدمتِها المفعَّلُ النقطة. والترتيبُ بالرمزِ
  -- يجعلُ الحكمَ حتميّاً لو تداخلَ حدّان (لا تداخلَ في البذورِ القائمة).
  select c.id, c.code, c.name_ar, c.name_en, c.is_active
    into v_target
    from cities c
    join city_service_areas a on a.city_id = c.id and a.is_active
    where c.is_active
      and st_covers(a.area, v_point)
    order by c.code
    limit 1;

  if v_target.id is null then
    return jsonb_build_object(
      'ok', true,
      'outcome', 'OUTSIDE_ACTIVE_CITIES',
      'city', case when v_current.code is null then null else jsonb_build_object(
        'code', v_current.code, 'name_ar', v_current.name_ar,
        'name_en', v_current.name_en, 'is_active', v_current.is_active) end
    );
  end if;

  if v_target.id = v_user.city_id then
    return jsonb_build_object(
      'ok', true,
      'outcome', 'SAME_CITY',
      'city', jsonb_build_object(
        'code', v_target.code, 'name_ar', v_target.name_ar,
        'name_en', v_target.name_en, 'is_active', v_target.is_active)
    );
  end if;

  select r.id into v_rider_id from riders r where r.user_id = v_user.id;

  if v_rider_id is not null and exists (
    select 1 from orders o
     where o.rider_id = v_rider_id
       and is_active_order_status(o.status)
  ) then
    return jsonb_build_object(
      'ok', true,
      'outcome', 'ACTIVE_RIDE',
      'city', case when v_current.code is null then null else jsonb_build_object(
        'code', v_current.code, 'name_ar', v_current.name_ar,
        'name_en', v_current.name_en, 'is_active', v_current.is_active) end
    );
  end if;

  update users set city_id = v_target.id where id = v_user.id;
  if v_rider_id is not null then
    update riders set city_id = v_target.id where id = v_rider_id;
  end if;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (
    v_target.id, v_user.id, 'rider.operating_city_changed', 'user', v_user.id,
    jsonb_build_object(
      'from_city', v_current.code,
      'to_city', v_target.code,
      'source', 'device_location'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'outcome', 'CHANGED',
    'city', jsonb_build_object(
      'code', v_target.code, 'name_ar', v_target.name_ar,
      'name_en', v_target.name_en, 'is_active', v_target.is_active)
  );
end;
$$;

revoke execute on function locate_rider_operating_city(text, double precision, double precision)
  from public, anon, authenticated;
grant execute on function locate_rider_operating_city(text, double precision, double precision)
  to service_role;
