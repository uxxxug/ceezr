-- migration-phase: expand
-- =============================================================================
-- `F3-06` — لوحُ اشتراكِ السائقِ: **كلُّ سعرٍ ومدّةٍ من `platform_settings`**،
--   ولا رقمٌ صلبٌ في شاشةٍ ولا مسارٍ. والتاريخُ والتجربةُ والتحذيرُ من القاعدةِ،
--   والدفعُ يُبدأُ لا يُتمُّ ههنا — التأكيدُ ويبهوك.
--
-- الحالة: منفَّذٌ فعليّاً — البند `F3-06` (`SD-07`).
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `packages/infrastructure/driver/driver-subscription-store.ts` عبرَ
--   نداءِ دالّتَي `driver_subscription_dashboard` و`driver_subscription_history`.
-- يحرسُه: tests/integration/driver-subscription.test.ts ·
--   scripts/check-driver-subscription-contract.ts
-- الحاكم: docs/adr/0094-project-independence.md
--
-- ## لِمَ السعرُ هنا يُقرأُ ولا يُرسَلُ
--
-- `SD-07` يقولُ «الخطةُ والسعرُ من `platform_settings`» — والمنطقُ واحدٌ مع
-- `F3-05`: السعرُ في الشاشةِ نسخةٌ تتخلَّفُ، فتُقرأُ من الجوابِ الذي حسبَته
-- الدالّةُ من الإعداداتِ لا يُكتبُ في ثابتٍ. و`activate_subscription` نفسُها
-- تقرأُ السعرَ من `platform_settings` (`subscription_price_<plan>`)، فمصدرُ
-- الحقيقةِ واحدٌ للعرضِ وللتفعيلِ.
--
-- ## ولِمَ التاريخُ يُفصَلُ عن اللوحِ
--
-- اللوحُ يُفتَحُ لِيُعرَفَ الحالُ: ما خطّتي وما تاريخُ تجديدي وهل أنا في تجربةٍ.
-- والتاريخُ يُطَلَبُ عندَ التوسيعِ. وجمعُهما يجعلُ كلَّ فتحةٍ تقرأُ عشرينَ
-- دفعةً لا يراها أحدٌ، ويجعلُ سقفَ الصفحةِ حقلاً في طلبِ اللوحِ بلا معنًى.
--
-- ## وما لا تفعلُه هذه الهجرةُ عن قصدٍ — (`ح-5`)
--
--   ــ **لا تُفعِّلُ اشتراكاً**: التفعيلُ `activate_subscription` القائمُ،
--      وهذه الدوالُ **تقرأُ**.
--   ــ **لا تُخزِّنُ مُجمَّعاً**: لا عمودَ عدَّادٍ — التاريخُ يُحسَبُ عندَ
--      القراءةِ من `payment_transactions`.
--   ــ **لا تُحدِّدُ مزوّدَ دفعٍ**: `renew` مسارٌ يُبدأُ الدفعَ عبرَ منفذٍ،
--      ومزوّدُ الدفعِ تهيئةٌ لا قرارُ قاعدةٍ.
--   ــ **لا تقرأُ هويّةَ راكبٍ**: لا حقلَ ههنا ولا في التاريخِ.
-- =============================================================================

-- ── ١) لوحُ الاشتراكِ: الحالُ والخطةُ والسعرُ والتجربةُ والتحذيرُ ──────────────
--
-- كلُّ سعرٍ يُقرأُ من `platform_settings` بـ`get_setting_number` — لا ثابتٍ.
-- والسعرُ **لقطةٌ من الإعداداتِ الآنَ** لا `price_amount` المخزونِ في صفِّ
-- الاشتراكِ: ذاك تاريخيٌّ يُفيدُ التدقيقَ، والسائقُ يرى ما سيدفعُه اليومَ.
-- و`trial_days` و`subscription_period_days` من الإعداداتِ كذلكَ.
--
-- والتحذيرُ قبلَ الانتهاءِ إعدادٌ: `subscription_expiry_warning_days` —
-- يُبذَرُ هنا بقيمةٍ افتراضيّةٍ ويسبقُ `current_period_end` بقدرِها.
insert into platform_settings (city_id, key, value, value_type, description_ar)
select c.id, 'subscription_expiry_warning_days', to_jsonb(7::integer), 'number',
       'أيامُ التحذيرِ قبلَ انتهاءِ الاشتراكِ — يُعرضُ التنبيهُ ضمنَها'
  from cities c
