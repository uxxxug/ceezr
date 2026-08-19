-- =====================================================================
-- الغرض: أن تتبع قدراتُ السائق خطّةَ اشتراكه، لا لحظةَ تسجيله.
--
-- ## العطب الذي تُصلحه هذه الهجرة
--
-- أهليّة الإسناد تشترط أمرين معاً (packages/domain/dispatch/entity.ts:184-186):
-- قدرةً مُفعَّلة في `driver_capabilities`، وخطّةً سارية تغطّي الخدمة. وكان
-- `driver_capabilities` لا يُكتب إلا مرّةً واحدة عند التسجيل من الخدمة المختارة
-- (packages/infrastructure/identity/directories.ts:137)، ولا تمسّه أيُّ دالّة
-- اشتراك: لا `start_trial`، ولا `activate_subscription`، ولا `upgrade_plan`.
--
-- الأثر: سائقٌ سجّل «مشاوير» ثم اشترك أو ترقّى إلى الخطّة الشاملة يدفع سعرها
-- ولا يصله عرضُ توصيلٍ واحد أبداً — يُرفض بـ`SERVICE_NOT_ENABLED` قبل أن
-- يُنظر في اشتراكه. ترقيةٌ اسميّة: المال يُقبض والخدمة لا تُفتح. والعطب أقدمُ
-- من مسار الترقية: مسار `activate_subscription` القائم يحمله بحرفه.
--
-- ## القرارات
--
-- ١. **الموضع في القاعدة لا في التطبيق**: المواءمة تجري داخل الدوالّ الذرّية
--    نفسها التي تُغيّر الخطّة، في المعاملة عينها. ولو كُتبت في طبقة التطبيق
--    لأمكن أن تنجح الترقية وتفشل المواءمة فيبقى سائقٌ دافعٌ محجوباً.
-- ٢. **تفعيلٌ فقط، ولا تعطيل**: الهجرة لا تُطفئ قدرةً قائمة ولا تحذف صفّاً.
--    مَنعُ من انتهى اشتراكه يقع بفحص الاشتراك في `entity.ts:185-186` وهو
--    كافٍ؛ أمّا إطفاء القدرة فيُتلف خياراً اختاره السائق بنفسه، وقد يعود
--    فيشترك فيجد خدمته مُطفأةً بلا سببٍ يفهمه.
-- ٣. **إصلاحُ ما مضى**: القسم ٥ يُفعّل ما تغطّيه الخطط السارية اليوم، لأنّ
--    الصفوف المكتوبة قبل هذه الهجرة تحمل العطب فعلاً ولا يُصلحها كودٌ جديد.
--
-- الحالة: منفّذ فعلياً — أمر المالك 2026-08-12.
-- التوافق: تُطبَّق أكثر من مرّة بلا أثرٍ جانبي (idempotent).
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) الخدمات التي تغطّيها الخطّة — مصدرُ حقيقةٍ واحد داخل القاعدة
--
--    يقابل `servicesCoveredByPlan` في packages/domain/subscription/entity.ts.
--    وتكرارُ المعرفة في موضعين مقصودٌ ومحصور: القاعدة لا تستورد الدومين،
--    ويحرسه اختبارٌ يقارن مخرج الدالّتين لكل خطّة.
-- ---------------------------------------------------------------------
create or replace function services_covered_by_plan(p_plan subscription_plan)
returns service_type[]
language sql
immutable
security definer
set search_path = public
as $$
  select case p_plan
           when 'transport' then array['transport']::service_type[]
           when 'delivery'  then array['delivery']::service_type[]
           when 'both'      then array['transport', 'delivery']::service_type[]
         end
$$;

