-- migration-phase: expand
-- ============================================================================
-- LOC-TRUST-01 — عقدُ المكانِ الموحَّدُ للالتقاطِ والوجهةِ (ADR 0247)
--
-- العيبُ المقيسُ في PRD-008 (2026-10-08): «موقعي الحاليّ» وصفَ نقطةً قربَ معلَمٍ بعيدٍ عن
-- الراكب، وما وصلَ الطلبَ نقطةٌ واسمٌ فقط — بلا مصدرٍ ولا دقّةٍ ولا وقتِ التقاط، ولا رابطِ
-- موقعٍ ولا ملاحظاتٍ للمكان. فالسائقُ لا يعرفُ هل النقطةُ قراءةُ جهازٍ حديثةٌ أم مركزُ حيٍّ.
--
-- ما تُضيفُه هذه الهجرةُ (توسّعٌ لا انكماش):
--   ١) عشرةُ أعمدةٍ معدومةٍ افتراضاً على `orders` — خمسةٌ لكلِّ مكان:
--      `*_link` الرابطُ الأصليُّ كما لصقَه الراكبُ حرفاً (لا يُستبدَلُ ولا يُختصَر)،
--      `*_notes` ملاحظاتُ المكانِ نفسِه، `*_point_source` مصدرُ النقطة،
--      `*_accuracy_m` دقّةُ قراءةِ الجهاز، `*_captured_at` لحظةُ الالتقاط.
--      النقطةُ نفسُها تبقى في `pickup`/`dropoff` والاسمُ في `*_label` — بلا تغيير.
--   ٢) غلافٌ جديدٌ `request_ride_with_places` (14 معامِلاً) يتحقّقُ من المكانَين **قبلَ**
--      الإنشاء، ثمّ يُنادي `request_ride_with_terms` (12) حرفاً، ثمّ يكتبُ الأعمدةَ في الصفِّ
--      الجديدِ وحدَه وفي المعاملةِ نفسِها — فلا رحلةَ تُنشَأُ بنصفِ مكانِها.
--
-- التوافقُ: الغلافانِ القديمانِ يبقيانِ كما هما؛ البوّابةُ المنشورةُ تُناديهما حتّى تُنشَرَ
-- الجديدة، والهجرةُ تُطبَّقُ قبلَ النشر. ولا قيدَ CHECK (القاعدةُ ٢): الحدودُ في الغلاف.
-- ============================================================================

alter table orders add column if not exists pickup_link text;
alter table orders add column if not exists pickup_notes text;
alter table orders add column if not exists pickup_point_source text;
alter table orders add column if not exists pickup_accuracy_m double precision;
alter table orders add column if not exists pickup_captured_at timestamptz;
alter table orders add column if not exists dropoff_link text;
alter table orders add column if not exists dropoff_notes text;
alter table orders add column if not exists dropoff_point_source text;
alter table orders add column if not exists dropoff_accuracy_m double precision;
alter table orders add column if not exists dropoff_captured_at timestamptz;

comment on column orders.pickup_link is
  'LOC-TRUST-01: رابطُ موقعِ الالتقاطِ كما لصقَه الراكبُ حرفاً — مرجعٌ أصليٌّ لا يُستبدَلُ باسمِ معلَم. null ⇒ لا رابط.';
comment on column orders.pickup_notes is
  'LOC-TRUST-01: ملاحظاتُ مكانِ الالتقاطِ (≤ 200). منفصلةٌ عن `notes` (ملاحظةِ الرحلة).';
comment on column orders.pickup_point_source is
  'LOC-TRUST-01: مصدرُ نقطةِ الالتقاط: DEVICE | MAP_PIN | SHARED_LINK | SUGGESTION | SAVED. null ⇒ عميلٌ أقدمُ من العقد.';
comment on column orders.pickup_accuracy_m is
  'LOC-TRUST-01: دقّةُ قراءةِ الجهازِ بالمتر كما أعلنَها المصدر. null ⇒ لم تُعلَن.';
comment on column orders.pickup_captured_at is
  'LOC-TRUST-01: لحظةُ التقاطِ نقطةِ الالتقاط. null ⇒ لا طابعَ موثوقٌ من المصدر.';
comment on column orders.dropoff_link is
  'LOC-TRUST-01: رابطُ موقعِ الوجهةِ كما لصقَه الراكبُ حرفاً. null ⇒ لا رابط.';
comment on column orders.dropoff_notes is
  'LOC-TRUST-01: ملاحظاتُ الوجهة (≤ 200).';
