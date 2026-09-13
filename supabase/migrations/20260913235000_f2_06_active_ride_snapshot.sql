-- ============================================================================
-- migration-phase: expand
--
-- الغرض: لقطةُ الرحلةِ النشطةِ للراكبِ المالكِ — حالةٌ وطرفانِ وسائقٌ مُسنَدٌ
--   وموقعُه **بعُمرِه** — في استفسارٍ واحدٍ (البند `F2-06` · `SR-06`).
-- الحالة: منفَّذٌ فعليّاً — البند `F2-06`.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `packages/infrastructure/transport/active-ride-store.ts` وحدَه.
-- يُتوقع أن يستخدمه لاحقاً: `F2-07` (الإنهاءُ والتقييمُ) يقرأُ اللقطةَ نفسَها
--   بعدَ `completed` ولا يكتبُ قارئاً ثانياً؛ و`F3-03` **يكتبُ** أطواراً
--   (`arrived_at`) فتظهرُ ههنا بلا تغييرِ عقدٍ.
--
-- ## لماذا دالّةٌ واحدةٌ لا ثلاثةُ استفساراتٍ
--
-- الشاشةُ تسألُ ثلاثةَ أسئلةٍ معاً: **هل هذهِ رحلتي؟** و**من السائقُ؟** و**كم
-- عُمرُ نقطتِه؟**. ولو قرأَ التطبيقُ الصفَّ ثمَّ قرَّرَ، لَأمكنَ أن تُنسى شرطُ
-- الملكيّةِ في مسارٍ واحدٍ فيُسرَّبَ صفٌّ — ولو قُرِئَ الموقعُ في استفسارٍ ثانٍ
-- لَاختلفَ زمنُ القراءتَينِ فصارَ العُمرُ المنشورُ أقدمَ أو أحدثَ من نقطتِه.
-- فالحكمُ ههنا: **قراءةٌ واحدةٌ بساعةٍ واحدةٍ**.
--
-- ## ولماذا يُنشَرُ عُمرُ الموقعِ رقماً ولا يُنشَرُ الموقعُ وحدَه
--
-- `BUG-001` **قائمٌ**: كتابةُ `drivers.last_location` غيرُ محروسةٍ بترتيبٍ، فقد
-- تُكتَبَ إصلاحةٌ أقدمُ فوقَ أحدثَ. ونقطةٌ تُرسَمُ على خريطةِ الراكبِ بلا عُمرٍ
-- **شاهدٌ كاذبٌ على حداثتِها**. فالعُمرُ يُنشَرُ أبداً، والحكمُ في إظهارِه أو
-- حجبِه قرارُ نطاقٍ لا قرارُ SQL — ولذلكَ لا حدَّ أقصى مكتوبٌ ههنا.
--
-- ## ولماذا لا طورَ «وصلَ السائقُ» في هذه اللقطةِ
--
-- لأنَّه **لا عمودَ له**: `orders` فيها `matched_at` و`started_at`
-- و`completed_at` ولا `arrived_at`. وكاتبُ ذاكَ الطورِ تطبيقُ السائقِ
-- (`SD-05` · `F3-03`) وهوَ غيرُ مبنيٍّ. **فالطورُ لا يُخترَعُ من قُربِ مسافةٍ**:
-- «قاربَ السائقُ» ليسَ «وصلَ»، ورسمُ مرحلةٍ لم تحدثْ كذبٌ على الراكبِ.
--
-- ## وما لا تفعلُه هذه الدالّةُ عن قصدٍ
--
--   ــ **لا تُعلِنُ رقمَ هاتفٍ** — لا للسائقِ ولا للراكبِ. الاتصالُ المُقنَّعُ
--      غيرُ مبنيٍّ، وعرضُ رقمٍ خاصٍّ قرارُ خصوصيّةٍ لا قرارُ واجهةٍ.
--   ــ **لا تعرفُ أجرةً ولا وسيلةَ دفعٍ ولا عقوبةَ إلغاءٍ** (`ADR 0039` §٤ ·
--      `م13-7`) — ولا حقلَ مُعَدّاً لها.
--   ــ **لا رمزَ تتبُّعٍ ولا رابطَ مشاركةٍ** — ذاكَ `F2-09` وله جدولُه ودالّتُه.
--   ــ **لا تُميِّزُ «ليسَ لك» من «غيرُ موجودٍ»**: `ORDER_NOT_FOUND` للأمرَينِ،
--      كي لا يُصبِحَ الرمزُ عدَّادَ معرّفاتٍ صحيحةٍ لمن يجرِّبُها.
-- ============================================================================

