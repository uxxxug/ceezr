-- migration-phase: expand
-- SEC-22 — المحجوبُ لا يطلبُ: حارسُ `users.is_blocked` في `request_ride`
--
-- السياقُ والاكتشافُ: تدقيقٌ أمنيٌّ مستقلٌّ (2026-10-29، خارجَ بنودِ سجلِّ الأعطالِ)
-- أثبتَ بمسارٍ مكوَّنٍ فعليٍّ (جلسةٌ موقَّعةٌ ← `POST /v1/rides` ← الدالّة) أنَّ
-- `admin_set_user_blocked` لا يمنعُ المحجوبَ من **إنشاءِ طلبِ رحلةٍ جديدٍ**: الردُّ
-- كانَ `200 accepted` وصفُّ الطلبِ كُتبَ فعلًا (مسبارُ الفجوةِ فشلْ بحكمِهِ قبلَ
-- الإصلاحِ — والاختبارُ التراجعيُّ الجديدُ ينجحُ بعده؛ لا يُخلطُ بينهما). الحجبُ
-- كانَ نافذًا في الإسنادِ (السائقُ المحجوبُ لا يستلمُ عروضًا) وفي مساراتِ
-- `authorizeViewer`، ساقطًا من هذا البابِ. وهجرةٌ جديدةٌ لا تعديلٌ على القديمةِ (ح-8).
--
-- الموضعُ: داخلَ الدالّةِ الأمِّ `request_ride` لا الأغلفةِ (`request_ride_labeled`
-- وما فوقَها يُفوِّضُ إليها) — فالحكمُ في القاعدةِ في موضعٍ واحدٍ (القاعدةُ 0.5)،
-- ويشملُ مسارَ التطبيقِ ومسارَ البوتِ وخدمةَ التوصيلِ معًا.
--
-- القفلُ وترتيبُهُ: قراءةُ صفِّ المستخدمِ صارتْ `for update` — الحجبُ
-- (`admin_set_user_blocked`) والتجهيلُ (`erase_my_account`) يقفلانِ الصفَّ نفسَهُ قبلَ
-- قراراتِهما، فبدونِ القفلِ ههنا كانَ يمكنُ أن يقعَ الحجبُ بينَ قراءةِ الحارسِ
-- وكتابةِ الطلبِ، فيُنشئَ المحجوبُ طلبًا بعدَ حظرِهِ بملّي ثانيةٍ. معَ القفلِ
-- يتسلسلُ الطرفانِ: إمّا طلبٌ سابقٌ للحجبِ (مشروعٌ) أو حجبٌ يراهُ الطلبُ (مرفوضٌ).
--
-- **توحيدُ ترتيبِ الأقفالِ (دورةٌ كانَتْ ممكنةً لولاهُ):** التجهيلُ يقفلُ
-- `users` ثمَّ يمسُّ صفوفَ `riders`؛ والدالّةُ الأمُّ تقفلُ `users` ثمَّ `riders`
-- (الترتيبُ نفسُهُ) — لكنَّ `request_ride_with_offer` كانت تقفلُ `riders` **قبلَ**
-- أن تصلَ إلى الأمِّ، فلو أضيفَ قفلُ `users` في الأمِّ وحده لدارتْ دورةُ قفلٍ
-- (طلبٌ يحملُ راكبًا وينتظرُ مستخدمًا × تجهيلٌ يحملُ مستخدمًا وينتظرُ راكبًا).
-- فتوحَّدَ الترتيبُ: `users` أولًا في كلِّ مسارٍ — الأمُّ تقرأُهُ قفلًا في مطلعِها،
-- و`with_offer` (الغلافُ الوحيدُ الذي كانَ يقفلُ راكبًا قبلَ التفويضِ) يقتني قفلَ
-- المستخدمِ قبلَ قفلِ الراكبِ، ولا يُمسُّ منطقُها الآخرُ.
--
-- ترتيبُ الحارسِ: **بعدَ فحصِ الإعادةِ** — عقدُ الإعادةِ المعلنُ في هذه الدالّةِ
-- («من أعادَ الأمرَ نفسَه يستحقُّ الجوابَ الأوّلَ») باقٍٍ لا يُنقَض: إعادةُ أمرٍ
-- نُفِّذَ سابقًا تُعيدُ جوابَهُ الأوّلَ ولو كانَ الحسابُ موقوفًا (لا أثرَ جديدَ
-- ولا إنشاءَ)؛ والحارسُ يمنعُ **الأمرَ الجديدَ** فقط — وهو عينُ نطاقِ هذهِ
-- الهجرةِ: منعُ الإنشاءِ، لا مصادرةُ جوابٍ نُفِّذَ.
--
-- ما لا تفعلهُ هذه الهجرةُ عن عمدٍ:
--   ــ لا تمنعُ الإلغاءَ أو التصديرَ أو الدعمَ أو السلامةَ: سياسةٌ منفصلةٌ
--      تُبحثُ بأثرِ كلِّ فعلٍ (قد يكونُ إلغاءُ المحجوبِ لالتزامٍ قائمٍ ضرورةً).
--   ــ لا تُوسِّعُ الحارسَ إلى قراءةِ حسابٍ في كلِّ جلسةٍ: كلفةُ مسارٍ تُقاسُ
--      بمقعدِها، والحارسُ ههنا عندَ موضعِ الأثرِ لا عندَ البابِ.

