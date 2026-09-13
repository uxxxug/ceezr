-- migration-phase: expand
--
-- الغرض: حكمُ الاقتباسِ (`POST /v1/rides/quote`) في المحرِّكِ: فحصُ طرفَي الرحلةِ
--   ضدَّ منطقةِ خدمةِ مدينةِ الراكبِ، وقياسُ المسافةِ الجيوديسيّةِ، والجوابُ عن
--   «أيُّ خدمةٍ مخدومةٌ في هذه المدينةِ فعلاً» — في قراءةٍ واحدةٍ.
-- الحالة: منفَّذٌ فعليّاً — `F2-04` بنصفِه المشروعِ.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: packages/infrastructure/quote/quote-store.ts
-- يُتوقع أن يستخدمه لاحقاً: `F2-05` (إنشاءُ الرحلةِ) يقرأُ الحكمَ نفسَه قبلَ
--   القبولِ، فلا تُكرَّرُ قاعدةُ «داخلَ منطقةِ الخدمةِ» في موضعَينِ.
-- ملاحظات مستقبلية: إذا أُغلِقَ `DEC-11` بموافقةٍ نظاميّةٍ، فمكانُ الأجرةِ ترحيلٌ
--   جديدٌ يُعلِنُ سندَه — **ولا يُترَكُ لها عمودٌ ههنا** (`م13-7`).
--
-- ## لماذا الحكمُ في القاعدةِ لا في التطبيقِ
--
-- لأنَّ الجوابَ يحتاجُ ثلاثةَ أشياءَ من ثلاثةِ جداولَ: مدينةُ الراكبِ من `users`،
-- وحدُّ الخدمةِ من `city_service_areas`، ووجودُ سائقٍ قادرٍ من
-- `driver_capabilities` × `subscriptions`. ولو سُئِلَت من التطبيقِ لَصارَت ثلاثَ
-- رحلاتٍ ذهاباً وإياباً تتناقضُ بينها إذا تغيَّرَ صفٌّ بينهما، ولَسكنَت قاعدةُ
-- «داخلَ منطقةِ الخدمةِ» في موضعَينِ (ههنا وفي `F2-05`) فافترقَتا (القاعدة 0.5 ·
-- القاعدة 0.6).
--
-- ## لماذا رمزانِ للرفضِ لا رمزٌ واحدٌ
--
-- «نقطةُ انطلاقي خارجَ الخدمةِ» و«وجهتي خارجَ الخدمةِ» جوابانِ مختلفانِ للراكبِ
-- تماماً: الأوّلُ يعني «لا نخدمُ حيثُ أنتَ»، والثاني «لا نخدمُ حيثُ تريدُ». وجمعُهما
-- في رمزٍ واحدٍ يجعلُ الشاشةَ تكذبُ في نصفِ الحالاتِ.
--
-- ## ولماذا لا أجرةَ ولا وسيلةَ دفعٍ في هذا الترحيلِ
--
-- لأنَّ آليةَ الأجرةِ **محجوبةٌ** بـ`ADR 0039` §٤ على `DEC-11`، وملحقُ `م13-7`
-- يُجمِّدُ معَها الهياكلَ التمهيديّةَ نصّاً: «لا أعمدة ولا ترحيلات ولا واجهات ولا
-- حقول عرض جاهزة للأجرة». فلا عمودَ `fare` ولا `payment_method` ولا عمودٌ فارغٌ
-- «يُملأُ لاحقاً» — لأنَّ العمودَ الفارغَ أوّلُ خطوةٍ في سلسلةِ الفشلِ التي وُضِعَ
-- `F0` لمنعِها.
--
-- ## ما لا يفعلُه هذا الترحيلُ عن قصدٍ
--
-- لا يحسبُ مدّةً: المدّةُ مدّةُ توجيهٍ أو امتناعٌ مُصنَّفٌ (`ADR 0024`)، والقاعدةُ
-- لا تُنادي شبكةً. ولا يعرفُ «سائقاً متّصلاً الآن»: الاتّصالُ والقربُ شأنُ
-- التوزيعِ (`F2-05`)، وههنا يُسألُ عن **قدرةِ المدينةِ** لا عن سائقٍ بعينِه.
-- ولا يُنشئُ صفّاً ولا يكتبُ شيئاً: قراءةٌ محضةٌ.

