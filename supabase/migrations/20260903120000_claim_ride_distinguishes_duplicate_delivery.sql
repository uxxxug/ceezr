-- ============================================================================
-- الغرض: `BUG-008` — تمييزُ «إعادةِ تسليمٍ لنقرةِ الفائزِ نفسِه» من «سُبِقتُ»
--   داخلَ `claim_ride`، فلا يُقالُ لصاحبِ الإسنادِ «سبقك سائق آخر».
-- الحالة: منفّذ فعلياً — 2026-09-03 (§11-أ من ROADMAP-MASTER، البند BUG-008).
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه: packages/infrastructure/dispatch/dispatch-adapters.ts،
--   وpackages/application/bots/driver-dialog.ts عند القبول.
-- ملاحظات مستقبلية: مصدرُ الحقيقةِ لِـ«مَن الفائزُ» هو `orders.assigned_driver_id`
--   وحدَه. أيُّ مسارٍ يُسنِدُ طلباً بغيرِ هذا العمودِ يُبطِلُ هذا التمييزَ.
--
-- ## العطلُ بحرفِه
--
-- تلغرام يُعيدُ تسليمَ التحديثِ نفسِه إذا تجاوزَ الويبهوك مهلتَه أو سقطت
-- العمليّةُ قبلَ الـ`ACK` (وهو مذكورٌ في ADR 0023 §٣). والسائقُ نفسُه قد يضغطُ
-- زرَّ القبولِ ثانيةً إذ لم يرَ الردَّ. فيَصِلُ `claim_ride` نداءٌ ثانٍ لنفسِ
-- `(order_id, driver_id)` بعدَ أن أُسنِدَ الطلبُ لهذا السائقِ بعينِه.
--
-- والطلبُ لم يبقَ `searching`، فأوّلُ `select ... for update skip locked` لا يجدُ
-- شيئاً، فيخرجُ `ORDER_NOT_CLAIMABLE` — وهو نفسُ جوابِ الخاسرِ في السباقِ. فردَّ
-- الحوارُ `driver.offer_taken`: «سبقك سائق آخر» — للفائزِ. الحالةُ التجاريّةُ
-- سليمةٌ تماماً (عرضٌ مقبولٌ واحدٌ وطلبٌ `matched` لهذا السائق)، والكذبُ في
-- **ما يُقال** وحدَه. وهو مُقاسٌ حرفيّاً ومُسجَّلٌ في `docs/SYSTEM_STATE.md`.
--
-- ## مفتاحُ التكرارِ — قائمٌ لا مُختَرَع
--
-- النقرةُ لا تحملُ إلّا `(order_id, driver_id)`، وهما بعينُهما مفتاحُ الإسنادِ
-- المُسجَّلِ: `orders.id` + `orders.assigned_driver_id`. فلا معرّفٌ جديدٌ يُضاف
-- ولا عمودٌ ولا جدولُ إزالةِ تكرارٍ: الإسنادُ المُثبَّتُ في القاعدةِ **هو**
-- سِجِلُّ المفتاحِ. والقياسُ بـ`is_driver_engaged_order_status` لا بقائمةِ
-- حالاتٍ مكتوبةٍ هنا — مصدرُ المعنى واحدٌ (القاعدة ٥).
--
-- ## ولماذا في القاعدةِ لا في الذاكرة
--
-- `apps/gateway/src/routes/update-dedup.ts` يمنعُ التحديثَ المكرَّرَ بنفسِ
-- `update_id` — ويُفقَدُ عندَ إعادةِ التشغيلِ ولا يُشارَكُ بين النسخِ، وهو يقولُ
-- ذلك عن نفسِه. والنقرةُ الثانيةُ من السائقِ تحملُ `update_id` **آخرَ** أصلاً،
-- فلا يراها مكرَّرةً أحدٌ. فالحكمُ لا يصحُّ إلّا من حيثُ استقرَّ الإسنادُ: صفُّ
-- الطلبِ. ولا قفلَ في العمليّةِ ولا `Map` ولا انتظارٌ مصطنع.
--
-- ## ولماذا القراءةُ بلا `for update`
--
-- الفحصُ يقعُ بعدَ أن أخفقَ `skip locked`، ويقرأُ على لقطةِ `read committed`.
-- ولو حُبِسَ على القفلِ لانتظرَ الخاسرُ الفائزَ في كلِّ سباقٍ حقيقيّ — وهو ما
-- تَجنَّبَه `skip locked` أصلاً. فمن قرأَ إسناداً باسمِه فهو الفائزُ يقيناً
-- (الإسنادُ لا يُنقَلُ إلى سائقٍ آخرَ)، ومن لم يقرأْ فالجوابُ الحاسمُ
-- `ORDER_NOT_CLAIMABLE` كما كان. والنداءانِ المتزامنانِ لنفسِ السائقِ سباقٌ
-- حقيقيٌّ لا تسليمٌ مكرَّرٌ: أحدُهما يظفرُ والآخرُ يُخبَرُ أنّه سُبِق — وهو
-- الجوابُ الصحيحُ في لحظتِه، ولا حالةَ نصفَ مكتملةٍ فيه.
--
-- ## وما لا يُفعَلُ في مسارِ التكرار
--
-- لا تحديثَ عرضٍ، ولا تحديثَ طلبٍ، ولا صفَّ تدقيقٍ ثانياً، ولا هويّةَ راكبٍ في
-- المغلَّفِ. الأخيرةُ عن قصدٍ: الحوارُ يُخطِرُ الراكبَ متى وجدَ راكباً، فإخراجُه
-- في التكرارِ كان سيُرسِلُ إليه «قَبِلَ سائقٌ طلبَك» مرّتَين. و`duplicate` يخرجُ
-- صريحاً كذلك ليمنعَ الحوارُ الأثرَ الثاني بحُكمٍ لا بغيابِ حقل.
-- ============================================================================

