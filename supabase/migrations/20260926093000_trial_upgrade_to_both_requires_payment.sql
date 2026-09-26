-- migration-phase: contract
-- ───────────────────────────────────────────────────────────────────────────
-- ترقية «both» داخل التجربة المجانية تتطلب دفعاً
--
-- القرار: التجربة المجانية تغطّي خدمة واحدة. إضافة الخدمة الثانية ليست
-- مجّانية: السائق يدفع قيمة الخدمة الواحدة (الفرق بين سعر «both» وسعر خطّته
-- الحالية). لا يُفعَّل «both» بلا دفع.
--
-- سبب التغيير: الدالة كانت تُعيد payment_required = false داخل التجربة
-- المجانية بلا فرق مستحقّ، فكانت الترقية إلى «both» مجّانية بالكامل.
-- المنطق الصحيح: خدمة واحدة مجانية، والثانية مدفوعة.
--
-- لا يُمسُّ مسار الدورة المدفوعة: `v_sub.status = 'active'` يبقى كما هو
-- (الفرق بين سعرَي الخطّتين). والتغيير هنا على فرع `trialing` وحده.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function plan_upgrade_quote(
  p_driver_id uuid,
  p_new_plan subscription_plan
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub subscriptions%rowtype;
  v_current_price numeric;
  v_new_price numeric;
  v_currency text;
begin
  select * into v_sub
    from subscriptions
   where driver_id = p_driver_id
     and status in ('trialing', 'active');

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_LIVE_SUBSCRIPTION');
  end if;

  if v_sub.plan = p_new_plan then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_ON_PLAN');
  end if;

  -- الترقية معناها اكتساب خدمة لا مبادلتها: من خطّة مفردة إلى «الاثنين».
  -- الانتقال من «نقل» إلى «توصيل» تغييرٌ جانبيّ لا ترقية، ويحتاج سياسة
  -- تجارية مستقلّة (هل يُدفع فرق؟ هل تُلغى القدرة القديمة؟) — لا تُخترع هنا.
  if p_new_plan <> 'both' then
    return jsonb_build_object('ok', false, 'error', 'PLAN_NOT_AN_UPGRADE',
      'current_plan', v_sub.plan, 'requested_plan', p_new_plan);
  end if;

  v_current_price := get_setting_number(v_sub.city_id,
                       'subscription_price_' || v_sub.plan::text);
  v_new_price := get_setting_number(v_sub.city_id,
                   'subscription_price_' || p_new_plan::text);
  v_currency := get_setting(v_sub.city_id, 'currency') #>> '{}';

  -- في التجربة المجانية: خدمة واحدة مجانية، والثانية مدفوعة.
  -- الفرق بين سعر «both» وسعر الخطّة الحالية هو قيمة الخدمة الثانية.
  -- هذا ليس دفعاً لما لم يُدفَع (الدورة لم تُدفَع)، بل دفعٌ لإضافة خدمة
  -- جديدة فوق المجانية الواحدة. والدفع يبدأ دورة مدفوعة كاملة لـ«both».
  if v_sub.status = 'trialing' then
    if v_new_price <= v_current_price then
      return jsonb_build_object('ok', false, 'error', 'UPGRADE_PRICE_NOT_HIGHER',
        'current_price', v_current_price, 'new_price', v_new_price);
    end if;

    return jsonb_build_object('ok', true,
      'subscription_id', v_sub.id,
      'city_id', v_sub.city_id,
      'current_plan', v_sub.plan,
      'new_plan', p_new_plan,
      'current_price', v_current_price,
      'new_price', v_new_price,
      'amount_due', v_new_price - v_current_price,
      'payment_required', true,
      'currency', v_currency,
      'period_end', v_sub.trial_ends_at,
      'status', v_sub.status);
  end if;

  if v_new_price <= v_current_price then
    -- إعدادٌ يجعل «الاثنين» أرخص من المفردة ليس خطأً برمجياً بل تهيئةً
    -- متناقضة. تُرفض صراحةً بدل أن تُنتج معاملة بمبلغ صفريّ أو سالب.
    return jsonb_build_object('ok', false, 'error', 'UPGRADE_PRICE_NOT_HIGHER',
      'current_price', v_current_price, 'new_price', v_new_price);
  end if;

  return jsonb_build_object('ok', true,
    'subscription_id', v_sub.id,
    'city_id', v_sub.city_id,
    'current_plan', v_sub.plan,
    'new_plan', p_new_plan,
    'current_price', v_current_price,
    'new_price', v_new_price,
    'amount_due', v_new_price - v_current_price,
    'payment_required', true,
    'currency', v_currency,
    'period_end', v_sub.current_period_end,
    'status', v_sub.status);
end;
$$;
