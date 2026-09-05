-- ============================================================================
-- الغرض: `BUG-003` — أن يملكَ زرُّ الرفضِ **معرّفَ العرضِ الذي يرفضُه**، فلا يُلغي
--   رفضٌ نقرتُه على عرضِ الجولةِ الثانيةِ عرضَ الجولةِ الأولى المعلَّقَ للسائقِ
--   نفسِه على الطلبِ نفسِه. قبلَ هذا لم يكن في المغلَّفِ ولا في الزرِّ ما يُميّزُ
--   عرضاً عن عرضٍ، فكانَ الرفضُ يُصيبُ بالاسمِ `(order_id, driver_id)` كلَّ عرضٍ
--   معلَّقٍ للسائقِ مهما اختلفتْ جولتُه — ويُلغي بضغطةٍ واحدةٍ عروضاً ما زالت
--   محتمِلةً لم تنتهِ مهلتُها بعدُ.
-- الحالة: منفّذ فعلياً — 2026-09-05 (§11-أ من ROADMAP-MASTER، البند BUG-003).
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه: packages/infrastructure/dispatch/dispatch-adapters.ts
--   (`createOfferWriter.openRound`) فيقرأُ `offer_ids` ويُمرِّرُها إلى الإشعارِ
--   فتبني مُحوّلاتُ الإخطارِ زرَّ رفضٍ يحمِلُ `offerId` وحده.
-- ملاحظات مستقبلية: مصدرُ المعرّفِ هو الإدراجُ نفسُه لا استعلامٌ لاحقٌ، فلا
--   نافذةُ سباقٍ بين فتحِ الدورةِ وقراءةِ معرّفاتِها: من فتحَ الدورةَ هو من يملكُ
--   معرّفاتِ عروضِها في المغلَّفِ نفسِه.
--
-- ## لماذا لا يُغيَّرُ مفتاحُ `offers` القائمُ
--
-- تُرجِعُ الدالّةُ منذُ `BUG-005` مفتاحَ `offers` عدداً صحيحاً يَعُدُّ المُدرَجَ.
-- ولم يُكسَرْ هذا العقدُ: يبقى `offers` عدداً، ويُضافُ `offer_ids` مصفوفةً
-- تحملُ `{offer_id, driver_id}` لكلِّ صفٍّ أُدرجَ فعلاً. فلا يتغيّرُ سلوكٌ قائمٌ
-- على العدِّ، ويُضافُ ما يُميّزُ عرضاً عن عرضٍ.
--
-- ## ولماذا `on conflict do nothing` مع `returning`
--
-- القيدُ الفريدُ `(order_id, driver_id, round)` يَمنعُ تكرارَ عرضِ السائقِ في
-- الجولةِ نفسِها. وفي الجولةِ الجديدةِ لا يُتوقَّعُ تعارضٌ (لا عرضَ له فيها
-- بعدُ)، لكنَّ `do nothing` يبقى صمّامَ أمانٍ: إن وُجدَ صفٌّ متبقٍّ فلن يُفسدَ
-- الإدراجُ، ولن يُعادَ في `offer_ids` إلّا ما أُدرجَ حقّاً. فالعددُ والمصفوفةُ
-- متّفقانِ دائماً على الحقيقةِ نفسِها: ما وقعَ في القاعدةِ لا ما طُلبَ إدراجُه.
--
-- ## الإسنادُ بالإدراجِ لا بالاستعلامِ
--
-- `insert ... returning` في CTE يُخرجُ معرّفاتِ الصفوفِ المُدرَجةِ فعلاً،
-- فيُجمَّعُ في `jsonb_agg`. فالمعرّفُ صادرٌ من العمليةِ الذرّيةِ التي فتحتِ
-- الدورةَ وأدرجتِ العروضَ — لا من قراءةٍ ثانيةٍ قد تَرى حالةً أخرى بينَ الإدراجِ
-- والاستعلامِ.
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
    -- الرفضُ يقولُ سببَه بدقّةٍ: «لم يعُد يبحثُ» غيرُ «سبقَني غيري إلى الدورةِ».
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

  -- المدينةُ تُؤخَذ من الصفِّ المحجوزِ لا من الوسيطِ: العرضُ يُكتَبُ في مدينةِ
  -- الطلبِ التي قُلئت داخلَ المعاملةِ نفسِها التي حجزَت الدورةَ. ومعرّفُ كلِّ
  -- عرضٍ يخرجُ من الإدراجِ نفسِه — فلا قراءةٌ ثانيةٌ ولا نافذةُ سباقٍ. والعددُ
  -- والمصفوفةُ يَخرجانِ من المصدرِ نفسِه فلا يختلفانِ: ما وقعَ في القاعدةِ لا
  -- ما طُلبَ إدراجُه. (لا `get diagnostics` بعدَ `jsonb_agg` فهو يَعُدُّ صفَّ
  -- النتيجةِ واحدةً لا الصفوفَ المُدرَجةَ.)
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
  'فتحُ دورةِ بثٍّ ذرّيٌّ: يحرسُ status=searching ويحجزُ رقمَ الدورةِ ويُنشئُ عروضَها في معاملةٍ واحدةٍ (BUG-005)، ويُرجعُ معرّفاتِ العروضِ المُدرَجةِ ليحصرَ الرفضُ عرضاً بعينِه (BUG-003).';

-- سطحُ الصلاحياتِ يُعادُ تأمينُه بعدَ `create or replace`: الدالّةُ المُستبدَلةُ
-- تولدُ ممنوحةً لـ`public` بحكمِ PostgreSQL، فيُسحَبُ منها ويُقصَرُ على دورِ
-- الخدمةِ كما كان.
revoke all on function open_offer_round(uuid, integer, timestamptz, jsonb) from public;
grant execute on function open_offer_round(uuid, integer, timestamptz, jsonb) to service_role;
