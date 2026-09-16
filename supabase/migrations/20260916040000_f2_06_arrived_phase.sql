-- ============================================================================
-- migration-phase: expand
--
-- الغرض: إضافةُ ختمِ «وصلَ السائقُ» (`arrived_at`) إلى لقطةِ الرحلةِ النشطةِ.
--   كانَ البندُ `F2-06` عاجزاً عن هذا الطورِ لأنَّ `orders` لم يكنْ فيها عمودٌ،
--   فأضافتْه هجرةُ `20260915030000` (الفازةُ `F3-03`). وهذا التصحيحُ يقرأُه.
--
-- الحالة: مضافٌ تصحيحيّاً — البندانِ `F2-06` و`F3-03`.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `packages/infrastructure/transport/active-ride-store.ts`
-- يحكمُه: عقدُ `active_ride_snapshot` الأصليّ لا يُنقَضُ، والعمودُ اختياريٌّ:
--   `null` متى لم يكتبْه السائقُ بعدُ، فالطورُ لا يُخترَعُ من قربِ مسافةٍ.
-- ============================================================================

create or replace function active_ride_snapshot(
  p_telegram_id bigint,
  p_order_id    uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_user_id  uuid;
  v_rider_id uuid;
  v_order    record;
  v_driver_id      uuid;
  v_vehicle_type   text;
  v_plate_number   text;
  v_rating_average numeric;
  v_rating_count   integer;
  v_driver_lat     double precision;
  v_driver_lng     double precision;
  v_position_age   integer;
  v_full_name      text;
  v_driver_name    text;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ORDER_ID');
  end if;

  select u.id into v_user_id from users u where u.telegram_id = p_telegram_id;

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select r.id into v_rider_id from riders r where r.user_id = v_user_id;

  if v_rider_id is null then
    return jsonb_build_object('ok', false, 'error', 'RIDER_NOT_REGISTERED');
  end if;

  select o.id,
         o.status,
         o.service,
         o.assigned_driver_id,
         o.pickup_label,
         o.dropoff_label,
         st_y(o.pickup::geometry)  as pickup_lat,
         st_x(o.pickup::geometry)  as pickup_lng,
         st_y(o.dropoff::geometry) as dropoff_lat,
         st_x(o.dropoff::geometry) as dropoff_lng,
         o.created_at,
         o.matched_at,
         o.started_at,
         o.arrived_at,
         o.completed_at
    into v_order
  from orders o
  where o.id = p_order_id and o.rider_id = v_rider_id;

  if v_order.id is null then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  if v_order.assigned_driver_id is not null
     and v_order.status in ('matched', 'in_progress') then
    select d.id,
           d.vehicle_type,
           d.plate_number,
           d.rating_average,
           coalesce(d.rating_count, 0),
           st_y(d.last_location::geometry),
           st_x(d.last_location::geometry),
           case
             when d.last_location_at is null then null
             else greatest(0, floor(extract(epoch from (now() - d.last_location_at)))::integer)
           end,
           u.full_name
      into v_driver_id,
           v_vehicle_type,
           v_plate_number,
           v_rating_average,
           v_rating_count,
           v_driver_lat,
           v_driver_lng,
           v_position_age,
           v_full_name
    from drivers d
    join users u on u.id = d.user_id
    where d.id = v_order.assigned_driver_id;

    v_driver_name := nullif(split_part(coalesce(trim(v_full_name), ''), ' ', 1), '');
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'status', v_order.status,
    'service', v_order.service,
    'pickup', jsonb_build_object(
      'lat', v_order.pickup_lat, 'lng', v_order.pickup_lng, 'label', v_order.pickup_label
    ),
    'dropoff', case
      when v_order.dropoff_lat is null then null
      else jsonb_build_object(
        'lat', v_order.dropoff_lat, 'lng', v_order.dropoff_lng, 'label', v_order.dropoff_label
      )
    end,
    'created_at', v_order.created_at,
    'matched_at', v_order.matched_at,
    'started_at', v_order.started_at,
    'arrived_at', v_order.arrived_at,
    'completed_at', v_order.completed_at,
    'driver', case
      when v_driver_id is null then null
      else jsonb_build_object(
        'first_name', v_driver_name,
        'vehicle_type', v_vehicle_type,
        'plate_number', v_plate_number,
        'rating_average', v_rating_average,
        'rating_count', coalesce(v_rating_count, 0),
        'position', case
          when v_driver_lat is null then null
          else jsonb_build_object(
            'lat', v_driver_lat,
            'lng', v_driver_lng,
            'age_seconds', v_position_age
          )
        end
      )
    end
  );
end;
$fn$;

comment on function active_ride_snapshot(bigint, uuid) is
  'لقطةُ الرحلةِ النشطةِ للمالكِ وحدَه في استفسارٍ واحدٍ: الحالةُ والخدمةُ '
  'وطرفا الرحلةِ وأختامُ الأطوارِ (بما فيها «وصلَ السائقُ» `arrived_at`)، '
  'وبطاقةُ السائقِ المُسنَدِ متى كانَ matched أو in_progress وحدَه، وموقعُه '
  'مقروناً بعُمرِه بالثواني (BUG-001 قائمٌ فالنقطةُ بلا عُمرٍ شاهدٌ كاذبٌ). '
  'ولا هاتفَ ولا أجرةَ ولا عقوبةَ إلغاءٍ ولا رمزَ مشاركةٍ. وغيرُ المالكِ '
  'يُرَدُّ ORDER_NOT_FOUND لا FORBIDDEN.';

revoke execute on function active_ride_snapshot(bigint, uuid) from public, anon, authenticated;