set local search_path = public;

-- ----------------------------------------------------------------------------
-- 1) الخدماتُ المخدومةُ في مدينةٍ — قدرةٌ لا اتّصالٌ
-- ----------------------------------------------------------------------------
--
-- الشروطُ الثلاثةُ مجتمعةً، ولكلٍّ سندُه: القدرةُ مُفعَّلةٌ (`is_enabled`)، والسائقُ
-- **موثَّقٌ** (`verified`) لأنَّ سائقاً مُعلَّقاً أو مرفوضاً لا يُسنَدُ إليه، والاشتراكُ
-- سارٍ (`trialing` أو `active`) لأنَّ النموذجَ التجاريَّ اشتراكٌ (`ADR 0027`) ومن
-- انتهى اشتراكُه لا يُبَثُّ إليه.
create or replace function city_served_services(p_city_id uuid)
returns service_type[]
language sql
stable
security invoker
set search_path = public
as $fn$
  select coalesce(array_agg(distinct dc.service order by dc.service), array[]::service_type[])
  from driver_capabilities dc
  join drivers d on d.id = dc.driver_id
  join subscriptions s on s.driver_id = dc.driver_id
  where dc.city_id = p_city_id
    and dc.is_enabled
    and d.verification_status = 'verified'
    and s.status in ('trialing', 'active')
$fn$;

comment on function city_served_services(uuid) is
  'الخدماتُ التي تملكُ مدينةٌ سائقاً موثَّقاً مشترِكاً قادراً عليها. قدرةٌ لا اتّصالٌ: '
  'الاتّصالُ والقربُ شأنُ التوزيعِ في F2-05.';

