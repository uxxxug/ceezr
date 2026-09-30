-- migration-phase: expand
-- =============================================================================
-- `F12-20` — كاشفُ الطلباتِ التي تتجاوزُ سقفَ `tracking_link_max_lifetime_minutes`:
--   رحلةٌ `in_progress` بدأَتْ وظلَّت جاريةً فوقَ السقفِ (720 دقيقةً بذرةً).
--
-- الحالة: منفَّذٌ — البند `F12-20` (دَينُ `F12-04`).
-- ينتمي إلى: supabase/migrations
-- يحرسُه: tests/integration/stalled-order-ceiling-detector.test.ts
-- الحاكم: docs/adr/0216-ceiling-exceeded-detector.md
--
-- ## الفجوةُ
--
-- `F12-04` بنى `order_stall_state` لكشفِ الطلباتِ العالقةِ **بإشارةِ حياةٍ**
-- (آخرُ موقعٍ للسائقِ أو عمرُ الصفِّ). لكنَّ سقفَ `tracking_link_max_lifetime_minutes`
-- يقتلُ رابطَ مشاركةِ رحلةٍ **حيّةٍ** عندَ السقفِ — وهذا هو الوجهُ الأوّلُ الذي
-- بقِيَ مفتوحاً في `F12-04`.
--
-- ## العلاجُ
--
-- دالّةٌ قراءةٌ تُحصي الطلباتِ `in_progress` التي تجاوزَتْ سقفَ المدينةِ،
-- ويُصعِّدُها عاملٌ دوريٌّ سطراً مُهيكَلاً. **لا تُغيِّرُ حالةَ طلبٍ ولا تُلغي
-- ولا تُحذفُ بياناتٍ** — الكشفُ والتصعيدُ وحدَهما.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- (١) `detect_ceiling_exceeded_orders(uuid, int)` — الطلباتُ التي تجاوزَتْ السقفَ
--
-- رحلةٌ `in_progress` ظلَّت جاريةً فوقَ `tracking_link_max_lifetime_minutes`.
-- والمصدرُ `started_at` لا `matched_at` ولا `created_at`: السقفُ على الرحلةِ
-- لا على الطلبِ — فالرحلةُ تبدأُ حينَ يتحرّكُ السائقُ.
-- ----------------------------------------------------------------------------

create or replace function detect_ceiling_exceeded_orders(
  p_city_id uuid,
  p_limit integer default 100
)
returns table (
  order_id          uuid,
  status            order_status,
  started_at        timestamptz,
  elapsed_minutes   integer,
  ceiling_minutes   integer,
  ceiling_source    text
)
language sql
stable
security invoker
set search_path = public
as $fn$
  select o.id,
         o.status,
         o.started_at,
         (floor(extract(epoch from (now() - o.started_at)) / 60))::integer as elapsed_minutes,
         coalesce(
           (get_setting(o.city_id, 'tracking_link_max_lifetime_minutes') #>> '{}')::numeric::integer,
           720
         ) as ceiling_minutes,
         case
           when get_setting(o.city_id, 'tracking_link_max_lifetime_minutes') is not null
             then 'SETTING'
           else 'FALLBACK_DEFAULT'
         end as ceiling_source
    from orders o
   where o.city_id = p_city_id
     and o.status = 'in_progress'
     and o.started_at is not null
     and (floor(extract(epoch from (now() - o.started_at)) / 60))::integer
       > coalesce(
           (get_setting(o.city_id, 'tracking_link_max_lifetime_minutes') #>> '{}')::numeric::integer,
           720
         )
   order by o.started_at asc
   limit greatest(1, coalesce(p_limit, 100));
$fn$;

comment on function detect_ceiling_exceeded_orders(uuid, integer) is
  'F12-20: يُحصي طلباتَ مدينةٍ في in_progress تجاوزَتْ سقفَ tracking_link_max_lifetime_minutes. '
  'قراءةٌ محضةٌ تُصعِّدُ ولا تُغيِّرُ حالةً ولا تُحذفُ بياناتٍ — قرارُ الإلغاءِ تجاريٌّ (F2-05).';

-- ----------------------------------------------------------------------------
-- (٢) الإذنُ — لا `public` ولا `anon` ولا `authenticated`
-- ----------------------------------------------------------------------------

revoke execute on function detect_ceiling_exceeded_orders(uuid, integer) from public, anon, authenticated;
