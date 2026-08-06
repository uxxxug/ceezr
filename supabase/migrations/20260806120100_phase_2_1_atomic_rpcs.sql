-- =============================================================================
-- وَصْلة — المرحلة 2.1 — الدوال الذرّية (البند 0.5)
-- لا منطق تزامن على مستوى التطبيق. كل عملية حرجة هنا.
-- كل الدوال تُعيد jsonb بصيغة {ok, error, ...} لتطابق نمط Result<T,E> في الكود.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- قارئ الإعدادات — المصدر الوحيد لأي قيمة تجارية
-- ----------------------------------------------------------------------------
create or replace function get_setting(p_city_id uuid, p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select value from platform_settings where city_id = p_city_id and key = p_key;
$$;

create or replace function get_setting_number(p_city_id uuid, p_key text)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  v := get_setting(p_city_id, p_key);
  if v is null then
    raise exception 'MISSING_SETTING:%', p_key;
  end if;
  return (v #>> '{}')::numeric;
end;
$$;

-- ----------------------------------------------------------------------------
-- record_attendance — تبديل متاح/غير متاح + سجل + audit، ذرّياً
-- ----------------------------------------------------------------------------
create or replace function record_attendance(
  p_driver_id uuid,
  p_is_available boolean,
  p_source text default 'driver_bot'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_now timestamptz := now();
begin
  select * into v_driver from drivers where id = p_driver_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  insert into driver_availability (city_id, driver_id, is_available, changed_at)
  values (v_driver.city_id, p_driver_id, p_is_available, v_now)
  on conflict (driver_id) do update
    set is_available = excluded.is_available,
        changed_at   = excluded.changed_at;

  insert into attendance_log (city_id, driver_id, is_available, source, changed_at)
  values (v_driver.city_id, p_driver_id, p_is_available, p_source, v_now);

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_driver.city_id, v_driver.user_id, 'attendance.toggled', 'driver', p_driver_id,
          jsonb_build_object('is_available', p_is_available, 'source', p_source));

  return jsonb_build_object('ok', true, 'is_available', p_is_available, 'changed_at', v_now);
end;
$$;

-- ----------------------------------------------------------------------------
-- start_trial — الشهر المجاني مرة واحدة فقط لكل سائق
-- ----------------------------------------------------------------------------
create or replace function start_trial(p_driver_id uuid, p_plan subscription_plan)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_days numeric;
  v_ends timestamptz;
  v_id uuid;
begin
  select * into v_driver from drivers where id = p_driver_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  if exists (select 1 from subscriptions where driver_id = p_driver_id) then
    return jsonb_build_object('ok', false, 'error', 'TRIAL_ALREADY_USED');
  end if;

  v_days := get_setting_number(v_driver.city_id, 'trial_days');
  v_ends := now() + make_interval(days => v_days::int);

  insert into subscriptions (city_id, driver_id, plan, status, trial_ends_at, current_period_end)
  values (v_driver.city_id, p_driver_id, p_plan, 'trialing', v_ends, v_ends)
  returning id into v_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_driver.city_id, v_driver.user_id, 'subscription.trial_started', 'subscription', v_id,
          jsonb_build_object('plan', p_plan, 'trial_ends_at', v_ends));

  return jsonb_build_object('ok', true, 'subscription_id', v_id, 'trial_ends_at', v_ends);
end;
$$;

-- ----------------------------------------------------------------------------
-- activate_subscription — تفعيل مدفوع؛ السعر يُقرأ من platform_settings حصراً
-- ----------------------------------------------------------------------------
create or replace function activate_subscription(
  p_driver_id uuid,
  p_plan subscription_plan,
  p_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_price numeric;
  v_currency text;
  v_ends timestamptz;
  v_id uuid;
  v_key text;
begin
  select * into v_driver from drivers where id = p_driver_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  v_key := 'subscription_price_' || p_plan::text;
  v_price := get_setting_number(v_driver.city_id, v_key);
  v_currency := get_setting(v_driver.city_id, 'currency') #>> '{}';
  v_ends := now() + make_interval(days => p_days);

  update subscriptions
     set status = 'expired'
   where driver_id = p_driver_id and status in ('trialing', 'active');

  insert into subscriptions
    (city_id, driver_id, plan, status, current_period_end, price_amount, currency)
  values
    (v_driver.city_id, p_driver_id, p_plan, 'active', v_ends, v_price, v_currency)
  returning id into v_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_driver.city_id, v_driver.user_id, 'subscription.activated', 'subscription', v_id,
          jsonb_build_object('plan', p_plan, 'price', v_price, 'currency', v_currency,
                             'period_end', v_ends));

  return jsonb_build_object('ok', true, 'subscription_id', v_id,
                            'price', v_price, 'currency', v_currency, 'period_end', v_ends);
end;
$$;

-- ----------------------------------------------------------------------------
-- claim_ride — أول قبول يفوز. القلب الذرّي للمطابقة (3.3.3)
-- ----------------------------------------------------------------------------
create or replace function claim_ride(p_order_id uuid, p_driver_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  orders%rowtype;
  v_offer  order_offers%rowtype;
  v_driver drivers%rowtype;
  v_now    timestamptz := now();
begin
  -- القفل الذرّي: من لا يظفر بالصف لا ينتظر، بل يخسر فوراً
  select * into v_order
    from orders
   where id = p_order_id and status = 'searching'
     for update skip locked;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_CLAIMABLE');
  end if;

  select * into v_offer
    from order_offers
   where order_id = p_order_id
     and driver_id = p_driver_id
     and status = 'pending'
     and expires_at > v_now
   order by round desc
   limit 1
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'OFFER_NOT_VALID');
  end if;

  select * into v_driver from drivers where id = p_driver_id;
  if v_driver.city_id <> v_order.city_id then
    return jsonb_build_object('ok', false, 'error', 'CITY_MISMATCH');
  end if;

  update order_offers
     set status = 'accepted', responded_at = v_now
   where id = v_offer.id;

  update order_offers
     set status = 'cancelled', responded_at = v_now
   where order_id = p_order_id and id <> v_offer.id and status = 'pending';

  update orders
     set status = 'matched', assigned_driver_id = p_driver_id, matched_at = v_now
   where id = p_order_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, v_driver.user_id, 'order.claimed', 'order', p_order_id,
          jsonb_build_object('driver_id', p_driver_id, 'offer_id', v_offer.id,
                             'round', v_offer.round));

  return jsonb_build_object('ok', true, 'order_id', p_order_id,
                            'driver_id', p_driver_id, 'matched_at', v_now);
end;
$$;

-- ----------------------------------------------------------------------------
-- expire_stale_offers — تنفّذها مهمة Cron؛ المهلة من platform_settings
-- ----------------------------------------------------------------------------
create or replace function expire_stale_offers()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  with expired as (
    update order_offers
       set status = 'expired', responded_at = now()
     where status = 'pending' and expires_at <= now()
    returning order_id
  )
  select count(*) into v_count from expired;

  return jsonb_build_object('ok', true, 'expired_offers', v_count);
end;
$$;

-- ----------------------------------------------------------------------------
-- الصلاحيات: لا استدعاء من anon أو authenticated في المرحلة 2.1
-- ----------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'get_setting(uuid,text)',
    'get_setting_number(uuid,text)',
    'record_attendance(uuid,boolean,text)',
    'start_trial(uuid,subscription_plan)',
    'activate_subscription(uuid,subscription_plan,integer)',
    'claim_ride(uuid,uuid)',
    'expire_stale_offers()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