-- ----------------------------------------------------------------------------
-- 2) حكمُ الاقتباسِ — قراءةٌ واحدةٌ تُجيبُ عن الطرفَينِ والمسافةِ والخدماتِ
-- ----------------------------------------------------------------------------
--
-- ترتيبُ الفحصِ مقصودٌ: صلاحيّةُ الإحداثيّاتِ أوّلاً (عيبُ عميلٍ لا حالةُ منتَجٍ)،
-- ثمَّ وجودُ صفِّ المستخدمِ (عطبُ حسابٍ)، ثمَّ وجودُ منطقةِ خدمةٍ لمدينتِه، ثمَّ
-- الانطلاقُ، ثمَّ الوجهةُ. وكلُّ رفضٍ **رمزٌ في حمولةٍ** لا استثناءٌ، لأنَّ «خارجَ
-- منطقةِ الخدمةِ» جوابٌ صحيحٌ لا عطبٌ، ورفعُه استثناءً يجعلُ الشاشةَ تعرضُ عطباً
-- عن حالةٍ سليمةٍ.
--
-- ## ولماذا شكلُ الحمولةِ مطابقٌ لـ`resolve_destination` حرفاً
--
-- مفاتيحُ مسطَّحةٌ بحروفٍ صغيرةٍ وشرطةٍ سفليّةٍ، ورمزُ الرفضِ في `error` لا في
-- `refusal`. وهوَ عينُ ما تُعيدُه `resolve_destination` في `F2-03`. ولو اختُلِفَ
-- لَصارَ في المشروعِ عُرفانِ لحمولةِ حكمٍ واحدةٍ، فيُكتَبُ قارئانِ في البنيةِ
-- التحتيّةِ ويتباعدانِ بصمتٍ (القاعدة 0.6). والتسميةُ المقروءةُ (`kind`،
-- `meters`) موضعُها النوعُ في TypeScript لا مفاتيحُ القاعدةِ.
create or replace function quote_ride(
  p_telegram_id   bigint,
  p_origin_lat    double precision,
  p_origin_lng    double precision,
  p_dest_lat      double precision,
  p_dest_lng      double precision
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_city_id       uuid;
  v_city          record;
  v_area          record;
  v_origin        geography(Point, 4326);
  v_destination   geography(Point, 4326);
  v_meters        double precision;
  v_services      service_type[];
begin
  -- الإحداثيّاتُ تُفحَصُ قبلَ أيِّ قراءةٍ: لا يُكشَفُ وجودُ حسابٍ أو غيابُه لطلبٍ
  -- مبنيٍّ خطأً، ولا تُستهلَكُ قراءةٌ لمدخَلٍ مستحيلٍ.
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

  select u.city_id into v_city_id
  from users u
  where u.telegram_id = p_telegram_id;

  if v_city_id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select c.code, c.name_ar, c.name_en into v_city
  from cities c
  where c.id = v_city_id;

  select a.area_version, a.area into v_area
  from city_service_areas a
  where a.city_id = v_city_id and a.is_active
  limit 1;

  -- مدينةٌ بلا حدٍّ مرسومٍ **تُعلِنُ ذلكَ** ولا تُقبَلُ افتراضاً: القبولُ بلا حدٍّ
  -- يعني خدمةَ الكوكبِ كلِّه من صفٍّ ناقصٍ.
  if v_area is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'CITY_HAS_NO_SERVICE_AREA',
      'city_code', v_city.code, 'city_name_ar', v_city.name_ar, 'city_name_en', v_city.name_en
    );
  end if;

  v_origin      := st_setsrid(st_makepoint(p_origin_lng, p_origin_lat), 4326)::geography;
  v_destination := st_setsrid(st_makepoint(p_dest_lng, p_dest_lat), 4326)::geography;

  if not st_covers(v_area.area, v_origin) then
    return jsonb_build_object(
      'ok', false,
      'error', 'ORIGIN_OUTSIDE_SERVICE_AREA',
      'city_code', v_city.code, 'city_name_ar', v_city.name_ar, 'city_name_en', v_city.name_en,
      'area_version', v_area.area_version
    );
  end if;

  if not st_covers(v_area.area, v_destination) then
    return jsonb_build_object(
      'ok', false,
      'error', 'DESTINATION_OUTSIDE_SERVICE_AREA',
      'city_code', v_city.code, 'city_name_ar', v_city.name_ar, 'city_name_en', v_city.name_en,
      'area_version', v_area.area_version
    );
  end if;

  -- `st_distance` على `geography` مسافةٌ جيوديسيّةٌ بالأمتارِ — لا هافرساينُ
  -- مكتوبٌ باليدِ في تايبسكربت. والدالّةُ **لا تُسمّيها مسافةَ طريقٍ**: الوسمُ
  -- يُرافقُها في كلِّ طبقةٍ (`ADR 0024`).
  v_meters   := st_distance(v_origin, v_destination);
  v_services := city_served_services(v_city_id);

  return jsonb_build_object(
    'ok', true,
    'city_code', v_city.code, 'city_name_ar', v_city.name_ar, 'city_name_en', v_city.name_en,
    'area_version', v_area.area_version,
    'distance_kind', 'STRAIGHT_LINE',
    'distance_m', round(v_meters::numeric, 1),
    'served_services', to_jsonb(v_services)
  );
end;
$fn$;

comment on function quote_ride(bigint, double precision, double precision, double precision, double precision) is
  'حكمُ الاقتباسِ: طرفانِ يُفحَصانِ ضدَّ منطقةِ الخدمةِ برمزَينِ منفصلَينِ، ومسافةٌ '
  'جيوديسيّةٌ موسومةٌ STRAIGHT_LINE، وخدماتُ المدينةِ المخدومةُ. والشِّقُّ المُجمَّدُ '
  'بـADR 0039 على DEC-11 غائبٌ كُلِّيّاً لا مُهيَّأً: لا حقلَ ولا عمودَ ولا مكانَ محفوظاً.';

-- الدالّتانِ تُنادَيانِ من الخادمِ بمفتاحِ الخدمةِ وحدَه. وبقاءُ `execute` للعامِّ
-- يعني أنَّ مفتاحاً عامّاً منشوراً في العميلِ يقرأُ قدرةَ المدينةِ وحدودَها.
revoke execute on function city_served_services(uuid) from public, anon, authenticated;
revoke execute on function quote_ride(bigint, double precision, double precision, double precision, double precision)
  from public, anon, authenticated;
