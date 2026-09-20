-- migration-phase: expand
-- =============================================================================
-- الغرض: `PD-040` — ربطُ بدءِ التجربةِ المجانيّةِ بأهليّةِ استلامِ العروض:
--   لا يبدأُ `trial_ends_at` قبلَ توثيقِ السائقِ (verification_status = 'verified')
--   وتفعيلِ مدينتِهِ (cities.is_active = true). القاعدةُ معلنةٌ في هذه الهجرةِ
--   وفي `start_trial` نفسِها.
-- الحالة: منفَّذٌ فعليّاً.
-- ينتمي إلى: supabase/migrations
-- يبني على: 20260806120100 (`start_trial` الأصلية) · 20260808140000
--   (`admin_set_driver_verification`) · 20260806120000 (`cities.is_active`).
-- يُستخدم من: `start_trial(uuid,subscription_plan)` ·
--   `admin_set_driver_verification(uuid,uuid,text)`.
--
-- ## القاعدةُ المعلنة
--
-- التجربةُ المجانيّةُ شهرٌ واحدٌ لا يبدأُ حسابُهُ إلا حينَ يصبحُ السائقُ أهلاً
-- لاستلامِ العروضِ فعلاً: توثيقٌ (verification_status = 'verified') ومدينةٌ
-- مفعّلةٌ (is_active = true). فلا يُستهلَكُ الشهرُ في انتظارِ المراجعةِ.
--
-- ## التغيير
--
-- ١) `start_trial` تُضيفُ فحصَينِ قبلَ الإنشاءِ:
--    - verification_status ≠ 'verified' ← DRIVER_NOT_VERIFIED
--    - city.is_active = false ← CITY_NOT_ACTIVE
--
-- ٢) `admin_set_driver_verification` تُنشئُ التجربةَ تلقائيًّا عندَ التحويلِ إلى
--    'verified' إن لم يكنْ للسائقِ اشتراكٌ (بخطةِ 'transport' الافتراضيّةِ —
--    الترقيةُ متاحةٌ لاحقًا عبرَ upgrade_subscription).
--
-- ## العكسيّة
--
-- `create or replace function` قابلٌ للاستبدالِ بنصِّ الدالّةِ القديمةِ (المحفوظِ
-- في هجرةِ `20260806120100`). والبذورُ في `admin_set_driver_verification` وراءَ
-- `if not exists` فلا تتضاعف.
-- =============================================================================

-- ١) start_trial — مع فحصِ الأهليّة
create or replace function start_trial(p_driver_id uuid, p_plan subscription_plan)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_city   cities%rowtype;
  v_days   numeric;
  v_ends   timestamptz;
  v_id     uuid;
begin
  select * into v_driver from drivers where id = p_driver_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  if exists (select 1 from subscriptions where driver_id = p_driver_id) then
    return jsonb_build_object('ok', false, 'error', 'TRIAL_ALREADY_USED');
  end if;

  -- فحصُ الأهليّة: لا تجربةَ قبلَ التوثيقِ
  if v_driver.verification_status <> 'verified' then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_VERIFIED');
  end if;

  -- فحصُ الأهليّة: لا تجربةَ في مدينةٍ غيرِ مفعّلةٍ
  select * into v_city from cities where id = v_driver.city_id;
  if not v_city.is_active then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_ACTIVE');
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

-- ٢) admin_set_driver_verification — بدءُ التجربةِ تلقائيًّا عندَ التوثيق
create or replace function admin_set_driver_verification(
  p_actor_user_id uuid,
  p_driver_id     uuid,
  p_status        text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  users%rowtype;
  v_driver drivers%rowtype;
  v_city   cities%rowtype;
  v_trial  jsonb;
begin
  select * into v_actor from users where id = p_actor_user_id;
  if not found or v_actor.role <> 'admin' or v_actor.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;

  if p_status not in ('pending', 'verified', 'rejected', 'suspended') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STATUS');
  end if;

  select * into v_driver from drivers where id = p_driver_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  if v_driver.verification_status::text = p_status then
    return jsonb_build_object('ok', true, 'changed', false, 'status', p_status);
  end if;

  update drivers
     set verification_status = p_status::verification_status
   where id = v_driver.id;

  -- سائق لم يعد موثَّقاً لا يبقى «متاحاً» في جدول الإتاحة
  if p_status <> 'verified' then
    update driver_availability
       set is_available = false, changed_at = now()
     where driver_id = v_driver.id and is_available = true;
  end if;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_driver.city_id, v_actor.id, 'admin.driver_verification_changed', 'driver',
          v_driver.id,
          jsonb_build_object('from', v_driver.verification_status, 'to', p_status));

  -- بدءُ التجربةِ تلقائيًّا عندَ التوثيقِ إن لم يكنْ للسائقِ اشتراكٌ
  -- والمدينةُ مفعّلةٌ (القاعدةُ المعلنةُ في PD-040)
  if p_status = 'verified' and not exists (
    select 1 from subscriptions where driver_id = v_driver.id
  ) then
    select * into v_city from cities where id = v_driver.city_id;
    if v_city.is_active then
      v_trial := start_trial(v_driver.id, 'transport');
      -- نتيجةُ التجربةِ في الحمولةِ لا تُسقِطُ التوثيقَ إن فشلت
      insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
      values (v_driver.city_id, v_actor.id, 'admin.trial_auto_started', 'driver',
              v_driver.id, v_trial);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'changed', true, 'status', p_status);
end;
$$;
