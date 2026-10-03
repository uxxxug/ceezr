-- migration-phase: expand
-- ============================================================================
-- ORDER-OFFER-01 — طلبُ المالكِ 2026-10-03 (مكرَّراً صريحاً بعدَ NEG-SELECT-01):
--
--   «للسائقِ المشتركِ سواءٌ في التوصيلِ أو النقلِ يجبُ أن يكونَ هناكَ مكانٌ لعرضِ السعرِ
--    الذي يستطيعُ الزبونُ تقديمَه، كي يوفّرَ هذا مفاوضةً طويلةً — المدفوع: 40 ريال، أو
--    المدفوع: قابلٌ للتفاوض».
--
-- ما هذا وما ليسَه (DEC-11 §١): الرقمُ **يكتبُه الراكبُ بنفسِه** عرضاً منه، وتنقلُه البطاقةُ
-- إلى السائقِ كما تنقلُ رسالتَه في المحادثةِ. لا تحسبُه المنصّةُ ولا تقترحُه ولا تُحصّلُه ولا
-- تُلزِمُ به؛ والاتفاقُ الفعليُّ يبقى بينَ الطرفَين مباشرةً. فليس هذا «آليّةَ أجرةٍ» (ADR 0039):
-- لا محرّكَ تسعيرٍ ولا جدولَ أسعارٍ ولا مسارَ نقود.
--
-- عمودٌ معدومٌ افتراضاً: null ⇒ «قابلٌ للتفاوض». كلُّ طلبٍ قائمٍ وكلُّ مسارٍ لا يُرسِلُه يبقى
-- كما كان. ولا قيدَ CHECK (القاعدةُ ٢): الحدودُ تُفرَضُ في الغلافِ، وهو البابُ الوحيدُ للكتابةِ.
--
-- الغلافُ القديمُ (11 معامِلاً) يبقى كما هو: البوّابةُ المنشورةُ تُناديه حتى تُنشَرَ الجديدة،
-- والهجرةُ تُطبَّقُ قبلَ النشرِ (توسّعٌ لا انكماش).
-- ============================================================================

alter table orders add column if not exists rider_offer_sar integer;

comment on column orders.rider_offer_sar is
  'ORDER-OFFER-01: المبلغُ الذي يعرضُه الراكبُ بنفسِه بالريال (1..10000). null ⇒ قابلٌ للتفاوض. إخباريٌّ — لا تحسبُه المنصّةُ ولا تُحصّلُه (DEC-11 §١).';

create or replace function request_ride_with_terms(
  p_telegram_id     bigint,
  p_key             text,
  p_service         service_type,
  p_origin_lat      double precision,
  p_origin_lng      double precision,
  p_dest_lat        double precision,
  p_dest_lng        double precision,
  p_notes           text,
  p_pickup_label    text,
  p_dropoff_label   text,
  p_pickup_at       timestamptz,
  p_offer_sar       integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_offer  integer := case
    when p_offer_sar is not null and p_offer_sar between 1 and 10000 then p_offer_sar end;
begin
  v_result := request_ride_with_terms(
    p_telegram_id, p_key, p_service,
    p_origin_lat, p_origin_lng, p_dest_lat, p_dest_lng, p_notes,
    p_pickup_label, p_dropoff_label, p_pickup_at
  );

  -- الصفُّ الجديدُ وحدَه، وفي المعاملةِ نفسِها التي أودعَت العرضَ في الصادرِ: العاملُ يقرأُ
  -- المبلغَ من الطلبِ لحظةَ الإرسالِ فلا تخرجُ بطاقةٌ بلا مبلغٍ كُتِبَ.
  if (v_result->>'ok')::boolean is true
     and coalesce((v_result->>'reused')::boolean, false) is false
     and v_offer is not null then
    update orders
       set rider_offer_sar = coalesce(rider_offer_sar, v_offer)
     where id = (v_result->>'order_id')::uuid;
  end if;

  return v_result;
end;
$$;

revoke execute on function request_ride_with_terms(bigint, text, service_type, double precision, double precision, double precision, double precision, text, text, text, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function request_ride_with_terms(bigint, text, service_type, double precision, double precision, double precision, double precision, text, text, text, timestamptz, integer)
  to service_role;
