-- migration-phase: expand
--
-- الغرض: توسيعُ `request_ride()` لدعمِ وجهةٍ معدومةٍ — مسارُ البوتِ يسمحُ
--   بتخطّي الوجهةِ في النقلِ (`/skip`)، فالطلبُ بلا نقطةِ وصولٍ مشروعٌ لا استثناء.
--   والدالّةُ القائمةُ ترفضُ `null` على الوجهةِ بـ`INVALID_POINT`، فلا يستطيعُ
--   البوتُ استعمالَ المسارَ الذرّيَّ الآمنَ الذي يستعملهُ HTTP.
-- الحالة: D-01 — توحيدُ مسارِ إنشاءِ الطلب.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: packages/infrastructure/transport/ride-request-store.ts
-- يُتوقع أن يستخدمه لاحقاً: packages/application/bots/rider-dialog.ts
--
-- ## ما يُغيِّر هذا الترحيلُ
--
-- يُعيدُ تعريفَ `request_ride()` ليقبلَ `p_dest_lat` و`p_dest_lng` معدومَين:
-- إن كانا معدومَين، يُتخطّى فحصُ منطقةِ الخدمةِ على الوجهةِ، ويُكتَبُ `dropoff`
-- معدوماً. وإن كان أحدُهما موجوداً والآخرُ معدوماً، فالرفضُ `INVALID_POINT`
-- باقٍ — الوجهةُ كلٌّ أو لا شيء.
--
-- ## ما لا يُغيِّرُه
--
-- - **لا يُغيِّر** فحصَ نقطةِ البدايةِ — البدايةُ إلزاميّةٌ دائماً.
-- - **لا يُغيِّر** فحصَ الطلبِ النشطِ لكلِّ خدمةٍ.
-- - **لا يُغيِّر** مفتاحَ التكرارِ ولا منطقَ الإعادة.
-- - **لا يُغيِّر** فحصَ القدرةِ ولا فحصَ منطقةِ البداية.
--
-- ## التوافقُ مع القاعدةِ السياديّةِ 0.4
--
-- `city_id` لا يُكتَبُ في `orders` إلّا من `v_user.city_id` — لا من مُدخَلِ
-- المُستدعي. فالقاعدةُ محفوظةٌ.
--
-- ## ما لا يفعله هذا الترحيلُ عن قصدٍ
--
-- - **لا يُضيفُ عموداً** — `dropoff` موجودٌ وقابلٌ للعدمِ أصلاً.
-- - **لا يُغيِّر** الفهرسَ الفريدَ على `(rider_id, idempotency_key)`.

set local search_path = public;

create or replace function request_ride(
  p_telegram_id     bigint,
  p_idempotency_key text,
  p_service         service_type,
  p_origin_lat      double precision,
  p_origin_lng      double precision,
  p_dest_lat        double precision,
  p_dest_lng        double precision,
  p_notes           text default null
)
returns jsonb
language plpgsql
volatile
as $fn$
declare
  v_user_id   uuid;
  v_rider_id  uuid;
  v_city      record;
  v_area      record;
  v_origin    geography(Point, 4326);
  v_destination geography(Point, 4326);
  v_services  service_type[];
  v_existing  record;
  v_order_id  uuid;
  v_created_at timestamptz;
  v_reused    boolean := false;
