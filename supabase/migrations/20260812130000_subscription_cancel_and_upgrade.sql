-- ═══════════════════════════════════════════════════════════════════════════
-- الغرض: إغلاق الفجوة الصامتة الوحيدة التي كشفها الجرد الجنائي (البوابة B):
--   `packages/application/subscription/cancel-subscription.ts` و`upgrade-plan.ts`
--   يُعلنان في ترويستهما تفعيلاً كاملاً في الأمر الثاني، ولا أثر لهما في القاعدة
--   ولا في الواجهات. النتيجة العمليّة: السائق المشترك في «نقل فقط» لا يملك مساراً
--   للترقية إلى «الاثنين»، ولا مساراً لإلغاء اشتراكه بنفسه. قرار المالك: تُنجزان
--   فعلاً، لا تُصنَّفان خارج النطاق.
--
-- ثلاثة تغييرات، كلٌّ منها له سببه:
--
--   ١) `subscription_period_days`: مفتاح إعداد جديد. `confirm_payment` كانت تحسب
--      مدّة الاشتراك المدفوع من `trial_days` — خللٌ دلاليّ قائم: مدّة التجربة
--      المجّانية ومدّة الدورة المدفوعة قيمتان تجاريّتان مستقلّتان تتصادفان الآن
--      على ٣٠ يوماً. لو غيّر المالك مدّة التجربة غداً لتغيّرت مدّة ما يُدفَع مقابله
--      صامتةً. القيمة الابتدائية ٣٠ بالضبط كي لا يتغيّر أي سلوك بهذه الهجرة.
--
--   ٢) الإلغاء = «لا تُجدَّد»، لا قطعٌ فوري. لا توجد في هذا الأمر أي بنية استرداد
--      (المحافظ والفواتير والاسترداد مؤجَّلة صراحةً في MASTER_DIRECTIVE:95)، فقطع
--      الخدمة فوراً عن سائقٍ دفع دورته كاملةً سلبٌ لما دفع ثمنه بلا وسيلة ردّ.
--      لذلك يُرفع علم `cancel_at_period_end` وتبقى الخدمة إلى نهاية الدورة، ثم
--      تُغلق بحالة `cancelled` لا `expired` كي يبقى الفرق بين «انتهى» و«أُلغي»
--      مقروءاً في البيانات.
--
--   ٣) الترقية تغييرٌ في المكان لا اشتراكٌ جديد: الدورة المدفوعة تبقى كما هي
--      (`current_period_end` لا يُمَسّ) وتتغيّر الخطّة وسعرها المرجعي. لو أُنشئ
--      اشتراك جديد لضاعت بقيّة الدورة المدفوعة أو لامتدّت مجّاناً — وكلاهما
--      قرارٌ ماليّ لم يتّخذه أحد.
--
-- ملاحظة نطاق صريحة: التقسيط الزمنيّ (proration) غير مُنفَّذ. الفرق المستحقّ
--   هو فرق سعري الخطّتين كاملاً بلا نسبةٍ للأيام المتبقية. هذه سياسة تجارية
--   تحتاج قرار المالك، ولم تُخترع هنا: الفرق يُحسب من `platform_settings` وحدها،
--   وإن أراد المالك تقسيطاً أُضيف مفتاح إعداد له وقتها.
--
-- الحالة: منفّذ فعلياً — الأمر الثاني، وفق قرار المالك المؤرّخ 2026-08-12.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- ١) مدّة الدورة المدفوعة: مفتاح مستقلّ عن مدّة التجربة
-- ───────────────────────────────────────────────────────────────────────────
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id,
       'subscription_period_days',
       to_jsonb(30),
       'number',
       'عدد أيام الدورة المدفوعة للاشتراك. مستقلّ عن trial_days: التجربة المجّانية والدورة المدفوعة قيمتان تجاريّتان منفصلتان.',
       false
  from cities c
 where not exists (
   select 1 from platform_settings s
    where s.city_id = c.id and s.key = 'subscription_period_days'
 );

-- ───────────────────────────────────────────────────────────────────────────
-- ٢) أعمدة الإلغاء على subscriptions
-- ───────────────────────────────────────────────────────────────────────────
alter table subscriptions add column if not exists cancel_at_period_end boolean not null default false;
alter table subscriptions add column if not exists cancellation_requested_at timestamptz;
alter table subscriptions add column if not exists cancellation_reason text;

