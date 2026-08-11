-- ----------------------------------------------------------------------------
-- إلغاء الطلب كحدث واحد يعلم به كل النظام
--
-- العطب الذي عالجته هذه الهجرة، مثبتاً من قاعدة الإنتاج في 2026-08-11:
-- كان الإلغاء تحديثاً منفرداً لصفّ orders لا غير. فلا العروض المعلّقة تُلغى،
-- ولا السائق المُسنَد يُخبَر، ولا بطاقة القروب تُسحب، ولا يبقى للحدث أثر في
-- audit_log. أي أن الإلغاء كان قراراً لا يعلم به إلا الجدول الذي كُتب فيه.
--
-- claim_ride كانت مترابطة أصلاً: تقفل الصف، وتُلغي العروض المنافسة، وتكتب في
-- السجل. هذه الدالّة تُقابلها في الاتجاه المعاكس، وبالانضباط نفسه.
--
-- تُعيد الدالّة من يجب إخطارهم، لأن الإخطار عبر تيليجرام لا يجوز أن يجري داخل
-- المعاملة: فشل الشبكة لا يصحّ أن يُرجِع إلغاءً وافق عليه العميل.
-- ----------------------------------------------------------------------------

create or replace function cancel_order_by_rider(
  p_order_id uuid,
  p_rider_id uuid,
  p_reason   text default 'rider_cancelled'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    orders%rowtype;
  v_rider    riders%rowtype;
  v_now      timestamptz := now();
  v_offers   jsonb;
  v_assigned jsonb;
  v_negot    jsonb;
begin
  -- القفل الذرّي: يمنع أن يقبل سائق الطلب في اللحظة نفسها التي يُلغى فيها.
  -- claim_ride تشترط status='searching' تحت قفل مماثل، فأحد الطرفين يخسر حتماً.
  select * into v_order
    from orders
   where id = p_order_id
     and rider_id = p_rider_id
     and status in ('searching', 'matched')
     for update;

  if not found then
    -- نميّز الأسباب: «لا يوجد طلب» و«فات أوان الإلغاء» ليسا شيئاً واحداً،
    -- وقول أحدهما مكان الآخر كذب على العميل.
    if exists (select 1 from orders where id = p_order_id and rider_id = p_rider_id) then
      return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_CANCELLABLE');
    end if;
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  select * into v_rider from riders where id = p_rider_id;

  -- 1) السائقون أصحاب العروض المعلّقة: يجب أن يعرفوا أن الطلب لم يعد معروضاً،
  --    وإلا ظلّت بطاقة العرض في محادثتهم تدعوهم إلى قبول ما لا يُقبل.
  with cancelled_offers as (
    update order_offers o
       set status = 'cancelled', responded_at = v_now
     where o.order_id = p_order_id and o.status = 'pending'
    returning o.driver_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'driver_id', d.id, 'telegram_id', u.telegram_id, 'language', u.language_code)), '[]'::jsonb)
    into v_offers
    from cancelled_offers co
    join drivers d on d.id = co.driver_id
    join users u   on u.id = d.user_id;

  -- 2) السائق المُسنَد إن كان الطلب مطابَقاً: هو في طريقه فعلاً، وإخفاء الإلغاء
  --    عنه أسوأ من الإلغاء نفسه.
  if v_order.assigned_driver_id is not null then
    select jsonb_build_object(
             'driver_id', d.id, 'telegram_id', u.telegram_id, 'language', u.language_code)
      into v_assigned
      from drivers d join users u on u.id = d.user_id
     where d.id = v_order.assigned_driver_id;
  end if;

  -- 3) بطاقات القروب: التفاوض المفتوح يُغلق، ويُعاد معرّف الرسالة لتُحرَّر البطاقة
  --    في القروب بدل أن تبقى معروضة لطلب انتهى.
  with closed as (
    update unsubscribed_negotiations n
       set status = 'cancelled', settled_at = v_now, updated_at = v_now
     where n.order_id = p_order_id and n.status in ('collecting', 'negotiating')
    returning n.group_message_id, n.city_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'group_message_id', c.group_message_id)) filter (where c.group_message_id is not null),
         '[]'::jsonb)
    into v_negot
    from closed c;

  -- 4) الطلب نفسه — بعد الفروع لا قبلها، حتى تُقرأ الحالة السابقة سليمة أعلاه
  update orders
     set status = 'cancelled',
         cancelled_reason = p_reason,
         updated_at = v_now
   where id = p_order_id;

  -- 5) الأثر الدائم: بغير هذا السطر يصبح الإلغاء حدثاً بلا ذاكرة
  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, v_rider.user_id, 'order.cancelled', 'order', p_order_id,
          jsonb_build_object('reason', p_reason,
                             'previous_status', v_order.status,
                             'service', v_order.service,
                             'assigned_driver_id', v_order.assigned_driver_id,
                             'notified_offers', jsonb_array_length(v_offers)));

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'city_id', v_order.city_id,
    'service', v_order.service,
    'previous_status', v_order.status,
    'pickup_label', v_order.pickup_label,
    'dropoff_label', v_order.dropoff_label,
    'created_at', v_order.created_at,
    'offer_drivers', v_offers,
    'assigned_driver', coalesce(v_assigned, 'null'::jsonb),
    'group_cards', v_negot
  );
end;
$$;

comment on function cancel_order_by_rider(uuid, uuid, text) is
  'إلغاء ذرّي يُلغي العروض ويُغلق التفاوض ويكتب في السجل، ويُعيد من يجب إخطارهم.';

revoke all on function cancel_order_by_rider(uuid, uuid, text) from public;
grant execute on function cancel_order_by_rider(uuid, uuid, text) to service_role;