begin
  -- المفتاحُ شرطُ الأمرِ لا زينتُه: أمرٌ بلا مفتاحٍ **يُرَدُّ** ولا يُكتَبُ
  -- بمفتاحٍ مُختلَقٍ في القاعدةِ — لأنَّ مفتاحاً يختلقُه الخادمُ لكلِّ نداءٍ يجعلُ
  -- كلَّ إعادةٍ أمراً جديداً، وهوَ عينُ العطبِ الذي وُضِعَ `ARCH-006` لمنعِه.
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_KEY_REQUIRED');
  end if;

  if length(p_idempotency_key) > 255 then
    return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_KEY_TOO_LONG');
  end if;

  if p_notes is not null and length(btrim(p_notes)) > 280 then
    return jsonb_build_object('ok', false, 'error', 'NOTES_TOO_LONG');
  end if;

  -- البدايةُ إلزاميّةٌ دائماً. والوجهةُ **كلٌّ أو لا شيء**: وجودُ أحدِ
  -- الإحداثيَّين دونَ الآخرِ عيبُ عميلٍ لا غيابُ وجهة.
  if p_origin_lat is null or p_origin_lng is null
     or p_origin_lat <> p_origin_lat or p_origin_lng <> p_origin_lng
     or p_origin_lat < -90  or p_origin_lat > 90
     or p_origin_lng < -180 or p_origin_lng > 180
  then
    return jsonb_build_object('ok', false, 'error', 'INVALID_POINT');
  end if;

  -- الوجهةُ معدومةٌ مقبولةٌ — لكنَّ وجودَ أحدِ الإحداثيَّين دونَ الآخرِ عيبٌ.
  if (p_dest_lat is null) <> (p_dest_lng is null) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_POINT');
  end if;

  -- إن وُجِدَت الوجهةُ، فليكن نطاقُها صحيحاً.
  if p_dest_lat is not null then
    if p_dest_lat <> p_dest_lat or p_dest_lng <> p_dest_lng
       or p_dest_lat < -90  or p_dest_lat > 90
       or p_dest_lng < -180 or p_dest_lng > 180
    then
      return jsonb_build_object('ok', false, 'error', 'INVALID_POINT');
    end if;
  end if;

  select u.id, u.city_id into v_user
  from users u
  where u.telegram_id = p_telegram_id;

  if v_user.city_id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select r.id into v_rider_id
  from riders r
  where r.user_id = v_user.id
  for update;

  if v_rider_id is null then
    return jsonb_build_object('ok', false, 'error', 'RIDER_NOT_REGISTERED');
  end if;

  -- الإعادةُ تُقرأُ **قبلَ** أيِّ حكمٍ آخرَ بعدَ القفلِ.
  select o.id, o.created_at into v_existing
  from orders o
  where o.rider_id = v_rider_id and o.idempotency_key = p_idempotency_key;

  if v_existing.id is not null then
    return jsonb_build_object(
      'ok', true,
      'reused', true,
      'order_id', v_existing.id,
      'created_at', v_existing.created_at
    );
  end if;

  select c.code, c.name_ar, c.name_en into v_city
  from cities c
  where c.id = v_user.city_id;

  select a.area_version, a.area into v_area
  from city_service_areas a
  where a.city_id = v_user.city_id and a.is_active
  limit 1;

  if v_area is null then
    return jsonb_build_object('ok', false, 'error', 'CITY_HAS_NO_SERVICE_AREA');
  end if;

  v_origin := st_setsrid(st_makepoint(p_origin_lng, p_origin_lat), 4326)::geography;

  if not st_covers(v_area.area, v_origin) then
    return jsonb_build_object('ok', false, 'error', 'ORIGIN_OUTSIDE_SERVICE_AREA');
  end if;

  -- الوجهةُ معدومةٌ: لا فحصَ منطقةٍ عليها. الوجهةُ موجودةٌ: فحصُ المنطقةِ باقٍ.
  if p_dest_lat is not null then
    v_destination := st_setsrid(st_makepoint(p_dest_lng, p_dest_lat), 4326)::geography;

    if not st_covers(v_area.area, v_destination) then
      return jsonb_build_object('ok', false, 'error', 'DESTINATION_OUTSIDE_SERVICE_AREA');
    end if;
  end if;

  v_services := city_served_services(v_user.city_id);

  if not (p_service = any(v_services)) then
    return jsonb_build_object('ok', false, 'error', 'SERVICE_NOT_AVAILABLE_IN_CITY');
  end if;

  -- طلبٌ نشطٌ واحدٌ لكلِّ راكبٍ **لكلِّ خدمةٍ**.
  select o.id, o.status into v_existing
  from orders o
  where o.rider_id = v_rider_id
    and o.service = p_service
    and o.status in ('searching', 'matched', 'in_progress')
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'ok', false,
      'error', 'ACTIVE_RIDE_EXISTS',
      'order_id', v_existing.id,
      'status', v_existing.status
    );
  end if;

  begin
    insert into orders (
      city_id, rider_id, service, status, pickup, dropoff, notes, idempotency_key
    ) values (
      v_user.city_id, v_rider_id, p_service, 'searching', v_origin, v_destination,
      nullif(btrim(coalesce(p_notes, '')), ''), p_idempotency_key
    )
    returning id, created_at into v_order_id, v_created_at;
  exception when unique_violation then
    select o.id, o.created_at into v_order_id, v_created_at
    from orders o
    where o.rider_id = v_rider_id and o.idempotency_key = p_idempotency_key;
    v_reused := true;
  end;

  return jsonb_build_object(
    'ok', true,
    'reused', v_reused,
    'order_id', v_order_id,
    'created_at', v_created_at
  );
end;
$fn$;

comment on function request_ride(bigint, text, service_type, double precision, double precision, double precision, double precision, text) is
  'إنشاءُ الرحلةِ أمراً ذرّيّاً: مفتاحُ تكرارٍ، فحصُ منطقةِ خدمةٍ، منعُ طلبٍ نشطٍ '
  'لنفسِ الخدمةِ، وكتابةُ الصفِّ — كلُّه في معاملةٍ واحدةٍ. والوجهةُ معدومةٌ '
  'مقبولةٌ (مسارُ البوتِ `/skip`).';
