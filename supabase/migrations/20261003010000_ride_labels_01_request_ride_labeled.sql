-- migration-phase: expand
-- RIDE-LABEL-01: السائقُ يرى «مكانٌ غيرُ مُسمّى» في كلِّ رحلةٍ من التطبيقِ المصغَّرِ —
-- `request_ride` لا تقبلُ اسماً للالتقاطِ ولا للوجهةِ، فيبقى `pickup_label` و`dropoff_label`
-- معدومَين وإن اختارَ الراكبُ «مطار المدينة» بالاسمِ. (اختبارٌ حيٌّ في المدينة 2026-10-03.)
--
-- الحلُّ توسيعٌ لا تعديلٌ: دالّةٌ جديدةٌ تُنادي `request_ride` القائمةَ **حرفاً** (فلا يتغيّرُ
-- حكمُ التكرارِ ولا الرفضِ ولا المدينةِ)، ثمَّ تكتبُ الاسمَين في **الصفِّ الذي أُنشِئَ للتوِّ**
-- في المعاملةِ نفسِها — قبلَ أن يراهُ أيُّ بثٍّ. والطلبُ المُعادُ (`reused`) لا يُمَسُّ:
-- اسمٌ ثانٍ لا يُبدِّلُ ما رآهُ السائقُ.
-- الاسمُ يُشذَّبُ ويُقصَرُ على 120 حرفاً، والفارغُ يبقى `null`.
create or replace function request_ride_labeled(
  p_telegram_id     bigint,
  p_key             text,
  p_service         service_type,
  p_origin_lat      double precision,
  p_origin_lng      double precision,
  p_dest_lat        double precision,
  p_dest_lng        double precision,
  p_notes           text,
  p_pickup_label    text,
  p_dropoff_label   text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result  jsonb;
  v_pickup  text := nullif(left(btrim(coalesce(p_pickup_label, '')), 120), '');
  v_dropoff text := nullif(left(btrim(coalesce(p_dropoff_label, '')), 120), '');
begin
  v_result := request_ride(
    p_telegram_id, p_key, p_service,
    p_origin_lat, p_origin_lng, p_dest_lat, p_dest_lng, p_notes
  );

  if (v_result->>'ok')::boolean is true
     and coalesce((v_result->>'reused')::boolean, false) is false
     and (v_pickup is not null or v_dropoff is not null) then
    update orders
       set pickup_label  = coalesce(pickup_label, v_pickup),
           dropoff_label = case when dropoff is null then dropoff_label
                                else coalesce(dropoff_label, v_dropoff) end
     where id = (v_result->>'order_id')::uuid;
  end if;

  return v_result;
end;
$$;

revoke execute on function request_ride_labeled(bigint, text, service_type, double precision, double precision, double precision, double precision, text, text, text)
  from public, anon, authenticated;