on conflict (city_id, key) do nothing;

create or replace function driver_subscription_dashboard(p_telegram_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user users%rowtype;
  v_driver drivers%rowtype;
  v_sub subscriptions%rowtype;
  v_plan_key text;
  v_price numeric;
  v_currency text;
  v_trial_days numeric;
  v_period_days numeric;
  v_warning_days integer;
  v_now timestamptz := now();
  v_ends_at timestamptz;
  v_days_left integer;
  v_expires_soon boolean := false;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  -- الاشتراكُ الحيُّ: تجربةٌ أو فعّالٌ. ولا نقرأُ المنتهيَ ولا الملغىَ هنا —
  -- لوحُ الاشتراكِ يُعرَفُ عن الحالِ الساريةِ، والتاريخُ يُفصَلُ.
  select * into v_sub
    from subscriptions
   where driver_id = v_driver.id
     and status in ('trialing', 'active')
   order by created_at desc
   limit 1;

  -- الإعداداتُ كلُّها من القاعدةِ — لا ثابتٍ ولا افتراضٍ صامتٍ.
  v_trial_days := get_setting_number(v_driver.city_id, 'trial_days');
  v_period_days := get_setting_number(v_driver.city_id, 'subscription_period_days');
  v_currency := get_setting(v_driver.city_id, 'currency') #>> '{}';

  select coalesce(
    get_setting_number(v_driver.city_id, 'subscription_expiry_warning_days')::integer, 7)
    into v_warning_days;

  if not found or v_sub.id is null then
    -- سائقٌ بلا اشتراكٍ سارٍ: يُعادُ الحالُ معَ الأسعارِ ليختارَ إن أراد.
    -- لا يُخترَعُ «منتهٍ» ولا «ملغًى» — الاشتراكُ غائبٌ فالجوابُ غائبٌ.
    return jsonb_build_object(
      'ok', true,
      'server_time', v_now,
      'has_subscription', false,
      'plan_prices', jsonb_build_object(
        'transport', get_setting_number(v_driver.city_id, 'subscription_price_transport'),
        'delivery', get_setting_number(v_driver.city_id, 'subscription_price_delivery'),
        'both', get_setting_number(v_driver.city_id, 'subscription_price_both')
      ),
      'currency', v_currency,
      'trial_days', v_trial_days::integer,
      'period_days', v_period_days::integer
    );
  end if;

  -- السعرُ الحاليُّ للخطةِ من الإعداداتِ — لا `price_amount` المخزونِ.
  v_plan_key := 'subscription_price_' || v_sub.plan::text;
  v_price := get_setting_number(v_driver.city_id, v_plan_key);

  -- تاريخُ الانتهاءِ: التجربةُ تنتهي بـ`trial_ends_at`، والفعّالُ بـ`current_period_end`.
  v_ends_at := case when v_sub.status = 'trialing'
                    then v_sub.trial_ends_at
                    else v_sub.current_period_end
               end;

  if v_ends_at is not null then
    v_days_left := floor(extract(epoch from (v_ends_at - v_now)) / 86400)::integer;
    v_expires_soon := v_days_left between 0 and v_warning_days;
  end if;

  return jsonb_build_object(
    'ok', true,
    'server_time', v_now,
    'has_subscription', true,
    'subscription_id', v_sub.id,
    'plan', v_sub.plan,
    'status', v_sub.status,
    'is_trial', v_sub.status = 'trialing',
    'price', v_price,
    'currency', v_currency,
    'trial_ends_at', v_sub.trial_ends_at,
    'current_period_end', v_sub.current_period_end,
    'ends_at', v_ends_at,
    'days_left', v_days_left,
    'expires_soon', v_expires_soon,
    'cancel_at_period_end', v_sub.cancel_at_period_end,
    'cancellation_requested_at', v_sub.cancellation_requested_at,
    'trial_days', v_trial_days::integer,
    'period_days', v_period_days::integer,
    'warning_days', v_warning_days
  );
end;
$fn$;

comment on function driver_subscription_dashboard(bigint) is
  'لوحُ اشتراكِ السائقِ: الخطةُ والسعرُ من platform_settings، وتاريخُ التجربةِ والانتهاءِ، والأيّامُ الباقيةُ والتحذيرُ، وحالُ الإلغاءِ. لا تُفعِّلُ ولا تُلغي — قراءةٌ محضةٌ (SD-07 · F3-06).';

revoke all on function driver_subscription_dashboard(bigint) from public;
revoke all on function driver_subscription_dashboard(bigint) from anon;
revoke all on function driver_subscription_dashboard(bigint) from authenticated;
grant execute on function driver_subscription_dashboard(bigint) to service_role;

-- ── ٢) تاريخُ الدفعِ: من payment_transactions لا من عدَّادٍ ────────────────────
--
-- `payment_transactions` سجلُ الدفعاتِ الفعليِّ: كلُّ صفٍّ معاملةٌ لها حالةٌ
-- ومبلغٌ وزمنٌ. ولا يُجمَّعُ هنا — القائمةُ تُقرأُ عندَ الطلبِ بسقفٍ خادميٍّ.
-- ولا يُقرأُ `ledger_entries` لأنَّ المعاملةَ هي الحقيقةُ الماليّةُ، والدفترُ
-- مشتقٌّ منها.
create or replace function driver_subscription_history(
  p_telegram_id bigint,
  p_limit int default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user users%rowtype;
  v_driver drivers%rowtype;
  v_limit int;
  v_entries jsonb;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  -- سقفُ الصفحةِ مقصورٌ في الخادمِ: طلبٌ بلا سقفٍ يُقرأُ عشرينَ.
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  select coalesce(jsonb_agg(e.entry order by e.created_at desc), '[]'::jsonb)
    into v_entries
    from (
      select pt.id,
             pt.created_at,
             jsonb_build_object(
               'transaction_id', pt.id,
               'amount_minor', pt.amount_minor,
               'currency', pt.currency,
               'provider', pt.provider,
               'status', pt.status,
               'created_at', pt.created_at,
               'updated_at', pt.updated_at,
               'plan', pt.metadata #>> '{plan}',
               'checkout_url', pt.metadata #>> '{checkout_url}'
             ) as entry
        from payment_transactions pt
       where pt.payer_driver_id = v_driver.id
         and pt.purpose = 'driver_subscription'
       order by pt.created_at desc
       limit v_limit
    ) e;

  return jsonb_build_object(
    'ok', true,
    'server_time', now(),
    'limit', v_limit,
    'entries', v_entries
  );
end;
$fn$;

comment on function driver_subscription_history(bigint, int) is
  'تاريخُ دفعاتِ اشتراكِ السائقِ: معاملةٌ بمعرّفٍ ومبلغٍ وحالةٍ وزمنٍ. السقفُ مقصورٌ في الخادمِ، ولا هويّةَ راكبٍ (SD-07 · F3-06).';

revoke all on function driver_subscription_history(bigint, int) from public;
revoke all on function driver_subscription_history(bigint, int) from anon;
revoke all on function driver_subscription_history(bigint, int) from authenticated;
grant execute on function driver_subscription_history(bigint, int) to service_role;
