-- =====================================================================================
-- المرحلة 2.6 — الخطوة 02: أساس القاعدة لمشغّل الجوبات المركزي
--
-- المشكلة التي تحلّها: ثلاث حقائق تتعفّن بمرور الوقت بلا أن يمسّها أحد.
--   1) اشتراك انتهى أمسه وحالته لا تزال 'active' — فالسائق يتلقّى عروضاً لم يدفع
--      مقابلها، والإيراد في لوحة الإدارة يعدّه مشتركاً قائماً. لا شيء في النظام
--      يغيّر هذا الصفّ إلّا مهمّة دورية.
--   2) اشتراك ينتهي بعد يومين ولا يعلم صاحبه — فيصبح غير مشترك على غير توقّع.
--      التحذير المسبَق ليس ترفاً: من فوجئ بانقطاع رزقه لن يعود.
--   3) سائق أعلن توفّره ثم أغلق الهاتف — يبقى 'is_available = true' إلى الأبد،
--      فتُهدر عليه عروضٌ لا يراها، وكل عرض مهدور تأخيرٌ لعميل ينتظر في الشارع.
--
-- ما تضيفه:
--   1) إعدادان جديدان في platform_settings (لا قيمة تجارية في الكود)
--   2) expire_due_subscriptions — إنهاء ذرّي للمنتهية مع سجلّ تدقيق لكل صفّ
--   3) subscriptions_expiring_soon — قائمة من يستحقّ تحذيراً، وقد استُثني المحذَّر
--   4) record_subscription_warning — تثبيت أن التحذير أُرسل، فلا يتكرّر كل دقيقة
--   5) deactivate_stale_availability — إطفاء التوفّر البائت
--
-- ما لا تضيفه عمداً: جدول «تحذيرات مُرسَلة». الفكرة الأولى كانت جدولاً جديداً،
-- ثم ظهر أن audit_log يحمل المعلومة نفسها: صفٌّ بـ action = 'subscription.expiry_warned'
-- وفي حمولته تاريخ الانتهاء. جدولٌ ثانٍ للحقيقة نفسها يعني موضعين قد يختلفان.
-- =====================================================================================

-- 1) الإعدادات ------------------------------------------------------------------------
-- كل عمود من الستّة مطلوب، والإدراج لكل مدينة على حدة: قد تريد مدينة تحذيراً قبل
-- يومين ومدينة أخرى قبل خمسة، ومن حقّها ذلك بلا نشر كود.
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, 'subscription_expiry_warning_days', '2'::jsonb, 'number',
       'كم يوماً قبل انتهاء الاشتراك يُرسَل التحذير للسائق', false
  from cities c
on conflict (city_id, key) do nothing;

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, 'availability_stale_minutes', '180'::jsonb, 'number',
       'بعد كم دقيقة بلا تغيير يُعتبر إعلان التوفّر بائتاً فيُطفأ', true
  from cities c
on conflict (city_id, key) do nothing;

-- اللغات المدعومة صارت ثلاثاً فعلاً بعد الخطوة 01 من هذه المرحلة، والإعداد كان
-- لا يزال يقول ["ar"]. إعدادٌ يكذب على القاعدة أسوأ من إعداد غائب.
update platform_settings
   set value = '["ar", "en", "ur"]'::jsonb
 where key = 'supported_languages' and value = '["ar"]'::jsonb;

-- 2) إنهاء الاشتراكات المستحقّة -------------------------------------------------------
-- التاريخ الحاكم يختلف بحسب الحالة: التجريبي ينتهي بـ trial_ends_at والمدفوع
-- بـ current_period_end. خلطهما في عمود واحد كان سيجعل تمديد التجربة يمسّ المدفوع.
--
-- لا تلمس هذه الدالّة اشتراكاً بلا تاريخ انتهاء: صفٌّ كهذا خطأ بيانات يجب أن
-- يُرى في لوحة الإدارة، لا أن تُخفيه مهمّة دورية بإنهائه صامتة.
create or replace function expire_due_subscriptions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired integer;
begin
  with due as (
    select s.id, s.city_id, s.driver_id, s.status, s.plan,
           case when s.status = 'trialing' then s.trial_ends_at else s.current_period_end end as ends_at
      from subscriptions s
     where s.status in ('trialing', 'active')
  ),
  ripe as (
    select * from due where ends_at is not null and ends_at <= now()
  ),
  updated as (
    update subscriptions s
       set status = 'expired'
      from ripe r
     where s.id = r.id
    returning s.id, s.city_id, s.driver_id, r.status as previous_status, r.plan, r.ends_at
  ),
  logged as (
    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    select u.city_id, null, 'subscription.expired', 'subscription', u.id,
           jsonb_build_object(
             'driver_id', u.driver_id,
             'previous_status', u.previous_status,
             'plan', u.plan,
             'ends_at', u.ends_at
           )
      from updated u
    returning 1
  )
  select count(*) into v_expired from logged;

  return jsonb_build_object('ok', true, 'expired_subscriptions', v_expired);
end;
$$;