-- (١) الأمُّ: قفلُ المستخدمِ في المطلعِ، والحارسُ بعدَ الإعادةِ.
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
  v_existing       record;
  v_order_id       uuid;
  v_created_at     timestamptz;
  v_reused         boolean := false;
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

  -- البدايةُ إلزاميّةٌ دائماً. والوجهةُ **كلٌّ أو لا شيء**: وجودَ أحدِ
  -- الإحداثيَّين دونَ الآخرِ عيبُ عميلٍ لا غيابُ وجهة.
  if p_origin_lat is null or p_origin_lng is null
     or p_origin_lat <> p_origin_lat or p_origin_lng <> p_origin_lng
     or p_origin_lat < -90  or p_origin_lat > 90
     or p_origin_lng < -180 or p_origin_lng > 180
  then
    return jsonb_build_object('ok', false, 'error', 'INVALID_POINT');
  end if;

  -- الوجهةُ معدومةٌ مقبولةٌ — لكنَّ وجودَ أحدِ الإحداثيَّين دونَ الآخرِ عيبٌ.
  if (p_dest_lat is null) <> (p_dest_lng is null) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_POINT');
  end if;

  -- إن وُجِدَت الوجهةُ، فليكن نطاقُها صحيحاً.
  if p_dest_lat is not null then
    if p_dest_lat <> p_dest_lat or p_dest_lng <> p_dest_lng
       or p_dest_lat < -90  or p_dest_lat > 90
       or p_dest_lng < -180 or p_dest_lng > 180
    then
      return jsonb_build_object('ok', false, 'error', 'INVALID_POINT');
    end if;
  end if;

  -- SEC-22: قراءةُ الصفِّ **بقفلِهِ في المطلعِ** — قبلَ أيِّ قفلٍ آخرَ (الترتيبُ
  -- الموحَّدُ: مستخدمٌ ثمَّ راكبٌ) — الحجبُ والتجهيلُ يقفلانِ الصفَّ نفسَهُ،
  -- فلا يقعُ حظرٌ بينَ هذهِ القراءةِ وكتابةِ الطلبِ. والعمودُ يُقرأُ من الصفِّ
  -- المقفولِ لا من قراءةٍ سابقةٍ.
  select u.id, u.city_id, u.is_blocked into v_user
  from users u
  where u.telegram_id = p_telegram_id
  for update;

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
  -- المدينةُ) — وإلّا صارَت الإعادةُ رفضاً لأمرٍ **نُفِّذَ فعلاً**. وهذا العقدُ
  -- باقٍٍ على الحسابِ الموقوفِ نفسِهِ: الجوابُ الأوّلُ جوابُ أمرٍ نُفِّذَ، لا
  -- إنشاءٌ جديدٌ ولا أثرٌ جديد.
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

  -- SEC-22: المحجوبُ لا يُنشئُ طلبًا جديدًا — جاءَ الحارسُ **بعدَ** فحصِ الإعادةِ
  -- عمدًا كي لا يُنقضَ عقدُها: الأمرُ الجديدُ وحدهُ هو المرفوض.
  if v_user.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'ACCOUNT_BLOCKED');
  end if;

  select c.code, c.name_ar, c.name_en, c.is_active into v_city
  from cities c
  where c.id = v_user.city_id;

  -- **المدينةُ المُفعَّلةُ شرطُ الطلبِ لا وصفُها.**
  --
  -- ويُقرأُ **بعدَ** الإعادةِ عن قصدٍ: من أعادَ أمرَه بمفتاحِه يستحقُّ جوابَه
  -- الأوّلَ ولو أُغلِقَت المدينةُ بعدَه — وهذا ما نصَّ عليه تعليقُ الإعادةِ
  -- أعلاهُ حرفاً.
  --
  -- وقيدُ `cities_active_requires_groups` يمنعُ تفعيلَ مدينةٍ قبلَ ربطِ قروباتِها
  -- الثلاثةِ، **لكنَّه لا يمنعُ طلباً في مدينةٍ غيرِ مُفعَّلةٍ** — فالقيدُ على
  -- عمودٍ لا على بابٍ. فكانَ الطلبُ يُقبَلُ في مدينةٍ لا مسارَ إسنادٍ فيها ولا
  -- تصعيدٍ، وهوَ عينُ الضررِ الذي كُتِبَ القيدُ لدفعِه.
  if v_city.is_active is not true then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_ACTIVE');
  end if;

  select a.area_version, a.area into v_area
  from city_service_areas a
  where a.city_id = v_user.city_id and a.is_active
  limit 1;

  if v_area is null then
    return jsonb_build_object('ok', false, 'error', 'CITY_HAS_NO_SERVICE_AREA');
  end if;

  v_origin      := st_setsrid(st_makepoint(p_origin_lng, p_origin_lat), 4326)::geography;

  -- البدايةُ إلزاميّةٌ دائماً: فحصُ المنطقةِ عليها باقٍ لا يُمسَّ. مسارُ البوتِ
  -- `/skip` يُسقِطُ الوجهةَ فقط، لا نقطةَ الانطلاقِ.
  if not st_covers(v_area.area, v_origin) then
    return jsonb_build_object('ok', false, 'error', 'ORIGIN_OUTSIDE_SERVICE_AREA');
  end if;

  -- الوجهةُ معدومةٌ: لا فحصَ منطقةٍ عليها. الوجهةُ موجودةٌ: فحصُ المنطقةِ باقٍ.
  if p_dest_lat is not null then
    v_destination := st_setsrid(st_makepoint(p_dest_lng, p_dest_lat), 4326)::geography;

    if not st_covers(v_area.area, v_destination) then
      return jsonb_build_object('ok', false, 'error', 'DESTINATION_OUTSIDE_SERVICE_AREA');
    end if;
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

