-- migration-phase: expand
-- =============================================================================
-- `F3-04` — نبضةُ الموقعِ: **سببٌ ومُدّةٌ يُنشِرُهما الخادمُ**، لا مؤقّتٌ في
--   العميلِ ولا ثابتٌ في حزمةٍ تُنشَرُ.
--
-- الحالة: منفَّذٌ فعليّاً — البند `F3-04`.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `driver_active_job(bigint)` — القراءةُ التي تقرأُها الشاشةُ أصلاً.
-- يحرسُه: tests/integration/driver-location-broadcast.test.ts ·
--   scripts/check-location-broadcast-contract.ts
-- الحاكم: docs/adr/0119-a-heartbeat-needs-a-published-reason.md
--
-- ## لِمَ المُدّةُ في القاعدةِ لا في العميلِ
--
-- «تكيّفيٌّ» في نصِّ البندِ تعني أنَّ النبضةَ تتغيّرُ بحالِ السائقِ. ولو كُتِبَت
-- المُدَدُ في شيفرةِ التطبيقِ المصغَّرِ لَصارَ ضبطُها **نشرَ حزمةٍ**، ولَاختلفَت
-- بينَ جهازٍ لم يُحدِّثْ وجهازٍ حدَّثَ — أي **حُكمانِ في نظامٍ واحدٍ**. فالمُدَدُ
-- صفوفٌ في `platform_settings` بمدينةٍ، والسببُ (`reason`) حكمُ الخادمِ على
-- حالِ السائقِ، والعميلُ **يُطيعُ ولا يجتهدُ**.
--
-- ## والغيابُ يُنشَرُ غياباً لا صفراً (`ADR 0023`)
--
-- `interval_seconds = null` تعني **«لا تبثَّ»**: لا مَهمّةَ ولا توفُّرَ، أو
-- إعدادُ المدينةِ غائبٌ. ولا يُخترَعُ بديلٌ في القاعدةِ ولا في العميلِ: نبضةٌ
-- بمُدّةٍ مُخترَعةٍ تكتبُ صفوفاً وتُشعِلُ بطاريّةً بسببٍ لا يعرفُه أحدٌ، وسكونٌ
-- مُعلَنٌ أصدقُ. **وفشلٌ مغلقٌ ههنا اختيارٌ مُسجَّلٌ** لا سهوٌ.
--
-- ## وما لا تفعلُه هذه الهجرةُ عن قصدٍ — (`ح-5`)
--
--   ــ **لا تكتبُ موقعاً ولا تقرأُ موقعاً**: `update_driver_location` كاتبُ
--      الموقعِ الوحيدُ (`F4-01`) ولا يُمَسُّ، وهذه الهجرةُ **تُنشِرُ سياسةً**
--      فحسب. فلا `driver_locations` في هذا الملفِّ ألبتّةَ.
--   ــ **لا تستنتِجُ طَوراً من موضعٍ ولا من مسافةٍ** (`ADR 0118`): السببُ مشتقٌّ
--      من حالةِ الطلبِ والتوفُّرِ وحدَهما.
--   ــ **لا تُغيِّرُ حُكماً قائماً في `driver_active_job`**: الكتلةُ **إضافةٌ**،
--      وكلُّ مفتاحٍ كانَ يُنشَرُ يبقى بحرفِه وبموضعِه (`ح-8`).
--   ــ **لا تفرضُ حدَّ معدَّلٍ**: حدُّ البوّابةِ (`F4-01`) قائمٌ وهوَ الحاكمُ عندَ
--      عميلٍ عاصٍ أو مُنتحِلٍ. والنبضةُ المنشورةُ **تعاونٌ لا حراسةٌ**، ولا
--      يُدَّعى أنّها تمنعُ إسرافاً — تمنعُه البوّابةُ.
-- =============================================================================

