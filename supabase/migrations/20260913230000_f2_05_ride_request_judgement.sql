-- migration-phase: expand
--
-- الغرض: إنشاءُ الرحلةِ **أمراً ذرّيّاً** في المحرِّكِ: حكمُ الحدِّ والقدرةِ
--   ومنعُ الطلبِ النشطِ الثاني وكتابةُ الصفِّ — كلُّه في معاملةٍ واحدةٍ يحكمُها
--   مفتاحُ تكرارٍ، ومعَها قراءةُ حالةِ البحثِ بعددِ من أُخطِرَ **فعلاً**.
-- الحالة: منفَّذٌ فعليّاً — `F2-05` (`SR-05`).
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: packages/infrastructure/transport/ride-request-store.ts
-- يُتوقع أن يستخدمه لاحقاً: `F2-06` (الرحلةُ النشطةُ وSOS) يقرأُ `ride_search_state`
--   نفسَها بعدَ الإسنادِ، و`F3` (التوزيعُ) يكتبُ صفوفَ `order_offers` التي يعدُّها
--   هذا الملفُّ ولا يختلقُها.
-- ملاحظات مستقبلية: إذا صارَ للمفتاحِ عمرٌ مُعلَنٌ (تنظيفُ المفاتيحِ القديمةِ)
--   فموضعُه مهمّةٌ دوريّةٌ تقرأُ `created_at`، لا عمودٌ إضافيٌّ ههنا.
--
-- ## لماذا الأمرُ ذرّيٌّ في القاعدةِ لا مُركَّبٌ في التطبيقِ
--
-- لأنَّ إنشاءَ رحلةٍ **قرارٌ مركَّبٌ** يقرأُ أربعةَ جداولَ ويكتبُ في واحدٍ: مدينةُ
-- الراكبِ من `users`، وصفُّه من `riders`، وحدُّ الخدمةِ من `city_service_areas`،
-- وقدرةُ المدينةِ من `driver_capabilities` × `subscriptions`. ولو رُكِّبَ في
-- التطبيقِ لَكانَ بينَ «قرأتُ أنَّه لا طلبَ نشطاً» و«كتبتُ الصفَّ» **نافذةُ سباقٍ**
-- تُنشئُ رحلتَينِ لراكبٍ واحدٍ (القاعدة 0.5).
--
-- ## ولماذا الحالةُ القائمةُ عطبٌ لا نقصُ ميزةٍ
--
-- الإنشاءُ اليومَ `insert into orders` مكشوفٌ في
-- `packages/infrastructure/transport/order-adapters.ts` — بلا مفتاحِ تكرارٍ
-- ألبتّةَ. فضغطتانِ على زرٍّ، أو إعادةُ محاولةٍ من شبكةٍ متقطِّعةٍ، **تُنشئانِ
-- رحلتَينِ حقيقيّتَينِ وتُخطِرانِ السائقينَ مرّتَينِ**. و`ARCH-006` يشترطُ أن يحملَ
-- كلُّ أمرٍ مفتاحَ تكرارٍ، وهذا الترحيلُ يجعلُه **قابلاً للإنفاذِ** لا اتّفاقاً.
--
-- ## ولماذا المفتاحُ عمودٌ على `orders` لا جدولُ مفاتيحَ منفصلٌ
--
-- لأنَّ جدولاً منفصلاً يعني **مصدرَي حقيقةٍ** لواقعةٍ واحدةٍ: صفٌّ يقولُ «هذا
-- المفتاحُ مُستهلَكٌ» وصفٌّ يقولُ «هذه الرحلةُ قائمةٌ» — ويجوزُ أن يوجدَ أحدُهما بلا
-- الآخرِ عندَ أوّلِ عطبٍ. والعمودُ على الصفِّ نفسِه يجعلُ **وجودَ المفتاحِ هوَ
-- وجودَ الرحلةِ**، فالإعادةُ تُعيدُ المعرّفَ الأوّلَ من الصفِّ نفسِه (القاعدة 0.6).
-- والعمودُ **قابلٌ للعدمِ** عن قصدٍ: مسارُ البوتِ القائمُ يكتبُ بلا مفتاحٍ، وقيدٌ
-- إلزاميٌّ يُسقِطُه — وذاكَ سطحٌ خارجَ النطاقِ المحجوزِ، فلا يُمَسُّ صامتاً.
--
-- ## ما لا يفعلُه هذا الترحيلُ عن قصدٍ
--
-- **لا يُسنِدُ سائقاً ولا يبثُّ عرضاً ولا يرتِّبُ سائقينَ** — ذاكَ التوزيعُ (`F3`)
-- وله آلةُ حالاتِه، وههنا تُنشأُ الرحلةُ في `searching` وحدَها. **ولا يعرفُ سائقاً
-- متّصلاً الآنَ**: يُسألُ عن **قدرةِ المدينةِ** لا عن قربِ أحدٍ (`ADR 0017`).
-- **ولا أجرةَ ولا وسيلةَ دفعٍ ولا عقوبةَ إلغاءٍ ولا عمودَ لأيٍّ منها** —
-- `ADR 0039` §٤ يحجبُ آليةَ الأجرةِ على `DEC-11`، و`م13-7` يُجمِّدُ حتّى الهياكلَ
-- التمهيديّةَ، والإلغاءُ قبلَ الإسنادِ **بلا عقوبةٍ** نصُّ `SR-05` نفسِه.