-- 3) من يستحقّ تحذيراً ----------------------------------------------------------------
-- تُعيد ما يكفي لإرسال الرسالة في نداء واحد: معرّف تيليجرام ولغة السائق وأيام
-- المتبقّي. بدونهما كان المشغّل سيستعلم لكل سائق على حدة — نداءٌ لكل صفّ.
--
-- الاستثناء بـ not exists لا بعمود «warned_at»: العمود يجعل تمديد الاشتراك يحتاج
-- تصفيره يدوياً وإلّا حُرم صاحبه من تحذير الدورة القادمة. والحمولة تحمل ends_at
-- فيصير الاستثناء لدورة بعينها لا للاشتراك كلّه.
create or replace function subscriptions_expiring_soon(p_days integer default 2)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if p_days is null or p_days < 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_DAYS');
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into v_rows
    from (
      select s.id            as subscription_id,
             s.city_id       as city_id,
             s.driver_id     as driver_id,
             s.status        as status,
             s.plan          as plan,
             u.telegram_id   as telegram_id,
             u.language_code as language_code,
             e.ends_at       as ends_at,
             greatest(0, ceil(extract(epoch from (e.ends_at - now())) / 86400.0)::integer)
                             as days_left
        from subscriptions s
        join drivers d on d.id = s.driver_id
        join users   u on u.id = d.user_id
        cross join lateral (
          select case when s.status = 'trialing' then s.trial_ends_at else s.current_period_end end
        ) as e(ends_at)
       where s.status in ('trialing', 'active')
         and e.ends_at is not null
         and e.ends_at > now()
         and e.ends_at <= now() + make_interval(days => p_days)
         and u.is_blocked = false
         -- المقارنة بين تاريخين كلاهما من القاعدة نفسها. لا يجوز أن يمرّ التاريخ
         -- عبر التطبيق ويعود: JavaScript يحمل المللي ثانية وحدها، وtimestamptz يحمل
         -- الميكرو ثانية، فالعودة تُنتج قيمة مقتطعة لا تساوي الأصل نصّاً — وقد كشف
         -- هذا اختبارُ تكامل حقيقي بعد أن نجح الفحص اليدوي في psql.
         and not exists (
               select 1 from audit_log a
                where a.action = 'subscription.expiry_warned'
                  and a.entity_id = s.id
                  and (a.payload ->> 'ends_at')::timestamptz = e.ends_at
             )
       order by e.ends_at asc
    ) x;

  return jsonb_build_object('ok', true, 'subscriptions', v_rows);
end;
$$;

-- 4) تثبيت أن التحذير أُرسل -----------------------------------------------------------
-- يُستدعى **بعد** نجاح الإرسال لا قبله: من ثبّت قبل الإرسال ثم سقطت شبكة تيليجرام
-- حرم السائق تحذيره إلى الأبد. والعكس — تحذير مكرَّر — إزعاجٌ يُحتمَل.
-- تاريخ الانتهاء يُقرأ من الصفّ لا يُستقبَل من التطبيق. الصيغة الأولى كانت تستقبله
-- معاملاً، فكان التطبيق يقرأه من القاعدة ثم يعيده إليها بعد أن اقتطعته JavaScript إلى
-- المللي ثانية، فلا يساوي الأصل ولا يُطابقه شرط منع التكرار — فتكرّر التحذير كل شوط.
-- القاعدة هي مصدر الحقيقة لتاريخ الانتهاء، فلا معنى لأن يخبرها التطبيق به.
create or replace function record_subscription_warning(p_subscription_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_city_id uuid;
  v_ends_at timestamptz;
begin
  select s.city_id,
         case when s.status = 'trialing' then s.trial_ends_at else s.current_period_end end
    into v_city_id, v_ends_at
    from subscriptions s
   where s.id = p_subscription_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'SUBSCRIPTION_NOT_FOUND');
  end if;
  if v_ends_at is null then
    return jsonb_build_object('ok', false, 'error', 'ENDS_AT_REQUIRED');
  end if;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_city_id, null, 'subscription.expiry_warned', 'subscription', p_subscription_id,
          jsonb_build_object('ends_at', v_ends_at));

  return jsonb_build_object('ok', true, 'subscription_id', p_subscription_id,
                            'ends_at', v_ends_at);
end;
$$;

-- 5) إطفاء التوفّر البائت -------------------------------------------------------------
-- المهلة تأتي وسيطاً من الإعدادات لا مرمَّزة هنا: قيمة تُقاس على سلوك السائقين
-- الحقيقي وتُعدَّل من لوحة الإدارة، وهذا تعريف القيمة التجارية.
--
-- سائق داخل رحلة قائمة لا يُطفأ توفّره ولو لم يلمس هاتفه: هو مشغول لا غائب،
-- وإطفاؤه يُخرجه من الحساب بعد أن ينهي رحلته.
create or replace function deactivate_stale_availability(
  p_city_id uuid,
  p_stale_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_stale_minutes is null or p_stale_minutes <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STALE_MINUTES');
  end if;

  with stale as (
    update driver_availability a
       set is_available = false, changed_at = now()
     where a.city_id = p_city_id
       and a.is_available = true
       and a.changed_at <= now() - make_interval(mins => p_stale_minutes)
       and not exists (
             select 1 from orders o
              where o.assigned_driver_id = a.driver_id
                and o.status in ('matched', 'in_progress')
           )
    returning a.driver_id, a.city_id
  ),
  logged as (
    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    select s.city_id, null, 'driver.availability_expired', 'driver', s.driver_id,
           jsonb_build_object('stale_minutes', p_stale_minutes)
      from stale s
    returning 1
  )
  select count(*) into v_count from logged;

  return jsonb_build_object('ok', true, 'deactivated', v_count);
end;
$$;

-- 6) الصلاحيات -----------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'expire_due_subscriptions()',
    'subscriptions_expiring_soon(integer)',
    'record_subscription_warning(uuid)',
    'deactivate_stale_availability(uuid,integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