-- الحالة والعلم يجب أن يتّسقا: علمٌ مرفوع بلا وقت طلب يعني سجلّاً لا يُعرف متى
-- طُلب فيه الإلغاء، وهو ما يُسأل عنه أول ما يُنازع السائق في فاتورته.
alter table subscriptions drop constraint if exists subscriptions_cancellation_coherent;
alter table subscriptions add constraint subscriptions_cancellation_coherent
  check (cancel_at_period_end = false or cancellation_requested_at is not null);

create index if not exists subscriptions_cancel_pending_idx
  on subscriptions (city_id, current_period_end)
  where cancel_at_period_end = true and status in ('trialing', 'active');

-- ──────────────────────────────────────────────────────────────
-- ٢م) تناسق `platform_settings.value_type` مع النوع الفعلي للقيمة
--
-- هذا القيد ليس تجميلاً نظريّاً: وُجد فعلاً في قاعدتي العمل صفّان بـ
--   value_type='number' وقيمتهما jsonb من نوع `string` (مثل `"0"`)، منشأهما
--   تمرير `${text}::jsonb` من سائق postgres.js فيُلفّف النصّ ثانيةً
--   (tests/integration/driver-location-freshness.test.ts وscripts/race-support-ticket.ts
--   — أُصلحا مع هذه الهجرة).
--
-- خطورته أنّ `get_setting_number` تقرأ `(v #>> '{}')::numeric` فتتجاوز طبقةً واحدة
--   من التلفيف بلا شكوى، فيبقى الخلل صامتاً حتّى تتراكم طبقةٌ ثانية فينفجر
--   بـinvalid input syntax for type numeric في وجه أوّل سائق يبدأ تجربته المجّانية
--   (وقع فعلاً في تشغيل محليّ: start_trial → get_setting_number → 22P02).
--
-- ترتيب مقصود: يُصحّح الموجود أوّلاً ثمّ يُفرض القيد، لأنّ الهجرة تُطبّق
--   على قواعد قائمة فيها هذا التلوّث. والتصحيح ليس حذفاً: يُجرّد التلفيف
--   ويُبقي القيمة نفسها (`"0"` → `0`)، وما لا يقبل التجريد يُبلّغ عنه ويُوقف الهجرة.
do $$
declare v_bad integer;
begin
  -- ١) تجريد التلفيف عن الأرقام المخزّنة نصّاً (القيمة تُحفظ كما هي).
  update platform_settings
     set value = to_jsonb((value #>> '{}')::numeric),
         updated_at = now()
   where value_type = 'number'
     and jsonb_typeof(value) = 'string'
     and (value #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$';

  update platform_settings
     set value = to_jsonb((value #>> '{}')::boolean),
         updated_at = now()
   where value_type = 'boolean'
     and jsonb_typeof(value) = 'string'
     and (value #>> '{}') in ('true', 'false');

  -- ٢) ما بقي مختلّاً لا يُخمّن ولا يُحذف: تُوقف الهجرة ليقرّر المالك.
  select count(*) into v_bad from platform_settings
   where jsonb_typeof(value) <> value_type;
  if v_bad > 0 then
    raise exception
      'PLATFORM_SETTINGS_TYPE_MISMATCH: % صفّاً لا يوافق value_type نوعَ قيمته، ولا يُخمّن لها تصحيح', v_bad;
  end if;
end $$;

alter table platform_settings drop constraint if exists platform_settings_value_type_coherent;
alter table platform_settings add constraint platform_settings_value_type_coherent
  check (jsonb_typeof(value) = value_type);

-- ───────────────────────────────────────────────────────────────────────────
-- ٣) إلغاء الاشتراك — ذرّي، مقفل على صفّ الاشتراك
-- ───────────────────────────────────────────────────────────────────────────
create or replace function cancel_subscription(
  p_driver_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_sub subscriptions%rowtype;
  v_ends timestamptz;
begin
  select * into v_driver from drivers where id = p_driver_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  -- القفل على صفّ الاشتراك الحيّ نفسه: طلبا إلغاء متزامنان لا يكتب أحدهما فوق
  -- الآخر، ولا يُسجَّل سببان لطلبٍ واحد. لا منطق تزامن في طبقة التطبيق.
  select * into v_sub
    from subscriptions
   where driver_id = p_driver_id
     and status in ('trialing', 'active')
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_LIVE_SUBSCRIPTION');
  end if;

  v_ends := case when v_sub.status = 'trialing'
                 then v_sub.trial_ends_at
                 else v_sub.current_period_end
            end;

  -- الإيدمبوتنسي: الطلب المكرَّر لا يُخطئ ولا يُعيد كتابة السبب الأول.
  if v_sub.cancel_at_period_end then
    return jsonb_build_object('ok', true, 'subscription_id', v_sub.id,
      'already_cancelled', true, 'status', v_sub.status,
      'service_until', v_ends,
      'cancellation_requested_at', v_sub.cancellation_requested_at);
  end if;

  update subscriptions
     set cancel_at_period_end = true,
         cancellation_requested_at = now(),
         cancellation_reason = p_reason,
         updated_at = now()
   where id = v_sub.id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_sub.city_id, v_driver.user_id, 'subscription.cancellation_requested',
          'subscription', v_sub.id,
          jsonb_build_object('plan', v_sub.plan, 'status', v_sub.status,
                             'service_until', v_ends, 'reason', p_reason));

  return jsonb_build_object('ok', true, 'subscription_id', v_sub.id,
    'already_cancelled', false, 'status', v_sub.status,
    'service_until', v_ends,
    'cancellation_requested_at', now());
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- ٤) استئناف اشتراك أُلغي قبل انتهاء دورته — لا يُترك السائق في طريق أحاديّ
-- ───────────────────────────────────────────────────────────────────────────
create or replace function resume_subscription(p_driver_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_sub subscriptions%rowtype;
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

  if not v_sub.cancel_at_period_end then
    return jsonb_build_object('ok', true, 'subscription_id', v_sub.id,
      'already_active', true, 'status', v_sub.status);
  end if;

  update subscriptions
     set cancel_at_period_end = false,
         cancellation_requested_at = null,
         cancellation_reason = null,
         updated_at = now()
   where id = v_sub.id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_sub.city_id, v_driver.user_id, 'subscription.cancellation_revoked',
          'subscription', v_sub.id,
          jsonb_build_object('plan', v_sub.plan, 'status', v_sub.status));

  return jsonb_build_object('ok', true, 'subscription_id', v_sub.id,
    'already_active', false, 'status', v_sub.status);
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- ٥) الفرق المستحقّ للترقية — يُقرأ من الإعدادات، ولا يُحسب في التطبيق
-- ───────────────────────────────────────────────────────────────────────────
-- سبب وجودها دالّةً مستقلّة: طبقة التطبيق تحتاج المبلغ قبل إنشاء المعاملة،
-- ويجب أن يكون المبلغ الذي تُنشئ به المعاملة هو نفسه الذي تتحقّق منه الترقية.
-- مصدرٌ واحد للحساب يمنع اختلاف الرقمين عند تغيير الأسعار بين الخطوتين.
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

  -- في التجربة المجّانية لا شيء مدفوع، فلا فرق مستحقّ. الاختبار الفعليّ لأول
  -- نسخة من هذه الدالّة أظهر سائقاً في تجربة مجّانية يُطالَب بـ١٥٠ ريالاً
  -- ليرقّي فترةً لم يدفع فيها شيئاً — وهو ما كان سيُطبَّق على الإنتاج.
  -- وليست هذه ثغرة استغلال: `start_trial` تسمح ببدء التجربة على «الاثنين»
  -- ابتداءً، فتغيير الخطّة داخل التجربة لا يمنح السائق أكثر ممّا كان يملكه.
  if v_sub.status = 'trialing' then
    return jsonb_build_object('ok', true,
      'subscription_id', v_sub.id,
      'city_id', v_sub.city_id,
      'current_plan', v_sub.plan,
      'new_plan', p_new_plan,
      'current_price', v_current_price,
      'new_price', v_new_price,
      'amount_due', 0,
      'payment_required', false,
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

-- ───────────────────────────────────────────────────────────────────────────
-- ٦) تنفيذ الترقية — ذرّي، بعد تأكيد الدفع
-- ───────────────────────────────────────────────────────────────────────────
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
  -- قائمة أصلاً، فيُعاد نجاحٌ صريح موسومٌ بأنه لم يُغيّر شيئاً.
  if v_sub.plan = p_new_plan then
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

-- ───────────────────────────────────────────────────────────────────────────
-- ٧) confirm_payment: مدّة الدورة من مفتاحها الصحيح، والترقية تسلك مسارها
-- ───────────────────────────────────────────────────────────────────────────
create or replace function confirm_payment(
  p_transaction_id uuid,
  p_provider_transaction_id text,
  p_new_status text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx payment_transactions%rowtype;
  v_plan subscription_plan;
  v_sub_id uuid;
  v_period_end timestamptz;
  v_days integer;
  v_is_upgrade boolean;
  v_upgrade jsonb;
begin
  select * into v_tx from payment_transactions where id = p_transaction_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'TRANSACTION_NOT_FOUND');
  end if;

  -- لا تؤكَّد معاملة منتهية: active/failed/canceled/expired نهائية.
  if v_tx.status not in ('pending', 'past_due') then
    return jsonb_build_object('ok', true, 'transaction_id', v_tx.id,
      'status', v_tx.status, 'already_confirmed', true);
  end if;

  -- التحقّق قبل أي كتابة: خطّةٌ مجهولة تُرفض ولا تُفترض.
  -- النسخة السابقة كانت `coalesce(v_tx.metadata->>'plan', 'both')`، وذلك
  -- الافتراض حوّل خللاً في التسلسل (metadata مخزَّن نصّاً لا كائناً) إلى خسارة
  -- مالية صامتة: من دفع ٢٥٠ لخطّة «نقل» فُعّلت له خطّة «الاثنين» بـ٤٠٠.
  -- الأغلى ليس افتراضاً آمناً، ولا الأرخص. المجهول يُرفض صريحاً.
  if p_new_status = 'active' then
    if jsonb_typeof(v_tx.metadata) <> 'object' then
      return jsonb_build_object('ok', false, 'error', 'TRANSACTION_METADATA_NOT_OBJECT',
        'metadata_type', jsonb_typeof(v_tx.metadata));
    end if;
    if v_tx.metadata->>'plan' is null then
      return jsonb_build_object('ok', false, 'error', 'TRANSACTION_METADATA_MISSING_PLAN');
    end if;
    if not exists (
      select 1 from unnest(enum_range(null::subscription_plan)) e
       where e::text = v_tx.metadata->>'plan'
    ) then
      return jsonb_build_object('ok', false, 'error', 'TRANSACTION_METADATA_UNKNOWN_PLAN',
        'plan', v_tx.metadata->>'plan');
    end if;
  end if;

  update payment_transactions
     set status = p_new_status,
         provider_transaction_id = coalesce(p_provider_transaction_id, provider_transaction_id),
         updated_at = now()
   where id = p_transaction_id;

  if p_new_status = 'active' then
    v_plan := (v_tx.metadata->>'plan')::subscription_plan;
    v_is_upgrade := coalesce((v_tx.metadata->>'upgrade')::boolean, false);

    if v_is_upgrade then
      -- الترقية لا تُنشئ اشتراكاً جديداً ولا تُمدّد الدورة: تُغيّر الخطّة في
      -- مكانها. لذلك لا تُستدعى activate_subscription هنا.
      v_upgrade := upgrade_plan(v_tx.payer_driver_id, v_plan, v_tx.id);
      if not (v_upgrade->>'ok')::boolean then
        -- الدفع تمّ والترقية تعذّرت: يُرفع الخطأ ليُلفّ كل شيء في تراجع واحد.
        -- بديله الوحيد أن يُخصم من السائق بلا ترقية — وذلك أسوأ من الفشل الصريح.
        raise exception 'UPGRADE_FAILED_AFTER_PAYMENT: %', v_upgrade->>'error'
          using errcode = 'raise_exception';
      end if;
      v_sub_id := (v_upgrade->>'subscription_id')::uuid;
      v_period_end := (v_upgrade->>'period_end')::timestamptz;
    else
      -- مدّة الدورة المدفوعة من مفتاحها المستقلّ، لا من trial_days.
      v_days := get_setting_number(v_tx.city_id, 'subscription_period_days')::int;
      v_period_end := now() + make_interval(days => v_days);

      perform activate_subscription(v_tx.payer_driver_id, v_plan, v_days);

      select id into v_sub_id from subscriptions
       where driver_id = v_tx.payer_driver_id and status = 'active'
       order by created_at desc limit 1;
    end if;

    insert into ledger_entries
      (city_id, transaction_id, driver_id, entry_type, amount_minor, currency)
    values
      (v_tx.city_id, v_tx.id, v_tx.payer_driver_id, 'credit', v_tx.amount_minor, v_tx.currency);

    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    select v_tx.city_id, d.user_id,
           case when v_is_upgrade then 'subscription.upgraded_via_payment'
                else 'subscription.activated_via_payment' end,
           'subscription', v_sub_id,
           jsonb_build_object('transaction_id', v_tx.id, 'plan', v_plan,
                              'amount_minor', v_tx.amount_minor, 'currency', v_tx.currency,
                              'period_end', v_period_end)
      from drivers d where d.id = v_tx.payer_driver_id;
  end if;

  return jsonb_build_object('ok', true, 'transaction_id', v_tx.id,
    'status', p_new_status, 'subscription_id', v_sub_id, 'already_confirmed', false);
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- ٨) expire_due_subscriptions: يميّز المُلغى عن المنتهي
-- ───────────────────────────────────────────────────────────────────────────
create or replace function expire_due_subscriptions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired integer;
  v_cancelled integer;
