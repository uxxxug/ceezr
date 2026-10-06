-- migration-phase: expand
-- ============================================================================
-- UI-8 · إغلاقُ فجوةِ العقد [C] الثانية — مدى التنبؤِ الصادق (§10.8 · ADR 0243)
--
-- طلبُ المالكِ 2026-10-06: «صحّح فجوتي العقد المسجلتين في UI-8». والثانيةُ: محرّكُ الطرقِ
-- يُعيدُ دقائقَ مفردةً بلا مدىً ولا ثقة. ولا مدى صادقٌ بلا قياس، فهذه الهجرةُ **تقيسُ**:
--
--   • `eta_observations` — أوّلُ تقديرٍ عُرِضَ لكلِّ (طلب، ساق) ولحظةُ عرضِه. الساقُ
--     `pickup` تنتهي بـ`orders.arrived_at` (ضغطُ السائقِ «وصلت»)، و`dropoff` بـ`orders.completed_at`.
--   • `record_eta_and_read_band(order, leg, predicted_seconds)` — يحفظُ الأوّلَ ويتركُ ما بعدَه
--     (`on conflict do nothing`)، ثمَّ يُعيدُ لمدينةِ الطلبِ: عددَ الساقاتِ المنتهيةِ (آخرُ 500
--     خلالَ 30 يوماً) والمئينَ العاشرَ والتسعين لنسبةِ (المدّةِ الفعليّةِ ÷ المقدَّرة).
--
-- لا رقمَ مكتوبٌ باليدِ ولا نموذجٌ مفترَض: دونَ 30 ساقاً منتهيةً لا مدى (يقرّرُه النطاقُ في
-- `packages/domain/eta/band.ts`). والدالّةُ لـ`service_role` وحدَه؛ البوّابةُ تناديها بعدَ أن
-- يثبتَ أنَّ الطلبَ لصاحبِ الجلسة (`get_active_ride`).
-- ============================================================================

create table if not exists eta_observations (
  order_id          uuid not null references orders(id) on delete cascade,
  leg               text not null check (leg in ('pickup', 'dropoff')),
  city_id           uuid not null references cities(id),
  predicted_seconds integer not null check (predicted_seconds > 0),
  predicted_at      timestamptz not null default now(),
  primary key (order_id, leg)
);

alter table eta_observations enable row level security;
revoke all on table eta_observations from public, anon, authenticated;

comment on table eta_observations is
  'ADR 0243: أوّلُ تقديرِ وصولٍ عُرِضَ لكلِّ (طلب، ساق) — مادّةُ قياسِ خطأِ محرّكِ الطرقِ لمدى التنبؤِ الصادق.';

create or replace function record_eta_and_read_band(
  p_order_id          uuid,
  p_leg               text,
  p_predicted_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_city    uuid;
  v_samples integer;
  v_low     double precision;
  v_high    double precision;
begin
  if p_leg is null or p_leg not in ('pickup', 'dropoff')
     or p_predicted_seconds is null or p_predicted_seconds <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  select o.city_id into v_city from orders o where o.id = p_order_id;
  if v_city is null then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  insert into eta_observations (order_id, leg, city_id, predicted_seconds)
  values (p_order_id, p_leg, v_city, p_predicted_seconds)
  on conflict (order_id, leg) do nothing;

  with resolved as (
    select e.predicted_seconds,
           e.predicted_at,
           case when e.leg = 'pickup' then o.arrived_at else o.completed_at end as ended_at
      from eta_observations e
      join orders o on o.id = e.order_id
     where e.city_id = v_city
       and e.leg = p_leg
       and e.predicted_at > now() - interval '30 days'
  ), recent as (
    select extract(epoch from (r.ended_at - r.predicted_at)) / r.predicted_seconds as ratio
      from resolved r
     where r.ended_at is not null
       and r.ended_at > r.predicted_at
     order by r.predicted_at desc
     limit 500
  )
  select count(*)::integer,
         percentile_cont(0.1) within group (order by ratio),
         percentile_cont(0.9) within group (order by ratio)
    into v_samples, v_low, v_high
    from recent;

  return jsonb_build_object(
    'ok', true,
    'samples', v_samples,
    'low_ratio', v_low,
    'high_ratio', v_high
  );
end;
$$;

revoke execute on function record_eta_and_read_band(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function record_eta_and_read_band(uuid, text, integer)
  to service_role;
