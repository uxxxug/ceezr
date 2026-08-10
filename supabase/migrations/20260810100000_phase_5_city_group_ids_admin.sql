-- =============================================================================
-- وَصْلة — المرحلة 5 — إدارة معرّفات قروبات المدن من لوحة الإدارة
--
-- التعديل يمرّ بدالّة ذرّية ومدقّقة، لا UPDATE مباشر من HTTP. بذلك تبقى القروبات
-- في جدول cities مصدر الحقيقة، ويظل لكل تغيير أثر إداري قابل للمراجعة.
-- =============================================================================

-- معرّف محادثة تيليجرام لا يساوي صفراً، والقروبات الثلاثة مسارات مستقلة فلا يصح
-- أن يشير اثنان منها إلى القروب نفسه. يسمح القيد بالقيمة NULL كي تبقى المدينة
-- غير مفعّلة أثناء إدخال الحقول تدريجياً.
alter table cities
  add constraint cities_group_ids_nonzero check (
    (telegram_support_group_id is null or telegram_support_group_id <> 0)
    and (telegram_escalation_group_id is null or telegram_escalation_group_id <> 0)
    and (
      telegram_unsubscribed_drivers_group_id is null
      or telegram_unsubscribed_drivers_group_id <> 0
    )
  ),
  add constraint cities_group_ids_distinct check (
    telegram_support_group_id is null
    or telegram_escalation_group_id is null
    or telegram_support_group_id <> telegram_escalation_group_id
  ),
  add constraint cities_group_ids_distinct_unsubscribed_support check (
    telegram_support_group_id is null
    or telegram_unsubscribed_drivers_group_id is null
    or telegram_support_group_id <> telegram_unsubscribed_drivers_group_id
  ),
  add constraint cities_group_ids_distinct_unsubscribed_escalation check (
    telegram_escalation_group_id is null
    or telegram_unsubscribed_drivers_group_id is null
    or telegram_escalation_group_id <> telegram_unsubscribed_drivers_group_id
  );

-- ----------------------------------------------------------------------------
-- تحديث القروبات الثلاثة في عملية واحدة.
-- لا تُقبل مدينة مفعّلة جزئياً: عند غياب أي حقل تبقى غير مفعّلة، وعند اكتمال
-- الحقول تصبح مفعّلة في نفس المعاملة. الدالّة تتحقق من الدور وتكتب audit_log
-- على نمط admin_update_setting.
-- ----------------------------------------------------------------------------
create or replace function admin_update_city_group_ids(
  p_actor_user_id uuid,
  p_city_id       uuid,
  p_support_group_id bigint,
  p_escalation_group_id bigint,
  p_unsubscribed_drivers_group_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor users%rowtype;
  v_city  cities%rowtype;
  v_is_ready boolean;
begin
  select * into v_actor from users where id = p_actor_user_id;
  if not found or v_actor.role <> 'admin' or v_actor.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;

  if p_support_group_id = 0
  or p_escalation_group_id = 0
  or p_unsubscribed_drivers_group_id = 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_GROUP_ID');
  end if;

  if (p_support_group_id is not null and p_escalation_group_id is not null
      and p_support_group_id = p_escalation_group_id)
  or (p_support_group_id is not null and p_unsubscribed_drivers_group_id is not null
      and p_support_group_id = p_unsubscribed_drivers_group_id)
  or (p_escalation_group_id is not null and p_unsubscribed_drivers_group_id is not null
      and p_escalation_group_id = p_unsubscribed_drivers_group_id) then
    return jsonb_build_object('ok', false, 'error', 'DUPLICATE_GROUP_ID');
  end if;

  select * into v_city from cities where id = p_city_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_FOUND');
  end if;

  v_is_ready := p_support_group_id is not null
    and p_escalation_group_id is not null
    and p_unsubscribed_drivers_group_id is not null;

  if v_city.telegram_support_group_id is not distinct from p_support_group_id
  and v_city.telegram_escalation_group_id is not distinct from p_escalation_group_id
  and v_city.telegram_unsubscribed_drivers_group_id is not distinct from p_unsubscribed_drivers_group_id
  and v_city.is_active = v_is_ready then
    return jsonb_build_object('ok', true, 'changed', false, 'is_active', v_city.is_active);
  end if;

  update cities
     set telegram_support_group_id = p_support_group_id,
         telegram_escalation_group_id = p_escalation_group_id,
         telegram_unsubscribed_drivers_group_id = p_unsubscribed_drivers_group_id,
         is_active = v_is_ready
   where id = v_city.id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (
    v_city.id,
    v_actor.id,
    'admin.city_group_ids_updated',
    'city',
    v_city.id,
    jsonb_build_object(
      'from', jsonb_build_object(
        'support_group_id', v_city.telegram_support_group_id,
        'escalation_group_id', v_city.telegram_escalation_group_id,
        'unsubscribed_drivers_group_id', v_city.telegram_unsubscribed_drivers_group_id,
        'is_active', v_city.is_active
      ),
      'to', jsonb_build_object(
        'support_group_id', p_support_group_id,
        'escalation_group_id', p_escalation_group_id,
        'unsubscribed_drivers_group_id', p_unsubscribed_drivers_group_id,
        'is_active', v_is_ready
      )
    )
  );

  return jsonb_build_object('ok', true, 'changed', true, 'is_active', v_is_ready);
end;
$$;

revoke all on function admin_update_city_group_ids(uuid, uuid, bigint, bigint, bigint)
  from public, anon, authenticated;
grant execute on function admin_update_city_group_ids(uuid, uuid, bigint, bigint, bigint)
  to service_role;