comment on column orders.dropoff_point_source is
  'LOC-TRUST-01: مصدرُ نقطةِ الوجهة: DEVICE | MAP_PIN | SHARED_LINK | SUGGESTION | SAVED.';
comment on column orders.dropoff_accuracy_m is
  'LOC-TRUST-01: دقّةُ قراءةِ الجهازِ للوجهةِ بالمتر.';
comment on column orders.dropoff_captured_at is
  'LOC-TRUST-01: لحظةُ التقاطِ نقطةِ الوجهة.';

-- حكمُ مكانٍ واحدٍ — `true` إن كانَ غائباً أو سليماً. يُقرأُ في الغلافِ قبلَ أيِّ كتابة.
create or replace function place_input_is_valid(p_place jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_place is null or jsonb_typeof(p_place) = 'null' then
    return true;
  end if;
  if jsonb_typeof(p_place) <> 'object' then
    return false;
  end if;
  if coalesce(p_place->>'point_source', '') not in ('DEVICE', 'MAP_PIN', 'SHARED_LINK', 'SUGGESTION', 'SAVED') then
    return false;
  end if;
  if p_place ? 'link' and jsonb_typeof(p_place->'link') not in ('null', 'string') then
    return false;
  end if;
  if length(coalesce(p_place->>'link', '')) > 2048 then
    return false;
  end if;
  if p_place ? 'notes' and jsonb_typeof(p_place->'notes') not in ('null', 'string') then
    return false;
  end if;
  if length(coalesce(p_place->>'notes', '')) > 200 then
    return false;
  end if;
  if p_place ? 'accuracy_m' and jsonb_typeof(p_place->'accuracy_m') not in ('null', 'number') then
    return false;
  end if;
  if (p_place->>'accuracy_m') is not null
     and ((p_place->>'accuracy_m')::double precision < 0
          or (p_place->>'accuracy_m')::double precision > 100000) then
    return false;
  end if;
  if p_place ? 'captured_at' and jsonb_typeof(p_place->'captured_at') not in ('null', 'string') then
    return false;
  end if;
  return true;
end;
$$;

revoke execute on function place_input_is_valid(jsonb) from public, anon, authenticated;
grant execute on function place_input_is_valid(jsonb) to service_role;

create or replace function request_ride_with_places(
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
  p_offer_sar       integer,
  p_pickup_place    jsonb,
  p_dropoff_place   jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result   jsonb;
  v_order_id uuid;
begin
  -- الحكمُ قبلَ الإنشاء: مكانٌ معطوبٌ لا يُنشئُ رحلةً بلا مكانِها ثمَّ يُسقِطُه صامتاً.
  if not place_input_is_valid(p_pickup_place) or not place_input_is_valid(p_dropoff_place) then
    return jsonb_build_object('ok', false, 'error', 'PLACE_INVALID');
  end if;

  v_result := request_ride_with_terms(
    p_telegram_id, p_key, p_service,
    p_origin_lat, p_origin_lng, p_dest_lat, p_dest_lng, p_notes,
    p_pickup_label, p_dropoff_label, p_pickup_at, p_offer_sar
  );

  if (v_result->>'ok')::boolean is true
     and coalesce((v_result->>'reused')::boolean, false) is false then
    v_order_id := (v_result->>'order_id')::uuid;
    update orders
       set pickup_link         = nullif(p_pickup_place->>'link', ''),
           pickup_notes        = nullif(p_pickup_place->>'notes', ''),
           pickup_point_source = p_pickup_place->>'point_source',
           pickup_accuracy_m   = (p_pickup_place->>'accuracy_m')::double precision,
           pickup_captured_at  = (p_pickup_place->>'captured_at')::timestamptz,
           dropoff_link         = case when p_dest_lat is null then null else nullif(p_dropoff_place->>'link', '') end,
           dropoff_notes        = case when p_dest_lat is null then null else nullif(p_dropoff_place->>'notes', '') end,
           dropoff_point_source = case when p_dest_lat is null then null else p_dropoff_place->>'point_source' end,
           dropoff_accuracy_m   = case when p_dest_lat is null then null else (p_dropoff_place->>'accuracy_m')::double precision end,
           dropoff_captured_at  = case when p_dest_lat is null then null else (p_dropoff_place->>'captured_at')::timestamptz end
     where id = v_order_id;
  end if;

  return v_result;
end;
$$;

revoke execute on function request_ride_with_places(bigint, text, service_type, double precision, double precision, double precision, double precision, text, text, text, timestamptz, integer, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function request_ride_with_places(bigint, text, service_type, double precision, double precision, double precision, double precision, text, text, text, timestamptz, integer, jsonb, jsonb)
  to service_role;
