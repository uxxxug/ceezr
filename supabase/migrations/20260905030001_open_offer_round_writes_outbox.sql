-- ============================================================================
-- الغرض: BUG-004 — كتابةُ صفّ outbox الإشعار في معاملة فتح الدورة نفسها لا بعدها.
--   قبل هذا كان open_offer_round يُدرج العروض ويُرفع broadcast_round في معاملةٍ
--   واحدة، ثمّ يُرسل الإشعارُ لتيليجرام خارجها — فإذا فشل الإرسالُ بعد الالتزام
--   وقع «تغيّر الحالة بلا إشعار». الآن يُدرج صفُّ notification_outbox في CTE
--   الإدراجِ نفسه: ما التزمَ بالعرضِ التزمَ بإشعارٍ ينتظر العاملَ، وما فُشلَ
--   لم يُخلق له أثرٌ يتيم.
-- الحالة: منفّذ فعلياً — 2026-09-05 (§11-أ، BUG-004).
-- ينتمي إلى: supabase/migrations
-- يُتوقّع أن يستخدمه: packages/infrastructure/dispatch/dispatch-adapters.ts
--   (createOfferWriter.openRound) — لم تتغيّر توقيعُ الدالّة ولا مفتاحُ العودة:
--   يبقى offer_ids مصفوفةً كما في BUG-003، ويزيد عليها أثرٌ ذرّيٌّ في outbox.
-- ملاحظات مستقبلية: مصدرُ صفوفِ outbox هو CTE الإدراجِ نفسه، فلا قراءةٌ ثانيةٌ
--   ولا نافذةُ سباق. والقيدُ الفريدُ على offer_id يمنع تكرارَ صفٍّ للعرضِ نفسه
--   لو أُعيد تشغيلُ الدالة — وهو أمانٌ لا يُتوقَّعُ أن يُلمَّ به إلا عند الخطأ.
-- ============================================================================

create or replace function open_offer_round(
  p_order_id   uuid,
  p_round      integer,
  p_expires_at timestamptz,
  p_entries    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    orders%rowtype;
  v_status   text;
  v_inserted integer;
  v_offer_ids jsonb;
begin
  -- الحجزُ والحراسةُ في جملةٍ واحدةٍ: من تُصِب صفّاً فقد ظفرَ بالدورةِ وحدَه.
  update orders
     set broadcast_round = p_round,
         updated_at      = now()
   where id              = p_order_id
     and status          = 'searching'
     and broadcast_round = p_round - 1
  returning * into v_order;

  if not found then
    select status::text into v_status from orders where id = p_order_id;
    if v_status is null then
      return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
    end if;
    if v_status <> 'searching' then
      return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_SEARCHING',
                                'status', v_status);
    end if;
    return jsonb_build_object('ok', false, 'error', 'ROUND_ALREADY_OPENED',
                              'status', v_status);
  end if;

  -- BUG-004: الإدراجُ والكتابةُ في outbox في CTE واحد — معاملةٌ واحدةٌ ذرّيّة.
  -- ما وقعَ في القاعدةِ من عرضٍ وقعَ معه صفُّ إشعارٍ ينتظر العاملَ، فلا يُفقد
  -- إشعارٌ بفشلِ تيليجرام بعد الالتزام. والمصدرُ هو الإدراجُ نفسه لا قراءةٌ
  -- ثانيةٌ، فلا نافذةُ سباق. (BUG-005: الحراسةُ في update orders الذرّيّة.
  --  BUG-003: offer_ids تُميّز عرضاً عن عرضٍ لزرِّ الرفض.)
  with inserted as (
    insert into order_offers
      (city_id, order_id, driver_id, round, score, distance_km, status, expires_at)
    select v_order.city_id,
           p_order_id,
           (entry->>'driver_id')::uuid,
           p_round,
           (entry->>'score')::numeric,
           (entry->>'distance_km')::numeric,
           'pending',
           p_expires_at
      from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) as entry
    on conflict (order_id, driver_id, round) do nothing
    returning id, driver_id
  ),
  outboxed as (
    insert into notification_outbox (city_id, kind, offer_id, order_id, driver_id)
    select v_order.city_id, 'offer', id, p_order_id, driver_id
      from inserted
  )
  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('offer_id', id, 'driver_id', driver_id)),
                  '[]'::jsonb)
    into v_inserted, v_offer_ids
    from inserted;

  return jsonb_build_object('ok', true, 'round', p_round,
                           'offers', v_inserted,
                           'offer_ids', v_offer_ids);
end;
$$;

comment on function open_offer_round(uuid, integer, timestamptz, jsonb) is
  'فتحُ دورةِ بثٍّ ذرّيٌّ: يحرسُ status=searching ويحجزُ رقمَ الدورةِ ويُنشئُ عروضَها وصفوفَ إشعارِها في معاملةٍ واحدةٍ (BUG-005 + BUG-004)، ويُرجعُ معرّفاتِ العروضِ المُدرَجةِ ليحصرَ الرفضُ عرضاً بعينِه (BUG-003).';

revoke all on function open_offer_round(uuid, integer, timestamptz, jsonb) from public;
grant execute on function open_offer_round(uuid, integer, timestamptz, jsonb) to service_role;