-- ── ١) المُدَدُ الثلاثُ إعداداتُ مدينةٍ ─────────────────────────────────────────
--
-- تُبذَرُ لكلِّ مدينةٍ قائمةٍ. و`on conflict do nothing`: هجرةٌ تُعادُ لا تمحو
-- ضبطاً بشريّاً بقيمةٍ افتراضيّةٍ — والضبطُ بعدَ البذرِ **ملكُ المُشغِّلِ**.
--
-- والقيمُ الأولى مُعلَّلةٌ لا مُختارةٌ عبثاً:
--   * متاحٌ بلا مَهمّةٍ (60 ثانيةً): يكفي أن يُعرَفَ حيُّه للإسنادِ، ولا يُتعقَّبُ
--     شارعاً بشارعٍ وهوَ في بيتِه.
--   * في طريقِه إلى الالتقاطِ (15 ثانيةً): الراكبُ ينتظرُ، والحاجةُ أعلى.
--   * في رحلةٍ (20 ثانيةً): مسارٌ يُسجَّلُ ولا يُلاحَظُ لحظةً بلحظةٍ.
insert into platform_settings (city_id, key, value, value_type, description_ar)
select c.id, v.key, v.value, 'number', v.description
  from cities c
 cross join (values
   ('location_broadcast_seconds_available', to_jsonb(60), 'مدة نبضة الموقع لسائق متاح بلا مهمة (ثانية)'),
   ('location_broadcast_seconds_matched', to_jsonb(15), 'مدة نبضة الموقع لسائق في طريقه إلى نقطة الالتقاط (ثانية)'),
   ('location_broadcast_seconds_on_trip', to_jsonb(20), 'مدة نبضة الموقع لسائق في رحلة جارية (ثانية)')
 ) as v(key, value, description)
on conflict (city_id, key) do nothing;