set local search_path = public;

-- ----------------------------------------------------------------------------
-- 1) مفتاحُ التكرارِ عموداً — والتكرارُ يُمنَعُ في المخطَّطِ لا في الشِّفرةِ
-- ----------------------------------------------------------------------------
--
-- الفهرسُ الفريدُ في ملفِّ طورِ `index` المرافقِ، لأنَّ `concurrently` لا تُقبَلُ
-- في معاملةٍ. ومعناهُ أنَّ سباقَ نداءَينِ متزامنَينِ بالمفتاحِ نفسِه يُحسَمُ في
-- المحرِّكِ: أحدُهما يكتبُ والآخرُ يرتدُّ بـ`unique_violation` فيُقرأُ الصفَّ
-- الأوّلَ ويُعيدُ معرّفَه — لا فحصٌ مسبقٌ في التطبيقِ يمرُّ منه الاثنانِ.
alter table orders add column if not exists idempotency_key text;

comment on column orders.idempotency_key is
  'مفتاحُ تكرارِ الأمرِ من العميلِ (ARCH-006). قابلٌ للعدمِ لأنَّ مسارَ البوتِ القائمَ '
  'يكتبُ بلا مفتاحٍ. والفريدُ الجزئيُّ orders_rider_idempotency_uidx يجعلُ التكرارَ '
  'مستحيلاً في المخطَّطِ لمن يحملُ مفتاحاً.';

