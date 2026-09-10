-- =============================================================================
-- migration-phase: expand
-- F4-05 / ADR-0076: `drivers.last_location_at` يعودُ إلى معناهُ المُعلَنِ —
--   **زمنُ قبولِ الخادمِ**، لا زمنُ الإفراغِ المجمَّعِ.
-- الحالة: منفّذ (توسيعٌ: `create or replace` لدالّةٍ قائمةٍ، بتوقيعٍ واحدٍ لم
--   يتغيّر حرفاً، ومُدخَلٍ زِيدَ فيه حقلٌ **اختياريٌّ** ولم يُنقَص منه حقلٌ،
--   ومُخرَجٍ لم يُمَسّ).
-- يبني على: 20260812020000 (تعليقُ العمودِ: «زمنُ الخادمِ لحظةَ قبولِ الإصلاحةِ»)،
--   20260909140000 (`persist_driver_location_batch` — F4-02)،
--   20260910050100 (إلحاقُ الأثرِ — F7-03).
-- ينتمي إلى: supabase/migrations.
--
-- ## العيبُ الذي تُصلحُه
--
-- العمودُ `drivers.last_location_at` مُعلَنٌ في تعليقِه منذُ المرحلةِ الخامسةِ
-- حرفاً: «زمنُ الخادمِ لحظةَ قبولِ الإصلاحةِ — متى علمنا. لقياسِ حداثةِ المعرفةِ».
-- وكانَ صادقاً يومَ كانَ الاستقبالُ يكتبُ في القاعدةِ مباشرةً: لحظةُ الكتابةِ هيَ
-- لحظةُ القبولِ.
--
-- ثمَّ جاءَ `F4-02` فنقلَ المسارَ الساخنَ إلى `Redis` وجعلَ الاستمرارَ **مجمَّعاً**
-- بدورةِ إفراغٍ. والدالّةُ الذرّيّةُ تكتبُ `last_location_at = now()` — أي
-- **لحظةَ الإفراغِ**. فصارَ العمودُ يقولُ «علمتُ الآنَ» عن إصلاحةٍ عُلِمَت قبلَ
-- دورةٍ كاملةٍ، والعمودُ لم يتغيّر تعليقُه ولا اسمُه ولا قارئوه.
--
-- وليسَ هذا تأخّراً في العرضِ يُغتفَرُ، بل **مبالغةٌ في ادّعاءِ الحداثةِ** —
-- وأسوأُ الاتجاهَينِ. ولها ضحيّتانِ في المستودعِ اليومَ:
--
--   ١) `SS-06` (صفحةُ التتبّعِ العامّةُ): `get_tracking_position` تُخرِجُ
--      `updated_at := last_location_at`، والصفحةُ تطبعُ «آخرُ تحديثٍ: …».
--      فيُقالُ لمن ينتظرُ الطردَ إنَّ الموضعَ لحظيٌّ وقد يكونُ أقدمَ بدورةِ إفراغٍ.
--   ٢) `driver_location_max_age_seconds`: حارسُ عمرِ الموقعِ في الإسنادِ يقيسُ
--      بهذا العمودِ عن قصدٍ (هجرةُ المرحلةِ الثامنةِ). فعمرٌ أصغرُ من الحقيقةِ
--      يعني قبولَ إصلاحةٍ كانَ يجبُ أن تُرفَضَ. (الحارسُ اليومَ صفرٌ مُعطَّلٌ
--      `is_provisional`، فالأثرُ كامنٌ لا واقعٌ — ويُذكَرُ ولا يُدَّعى.)
--
-- ## ولماذا الطابعُ يُحمَلُ ولا يُشتَقُّ
--
-- لحظةُ القبولِ لا يعرفُها إلّا **موضعُ القبولِ** (`updateDriverLocation`). وبعدَه
-- كلُّ حسابٍ تخمينٌ: «الإفراغُ ناقصَ نصفِ الدورةِ» رقمٌ مُختَرَعٌ يتغيّرُ بتغيّرِ
-- الإعدادِ ويكذبُ عندَ التراكمِ. فالطابعُ يُلتَقَطُ هناكَ ويُحمَلُ في حِملِ
-- الانتظارِ إلى الدفعةِ — بيانٌ لا استنتاجٌ.
--
-- ## ولماذا **لا** يُستعمَلُ `last_location_recorded_at` مكانَه
--
-- كانَ الأسهلُ أن تُخرِجَ `SS-06` طابعَ الجهازِ فيبدو صادقاً. وهوَ **مرفوضٌ**:
-- هجرةُ `20260812040000` تقولُ حرفاً إنَّ العمرَ يُقاسُ بزمنِ الخادمِ لا بطابعِ
-- الجهازِ، لأنَّ الطابعَ مُدخَلٌ خارجيٌّ يُضبَطُ خطأً أو يُزوَّرُ — فسائقٌ ساعتُه
-- متقدّمةٌ يبدو موقعُه أحدثَ من كلِّ من حولَه إلى الأبدِ. والسؤالُ «متى عرفنا؟»
-- لا «متى يقولُ إنّه كانَ؟». فالإصلاحُ يُعيدُ **زمنَ خادمٍ صادقاً**، لا يُبدِلُه
-- بطابعِ جهازٍ على سطحٍ عامٍّ بلا مصادقةٍ.
--
-- ## والحدُّ الأعلى `least(…, now())` ليسَ زينةً
--
-- الطابعُ يمرُّ في `Redis` وقد يصلُ من نسخةٍ ساعتُها متقدّمةٌ. و«علمتُ في
-- المستقبلِ» يجعلُ كلَّ حسابِ عمرٍ سالباً، والحارسَ يقبلُ إلى الأبدِ. فالسقفُ
-- `now()`: أقصى ما يُقبَلُ ادّعاؤه هوَ اللحظةُ. ولا أرضيّةَ مقابِلةٌ عن قصدٍ —
-- «علمتُ قبلَ ساعةٍ» ممكنٌ فعلاً (تراكمٌ أو انقطاعٌ)، وقطعُه كتمانٌ للتأخّرِ.
--
-- ## والحقلُ اختياريٌّ في المُدخَلِ عن قصدٍ
--
-- حِملُ انتظارٍ كُتِبَ في `Redis` **قبلَ** النشرِ لا يحملُ `observed_at_ms`.
-- فيُقرأُ `null` ويأخذُ `now()` كما كانَ الحالُ حرفاً — لا يُسقَطُ الصفُّ (فذاكَ
-- فقدُ موضعٍ)، ولا يُوضَعُ مكانَه طابعُ الجهازِ (فذاكَ العيبُ المرفوضُ أعلاه).
-- والنافذةُ بعمرِ الحالةِ الساخنةِ وحدَه (ثوانٍ) وتُغلَقُ بذاتِها.
-- وبهذا **لا يشترطُ النشرُ ترتيباً** بينَ الهجرةِ والشيفرةِ في أيِّ اتجاهٍ:
-- هجرةٌ سبقَت الشيفرةَ تقرأُ `null` فتعملُ كالسابقِ، وشيفرةٌ سبقَت الهجرةَ
-- تُرسِلُ حقلاً تتجاهلُه `jsonb_to_recordset` القديمةُ.
--
-- ## ما لا تُغيّرُه هذه الهجرةُ
--
-- - `last_location_recorded_at` — طابعُ الجهازِ كما هوَ، وحارسُ التسلسلِ عليه
--   كما هوَ حرفاً (`الأقدمُ لا يُزيحُ الأحدثَ`). فلا يُقارَنُ زمنانِ مختلفانِ.
-- - `driver_location_history.recorded_at` — طابعُ الجهازِ كما في ADR-0074.
-- - `updated_at = now()` — لحظةُ تغيّرِ الصفِّ، وهيَ صادقةٌ كما هيَ.
-- - المُخرَجُ: `ok` · `applied` · `stale` · `missing` · `appended` بلا زيادةٍ
--   ولا نقصٍ.
--
-- ## العودة (rollback)
--
-- **تُبدِّلُ جسمَ دالّةٍ قائمةٍ**، فالعودةُ إعادةُ تطبيقِ جسمِها من
-- `20260910050100_f7_03_batch_persist_appends_history.sql` حرفاً — والنصُّ محفوظٌ
-- هناكَ بلا تغييرٍ. ولا صفَّ يُفقَدُ ولا عمودَ يُحذَفُ: العودةُ تُرجِعُ الطابعَ
-- إلى `now()` فيرجعُ العيبُ، ولا شيءَ سواه.
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
  'F4-02 + F7-03 + F4-05: استمرارٌ مجمَّعٌ لمواقعِ السائقينَ — تنقيةٌ وحارسُ تسلسلٍ ومدينةٌ مقيَّدةٌ، وإلحاقُ الأثرِ في `driver_location_history` من فرعِ الكتابةِ نفسِه، و`last_location_at` لحظةُ **قبولِ** الإصلاحةِ المحمولةُ من الاستقبالِ (بسقفِ `now()`) لا لحظةُ الإفراغِ.';