-- ── ٢) دالّةُ السياسةِ: سببٌ ومُدّةٌ، أو عَدَمٌ ─────────────────────────────────
--
-- `stable` لأنَّها لا تكتبُ. و`security definer` منزوعةُ التنفيذِ عن العامِّ:
-- تُقرأُ من دالّةٍ أُخرى في القاعدةِ لا من العميلِ مباشرةً.
create or replace function driver_location_broadcast_policy(
  p_city_id uuid,
  p_order_status text,
  p_arrived_at timestamptz,
  p_is_available boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_reason text;
  v_key text;
  v_seconds numeric;
begin
  -- **السببُ أوّلاً، والمُدّةُ تابعةٌ له**: نبضةٌ بلا سببٍ مذكورٍ لا تُنشَرُ.
  v_reason := case
    when p_order_status = 'in_progress' then 'ON_TRIP'
    -- **الوصولُ ختمٌ بشريٌّ يُسكِتُ النبضةَ** (ADR 0118): بينَ ختمِ الوصولِ
    -- وبدءِ الرحلةِ لا أحدَ ينتظرُ موضعاً، فلا سببَ يُنشَرُ — ولا يُستنتَجُ
    -- الطَورُ من مسافةٍ ولا من مُضيِّ وقتٍ.
    when p_order_status = 'matched' and p_arrived_at is null then 'TO_PICKUP'
    when p_order_status is null and coalesce(p_is_available, false) then 'AVAILABLE'
    else null
  end;

  if v_reason is null then
    return jsonb_build_object('reason', null, 'interval_seconds', null);
  end if;

  v_key := case v_reason
    when 'ON_TRIP' then 'location_broadcast_seconds_on_trip'
    when 'TO_PICKUP' then 'location_broadcast_seconds_matched'
    else 'location_broadcast_seconds_available'
  end;

  select (value #>> '{}')::numeric into v_seconds
    from platform_settings
   where city_id = p_city_id
     and key = v_key
     and value_type = 'number';

  -- إعدادٌ غائبٌ أو غيرُ موجبٍ ⇒ **سكونٌ مُعلَنٌ**: السببُ يُنشَرُ ليُقرأَ في
  -- الواجهةِ وفي الفحصِ، والمُدّةُ `null` فلا يُخترَعُ رقمٌ في عميلٍ.
  if v_seconds is null or v_seconds <= 0 then
    return jsonb_build_object('reason', v_reason, 'interval_seconds', null);
  end if;

  return jsonb_build_object('reason', v_reason, 'interval_seconds', floor(v_seconds)::int);
end;
$fn$;

comment on function driver_location_broadcast_policy(uuid, text, timestamptz, boolean) is
  'سياسةُ نبضةِ موقعِ السائقِ: سببٌ (ON_TRIP/TO_PICKUP/AVAILABLE) ومُدّةٌ بالثواني من platform_settings لمدينةِ السائقِ، أو null فيهما معناه لا تبثَّ. لا تكتبُ موقعاً ولا تستنتِجُ طَوراً من مسافةٍ (F3-04).';

revoke all on function driver_location_broadcast_policy(uuid, text, timestamptz, boolean) from public;
revoke all on function driver_location_broadcast_policy(uuid, text, timestamptz, boolean) from anon;
revoke all on function driver_location_broadcast_policy(uuid, text, timestamptz, boolean) from authenticated;
grant execute on function driver_location_broadcast_policy(uuid, text, timestamptz, boolean) to service_role;

-- ── ٣) الكتلةُ تُضافُ إلى القراءةِ القائمةِ — إضافةً لا استبدالاً (`ح-8`) ──────
--
-- كلُّ ما كانَ يُنشَرُ في `20260915030000` يبقى بحرفِه؛ الجديدُ مفتاحٌ واحدٌ في
-- الجذرِ: `location_broadcast`. **وفي الجذرِ لا داخلَ `job`** لأنَّ سائقاً متاحاً
-- بلا مَهمّةٍ يبثُّ أيضاً، و`job = null` لا يعني «لا نبضةَ».
create or replace function driver_active_job(p_telegram_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user users%rowtype;
  v_driver drivers%rowtype;
  v_now timestamptz := now();
  v_order orders%rowtype;
  v_rider riders%rowtype;
  v_rider_user users%rowtype;
  v_rider_first_name text;
  v_next_action text;
  v_is_available boolean;
  v_broadcast jsonb;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  -- توفُّرُ السائقِ يُقرأُ من كاتبِه الواحدِ (`driver_availability`)، والصفُّ
  -- الغائبُ **ليسَ متاحاً**: غيابٌ يُقرأُ سكوناً لا إذناً.
  select da.is_available into v_is_available
    from driver_availability da
   where da.driver_id = v_driver.id;

  -- «مَهمّتي» = ما التزمَ به هذا السائقُ ولمّا يُكملْه، بمعنى `orders` الواحدِ
  -- لا بقائمةٍ مكتوبةٍ نصّاً ههنا (`is_driver_engaged_order_status` · القاعدة 0.6).
  -- وأحدثُ إسنادٍ أوّلاً: صفوفٌ قديمةٌ عالقةٌ لا تحجبُ المَهمّةَ القائمةَ.
  select * into v_order
    from orders
   where assigned_driver_id = v_driver.id
     and is_driver_engaged_order_status(status)
   order by matched_at desc nulls last
   limit 1;

  if not found then
    -- لا مَهمّةَ: تُنشَرُ السياسةُ **من توفُّرِه وحدَه**، ومدينةُ السياسةِ مدينةُ
    -- السائقِ لا مدينةُ طلبٍ لا وجودَ له.
    return jsonb_build_object(
      'ok', true,
      'server_time', v_now,
      'job', null,
      'location_broadcast',
        driver_location_broadcast_policy(v_driver.city_id, null::text, null::timestamptz, v_is_available)
    );
  end if;

  select * into v_rider from riders where id = v_order.rider_id;
  if found then
    select * into v_rider_user from users where id = v_rider.user_id;
  end if;

  -- **الاسمُ الأوّلُ وحدَه**: سائقٌ ينادي راكبَه باسمِه الأوّلِ يكفيهِ، واللقبُ
  -- الكاملُ توسيعٌ للسطحِ بلا حاجةٍ. والفراغُ يُنشَرُ عَدَماً لا نصّاً فارغاً.
  v_rider_first_name := nullif(split_part(coalesce(trim(v_rider_user.full_name), ''), ' ', 1), '');

  -- **حكمُ الخادمِ على زرِّ المرحلةِ** — لا تحكمُ الشاشةُ عليه بنفسِها، وزرٌّ
  -- تفتحُه الشاشةُ وترفضُه القاعدةُ عطبُ منتَجٍ. والحكمُ مُشتقٌّ من الحالةِ
  -- والختمِ وحدَهما، **ولا من مسافةٍ**.
  v_next_action := case
    when v_order.status = 'matched' and v_order.arrived_at is null then 'MARK_ARRIVED'
    when v_order.status = 'matched' then 'START_RIDE'
    when v_order.status = 'in_progress' then 'COMPLETE_RIDE'
    else null
  end;

  -- ومدينةُ السياسةِ **مدينةُ الطلبِ** حينَ توجدُ مَهمّةٌ: سائقٌ يعملُ في مدينةٍ
  -- تُحكَمُ نبضتُه بإعدادِ تلكَ المدينةِ لا بإعدادِ مدينةِ تسجيلِه.
  v_broadcast := driver_location_broadcast_policy(
    coalesce(v_order.city_id, v_driver.city_id),
    -- **الحالةُ تُمرَّرُ نصّاً صريحاً**: نوعُ العَدِّ `order_status` لا يُحوَّلُ ضمناً،
    -- ولو تُرِكَ بلا صَبٍّ لَسقطَت القراءةُ كلُّها عندَ أوّلِ مَهمّةٍ حقيقيّةٍ.
    v_order.status::text,
    v_order.arrived_at,
    v_is_available
  );

  return jsonb_build_object(
    'ok', true,
    -- لحظةُ الخادمِ تُنشَرُ أبداً: كلُّ عُمرٍ في الشاشةِ فرقٌ عنها لا فرقٌ عن
    -- ساعةِ الجهازِ (نفسُ حكمِ `F3-02`).
    'server_time', v_now,
    'location_broadcast', v_broadcast,
    'job', jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'service', v_order.service,
      'next_action', v_next_action,
      'matched_at', v_order.matched_at,
      'arrived_at', v_order.arrived_at,
      'started_at', v_order.started_at,
      'pickup', jsonb_build_object(
        'label', v_order.pickup_label,
        'latitude', st_y(v_order.pickup::geometry),
        'longitude', st_x(v_order.pickup::geometry)
      ),
      -- ورحلةٌ بلا وجهةٍ **عَدَمٌ لا صفرٌ** (`ADR 0023`).
      'dropoff', case
        when v_order.dropoff is null then null
        else jsonb_build_object(
               'label', v_order.dropoff_label,
               'latitude', st_y(v_order.dropoff::geometry),
               'longitude', st_x(v_order.dropoff::geometry))
      end,
      'notes', v_order.notes,
      -- **بياناتُ الراكبِ المسموحةُ** وحدَها: لا هاتفَ ولا معرِّفَ تلغرامَ.
      'rider', jsonb_build_object(
        'first_name', v_rider_first_name,
        'language_code', v_rider_user.language_code
      )
    )
  );
end;
$fn$;

comment on function driver_active_job(bigint) is
  'مَهمّةُ السائقِ النشطةُ في قراءةٍ واحدةٍ: الحالةُ وأختامُ الأطوارِ ونقطتا الرحلةِ وملاحظةُ الراكبِ واسمُه الأوّلُ ولغتُه، ومعَها next_action حكماً من الخادمِ على زرِّ المرحلةِ، ومعَها location_broadcast سبباً ومُدّةً لنبضةِ الموقعِ (F3-04) أو عَدَماً فيهما. ولا هاتفَ ولا معرِّفَ تلغرامَ للراكبِ ولا أجرةَ ولا موضعَ حيَّ (SD-05).';

revoke all on function driver_active_job(bigint) from public;
revoke all on function driver_active_job(bigint) from anon;
revoke all on function driver_active_job(bigint) from authenticated;
grant execute on function driver_active_job(bigint) to service_role;
