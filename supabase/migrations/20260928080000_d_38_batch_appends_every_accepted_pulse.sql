-- =============================================================================
-- migration-phase: expand
-- D-38 / ADR-0209: مسارُ الدفعةِ يُلحِقُ في الأثرِ **كلَّ نبضةٍ مقبولةٍ** لا الأحدثَ
--   لكلِّ سائقٍ وحدَه. وصفُّ السائقِ (`drivers.last_location`) يبقى للأحدثِ بحارسِهِ
--   لم يُمسَّ حرفاً.
-- الحالة: منفّذ (توسيعٌ: `create or replace` لدالّةٍ قائمةٍ، بتوقيعٍ واحدٍ لم
--   يتغيّر حرفاً، ومُدخَلٍ لم يُنقَص منه مفتاحٌ، ومُخرَجٍ لم تُنقَص منه مفتاحٌ —
--   وتغيّرَ **معنَى** `appended` من عدِّ السائقينَ إلى عدِّ صفوفِ الأثرِ).
-- يبني على: 20260909140000 (`persist_driver_location_batch` — F4-02)،
--   20260910050100 (إلحاقُ الأثرِ من `written` — F7-03)،
--   20260910200000 (زمنُ القبولِ المحمولُ — F4-05).
-- ينتمي إلى: supabase/migrations.
--
-- ## العيبُ الذي تُصلحُه
--
-- `D-38`: النبضةُ المقبولةُ في الحالةِ الساخنةِ تُسقَطُ قبلَ أن تبلغَ
-- `driver_location_history`. قائمةُ الانتظارِ عضوٌ واحدٌ لكلِّ سائقٍ يُكتَبُ فوقَه،
-- والدفعةُ تُنقّى إلى الأحدثِ لكلِّ سائقٍ مرّتَينِ (في الشيفرةِ وفي الدالّةِ)، فالأثرُ
-- في المسارِ السويِّ نقطةٌ واحدةٌ لكلِّ سائقٍ في كلِّ دورةِ إفراغٍ (١٠ ثوانٍ)،
-- وكثافتُه تتبدّلُ بحالِ Redis. و`ADR 0208` §٨ جعلَ حسمَ هذا شرطاً سابقاً لقياسِ
-- المسافةِ المقطوعةِ في `F2-07`: «بغيرِه يكونُ القياسُ تابعاً لحالِ Redis لا لحركةِ
-- السائقِ».
--
-- ## ما تُغيّرُه هذه الهجرةُ
--
-- فرعُ `appended` يُدرِجُ من `parsed` **كُلِّها** لا من فرعِ `written` وحدَه: كلُّ
-- صفٍّ لسائقٍ قائمٍ في المدينةِ (`join drivers … and d.city_id = p_city_id`) يبلغُ
-- الأثرَ. والمسوِّغُ أنَّ ما في الدفعةِ مقبولٌ **بنيويّاً**: سكربتُ الكتابةِ الساخنةِ
-- رفضَ الأقدمَ (`stale`) قبلَ الإدراجِ في القائمةِ، وGPS حَكَمَ عندَ الاستقبالِ —
-- فلا حَكَمَ ثانياً ههنا (`ADR 0053` §٦). وصفُّ السائقِ لا يتغيّرُ: `newest`
-- (`distinct on`) و`written` بحارسِهما (`last_location_recorded_at is null or <= …`)
-- كما كانَا حرفاً بحرفٍ.
--
-- ## ولماذا تغيّرَ معنَى `appended` ولا يُقرأُ ذلكَ عطلًا
--
-- كانَ `appended` يَعُدُّ السائقينَ المكتوبينَ ويساوي `applied` «دائماً» — وذلكَ
-- عقدُ `F7-03` يومَ كانَ الأثرُ فرعاً من الكتابةِ. واليومَ الأثرُ يَعُدُّ **النبضاتِ**
-- فيزيدُ على `applied` في الدفعةِ المتراكمةِ وهذا هوَ السويُّ (`D-38`). وخرقُهُ الجديدُ
-- المسمّى: أن يقلَّ عن عددِ صفوفِ الدفعةِ لسائقينَ قائمينَ في المدينةِ — لا أن
-- يختلفَ عن `applied`.
--
-- ## ما لا تُغيّرُه هذه الهجرةُ
--
-- - المُدخَلَ والمُخرَجَ: المفاتيحُ `ok` · `applied` · `stale` · `missing` ·
--   `appended` بأسمائِها — النسخةُ السابقةُ من الشيفرةِ تقرأُ ما تعرفُه.
-- - المسارَ المباشرَ (`drivers.updateLocation`): يُلحِقُ من فرعِ `written` كما هوَ.
-- - الحالةَ الساخنةَ والمفاتيحَ الأربعةَ في `platform_settings`.
--
-- ## العودة (rollback)
--
-- **تُبدِّلُ جسمَ دالّةٍ قائمةٍ**، فالعودةُ إعادةُ تطبيقِ جسمِها من
-- `20260910200000_f4_05_last_location_at_is_acceptance_time.sql` حرفاً — والنصُّ
-- محفوظٌ هناكَ بلا تغييرٍ. ولا صفَّ يُفقَدُ بالعودةِ: ما أُلحِقَ يبقى في التاريخِ،
-- والإلحاقُ يعودُ إلى الأحدثِ لكلِّ سائقٍ.
-- =============================================================================