-- ----------------------------------------------------------------------------
-- 2) إنشاءُ الرحلةِ — أمرٌ واحدٌ يحكمُ ويكتبُ تحتَ قفلٍ واحدٍ
-- ----------------------------------------------------------------------------
--
-- ترتيبُ الفحصِ مقصودٌ كما في `quote_ride`: صلاحيّةُ المدخَلِ أوّلاً (عيبُ عميلٍ لا
-- حالةُ منتَجٍ)، ثمَّ الهويّةُ، ثمَّ الحدُّ، ثمَّ القدرةُ، ثمَّ الطلبُ النشطُ. وكلُّ
-- رفضٍ **رمزٌ في حمولةٍ** لا استثناءٌ: «خارجَ منطقةِ الخدمةِ» و«لديكَ رحلةٌ قائمةٌ»
-- جوابانِ صحيحانِ لا عطبانِ.
--
-- **والقفلُ على صفِّ الراكبِ لا على الجدولِ**: `select … for update` على `riders`
-- يجعلُ نداءَينِ لراكبٍ واحدٍ يتسلسلانِ، ونداءَينِ لراكبَينِ مختلفَينِ لا
-- يتزاحمانِ. ولو قُرِئَ الطلبُ النشطُ بلا قفلٍ لَمَرَّ الاثنانِ من الفحصِ نفسِه.
create or replace function request_ride(
  p_telegram_id     bigint,
  p_idempotency_key text,
  p_service         service_type,
  p_origin_lat      double precision,
  p_origin_lng      double precision,
  p_dest_lat        double precision,
  p_dest_lng        double precision,
  p_notes           text default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $fn$
declare
  v_user          record;
  v_rider_id      uuid;
  v_city          record;
  v_area          record;
  v_origin        geography(Point, 4326);
  v_destination   geography(Point, 4326);
  v_services      service_type[];
  v_existing      record;
  v_order_id      uuid;
  v_created_at    timestamptz;
  v_reused        boolean := false;
begin
  -- المفتاحُ شرطُ الأمرِ لا زينتُه: أمرٌ بلا مفتاحٍ **يُرَدُّ** ولا يُكتَبُ
  -- بمفتاحٍ مُختلَقٍ في القاعدةِ — لأنَّ مفتاحاً يختلقُه الخادمُ لكلِّ نداءٍ يجعلُ
  -- كلَّ إعادةٍ أمراً جديداً، وهوَ عينُ العطبِ الذي وُضِعَ `ARCH-006` لمنعِه.
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_KEY_REQUIRED');
  end if;

  if length(p_idempotency_key) > 200 then
    return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_KEY_TOO_LONG');
  end if;

  -- ملاحظةُ السائقِ (`SR-04`) نصٌّ حرٌّ، **وحدُّه حكمٌ في القاعدةِ أيضاً** لا في
  -- الناقلِ وحدَه: من نادى الدالّةَ من بوتٍ أو من سِفرٍ آخرَ لا يُفلِتُ بحدٍّ
  -- فحصَه مسارُ HTTP وحدَه (القاعدة 0.6: المصدرُ واحدٌ ومرآتُه حاجزٌ).
  -- والحدُّ 280 محرفاً يُقابِلُ `RIDE_NOTES_MAX_LENGTH` في
  -- `packages/domain/transport/ride-request.ts`، ويفحصُه
  -- `scripts/check-ride-request-contract.ts` على الملفَّينِ معاً.
  if p_notes is not null and length(btrim(p_notes)) > 280 then
    return jsonb_build_object('ok', false, 'error', 'NOTES_TOO_LONG');
  end if;

  if p_origin_lat is null or p_origin_lng is null
     or p_dest_lat is null or p_dest_lng is null
     or p_origin_lat <> p_origin_lat or p_origin_lng <> p_origin_lng
     or p_dest_lat   <> p_dest_lat   or p_dest_lng   <> p_dest_lng
     or p_origin_lat < -90  or p_origin_lat > 90
     or p_dest_lat   < -90  or p_dest_lat   > 90
     or p_origin_lng < -180 or p_origin_lng > 180
     or p_dest_lng   < -180 or p_dest_lng   > 180
  then
    return jsonb_build_object('ok', false, 'error', 'INVALID_POINT');
  end if;

  select u.id, u.city_id into v_user
  from users u
  where u.telegram_id = p_telegram_id;

  if v_user.city_id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select r.id into v_rider_id
  from riders r
  where r.user_id = v_user.id
  for update;

  -- صفُّ الراكبِ شرطُ الطلبِ: `orders.rider_id` يُشيرُ إلى `riders` لا إلى
  -- `users`. ومن لم يُسجَّلْ راكباً **يُعلَمُ بذلكَ** ولا يُنشَأُ له صفٌّ ضمناً:
  -- إنشاءُ كيانٍ من أمرٍ آخرَ يُخفي خطوةَ تسجيلٍ ناقصةً.
  if v_rider_id is null then
    return jsonb_build_object('ok', false, 'error', 'RIDER_NOT_REGISTERED');
  end if;

  -- الإعادةُ تُقرأُ **قبلَ** أيِّ حكمٍ آخرَ بعدَ القفلِ: من أعادَ الأمرَ نفسَه
  -- يستحقُّ الجوابَ الأوّلَ حتّى لو تغيَّرَ العالَمُ بعدَه (خرجَ سائقٌ، أو أُغلِقَت
  -- المدينةُ) — وإلّا صارَت الإعادةُ رفضاً لأمرٍ **نُفِّذَ فعلاً**.
  select o.id, o.created_at into v_existing
  from orders o
  where o.rider_id = v_rider_id and o.idempotency_key = p_idempotency_key;

  if v_existing.id is not null then
    return jsonb_build_object(
      'ok', true,
      'reused', true,
      'order_id', v_existing.id,
      'created_at', v_existing.created_at
    );
  end if;

  select c.code, c.name_ar, c.name_en into v_city
  from cities c
  where c.id = v_user.city_id;

  select a.area_version, a.area into v_area
  from city_service_areas a
  where a.city_id = v_user.city_id and a.is_active
  limit 1;

  if v_area is null then
    return jsonb_build_object('ok', false, 'error', 'CITY_HAS_NO_SERVICE_AREA');
  end if;

  v_origin      := st_setsrid(st_makepoint(p_origin_lng, p_origin_lat), 4326)::geography;
  v_destination := st_setsrid(st_makepoint(p_dest_lng, p_dest_lat), 4326)::geography;

  if not st_covers(v_area.area, v_origin) then
    return jsonb_build_object('ok', false, 'error', 'ORIGIN_OUTSIDE_SERVICE_AREA');
  end if;

  if not st_covers(v_area.area, v_destination) then
    return jsonb_build_object('ok', false, 'error', 'DESTINATION_OUTSIDE_SERVICE_AREA');
  end if;

  -- القدرةُ تُقرأُ من `city_served_services` نفسِها التي يقرأُها الاقتباسُ، فلا
  -- تُكرَّرُ قاعدةُ «سائقٌ موثَّقٌ مشترِكٌ قادرٌ» في موضعَينِ فتفترقا (القاعدة 0.6).
  v_services := city_served_services(v_user.city_id);

  if not (p_service = any(v_services)) then
    return jsonb_build_object('ok', false, 'error', 'SERVICE_NOT_AVAILABLE_IN_CITY');
  end if;

  -- طلبٌ نشطٌ واحدٌ لكلِّ راكبٍ **لكلِّ خدمةٍ**: من ينتظرُ سيّارةً لا يطلبُ ثانيةً،
  -- ومن ينتظرُ مندوبَ توصيلٍ **يجوزُ** أن يطلبَ سيّارةً — فالحدُّ على الخدمةِ لا
  -- على الراكبِ. والقراءةُ تحتَ قفلِ صفِّ الراكبِ أعلاهُ فلا سباقَ.
  select o.id, o.status into v_existing
  from orders o
  where o.rider_id = v_rider_id
    and o.service = p_service
    and o.status in ('searching', 'matched', 'in_progress')
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'ok', false,
      'error', 'ACTIVE_RIDE_EXISTS',
      'order_id', v_existing.id,
      'status', v_existing.status
    );
  end if;

  begin
    insert into orders (
      city_id, rider_id, service, status, pickup, dropoff, notes, idempotency_key
    ) values (
      v_user.city_id, v_rider_id, p_service, 'searching', v_origin, v_destination,
      nullif(btrim(coalesce(p_notes, '')), ''), p_idempotency_key
    )
    returning id, created_at into v_order_id, v_created_at;
  exception when unique_violation then
    -- السباقُ يُحسَمُ في المحرِّكِ: الخاسرُ يقرأُ ما كتبَه الفائزُ ويُعيدُ معرّفَه.
    -- ولا يُرفَعُ عطبٌ لأمرٍ **نُفِّذَ فعلاً** بمفتاحِه.
    select o.id, o.created_at into v_order_id, v_created_at
    from orders o
    where o.rider_id = v_rider_id and o.idempotency_key = p_idempotency_key;
    v_reused := true;
  end;

  return jsonb_build_object(
    'ok', true,
    'reused', v_reused,
    'order_id', v_order_id,
    'created_at', v_created_at
  );
