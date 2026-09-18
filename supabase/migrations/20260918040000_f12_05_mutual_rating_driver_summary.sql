-- =====================================================================================
-- F12-05 — التقييمُ المتبادلُ: منظورُ السائقِ في ملخَّصِ الرحلةِ
--
-- التقييمُ المتبادلُ مبنيٌّ في القاعدةِ منذُ المرحلةِ 2.5: جدولُ `ratings` باتّجاهَينِ،
-- و`submit_rating_with_tags` تستنتجُ الاتّجاهَ من هويّةِ المُقيِّمِ. لكنَّ قراءةَ الملخَّصِ
-- كانت راكباً وحده: `completed_ride_summary` تردُّ `RIDER_NOT_REGISTERED` لكلِّ من ليسَ
-- راكباً، فلا يرى السائقُ مدّةَ رحلتِه ولا يرى أهليّةَ تقييمِ الراكبِ.
--
-- وهذه الهجرةُ تُوسِّعُ القارئَ نفسَه لا تُنشئ قارئاً موازياً: تَحمِلُ هويةَ المستعملِ
-- والطلبَ، ثمَّ تستنتجُ المنظورَ من علاقةِ الطلبِ تحديداً — راكبٌ أم سائقٌ مُسنَدٌ.
-- وعقدُ الراكبِ القائمُ يُحفَظُ حرفاً (`ح-8`): الحقولُ نفسُها والمدّةُ والوترُ ونافذةُ
-- التقييمِ. ويزيدُ منظورُ السائقِ: بطاقةُ راكبٍ (اسمٌ ومتوسِّطٌ وعددٌ) بلا هاتفَ ولا
-- معرِّفَ تلغرام، واتّجاهُ التقييمِ `driver_to_rider` لا `rider_to_driver`.
--
-- التغييرُ السلوكيُّ الوحيدُ على عقدِ الراكبِ: قيدُ مِلكيّةِ الطلبِ صارَ «راكبٌ
-- **أو** سائقٌ مُسنَدٌ» لا «راكبٌ وحده» — وهذا توسيعٌ لا تضييقٌ (`ح-8`): كلُّ راكبٍ
-- كانَ يرى ملخَّصَهُ يراهُ اليومَ، والسائقُ الذي كانَ يُرَدُّ برمزِ `RIDER_NOT_REGISTERED`
-- يرى اليومَ ملخَّصَه. ورمزُ `RIDER_NOT_REGISTERED` يُعادُ فقط حينَ لا يكونُ المستعملُ
-- راكباً **ولا** سائقاً مُسنَداً لهذا الطلبِ — وهوَ ما كانَ يُسمّى `ORDER_NOT_FOUND`
-- في عقدِ الراكبِ القديمِ (غيرُ المالكِ لا يرى الطلبَ). فالرمزُ القديمُ يُحفَظُ للراكبِ
-- وحده، والرمزُ الجديدُ `NOT_PARTY_TO_ORDER` يُنشَرُ لمن ليسَ طرفاً.
--
-- ولا وسومَ لتقييمِ السائقِ للراكبِ: نجومٌ وملاحظةٌ اختياريّةٌ. ووسومُ الراكبِ للسائقِ
-- تبقى كما هي — `submit_rating_with_tags` تتحقَّقُ منها قبلَ أيِّ قراءةٍ.
-- =====================================================================================

-- migration-phase: contract