-- ---------------------------------------------------------------------
-- ٢) مواءمة القدرات مع الخطّة — تُنادى من داخل الدوالّ الذرّية
-- ---------------------------------------------------------------------
create or replace function sync_driver_capabilities_to_plan(
  p_driver_id uuid,
  p_plan subscription_plan
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_city_id uuid;
  v_changed integer := 0;
begin
  select city_id into v_city_id from drivers where id = p_driver_id;
  if v_city_id is null then
    return 0;
  end if;

  -- `is_enabled = true` في التحديث لا يُطفئ شيئاً: القدرات الزائدة عن الخطّة
  -- تبقى كما هي، وفحصُ الاشتراك هو ما يمنع استخدامها.
  with target as (
    select unnest(services_covered_by_plan(p_plan)) as service
  ), upserted as (
    insert into driver_capabilities (city_id, driver_id, service, is_enabled)
    select v_city_id, p_driver_id, t.service, true from target t
    on conflict (driver_id, service) do update
      set is_enabled = true, updated_at = now()
      where driver_capabilities.is_enabled is distinct from true
    returning 1
  )
  select count(*)::integer into v_changed from upserted;

  return v_changed;
end;
$$;

-- ---------------------------------------------------------------------
-- ٣) بدء التجربة — نسخةٌ واحدة معدَّلة: سطرُ المواءمة قبل الإعادة
-- ---------------------------------------------------------------------
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

  perform sync_driver_capabilities_to_plan(p_driver_id, p_plan);

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_driver.city_id, v_driver.user_id, 'subscription.trial_started', 'subscription', v_id,
          jsonb_build_object('plan', p_plan, 'trial_ends_at', v_ends));

  return jsonb_build_object('ok', true, 'subscription_id', v_id, 'trial_ends_at', v_ends);
end;
$$;

-- ---------------------------------------------------------------------
-- ٤) التفعيل المدفوع والترقية
-- ---------------------------------------------------------------------
create or replace function activate_subscription(
  p_driver_id uuid,
  p_plan subscription_plan,
  p_days integer default 30
) returns jsonb
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

  perform sync_driver_capabilities_to_plan(p_driver_id, p_plan);

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_driver.city_id, v_driver.user_id, 'subscription.activated', 'subscription', v_id,
          jsonb_build_object('plan', p_plan, 'price', v_price, 'currency', v_currency,
                             'period_end', v_ends));

  return jsonb_build_object('ok', true, 'subscription_id', v_id,
                            'price', v_price, 'currency', v_currency, 'period_end', v_ends);
end;
$$;

