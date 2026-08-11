-- =============================================================================
-- الغرض: تغيير مدينة السائق أو الراكب — للانتقال والسفر.
--   RPC ذرّي: يحدّث city_id في drivers/riders، ويسجّل في audit_log،
--   ويتحقق أنّ المدينة الجديدة مُفعّلة (is_active=true).
--   لا يُسمح بالتغيير أثناء رحلة نشطة.
-- الحالة: منفّذ فعلياً.
-- ينتمي إلى: supabase/migrations
-- =============================================================================

-- تغيير مدينة سائق
create or replace function update_driver_city(
  p_driver_id uuid,
  p_new_city_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver record;
  v_active_city_count integer;
  v_active_order_count integer;
begin
  -- قراءة بيانات السائق
  select * into v_driver from drivers where id = p_driver_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  -- التحقق أنّ المدينة الجديدة موجودة ومُفعّلة
  select count(*) into v_active_city_count
    from cities where id = p_new_city_id and is_active = true;
  if v_active_city_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_FOUND_OR_INACTIVE');
  end if;

  -- لا تغيير إن كانت نفس المدينة
  if v_driver.city_id = p_new_city_id then
    return jsonb_build_object('ok', true, 'already_same', true);
  end if;

  -- منع التغيير أثناء رحلة نشطة
  select count(*) into v_active_order_count
    from orders
   where assigned_driver_id = p_driver_id
     and status in ('searching_driver', 'driver_assigned', 'driver_to_pickup',
                    'arrived_pickup', 'order_picked_up', 'driver_to_customer');
  if v_active_order_count > 0 then
    return jsonb_build_object('ok', false, 'error', 'ACTIVE_ORDER_IN_PROGRESS');
  end if;

  -- تحديث المدينة
  update drivers set city_id = p_new_city_id, updated_at = now()
   where id = p_driver_id;

  -- تسجيل في audit_log
  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  select p_new_city_id, v_driver.user_id, 'driver.city_changed', 'driver', p_driver_id,
         jsonb_build_object('old_city_id', v_driver.city_id, 'new_city_id', p_new_city_id);

  return jsonb_build_object('ok', true, 'already_same', false,
    'old_city_id', v_driver.city_id, 'new_city_id', p_new_city_id);
end;
$$;

-- تغيير مدينة راكب
create or replace function update_rider_city(
  p_rider_id uuid,
  p_new_city_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider record;
  v_active_city_count integer;
  v_active_order_count integer;
begin
  select * into v_rider from riders where id = p_rider_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'RIDER_NOT_FOUND');
  end if;

  select count(*) into v_active_city_count
    from cities where id = p_new_city_id and is_active = true;
  if v_active_city_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_FOUND_OR_INACTIVE');
  end if;

  if v_rider.city_id = p_new_city_id then
    return jsonb_build_object('ok', true, 'already_same', true);
  end if;

  -- منع التغيير أثناء طلب نشط
  select count(*) into v_active_order_count
    from orders
   where rider_id = p_rider_id
     and status in ('searching_driver', 'driver_assigned', 'driver_to_pickup',
                    'arrived_pickup', 'order_picked_up', 'driver_to_customer');
  if v_active_order_count > 0 then
    return jsonb_build_object('ok', false, 'error', 'ACTIVE_ORDER_IN_PROGRESS');
  end if;

  update riders set city_id = p_new_city_id, updated_at = now()
   where id = p_rider_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  select p_new_city_id, v_rider.user_id, 'rider.city_changed', 'rider', p_rider_id,
         jsonb_build_object('old_city_id', v_rider.city_id, 'new_city_id', p_new_city_id);

  return jsonb_build_object('ok', true, 'already_same', false,
    'old_city_id', v_rider.city_id, 'new_city_id', p_new_city_id);
end;
$$;

comment on function update_driver_city is
  'يغيّر مدينة السائق ذرّياً — يتحقق أنّ المدينة مُفعّلة ولا يوجد طلب نشط';
comment on function update_rider_city is
  'يغيّر مدينة الراكب ذرّياً — يتحقق أنّ المدينة مُفعّلة ولا يوجد طلب نشط';