create or replace function active_ride_snapshot(
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
  v_user_id  uuid;
  v_rider_id uuid;
  v_order    record;
  -- ولماذا حقولُ السائقِ **متغيّراتٌ مفردةٌ** لا سجلٌّ (`record`): سجلٌّ لم
  -- يُسنَدْ إليه شيءٌ لا يجوزُ ذِكرُه في استعلامِ الإرجاعِ **ولو في فرعٍ لا
  -- يُسلَكُ** — بنيتُه غيرُ معلومةٍ فيسقطُ التخطيطُ بـ`55000`. وقياسُ التكاملِ
  -- على قاعدةٍ حقيقيّةٍ هوَ ما كشفَ ذلكَ: الرحلةُ بلا سائقٍ مُسنَدٍ كانَت
  -- تُسقِطُ الدالّةَ كلَّها لا أن تُنشَرَ بلا بطاقةٍ.
  v_driver_id      uuid;
  v_vehicle_type   text;
  v_plate_number   text;
  v_rating_average numeric;
  v_rating_count   integer;
  v_driver_lat     double precision;
  v_driver_lng     double precision;
  v_position_age   integer;
  v_full_name      text;
  v_driver_name    text;
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

  -- الملكيّةُ شرطُ القراءةِ، وغيرُ المالكِ يُرَدُّ `ORDER_NOT_FOUND` لا `FORBIDDEN`.
  select o.id,
         o.status,
         o.service,
         o.assigned_driver_id,
         o.pickup_label,
         o.dropoff_label,
         st_y(o.pickup::geometry)  as pickup_lat,
         st_x(o.pickup::geometry)  as pickup_lng,
         st_y(o.dropoff::geometry) as dropoff_lat,
         st_x(o.dropoff::geometry) as dropoff_lng,
         o.created_at,
         o.matched_at,
         o.started_at,
         o.completed_at
    into v_order
  from orders o
  where o.id = p_order_id and o.rider_id = v_rider_id;

  if v_order.id is null then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  -- بطاقةُ السائقِ **تُقرأُ متى كانَ مُسنَداً وحدَه**. والقيدُ
  -- `orders_matched_requires_driver` يمنعُ `matched` بلا سائقٍ في القاعدةِ،
  -- والشرطُ ههنا **ليسَ تكراراً له**: رحلةٌ أُلغِيَت بعدَ إسنادٍ تبقى بسائقٍ
  -- مكتوبٍ، وعرضُ بطاقتِه على شاشةٍ حالتُها «أُلغِيَت» عرضٌ بلا معنى.
  if v_order.assigned_driver_id is not null
     and v_order.status in ('matched', 'in_progress') then
    select d.id,
           d.vehicle_type,
           d.plate_number,
           d.rating_average,
           coalesce(d.rating_count, 0),
           st_y(d.last_location::geometry),
           st_x(d.last_location::geometry),
           case
             when d.last_location_at is null then null
             else greatest(0, floor(extract(epoch from (now() - d.last_location_at)))::integer)
           end,
           u.full_name
      into v_driver_id,
           v_vehicle_type,
           v_plate_number,
           v_rating_average,
           v_rating_count,
           v_driver_lat,
           v_driver_lng,
           v_position_age,
           v_full_name
    from drivers d
    join users u on u.id = d.user_id
    where d.id = v_order.assigned_driver_id;

    v_driver_name := nullif(split_part(coalesce(trim(v_full_name), ''), ' ', 1), '');
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'status', v_order.status,
    'service', v_order.service,
    'pickup', jsonb_build_object(
      'lat', v_order.pickup_lat, 'lng', v_order.pickup_lng, 'label', v_order.pickup_label
    ),
    -- الوجهةُ `null` جائزةٌ: `dropoff` عمودٌ يقبلُ العَدَمَ (خدماتٌ بلا وجهةٍ).
    'dropoff', case
      when v_order.dropoff_lat is null then null
      else jsonb_build_object(
        'lat', v_order.dropoff_lat, 'lng', v_order.dropoff_lng, 'label', v_order.dropoff_label
      )
    end,
    'created_at', v_order.created_at,
    'matched_at', v_order.matched_at,
    'started_at', v_order.started_at,
    'completed_at', v_order.completed_at,
    'driver', case
      when v_driver_id is null then null
      else jsonb_build_object(
        'first_name', v_driver_name,
        'vehicle_type', v_vehicle_type,
        'plate_number', v_plate_number,
        -- التقييمُ `null` حتّى يوجَدَ، **ولا يُستبدَلُ بخمسةٍ ولا بمتوسِّطٍ
        -- منصّيٍّ**: «لا تقييمَ بعدُ» جوابٌ صادقٌ، و«٥٫٠» لسائقٍ بلا رحلةٍ كذبٌ.
        'rating_average', v_rating_average,
        'rating_count', coalesce(v_rating_count, 0),
        'position', case
          when v_driver_lat is null then null
          else jsonb_build_object(
            'lat', v_driver_lat,
            'lng', v_driver_lng,
            'age_seconds', v_position_age
          )
        end
      )
    end
  );