create or replace function upgrade_plan(
  p_driver_id uuid,
  p_new_plan subscription_plan,
  p_transaction_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_sub subscriptions%rowtype;
  v_new_price numeric;
  v_currency text;
begin
  select * into v_driver from drivers where id = p_driver_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  select * into v_sub
    from subscriptions
   where driver_id = p_driver_id
     and status in ('trialing', 'active')
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_LIVE_SUBSCRIPTION');
  end if;

  -- الإيدمبوتنسي: ويبهوك مكرَّر لا يرقّي مرّتين ولا يُخطئ. الحالة المطلوبة
  -- قائمة أصلاً، فيُعاد نجاحٌ صريح موسومٌ بأنه لم يُغيّر شيئاً. ومع ذلك
  -- تُوائَم القدرات: صفٌّ سابقٌ رُقِّي قبل هذه الهجرة قد يكون ناقص القدرة،
  -- وإعادةُ النداء أرخصُ سبيلٍ لإصلاحه من إجبار السائق على مراجعة الدعم.
  if v_sub.plan = p_new_plan then
    perform sync_driver_capabilities_to_plan(p_driver_id, p_new_plan);
    return jsonb_build_object('ok', true, 'subscription_id', v_sub.id,
      'already_on_plan', true, 'plan', v_sub.plan,
      'status', v_sub.status,
      'period_end', case when v_sub.status = 'trialing'
                         then v_sub.trial_ends_at else v_sub.current_period_end end);
  end if;

  if p_new_plan <> 'both' then
    return jsonb_build_object('ok', false, 'error', 'PLAN_NOT_AN_UPGRADE',
      'current_plan', v_sub.plan, 'requested_plan', p_new_plan);
  end if;

  v_new_price := get_setting_number(v_sub.city_id,
                   'subscription_price_' || p_new_plan::text);
  v_currency := get_setting(v_sub.city_id, 'currency') #>> '{}';

  -- تغييرٌ في المكان: الدورة المدفوعة لا تُمَسّ، ولا يُنشأ صفّ ثانٍ يصطدم
  -- بالفهرس الفريد subscriptions_one_live_per_driver.
  -- سعر التجربة يبقى كما هو (لا شيء مدفوع فيها)، فلا يُكتب لها سعرٌ يوحي بدفع.
  update subscriptions
     set plan = p_new_plan,
         price_amount = case when v_sub.status = 'trialing'
                            then v_sub.price_amount else v_new_price end,
         currency = v_currency,
         updated_at = now()
   where id = v_sub.id;

  -- الترقية ليست تغييرَ سطرٍ في جدول: هي فتحُ خدمةٍ للسائق. وبلا هذا السطر
  -- يدفع الشاملةَ ويُرفض بـ`SERVICE_NOT_ENABLED` ولا يفهم لماذا.
  perform sync_driver_capabilities_to_plan(p_driver_id, p_new_plan);

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_sub.city_id, v_driver.user_id, 'subscription.plan_upgraded',
          'subscription', v_sub.id,
          jsonb_build_object('previous_plan', v_sub.plan, 'new_plan', p_new_plan,
                             'previous_price', v_sub.price_amount,
                             'new_price', v_new_price,
                             'transaction_id', p_transaction_id,
                             'period_end', v_sub.current_period_end));

  return jsonb_build_object('ok', true, 'subscription_id', v_sub.id,
    'already_on_plan', false,
    'previous_plan', v_sub.plan, 'plan', p_new_plan,
    'status', v_sub.status,
    'price', case when v_sub.status = 'trialing' then v_sub.price_amount else v_new_price end,
    'currency', v_currency,
    'period_end', case when v_sub.status = 'trialing'
                       then v_sub.trial_ends_at else v_sub.current_period_end end);
end;
$$;

-- ---------------------------------------------------------------------
-- ٥) إصلاح ما مضى — سائقٌ خطّتُه السارية تغطّي خدمةً وقدرتُه لا تُفعّلها
--
--    لا يُطفئ شيئاً ولا يحذف صفّاً: يُدخل الناقص ويُفعّل المُطفأ الذي تغطّيه
--    الخطّة السارية فقط. ويُسجَّل في `audit_log` لأنّ إصلاحاً يمسّ ما يصل
--    السائق من عمل لا يجوز أن يجري صامتاً.
-- ---------------------------------------------------------------------
do $$
declare
  v_row record;
  v_changed integer;
  v_total integer := 0;
  v_drivers integer := 0;
begin
  for v_row in
    select s.driver_id, s.city_id, s.plan, d.user_id
      from subscriptions s
      join drivers d on d.id = s.driver_id
     where s.status in ('trialing', 'active')
  loop
    v_changed := sync_driver_capabilities_to_plan(v_row.driver_id, v_row.plan);
    if v_changed > 0 then
      v_total := v_total + v_changed;
      v_drivers := v_drivers + 1;
      insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
      values (v_row.city_id, v_row.user_id, 'driver.capabilities_synced_to_plan',
              'driver', v_row.driver_id,
              jsonb_build_object('plan', v_row.plan, 'capabilities_enabled', v_changed,
                                 'reason', 'migration_20260812150000'));
    end if;
  end loop;

  if v_total > 0 then
    raise notice 'مُوائمة القدرات: % قدرة على % سائقاً', v_total, v_drivers;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- ٦) الصلاحيات — سطحُ الاستدعاء لا يتوسّع بهجرة
-- ---------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'services_covered_by_plan(subscription_plan)',
    'sync_driver_capabilities_to_plan(uuid, subscription_plan)',
    'start_trial(uuid, subscription_plan)',
    'activate_subscription(uuid, subscription_plan, integer)',
    'upgrade_plan(uuid, subscription_plan, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public', v_fn);
    execute format('revoke all on function %s from anon', v_fn);
    execute format('revoke all on function %s from authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end;
$$;
