-- =============================================================================
-- migration-phase: expand
-- F7-03 / ADR-0074 §٦: مسارُ الدفعةِ يُلحِقُ أثرَه في **الجملةِ نفسِها**.
-- الحالة: منفّذ (توسيعٌ: `create or replace` لدالّةٍ قائمةٍ، بتوقيعٍ واحدٍ لم
--   يتغيّر حرفاً، ومُخرَجٍ زِيدَ فيه مفتاحٌ ولم يُنقَص منه مفتاحٌ).
-- يبني على: 20260909140000 (`persist_driver_location_batch` — F4-02)،
--   20260910050000 (`driver_location_history` — F7-03).
-- ينتمي إلى: supabase/migrations.
--
-- ## ما تُغيّره هذه الهجرة
--
-- تُبدِّلُ جسمَ `persist_driver_location_batch(uuid, jsonb)` ليُلحِقَ في
-- `driver_location_history` صفّاً **لكلِّ سائقٍ كُتِبَ موضعُه** — من فرعِ
-- `written` نفسِه لا من فرعٍ ثانٍ ولا من جملةٍ تالِيةٍ.
--
-- ## ولماذا في الجملةِ نفسِها لا في جملةٍ بعدَها
--
-- جملتانِ متتاليتانِ تتركانِ نافذةً يُقبَلُ فيها موضعٌ ولا يُلحَقُ أثرُه، أو
-- يُلحَقُ أثرُ ما رُفِضَ إن سقطت الثانيةُ. وهوَ عينُ ما رفضَه ADR-0015 في الحقلِ
-- والحكمِ: الموضعُ وحكمُه في جملةٍ واحدةٍ. فالأثرُ من `written` — أي **لا يُلحَقُ
-- إلّا ما قُبِلَ**، وبالمُسنَدِ نفسِه لا بمُسنَدٍ أخٍ له.
--
-- ## ولماذا `appended` عدداً في الحصيلةِ
--
-- المُنادي يحتاجُ أن يعرفَ أنَّ الأثرَ كُتِبَ لا أن يفترضَه. وعددٌ ينبغي أن
-- يساويَ `applied` دائماً: فاختلافُهما عطلٌ يُرى، لا حالٌ سويّةٌ تمرُّ صامتةً —
-- وهيَ نفسُ علّةِ فصلِ `stale` عن `missing` في النسخةِ الأولى.
--
-- ## والمفاتيحُ القديمةُ لم يُنقَص منها مفتاحٌ
--
-- `ok` · `applied` · `stale` · `missing` باقيةٌ بأسمائِها ومعانيها؛ و`appended`
-- **زيادةٌ**. فنسخةُ الشيفرةِ السابقةُ تقرأُ ما تعرفُه وتتجاهلُ ما لا تعرفُه،
-- والنشرُ لا يشترطُ ترتيباً بينَ الهجرةِ والشيفرةِ.
--
-- ## العودة (rollback)
--
-- **تُبدِّلُ جسمَ دالّةٍ قائمةٍ**، فالعودةُ إعادةُ تطبيقِ جسمِها من
-- `20260909140000_f4_02_driver_location_hot_state.sql` حرفاً — والنصُّ محفوظٌ
-- هناك بلا تغييرٍ. ولا صفَّ يُفقَدُ بالعودةِ: ما أُلحِقَ يبقى في التاريخِ،
-- والإلحاقُ وحدَه يتوقّفُ.
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

  -- دفعةٌ فارغةٌ ليست عطلاً: دورةُ إفراغٍ لم يبثَّ فيها أحدٌ.
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
           x.accuracy_m,
           x.verdict
      from jsonb_to_recordset(p_batch) as x(
             driver_id uuid,
             latitude double precision,
             longitude double precision,
             recorded_at_ms bigint,
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
           last_location_at = now(),
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
  -- F7-03: الأثرُ من `written` نفسِه — لا يُلحَقُ إلّا ما قُبِلَ.
  appended as (
    insert into driver_location_history (
      city_id, driver_id, position, recorded_at, accuracy_m, quality, source
    )
    select p_city_id,
           n.driver_id,
           st_setsrid(st_makepoint(n.longitude, n.latitude), 4326)::geography,
           n.recorded_at,
           n.accuracy_m,
           n.verdict,
           'batch'
      from written w
      join newest n on n.driver_id = w.id
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
  'F4-02 + F7-03: استمرارٌ مجمَّعٌ لمواقعِ السائقينَ — تنقيةٌ وحارسُ تسلسلٍ ومدينةٌ مقيَّدةٌ، وإلحاقُ الأثرِ في `driver_location_history` من فرعِ الكتابةِ نفسِه، في معاملةٍ واحدةٍ.';