create or replace function claim_ride(p_order_id uuid, p_driver_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  orders%rowtype;
  v_offer  order_offers%rowtype;
  v_driver drivers%rowtype;
  v_now    timestamptz := now();
  v_rider  record;
  v_driver_name text;
begin
  -- القفل الذرّي: من لا يظفر بالصف لا ينتظر، بل يخسر فوراً
  select * into v_order
    from orders
   where id = p_order_id and status = 'searching'
     for update skip locked;

  if not found then
    -- `BUG-008`: أهو سباقٌ خُسِر، أم إعادةُ تسليمٍ لنقرةِ الفائزِ نفسِه؟
    -- الحَكَمُ الإسنادُ المُثبَّتُ، لا الرسالةُ ولا الذاكرة.
    select * into v_order
      from orders
     where id = p_order_id
       and assigned_driver_id = p_driver_id
       and is_driver_engaged_order_status(status);

    if found then
      select * into v_driver from drivers where id = p_driver_id;
      select u.full_name into v_driver_name
        from users u where u.id = v_driver.user_id;

      -- نفسُ نتيجةِ النداءِ الأوّلِ: نجاحٌ بنفسِ لحظةِ الإسنادِ المحفوظةِ لا
      -- بـ`now()` — فالمكرَّرُ لا يخترعُ وقتاً جديداً.
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'order_id', p_order_id,
        'driver_id', p_driver_id,
        'matched_at', v_order.matched_at,
        'city_id', v_order.city_id,
        'rider', null,
        'driver_name', v_driver_name,
        'driver_plate', v_driver.plate_number,
        'driver_vehicle', v_driver.vehicle_type
      );
    end if;

    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_CLAIMABLE');
  end if;

  select * into v_offer
    from order_offers
   where order_id = p_order_id
     and driver_id = p_driver_id
     and status = 'pending'
     and expires_at > v_now
   order by round desc
   limit 1
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'OFFER_NOT_VALID');
  end if;

  select * into v_driver from drivers where id = p_driver_id;
  if v_driver.city_id <> v_order.city_id then
    return jsonb_build_object('ok', false, 'error', 'CITY_MISMATCH');
  end if;

  update order_offers
     set status = 'accepted', responded_at = v_now
   where id = v_offer.id;

  update order_offers
     set status = 'cancelled', responded_at = v_now
   where order_id = p_order_id and id <> v_offer.id and status = 'pending';

  update orders
     set status = 'matched', assigned_driver_id = p_driver_id, matched_at = v_now
   where id = p_order_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, v_driver.user_id, 'order.claimed', 'order', p_order_id,
          jsonb_build_object('driver_id', p_driver_id, 'offer_id', v_offer.id,
                             'round', v_offer.round));

  -- هويّةُ الراكب تُقرأ داخل المعاملة نفسها. والقراءةُ متساهلة عن قصد: راكبٌ
  -- بلا صفّ مستخدمٍ سليم لا يجوز أن يُبطِل إسناداً وقع — يخرج المغلّف بلا راكب
  -- فيمتنع الإخطار وحده.
  select u.telegram_id as telegram_id,
         coalesce(u.language_code, 'ar') as language_code,
         u.full_name as full_name
    into v_rider
    from riders r
    join users u on u.id = r.user_id
   where r.id = v_order.rider_id;

  -- اسمُ السائق من `users` لا من `drivers`: الأسماءُ كلّها في جدول المستخدمين،
  -- و`drivers` يحمل المهنةَ لا الهويّة.
  select u.full_name into v_driver_name
    from users u where u.id = v_driver.user_id;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'order_id', p_order_id,
    'driver_id', p_driver_id,
    'matched_at', v_now,
    'city_id', v_order.city_id,
    'rider', case
               when v_rider.telegram_id is null then null
               else jsonb_build_object(
                      'rider_id', v_order.rider_id,
                      'telegram_id', v_rider.telegram_id,
                      'language_code', v_rider.language_code,
                      'full_name', v_rider.full_name)
             end,
    'driver_name', v_driver_name,
    'driver_plate', v_driver.plate_number,
    'driver_vehicle', v_driver.vehicle_type
  );
end;
$$;

comment on function claim_ride(uuid, uuid) is
  'إسنادُ الطلب ذرّياً لسائقٍ قَبِل عرضه، ويُميّز إعادةَ تسليمِ نقرةِ الفائزِ نفسِه (BUG-008).';