end;
$fn$;

comment on function request_ride(bigint, text, service_type, double precision, double precision, double precision, double precision, text) is
  'إنشاءُ الرحلةِ أمراً ذرّيّاً بمفتاحِ تكرارٍ (ARCH-006): حدُّ الخدمةِ للطرفَينِ برمزَينِ '
  'منفصلَينِ، وقدرةُ المدينةِ، وطلبٌ نشطٌ واحدٌ لكلِّ خدمةٍ تحتَ قفلِ صفِّ الراكبِ. '
  'ولا إسنادَ ولا بثَّ (F3)، ولا أجرةَ ولا عقوبةَ إلغاءٍ (ADR 0039 §4 · م13-7).';

-- ----------------------------------------------------------------------------
-- 3) حالةُ البحثِ — والعددُ **مُحتسَبٌ من الصفوفِ** لا مُخترَعٌ
-- ----------------------------------------------------------------------------
--
-- «عددُ السائقينَ المُخطَرينَ فعلاً» نصُّ `SR-05` حرفاً. ومعناهُ الوحيدُ الصادقُ:
-- عددُ **السائقينَ المتمايزينَ** الذينَ لهم صفُّ عرضٍ على هذه الرحلةِ. ولا يُحتسَبُ
-- بعدِّ العروضِ لأنَّ سائقاً واحداً يُخطَرُ في دورتَينِ صفّانِ لا سائقانِ، ولا
-- بالتصفيةِ على `pending` لأنَّ عرضاً انقضى أو رُفِضَ **قد أُخطِرَ فعلاً** —
-- والراكبُ سُئِلَ «كم أُخطِرَ» لا «كم ينتظرُ».
--
-- **والصمتُ ليسَ رفضاً** (`ADR 0023`): صفرُ مُخطَرينَ حالةٌ صادقةٌ تُعلَنُ نصّاً،
-- لا دوّارٌ أبديٌّ ولا خانةٌ فارغةٌ.
create or replace function ride_search_state(
  p_telegram_id bigint,
  p_order_id    uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_user_id   uuid;
  v_rider_id  uuid;
  v_order     record;
  v_notified  integer;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ORDER_ID');
  end if;

  select u.id into v_user_id from users u where u.telegram_id = p_telegram_id;

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select r.id into v_rider_id from riders r where r.user_id = v_user_id;

  if v_rider_id is null then
    return jsonb_build_object('ok', false, 'error', 'RIDER_NOT_REGISTERED');
  end if;

  -- الملكيّةُ شرطُ القراءةِ، **وغيرُ المالكِ يُرَدُّ بـ`ORDER_NOT_FOUND` لا
  -- بـ`FORBIDDEN`**: رمزُ المنعِ يُقِرُّ بوجودِ الرحلةِ لمن ليسَ له، فيُصبِحُ
  -- عدَّادَ معرّفاتٍ صحيحةً لمن يجرِّبُها.
  select o.id, o.status, o.service, o.broadcast_round, o.created_at, o.assigned_driver_id
    into v_order
  from orders o
  where o.id = p_order_id and o.rider_id = v_rider_id;

  if v_order.id is null then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  select count(distinct oo.driver_id) into v_notified
  from order_offers oo
  where oo.order_id = v_order.id;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'status', v_order.status,
    'service', v_order.service,
    'broadcast_round', v_order.broadcast_round,
    'created_at', v_order.created_at,
    'notified_driver_count', coalesce(v_notified, 0),
    -- الإلغاءُ **بلا عقوبةٍ قبلَ الإسنادِ** نصُّ `SR-05`. والقابليّةُ تُحكَمُ ههنا
    -- لا في العميلِ، لأنَّ زرّاً يُظهِرُه العميلُ بحسبِ حالةٍ قديمةٍ يُلغي رحلةً
    -- أُسنِدَت فعلاً — أو يُخفي زرّاً يستحقُّه الراكبُ.
    'cancellable_without_penalty', v_order.status = 'searching'
  );