-- (٢) الغلافُ الوحيدُ الذي كانَ يقفلُ الراكبَ قبلَ التفويضِ: يقتني قفلَ المستخدمِ
-- أولًا — توحيدًا للترتيبِ معَ الأمِّ ومعَ مساري الحجبِ والتجهيلِ (لا دورةَ قفلٍ).
-- لا يُمسُّ منطقُ الغلافِ الآخرُ بحرفٍ.
create or replace function request_ride_with_offer(
  p_telegram_id bigint,
  p_key text,
  p_service service_type,
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_dest_lat double precision,
  p_dest_lng double precision,
  p_notes text,
  p_pickup_label text,
  p_dropoff_label text,
  p_pickup_at timestamp with time zone,
  p_offer_sar integer,
  p_pickup_place jsonb,
  p_dropoff_place jsonb,
  p_offer_mode text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = 'public'
as $fn$
declare
  v_result   jsonb;
  v_order_id uuid;
  v_rider_id uuid;
  v_existing record;
  v_order    record;
  v_lead     integer;
begin
  -- SEC-22: قفلُ صفِّ المستخدمِ **قبلَ** قفلِ الراكبِ أدناهُ — الترتيبُ الموحَّدُ
  -- (مستخدمٌ ثمَّ راكبٌ) الذي تقفلُ بهِ الأمُّ والحجبُ والتجهيلُ؛ ولولاهُ لدارتْ
  -- دورةٌ بينَ هذا المسارِ والتجهيلِ. لا حكمَ ههنا — الحارسُ في الأمِّ وحدَهُ.
  perform 1 from users u where u.telegram_id = p_telegram_id for update;

  if p_offer_mode is null or p_offer_mode not in ('fixed', 'suggested', 'open') then
    return jsonb_build_object('ok', false, 'error', 'OFFER_MODE_INVALID');
  end if;
  if p_offer_mode = 'open' and p_offer_sar is not null then
    return jsonb_build_object('ok', false, 'error', 'OFFER_AMOUNT_UNEXPECTED');
  end if;
  if p_offer_mode in ('fixed', 'suggested') then
    if p_offer_sar is null then
      return jsonb_build_object('ok', false, 'error', 'OFFER_AMOUNT_REQUIRED');
    end if;
    if p_offer_sar < 1 or p_offer_sar > 10000 then
      return jsonb_build_object('ok', false, 'error', 'OFFER_AMOUNT_INVALID');
    end if;
  end if;

  -- (أ) المجدولُ القائمُ يحجبُ كما يحجبُ البحث.
  select r.id into v_rider_id
    from users u join riders r on r.user_id = u.id
   where u.telegram_id = p_telegram_id
   for update of r;
  if v_rider_id is not null
     and not exists (select 1 from orders o
                      where o.rider_id = v_rider_id and o.idempotency_key = p_key) then
    select o.id, o.status into v_existing
      from orders o
     where o.rider_id = v_rider_id and o.service = p_service and o.status = 'scheduled'
     order by o.created_at
     limit 1;
    if v_existing.id is not null then
      return jsonb_build_object(
        'ok', false, 'error', 'ACTIVE_RIDE_EXISTS',
        'order_id', v_existing.id, 'status', v_existing.status);
    end if;
  end if;

  v_result := request_ride_with_places(
    p_telegram_id, p_key, p_service,
    p_origin_lat, p_origin_lng, p_dest_lat, p_dest_lng, p_notes,
    p_pickup_label, p_dropoff_label, p_pickup_at, p_offer_sar,
    p_pickup_place, p_dropoff_place
  );

  if (v_result->>'ok')::boolean is not true then
    return v_result;
  end if;
  v_order_id := (v_result->>'order_id')::uuid;

  if coalesce((v_result->>'reused')::boolean, false) is false then
    update orders
       set rider_offer_mode = p_offer_mode
     where id = v_order_id
    returning city_id, pickup_at into v_order;

    -- (ب) الجدولة.
    if v_order.pickup_at is not null then
      v_lead := scheduled_order_minutes(v_order.city_id, 'scheduled_dispatch_lead_minutes');
      if v_order.pickup_at > now() + make_interval(mins => v_lead) then
        update orders
           set status = 'scheduled',
               dispatch_at = v_order.pickup_at - make_interval(mins => v_lead)
         where id = v_order_id and status = 'searching';
        insert into audit_log (city_id, action, entity_type, entity_id, payload)
        values (v_order.city_id, 'order.scheduled', 'order', v_order_id,
                jsonb_build_object('pickup_at', v_order.pickup_at,
                                   'dispatch_at', v_order.pickup_at - make_interval(mins => v_lead),
                                   'lead_minutes', v_lead));
        perform enqueue_rider_trip_notice(v_order_id, 'SCHEDULED');
      end if;
    end if;
  end if;

  -- (ج) الحالةُ وموعداها في الرد.
  select o.status, o.pickup_at, o.dispatch_at into v_existing
    from orders o where o.id = v_order_id;
  return v_result || jsonb_build_object(
    'status', v_existing.status,
    'pickup_at', v_existing.pickup_at,
    'dispatch_at', v_existing.dispatch_at);
end;
$fn$;