end;
$fn$;

comment on function active_ride_snapshot(bigint, uuid) is
  'لقطةُ الرحلةِ النشطةِ للمالكِ وحدَه في استفسارٍ واحدٍ: الحالةُ والخدمةُ '
  'وطرفا الرحلةِ وأختامُ الأطوارِ، وبطاقةُ السائقِ المُسنَدِ متى كانَ matched أو '
  'in_progress وحدَه، وموقعُه **مقروناً بعُمرِه بالثواني** (BUG-001 قائمٌ فالنقطةُ '
  'بلا عُمرٍ شاهدٌ كاذبٌ). ولا هاتفَ ولا أجرةَ ولا عقوبةَ إلغاءٍ ولا رمزَ مشاركةٍ. '
  'وغيرُ المالكِ يُرَدُّ ORDER_NOT_FOUND لا FORBIDDEN.';

-- ===== نزعُ التنفيذِ عن الأدوارِ العامّةِ.
--
-- هذا السطرُ **ليسَ زينةً**: `postgres` يمنحُ `execute` لدورِ `public` على كلِّ
-- دالّةٍ جديدةٍ **تلقائيّاً**، فدالّةٌ تُنشَأُ ولا يُنزَعُ عنها التنفيذُ تصيرُ
-- مقروءةً بالمفتاحِ العامِّ المنشورِ في العميلِ. ولمّا كانَت هذه الدالّةُ
-- `security invoker` فلن تُعيدَ صفّاً لغيرِ مالكِه، **إلّا أنَّ بقاءَها
-- منفَّذةً يجعلُها أداةَ تعدادٍ**: زمنُ ردٍّ مختلفٌ بينَ معرِّفٍ موجودٍ ومعدومٍ
-- يُنبئُ عن الوجودِ ولو كانَ الجوابُ واحداً. والدوالُ تُنادَى من الخادمِ
-- بمفتاحِ الخدمةِ وحدَه.
--
-- **وقد كشفَ هذا الغيابَ حكمُ CI لا فحصٌ محلّيٌّ**: اختبارُ
-- `tests/integration/database-privilege-surface.test.ts` (الطبقةُ ٢) أسقطَ
-- الدفعةَ الأولى بـ `active_ride_snapshot(bigint,uuid)` وحدَها في قائمةِ
-- المنالِ — فأُصلِحَ السببُ ههنا، **وأُضيفَت قاعدةٌ سادسةٌ ساكنةٌ** إلى حاجزِ
-- `UX-022` كي يُمسَكَ المِثلُ محلّيّاً قبلَ الدفعِ لا بعدَه.
revoke execute on function active_ride_snapshot(bigint, uuid) from public, anon, authenticated;
