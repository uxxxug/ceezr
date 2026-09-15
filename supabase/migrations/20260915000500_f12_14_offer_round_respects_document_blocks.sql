-- migration-phase: expand
-- =============================================================================
-- `F12-14` — **حجبُ السائقِ آليّاً عندَ انتهاءِ وثيقةٍ إلزاميّةٍ**، في آخرِ
--   بوّابةٍ يمرُّ منها العرضُ: `open_offer_round`.
--
-- الحالة: منفَّذٌ فعليّاً — البند `F12-14` (إنفاذاً لـ`F3-01`).
-- ينتمي إلى: supabase/migrations
-- يحرسُه: tests/integration/driver-documents.test.ts
-- الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
--
-- ## لِمَ ههنا ولا في اختيارِ المرشَّحينَ
--
-- اختيارُ المرشَّحينَ يقعُ في الشِفرةِ (`dispatch-adapters`)، **وفحصٌ هناك
-- وحدَه يُتجاوَزُ**: مسارٌ آخرُ يفتحُ دورةً — سكربتٌ تشغيليٌّ، لوحةُ إدارةٍ،
-- إعادةُ بثٍّ — يُدخِلُ سائقاً محجوباً بلا مارٍّ بالفحصِ. **والدالّةُ آخرُ
-- بابٍ**: ما لم يمرَّ منها لم يُصبِح عرضاً في القاعدةِ، فالفحصُ فيها
-- **إنفاذٌ لا تحقُّقٌ**.
--
-- ## وكيفَ يُصفَّى السائقُ المحجوبُ
--
-- شرطٌ في `where` جملةِ الإدراجِ: `cardinality(driver_document_block_reasons(
-- driver_id)) = 0`. فالمحجوبُ **لا يُدرَجُ له صفُّ عرضٍ**، وما لم يُدرَجْ لم
-- يُكتَبْ له صفُّ إشعارٍ (البنيةُ نفسُها من `BUG-004`) — فلا عرضٌ يُرى ولا
-- إشعارٌ يُرسَلُ ولا سباقٌ بينَهما.
--
-- **والعددُ يُعادُ في الجوابِ** (`blocked_by_documents`): الموزِّعُ يعرفُ أنَّ
-- دورةً خرجَت أنقصَ ممّا طلبَ ولا يُفسِّرُ الفراغَ صمتَ سائقينَ. وهذا **قياسٌ
-- لا تجميلٌ**: صفرٌ يعني «لا أحدَ حُجِبَ» لا «لم يُفحَصْ».
--
-- ## وما لا يُغيَّرُ في هذه الهجرةِ — (`ح-5`)
--
--   ــ **لا حرفَ في التوقيعِ**: `open_offer_round(uuid, integer, timestamptz,
--      jsonb)` كما هيَ، و`offer_ids` كما هيَ (`BUG-003`)، فلا شِفرةَ استدعاءٍ
--      تُعدَّلُ.
--   ــ **لا حجبَ في `driver_availability`**: السائقُ المحجوبُ **يبقى قادراً
--      على فتحِ التطبيقِ ورؤيةِ ما ينقصُه** — الحجبُ عن العروضِ لا عن الشاشةِ،
--      وحجبُه عن الشاشةِ يمنعُه من إصلاحِ سببِ حجبِه.
--   ــ **لا إشعارَ للمحجوبِ ههنا**: «أُنتَ محجوبٌ لانتهاءِ رخصتِكَ» رسالةٌ
--      **دَينٌ مُعلَنٌ** محلُّها مُنبِّهُ الانتهاءِ لا مسارُ العرضِ.
-- =============================================================================

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
  v_requested integer;
  v_eligible integer;
begin
  -- الحجزُ والحراسةُ في جملةٍ واحدةٍ: من تُصِب صفّاً فقد ظفرَ بالدورةِ وحدَه.
  -- (`BUG-005` — لا حرفَ تغيَّرَ ههنا.)
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

  -- `F12-14`: المدخلاتُ تُصفَّى **قبلَ** الإدراجِ، والعددانِ يُقاسانِ من
  -- المصدرِ نفسِه فلا فرقَ بينَ ما قِيسَ وما نُفِّذَ.
  with requested as (
    select (entry->>'driver_id')::uuid as driver_id,
           (entry->>'score')::numeric as score,
           (entry->>'distance_km')::numeric as distance_km
      from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) as entry
  ),
  eligible as (
    select r.*
      from requested r
     where cardinality(driver_document_block_reasons(r.driver_id)) = 0
  ),
  inserted as (
    insert into order_offers
      (city_id, order_id, driver_id, round, score, distance_km, status, expires_at)
    select v_order.city_id, p_order_id, e.driver_id, p_round, e.score, e.distance_km,
           'pending', p_expires_at
      from eligible e
    on conflict (order_id, driver_id, round) do nothing
    returning id, driver_id
  ),
  outboxed as (
    insert into notification_outbox (city_id, kind, offer_id, order_id, driver_id)
    select v_order.city_id, 'offer', id, p_order_id, driver_id
      from inserted
  )
  select (select count(*)::integer from requested),
         (select count(*)::integer from eligible),
         (select count(*)::integer from inserted),
         (select coalesce(jsonb_agg(jsonb_build_object('offer_id', id, 'driver_id', driver_id)),
                          '[]'::jsonb)
            from inserted)
    into v_requested, v_eligible, v_inserted, v_offer_ids;

  return jsonb_build_object('ok', true, 'round', p_round,
                           'offers', v_inserted,
                           'offer_ids', v_offer_ids,
                           'blocked_by_documents', v_requested - v_eligible);
end;
$$;

comment on function open_offer_round(uuid, integer, timestamptz, jsonb) is
  'فتحُ دورةِ بثٍّ ذرّيٌّ (BUG-005 + BUG-004 + BUG-003)، **ويُصفّي السائقَ المحجوبَ بوثيقةٍ منتهيةٍ أو ناقصةٍ قبلَ الإدراجِ** ويُعيدُ عددَ المحجوبينَ (F12-14 · ADR 0115).';

revoke all on function open_offer_round(uuid, integer, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function open_offer_round(uuid, integer, timestamptz, jsonb) to service_role;
