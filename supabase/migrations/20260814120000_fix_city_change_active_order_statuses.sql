-- =============================================================================
-- الغرض: إصلاح `update_driver_city` و`update_rider_city` — كانتا تقارنان عمود
--   `orders.status` (من النوع order_status) بأسماء حالاتٍ لا وجود لها في النوع:
--   'searching_driver' و'driver_assigned' و'driver_to_pickup' و'arrived_pickup'
--   و'order_picked_up' و'driver_to_customer'. والنوع الفعليّ هو:
--   ('searching','matched','in_progress','completed','cancelled','failed').
--
--   وأثرُ ذلك ليس شرطاً لا يُطابق بل استثناءٌ يُرفع: PostgreSQL يردّ 22P02
--   «invalid input value for enum order_status» عند أوّل تقييمٍ للشرط. فكانت
--   الدالّتان تُخفقان دائماً لكلّ من بلغهما — أي أنّ تغييرَ المدينة مُعطَّلٌ
--   بالكامل: السائق الذي انتقل من جدّة إلى مكة يضغط «تغيير المدينة» فيقرأ
--   «حدث خطأ، حاول لاحقاً» إلى الأبد، ويبقى في قروبٍ وسائقٍ لمدينةٍ تركها.
--   وهذا وحدُه يجعله لا يعمل ولا يُشترك — بينما المنصّة تُحصي عليه اشتراكاً.
--
--   والحراسة نفسها مقصودة وتبقى: لا تُغيَّر المدينة أثناء رحلةٍ قائمة. لكنّها
--   الآن تُقاس بالحالات الحقيقية: للسائق ما أُسند إليه ولمّا يُكمَل، وللراكب ما
--   لمّا يُنتهِ منه — بما فيه البحثُ عن سائق، لأنّ نقل مدينته وطلبُه يبحث يترك
--   طلباً معلّقاً في مدينةٍ ما عاد فيها.
-- الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
-- ينتمي إلى: supabase/migrations
-- ملاحظات مستقبلية: أيُّ حالةٍ جديدة تُضاف إلى order_status وتُعدّ «قائمة» تُضاف
--   إلى القائمتين أدناه. ولا تُكتب أسماءُ الحالات في شرطٍ نصّيّ بلا كسرٍ ظاهر:
--   المقارنة بالنوع نفسه هي ما جعل هذا العيب يظهر بخطأٍ لا بصمت.
-- =============================================================================

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
  select * into v_driver from drivers where id = p_driver_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  select count(*) into v_active_city_count
    from cities where id = p_new_city_id and is_active = true;
  if v_active_city_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_FOUND_OR_INACTIVE');
  end if;

  if v_driver.city_id = p_new_city_id then
    return jsonb_build_object('ok', true, 'already_same', true);
  end if;

  -- رحلةٌ قائمة للسائق: ما أُسند إليه ولمّا يُكمَل أو يُلغَ.
  select count(*) into v_active_order_count
    from orders
   where assigned_driver_id = p_driver_id
     and status in ('matched', 'in_progress');
  if v_active_order_count > 0 then
    return jsonb_build_object('ok', false, 'error', 'ACTIVE_ORDER_IN_PROGRESS');
  end if;

  update drivers set city_id = p_new_city_id, updated_at = now()
   where id = p_driver_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  select p_new_city_id, v_driver.user_id, 'driver.city_changed', 'driver', p_driver_id,
         jsonb_build_object('old_city_id', v_driver.city_id, 'new_city_id', p_new_city_id);

  return jsonb_build_object('ok', true, 'already_same', false,
    'old_city_id', v_driver.city_id, 'new_city_id', p_new_city_id);
end;
$$;

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

  -- طلبٌ قائم للراكب: البحثُ عن سائق طلبٌ قائم أيضاً — نقلُ مدينته وهو يبحث
  -- يترك طلباً يُوزَّع في مدينةٍ ما عاد فيها.
  select count(*) into v_active_order_count
    from orders
   where rider_id = p_rider_id
     and status in ('searching', 'matched', 'in_progress');
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
  'يغيّر مدينة السائق ذرّياً — يتحقق أنّ المدينة مُفعّلة ولا رحلة قائمة له';
comment on function update_rider_city is
  'يغيّر مدينة الراكب ذرّياً — يتحقق أنّ المدينة مُفعّلة ولا طلب قائم له';

-- ---------------------------------------------------------------------------
-- سطحُ الصلاحيات: `create or replace` يعيد الدالّة مفتوحةً لـPUBLIC، فتُسحب
-- صراحةً. اختبار database-privilege-surface يحرس هذا.
-- ---------------------------------------------------------------------------

do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'update_driver_city(uuid, uuid)',
    'update_rider_city(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public', v_sig);
    execute format('revoke all on function %s from anon, authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end $$;