create or replace function persist_driver_location_batch(
  p_city_id uuid,
  p_batch jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer := 0;
  v_matched integer := 0;
  v_applied integer := 0;
  v_appended integer := 0;
begin
  if p_city_id is null then
    return jsonb_build_object('ok', false, 'error', 'CITY_REQUIRED');
  end if;

  if p_batch is null or jsonb_typeof(p_batch) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'BATCH_MUST_BE_ARRAY');
  end if;

  -- دفعةٌ فارغةٌ ليست عطلًا: دورةُ إفراغٍ لم يبثَّ فيها أحدٌ.
  if jsonb_array_length(p_batch) = 0 then
    return jsonb_build_object(
      'ok', true, 'applied', 0, 'stale', 0, 'missing', 0, 'appended', 0
    );
  end if;

  with parsed as (
    select x.driver_id,
           x.latitude,
           x.longitude,
           x.recorded_at_ms,
           x.observed_at_ms,
           x.accuracy_m,
           x.verdict
      from jsonb_to_recordset(p_batch) as x(
             driver_id uuid,
             latitude double precision,
             longitude double precision,
             recorded_at_ms bigint,
             -- F4-05: اختياريٌّ. غيابُه أو `null` = «مجهولةٌ لحظةُ القبولِ»،
             -- ولا يُرفَضُ الصفُّ به (بخلافِ الحقولِ الأربعةِ أدناه).
             observed_at_ms bigint,
             accuracy_m double precision,
             verdict text
           )
     where x.driver_id is not null
       and x.latitude is not null
       and x.longitude is not null
       and x.recorded_at_ms is not null
       -- الحكمُ يُقرأُ كما هوَ ولا يُخترَعُ: قيدُ العمودِ يرفضُ غيرَ الثلاثةِ،
       -- ورفضُ الصفِّ ههنا يمنعُ دفعةً كاملةً من السقوطِ بسببِ صفٍّ واحدٍ.
       and x.verdict in ('ACCEPT', 'WARNING', 'ALERT')
  ),
  newest as (
    select distinct on (p.driver_id)
           p.driver_id,
           p.latitude,
           p.longitude,
           to_timestamp(p.recorded_at_ms / 1000.0) as recorded_at,
           /**
            * F4-05: لحظةُ القبولِ كما وصلَت، بسقفٍ عندَ `now()` ولا أرضيّةَ.
            * و`coalesce` **آخرُ** ما يُطبَّقُ: مجهولٌ يعني اللحظةَ، ومعلومٌ
            * متقدّمٌ يُقصَرُ إليها — فلا «معرفةٌ في المستقبلِ» بحالٍ.
            * والتنقيةُ تبقى على `recorded_at_ms` وحدَه: أحدثُ **إصلاحةٍ** لا
            * أحدثُ **علمٍ** بها، وهما قد يختلفانِ عندَ التراكمِ.
            *
            * D-38/ADR-0209: هذهِ التنقيةُ لصفِّ السائقِ وحدَه — الأثرُ يُلحِقُ
            * الدفعةَ كلَّها من `parsed` لا من هنا.
            */
           least(
             coalesce(to_timestamp(p.observed_at_ms / 1000.0), now()),
             now()
           ) as observed_at,
           p.accuracy_m,
           p.verdict
      from parsed p
     order by p.driver_id, p.recorded_at_ms desc
  ),
  matched as (
    select n.driver_id
      from newest n
      join drivers d on d.id = n.driver_id and d.city_id = p_city_id
  ),
  written as (
    update drivers as d
       set last_location = st_setsrid(
             st_makepoint(n.longitude, n.latitude), 4326)::geography,
           -- F4-05: لحظةُ القبولِ المحمولةُ، لا `now()` المُختَرَعةُ ههنا.
           last_location_at = n.observed_at,
           last_location_recorded_at = n.recorded_at,
           last_location_accuracy_m = n.accuracy_m,
           last_location_quality = n.verdict,
           updated_at = now()
      from newest n
     where d.id = n.driver_id
       and d.city_id = p_city_id
       and (d.last_location_recorded_at is null
            or d.last_location_recorded_at <= n.recorded_at)
    returning d.id
  ),
  -- D-38/ADR-0209: الأثرُ من `parsed` كُلِّها لا من `written` — النبضةُ بلغَت
  -- القائمةَ بعدَ حكمِ القبولِ (السكربتُ رفضَ الأقدمَ قبلَ الإدراجِ)، فإلحاقُها
  -- أثراً لا يُحرِّكُ صفَّ السائقِ الذي يبقى للأحدثِ وحدَه بحارسِه أعلاه.
  -- والقيدُ المدينيُّ من `drivers.city_id` نفسِه لا من `p_city_id` وحده: سائقُ
  -- مدينةٍ أخرى لا يُلحَقُ في أثرِ مدينةٍ لا ينتسبُ إليها (القاعدةُ ٠٫٤).
  appended as (
    insert into driver_location_history (
      city_id, driver_id, position, recorded_at, accuracy_m, quality, source
    )
    select p_city_id,
           p.driver_id,
           st_setsrid(st_makepoint(p.longitude, p.latitude), 4326)::geography,
           to_timestamp(p.recorded_at_ms / 1000.0),
           p.accuracy_m,
           p.verdict,
           'batch'
      from parsed p
      join drivers d on d.id = p.driver_id and d.city_id = p_city_id
    returning 1
  )
  select (select count(*) from newest),
         (select count(*) from matched),
         (select count(*) from written),
         (select count(*) from appended)
    into v_total, v_matched, v_applied, v_appended;

  return jsonb_build_object(
    'ok', true,
    'applied', v_applied,
    'stale', v_matched - v_applied,
    'missing', v_total - v_matched,
    'appended', v_appended
  );
end;
$$;

revoke all on function persist_driver_location_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function persist_driver_location_batch(uuid, jsonb) to service_role;

comment on function persist_driver_location_batch(uuid, jsonb) is
  'F4-02/F7-03/D-38: إفراغٌ مجمّعٌ ذرّيٌّ لمواقعِ السائقينَ في مدينةٍ — صفُّ السائقِ للأحدثِ (distinct on + حارسُ <=)، والأثرُ يُلحِقُ كلَّ نبضةٍ مقبولةٍ في الدفعةِ (ADR-0209). appended يَعُدُّ صفوفَ الأثرِ فقد يزيدُ على applied.';