begin
  with due as (
    select s.id, s.city_id, s.driver_id, s.status, s.plan, s.cancel_at_period_end,
           case when s.status = 'trialing' then s.trial_ends_at else s.current_period_end end as ends_at
      from subscriptions s
     where s.status in ('trialing', 'active')
  ),
  ripe as (
    select * from due where ends_at is not null and ends_at <= now()
  ),
  updated as (
    update subscriptions s
       -- المُلغى يُغلق بحالته: «أُلغي» و«انتهى» واقعتان مختلفتان، وخلطهما
       -- يُفقد القدرة على قياس معدّل الإلغاء أصلاً.
       set status = case when r.cancel_at_period_end then 'cancelled'::subscription_status
                         else 'expired'::subscription_status end
      from ripe r
     where s.id = r.id
    returning s.id, s.city_id, s.driver_id, r.status as previous_status, r.plan,
              r.ends_at, r.cancel_at_period_end, s.status as new_status
  ),
  logged as (
    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    select u.city_id, null,
           case when u.cancel_at_period_end then 'subscription.cancelled'
                else 'subscription.expired' end,
           'subscription', u.id,
           jsonb_build_object(
             'driver_id', u.driver_id,
             'previous_status', u.previous_status,
             'plan', u.plan,
             'ends_at', u.ends_at,
             'cancelled_by_request', u.cancel_at_period_end
           )
      from updated u
    returning (payload->>'cancelled_by_request')::boolean as was_cancelled
  )
  select count(*) filter (where not was_cancelled),
         count(*) filter (where was_cancelled)
    into v_expired, v_cancelled
    from logged;

  return jsonb_build_object('ok', true,
    'expired_subscriptions', v_expired,
    'cancelled_subscriptions', v_cancelled);
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- ٩) سطح الصلاحيات: هجرة الختم 20260812000000 تسبق هذه الهجرة، فكل دالّة
--    أُنشئت أو استُبدلت أعلاه تعود مفتوحة لـPUBLIC تلقائياً. تُسحب صراحةً.
--    اختبار tests/integration/database-privilege-surface.test.ts يحرس هذا.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'cancel_subscription(uuid, text)',
    'resume_subscription(uuid)',
    'plan_upgrade_quote(uuid, subscription_plan)',
    'upgrade_plan(uuid, subscription_plan, uuid)',
    'confirm_payment(uuid, text, text)',
    'expire_due_subscriptions()'
  ] loop
    execute format('revoke all on function %s from public', v_sig);
    execute format('revoke all on function %s from anon, authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end $$;
