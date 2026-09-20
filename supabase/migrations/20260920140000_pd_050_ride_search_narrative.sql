-- migration-phase: expand
--
-- الغرض: مآلُ الانتظارِ يُسرَدُ كما يجري — دالّةُ `ride_search_state` تُخبِرُ
--   الطبقةَ العليا بطورَينِ لم تكن تراهما: **فتحُ دورةِ غيرِ المشتركينَ**
--   (`wider_circle_opened`) و**التصعيدُ المُسلَّمُ إلى قروبِ الإسنادِ**
--   (`escalated`) — فيكتملُ للراكبِ السردُ: بحثٌ → توسيعٌ → تصعيدٌ → إسنادٌ
--   (البندُ `PD-050` · خارطةُ دَينِ المنتَجِ §4 الصفُّ الأوّلُ).
-- الحالة: منفَّذٌ فعليّاً — 2026-09-20.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `ride_search_state` تُقرَأُ من `packages/infrastructure/transport/ride-request-store.ts`
--   ويُشتقُّ الطورُ من الرايتَينِ في `packages/domain/transport/ride-request.ts`
--   (`searchPhaseOf`) — القاعدةُ تعطي الوقائعَ والنطاقُ يُصنِّفُ الطورَ (القاعدة 0.3).
-- يُتوقع أن يستخدمه لاحقاً: `F2-06` يقرأُ الدالّةَ نفسَها بعدَ الإسنادِ.
--
-- ## لماذا الرايةُ من الجداولِ التشغيليّةِ لا من رسائلِ البوتِ
--
-- رسالتا البوتِ (`rider.searching_wider_circle` و`rider.no_driver_found`)
-- خبرٌ **يُرسَلُ مرّةً**، أمّا الشاشةُ فتُقرَأُ في أيِّ لحظةٍ — فمصدرُ الحقيقةِ
-- للشاشةِ يجبُ أن يكونَ **حالةً قائمةً** لا حدثًا مضى: صفٌّ في
-- `unsubscribed_negotiations` يعني «الدائرةُ الأوسعُ مفتوحةٌ» ما دامَ الطلبُ
-- حيًّا، وأثرُ `order.escalated` المُسلَّمُ يعني «وصلَ طلبُكَ إلى فريقِ الإسنادِ».
-- ولو اشتُقَّ الطورُ من صندوقِ الصادرِ لتغيّرَتِ الشاشةُ بتنظيفِ رسائلٍ قديمةٍ —
-- والسردُ لا يُبنى على ما يُحذَفُ.
--
-- ## ولماذا «المُسلَّمُ» وحدهُ يُصعِّدُ
--
-- أثرُ التصعيدِ غيرِ المُسلَّمِ (شوطٌ أخفقَ إرسالُ بطاقتِهِ) ليسَ خبرًا للراكبِ
-- بعدُ: `escalate_order` يُعيدُ استعمالَهُ في الشوطِ التالي، فعرضُهُ «مُصعَّدًا»
-- يقولُ ما لم يحدثْ. ومعَ ذلك تبقى الصفوفُ القديمةُ — المكتوبةُ قبلَ مفتاحِ
-- `delivered` — تصعيداتٍ سلّمتْ فعلاً (`coalesce(..., true)`) كما قرَّرَتْهُ
-- هجرةُ `20260813090000` نفسُها، فدلالتُها ههنا مطابقةٌ لدلالتِها هناك.
--
-- ## وما لا يفعله هذا الترحيلُ عن قصدٍ
--
--   ــ **لا يحذفُ `broadcast_round` من الخرجِ**: الخرجُ الداخليُّ يبقى كما هو
--      (أمانُ ترتيبِ النشرِ)، وحجبُهُ عن الراكبِ قرارُ طبقةِ البوّابةِ والعقدِ —
--      لا قرارَ القاعدةِ.
--   ــ **لا يعدّلُ التوزيعَ**: `open_unsubscribed_cycle` و`escalate_order`
--      و`decideRotation` لم تُمَسّ — هذا ترحيلُ قراءةٍ لا ترحيلَ محرّكٍ.
--   ــ **لا تُنشَرُ الرايتانِ للعميلِ**: خرجُ الدالّةِ ملكُ الطبقاتِ الداخليّةِ؛
--      ما يعبرُ إلى Mini App هو الطورُ `phase` وحدهُ بعدَ اشتقاقِهِ.
--
-- set local search_path = public; -- (تُدار المعاملةُ من مشغّلِ الهجراتِ)

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
    -- الدائرةُ الأوسعُ مفتوحةٌ: صفٌّ واحدٌ في دوراتِ غيرِ المشتركينَ يكفي —
    -- والفهرسُ الفريدُ الجزئيُّ `unsubscribed_negotiations_single_open` يمسُّ
    -- الحيَّ منها، وههنا يُسألُ عن الوجودِ قطّ (أيُّ دورةٍ) لأنَّ الراكبَ يسألُ
    -- «هل وسّعتم؟» لا «في أيِّ دورةٍ أنا؟».
    'wider_circle_opened', exists (
      select 1 from unsubscribed_negotiations un where un.order_id = v_order.id
    ),
    -- التصعيدُ المُسلَّمُ وحدَهُ (راجعْ تعليقَ الرأسِ): الصفوفُ القديمةُ بلا
    -- المفتاحِ تُقرَأُ مُسلَّمةً كما في حراسةِ `mark_escalation_delivered`.
    'escalated', exists (
      select 1 from audit_log a
       where a.entity_type = 'order' and a.entity_id = v_order.id
         and a.action = 'order.escalated'
         and coalesce((a.payload->>'delivered')::boolean, true) = true
    ),
    -- الإلغاءُ **بلا عقوبةٍ قبلَ الإسنادِ** نصُّ `SR-05`. والقابليّةُ تُحكَمُ ههنا
    -- لا في العميلِ، لأنَّ زرّاً يُظهِرُهُ العميلُ بحسبِ حالةٍ قديمةٍ يُلغي رحلةً
    -- أُسنِدَت فعلاً — أو يُخفي زرّاً يستحقُّه الراكبُ.
    'cancellable_without_penalty', v_order.status = 'searching'
  );
end;
$fn$;

comment on function ride_search_state(bigint, uuid) is
  'حالةُ البحثِ للمالكِ وحدَه: الحالةُ والخدمةُ وختمُ الإنشاءِ وعددُ السائقينَ '
  'المتمايزينَ المُخطَرينَ فعلاً — مُحتسَباً من order_offers لا مُخترَعاً — '
  'وقابليّةُ الإلغاءِ بلا عقوبةٍ، ومعَها رايتا المآلِ: فتحُ دورةِ غيرِ '
  'المشتركينَ (wider_circle_opened من unsubscribed_negotiations) والتصعيدُ '
  'المُسلَّمُ (escalated من آثارِ order.escalated المُسلَّمةِ). وغيرُ المالكِ '
  'يُرَدُّ ORDER_NOT_FOUND لا FORBIDDEN.';