create or replace function completed_ride_summary(
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
  v_driver_id     uuid;
  v_order         record;
  v_is_driver     boolean := false;
  v_vehicle_type   text;
  v_plate_number   text;
  v_rating_average numeric;
  v_rating_count   integer;
  v_full_name      text;
  v_counterpart_name text;
  v_window_hours   numeric;
  v_already_rated  boolean := false;
  v_window_closed  boolean := true;
  v_can_rate       boolean := false;
  v_direction      rating_direction;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ORDER_ID');
  end if;

  select u.id into v_user_id from users u where u.telegram_id = p_telegram_id;

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  -- المنظورُ يُستنتَجُ من علاقةِ الطلبِ تحديداً لا من دورٍ مُسبَقٍ:
  -- راكبٌ يرى الطلبَ الذي rider_id له، وسائقٌ مُسنَدٌ يرى الطلبَ الذي assigned_driver_id
  -- له. ومن ليسَ طرفاً لا يرى شيئاً.
  select r.id into v_rider_id from riders r where r.user_id = v_user_id;

  if v_rider_id is not null then
    -- راكبٌ: ابحث عن الطلبِ بصفتهِ راكبَه.
    select o.id,
           o.status,
           o.service,
           o.city_id,
           o.assigned_driver_id,
           o.rider_id,
           o.pickup_label,
           o.dropoff_label,
           o.created_at,
           o.matched_at,
           o.started_at,
           o.completed_at,
           case
             when o.started_at is null or o.completed_at is null then null
             else greatest(
               0,
               floor(extract(epoch from (o.completed_at - o.started_at)))::bigint
             )
           end as duration_seconds,
           case
             when o.dropoff is null then null
             else round(st_distance(o.pickup, o.dropoff)::numeric, 1)
           end as straight_line_meters
      into v_order
    from orders o
    where o.id = p_order_id and o.rider_id = v_rider_id;

    if v_order.id is null then
      -- ليسَ راكبَ هذا الطلبِ: قد يكونُ سائقَه. ابحث في السائقين.
      select d.id into v_driver_id from drivers d where d.user_id = v_user_id;
      if v_driver_id is not null then
        v_is_driver := true;
        select o.id,
               o.status,
               o.service,
               o.city_id,
               o.assigned_driver_id,
               o.rider_id,
               o.pickup_label,
               o.dropoff_label,
               o.created_at,
               o.matched_at,
               o.started_at,
               o.completed_at,
               case
                 when o.started_at is null or o.completed_at is null then null
                 else greatest(
                   0,
                   floor(extract(epoch from (o.completed_at - o.started_at)))::bigint
                 )
               end as duration_seconds,
               case
                 when o.dropoff is null then null
                 else round(st_distance(o.pickup, o.dropoff)::numeric, 1)
               end as straight_line_meters
          into v_order
        from orders o
        where o.id = p_order_id and o.assigned_driver_id = v_driver_id;
      end if;
    end if;
  else
    -- ليسَ راكاً أصلاً: ابحث في السائقين.
    select d.id into v_driver_id from drivers d where d.user_id = v_user_id;
    if v_driver_id is not null then
      v_is_driver := true;
      select o.id,
             o.status,
             o.service,
             o.city_id,
             o.assigned_driver_id,
             o.rider_id,
             o.pickup_label,
             o.dropoff_label,
             o.created_at,
             o.matched_at,
             o.started_at,
             o.completed_at,
             case
               when o.started_at is null or o.completed_at is null then null
               else greatest(
                 0,
                 floor(extract(epoch from (o.completed_at - o.started_at)))::bigint
               )
             end as duration_seconds,
             case
               when o.dropoff is null then null
               else round(st_distance(o.pickup, o.dropoff)::numeric, 1)
             end as straight_line_meters
        into v_order
      from orders o
      where o.id = p_order_id and o.assigned_driver_id = v_driver_id;
    end if;
  end if;

  if v_order.id is null then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  -- بطاقةُ الطرفِ الآخر تُقرأُ للرحلةِ المنتهيةِ وحدها: الرحلةُ التي أُلغِيَت بعدَ
  -- إسنادٍ لا تُعرَضُ بطاقةُ سائقٍ فيها ولا بطاقةُ راكبٍ.
  if v_order.status = 'completed' then
    if v_is_driver then
      -- منظورُ السائقِ: بطاقةُ الراكبِ — اسمٌ ومتوسِّطٌ وعددٌ. لا هاتفَ ولا معرِّفَ
      -- تلغرام: الاتّصالُ بندٌ له حكمُه لا يُشتَقُّ ههنا (مثل بطاقةِ السائقِ في
      -- منظورِ الراكبِ).
      select u.full_name,
             r.rating_average,
             coalesce(r.rating_count, 0)
        into v_full_name,
             v_rating_average,
             v_rating_count
      from orders o
      join riders r on r.id = o.rider_id
      join users u on u.id = r.user_id
      where o.id = v_order.id;

      v_counterpart_name := nullif(split_part(coalesce(trim(v_full_name), ''), ' ', 1), '');
      v_direction := 'driver_to_rider';
    elsif v_order.assigned_driver_id is not null then
      -- منظورُ الراكبِ: بطاقةُ السائقِ كما كانت.
      select d.id,
             d.vehicle_type,
             d.plate_number,
             d.rating_average,
             coalesce(d.rating_count, 0),
             u.full_name
        into v_driver_id,
             v_vehicle_type,
             v_plate_number,
             v_rating_average,
             v_rating_count,
             v_full_name
      from drivers d
      join users u on u.id = d.user_id
      where d.id = v_order.assigned_driver_id;

      v_counterpart_name := nullif(split_part(coalesce(trim(v_full_name), ''), ' ', 1), '');
      v_direction := 'rider_to_driver';
    end if;
  end if;

  -- نافذةُ التقييمِ من الإعدادِ، **وبديلُها مكتوبٌ ههنا وحدَه**:
  begin
    v_window_hours := get_setting_number(v_order.city_id, 'rating_prompt_window_hours');
  exception when raise_exception then
    v_window_hours := 48;
  end;

  select exists (
    select 1
      from ratings rt
     where rt.order_id = v_order.id
       and rt.direction = v_direction
  ) into v_already_rated;

  v_window_closed := case
    when v_order.completed_at is null then true
    else v_order.completed_at + make_interval(hours => v_window_hours::integer) < now()
  end;

  v_can_rate := v_order.status = 'completed'
                and not v_already_rated
                and not v_window_closed;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'status', v_order.status,
    'service', v_order.service,
    'pickup_label', v_order.pickup_label,
    'dropoff_label', v_order.dropoff_label,
    'created_at', v_order.created_at,
    'matched_at', v_order.matched_at,
    'started_at', v_order.started_at,
    'completed_at', v_order.completed_at,
    'duration_seconds', v_order.duration_seconds,
    'straight_line_meters', v_order.straight_line_meters,
    'driver', case
      when v_is_driver then null
      when v_driver_id is null then null
      else jsonb_build_object(
        'first_name', v_counterpart_name,
        'vehicle_type', v_vehicle_type,
        'plate_number', v_plate_number,
        'rating_average', v_rating_average,
        'rating_count', coalesce(v_rating_count, 0)
      )
    end,
    'rider', case
      when not v_is_driver then null
      else jsonb_build_object(
        'first_name', v_counterpart_name,
        'rating_average', v_rating_average,
        'rating_count', coalesce(v_rating_count, 0)
      )
    end,
    'rating', jsonb_build_object(
      'direction', v_direction::text,
      'already_rated', v_already_rated,
      'window_hours', v_window_hours,
      'window_closed', v_window_closed,
      'can_rate', v_can_rate
    )
  );
end;
$fn$;

comment on function completed_ride_summary(bigint, uuid) is
  'F2-07/F12-05: ملخَّصُ رحلةٍ منتهيةٍ لطرفِها — راكبٌ يرى بطاقةَ سائقِه، وسائقٌ يرى بطاقةَ راكبِه. مدّةٌ ووترُ خطٍّ مستقيمٍ وحالةُ تقييمٍ باتّجاهِه، بلا مالٍ وبلا موقعٍ.';

revoke execute on function completed_ride_summary(bigint, uuid) from public, anon, authenticated;