end;
$fn$;

comment on function ride_search_state(bigint, uuid) is
  'حالةُ البحثِ للمالكِ وحدَه: الحالةُ والدورةُ وختمُ الإنشاءِ وعددُ السائقينَ '
  'المتمايزينَ المُخطَرينَ فعلاً — مُحتسَباً من order_offers لا مُخترَعاً — وقابليّةُ '
  'الإلغاءِ بلا عقوبةٍ. وغيرُ المالكِ يُرَدُّ ORDER_NOT_FOUND لا FORBIDDEN.';

-- ----------------------------------------------------------------------------
-- 4) الإلغاءُ من الشاشةِ — **تفويضٌ لا نسخٌ**
-- ----------------------------------------------------------------------------
--
-- `SR-05` يشترطُ «إلغاءً بلا عقوبةٍ قبلَ الإسنادِ»، والإلغاءُ الذريُّ مكتوبٌ
-- منذُ `20260906040000` في `cancel_order_by_rider`: يُلغي العروضَ المعلَّقةَ،
-- ويُغلقُ التفاوضَ، ويكتبُ في السَّجِلِ، ويُودِعُ إخطارَ كلِّ سائقٍ في المعاملةِ
-- نفسِها (`BUG-004`) — كلُّ ذلكَ تحتَ قفلٍ واحدٍ.
--
-- **فلا يُكتبُ إلغاءٌ ثانٍ ههنا.** وحاجةُ الشاشةِ واحدةٌ: هي تعرفُ
-- `telegram_id` ولا تعرفُ `riders.id`، والدالّةُ القديمةُ تشترطُ المعرَّفَ
-- الداخليَّ. ولو قرأَ الخادمُ `riders.id` بنداءٍ ثمَّ نادى الإلغاءَ بنداءٍ آخرَ
-- لَأمكنَ أن يُمرَّرَ معرَّفُ راكبٍ من طبقةٍ أعلى — وذاكَ موضعُ تزييفِ هويَّةٍ.
-- فهذه الدالّةُ **ترجمةُ هويَّةٍ لا منطقُ إلغاءٍ**: تستنبِطُ الراكبَ من حسابِه
-- ثمَّ تُفوِّضُ، وتُعيدُ حمولةَ المفوَّضِ إليه كما هيَ.
create or replace function cancel_ride_by_telegram(
  p_telegram_id bigint,
  p_order_id    uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_user_id  uuid;
  v_rider_id uuid;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ORDER_ID');
  end if;

  select u.id into v_user_id from users u where u.telegram_id = p_telegram_id;

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select r.id into v_rider_id from riders r where r.user_id = v_user_id;

  if v_rider_id is null then
    return jsonb_build_object('ok', false, 'error', 'RIDER_NOT_REGISTERED');
  end if;

  -- الملكيَّةُ تُفرَضُ في الدالّةِ المفوَّضِ إليها (`rider_id = p_rider_id` في
  -- شرطِ القفلِ)، فلا تُكرَّرُ ههنا: شرطٌ مكتوبٌ مرتَّينِ يفترقُ مرتَّينِ.
  return cancel_order_by_rider(p_order_id, v_rider_id, 'rider_cancelled');
end;
$fn$;

comment on function cancel_ride_by_telegram(bigint, uuid) is
  'ترجمةُ هويَّةٍ لا منطقُ إلغاءٍ: تستنبِطُ riders.id من telegram_id ثمَّ تُفوِّضُ '
  'إلى cancel_order_by_rider بلا نسخِ منطقِه (القاعدة 0.6). ولا عقوبةَ إلغاءٍ في '
  'المشروعِ أصلاً (ADR 0027 · ADR 0039 §4 · م13-7).';

-- الدوالُ تُنادَى من الخادمِ بمفتاحِ الخدمةِ وحدَه. ومفتاحٌ عامٌّ منشورٌ في
-- العميلِ **لا يُنشئُ رحلةً** ولا يقرأُ حالةَ رحلةِ غيرِه ولا يُلغيها.
revoke execute on function request_ride(bigint, text, service_type, double precision, double precision, double precision, double precision, text)
  from public, anon, authenticated;
revoke execute on function ride_search_state(bigint, uuid) from public, anon, authenticated;
revoke execute on function cancel_ride_by_telegram(bigint, uuid) from public, anon, authenticated;
