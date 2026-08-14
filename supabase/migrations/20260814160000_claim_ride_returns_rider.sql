-- ============================================================================
-- الغرض: توسيع مغلّف `claim_ride` بهويّة الراكب — ليُخطَر بقبول سائقه لحظةَ وقوعه.
-- الحالة: منفّذ فعلياً — 2026-08-14 (§4.2 من أمر الإطلاق التجاري).
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه: packages/infrastructure/dispatch/dispatch-adapters.ts،
--   وpackages/application/bots/driver-dialog.ts عند القبول.
-- ملاحظات مستقبلية: أيّ حقلٍ يُضاف للمغلّف يُضاف هنا لا في التطبيق — قارئُ المغلّف
--   يتجاهل ما لا يعرف، والقديمُ يبقى عاملاً.
--
-- ## ما تغيّر ولماذا
--
-- منطقُ الإسناد لم يتغيّر بحرفٍ واحد: نفسُ `for update skip locked`، ونفسُ فحص
-- العرض والمدينة، ونفسُ التحديثات الثلاثة وسجلّ التدقيق. المضافُ **قراءةٌ**
-- واحدةٌ لاسم الراكب ومعرّفه في تلغرام ولغته، تُلحَق بالمغلّف.
--
-- والسبب: قبل هذا الترحيل كان القبول يُخطر السائق وحده. الراكبُ الذي أرسل طلبه
-- ثمّ قَبِله سائقٌ لم يكن يُبلَّغ إطلاقاً في هذا المسار (مسارُ التفاوض وحده كان
-- يُبلّغ عبر `notifyAgreed`)، فكان يجلس ينتظر بلا خبرٍ حتى ينطلق السائق فعلاً.
-- ومع رابط التتبّع صار الخبرُ ضرورةً مضاعفة: الرابطُ يُصدَر باسم الراكب، فلا
-- يُصدَر إلا وقد عُرِف من هو.
--
-- ## ولماذا في القاعدة لا في التطبيق
--
-- كان يمكن أن يقرأ البوتُ الراكبَ باستعلامٍ ثانٍ بعد نجاح القبول. ورُفض: بين
-- القبول والاستعلام الثاني نافذةٌ يمكن أن يُلغى فيها الطلب أو يُغيّر الراكب لغته،
-- فيُخطَر بلغةٍ ليست لغته أو يُخطَر عن طلبٍ لم يبقَ. والقراءةُ داخل الدالّة تقع
-- في المعاملة نفسها التي أسندت الطلب، فالمقروءُ هو الحال الذي أُسنِد عليه بعينه.
--
-- ولا سرّ يخرج: لا هاتف ولا عنوان. المعروضُ اسمٌ ومعرّفُ محادثةٍ ولغةٌ — وهو
-- بعينه ما يخرج في `notifyAgreed` القائم منذ تفاوض القروبات، فلا توسيعَ صلاحيةٍ
-- هنا بل توحيدُ ما يُعطى للطرف المُبلِّغ في المسارين.
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
  'إسنادُ الطلب ذرّياً لسائقٍ قَبِل عرضه، ويُعيد هويّةَ الراكب ليُخطَر بلغته (§4.2).';
