-- =============================================================================
-- migration-phase: expand
-- F4-02 / ADR-0072: حالةٌ ساخنةٌ مشتركةٌ لموقعِ السائقِ + استمرارٌ **مجمَّعٌ**
--   غيرُ متزامنٍ إلى PostgreSQL — العائقُ `CAP-009`.
-- الحالة: منفّذ (توسيعٌ لا كسرٌ — `expand` بحتٌ).
-- يبني على: 20260812010000 (جودةُ الموقعِ وطابعُ الإصلاحةِ `last_location_*`)،
--   20260814050000 (توريثُ إعداداتِ مدينةٍ جديدةٍ)، 20260909120000 (نسقُ البذرِ).
-- ينتمي إلى: supabase/migrations.
--
-- ## ما تُغيّره هذه الهجرة
--
-- ١) تبذُرُ أربعةَ مفاتيحَ لكلِّ مدينةٍ: عمرُ الحالةِ الساخنةِ، ودورةُ الإفراغِ،
--    وحجمُ الدفعةِ، وسقفُ التراكمِ. ولا واحدَ منها في الشيفرةِ: القاعدةُ ٠.٤.
-- ٢) `persist_driver_location_batch(uuid, jsonb)`: **دالّةٌ ذرّيّةٌ واحدةٌ** تأخذُ
--    دفعةً كاملةً فتُنقّيها إلى أحدثِ إصلاحةٍ لكلِّ سائقٍ، وتكتبُ بحارسِ التسلسلِ
--    نفسِه الذي يحكمُ الكتابةَ المباشرةَ، وتُرجِعُ حصيلةً بثلاثةِ أصنافٍ.
--
-- ## لماذا نداءٌ واحدٌ لدفعةٍ لا نداءٌ لكلِّ سائقٍ
--
-- القاعدةُ ٠.٥: الذرّيّةُ في الدالّةِ لا في الشيفرةِ. ونبضةُ الموقعِ اليومَ
-- (`F4-01`) كتابةٌ مشروطةٌ لكلِّ نبضةٍ: رحلةُ شبكةٍ ومعاملةٌ ولمسُ صفٍّ لكلِّ
-- سائقٍ كلَّ ثوانٍ — وهوَ `CAP-009` بحرفِه. والدفعةُ تجعلُها معاملةً واحدةً
-- تلمسُ كلَّ سائقٍ **مرّةً واحدةً** ولو بثَّ عشرَ نبضاتٍ في الدورةِ.
--
-- ولو كانَ الإفراغُ حلقةً في `TypeScript` تُنادي الكتابةَ المشروطةَ صفّاً صفّاً
-- لما تغيّرَ شيءٌ في الحملِ الذي وُجِدَ البندُ لرفعِه: النداءاتُ هيَ الحملُ لا
-- شكلُ الشيفرةِ. فالتنقيةُ والحراسةُ والعدُّ ههنا كلُّها داخلَ الجملةِ.
--
-- ## حارسُ التسلسلِ — هوَ هوَ لا أخٌ له
--
-- `BUG-001` يُلزِمُ أن يكونَ الحكمُ في القاعدةِ لا في `JS`، و`ADR 0053 §٦` يُلزِمُ
-- أن يكونَ مُسنَدُه **مُسنَدَ حارسِ `tracking_sessions` حرفاً**: قِدَمٌ صارمٌ على
-- طابعِ الإصلاحةِ والتساوي مقبولٌ. فمُسنَدُ هذه الدالّةِ:
--
--   `d.last_location_recorded_at is null or d.last_location_recorded_at <= n.recorded_at`
--
-- وهوَ حرفاً مُسنَدُ `drivers.updateLocation` القائمِ. والتضييقُ إلى `<` ههنا كانَ
-- سيُنشئُ حَكَمَينِ على «الأحدثِ» في نظامٍ واحدٍ، وطابعُ تلغرام بدقّةِ الثانيةِ
-- فإصلاحتانِ في ثانيةٍ حالةٌ عاديّةٌ لا شاذّةٌ.
--
-- ## ولماذا `distinct on` داخلَ الدالّةِ لا في الشيفرةِ
--
-- الشيفرةُ تُنقّي أيضاً (`newestPerDriver`) — وذلكَ لتصغيرَ حجمِ ما يُرسَلُ على
-- السلكِ، لا ليكونَ الحَكَمَ. فلو أُرسِلَت دفعةٌ فيها إصلاحتانِ لسائقٍ (من
-- منادٍ آخرَ، أو من إعادةٍ بعدَ فشلٍ) لكانَ `update … from` بلا تنقيةٍ يكتبُ
-- إحداهما **بترتيبٍ غيرِ محدَّدٍ**: فيُقبَلُ الأقدمُ ويُهمَلُ الأحدثُ صامتاً.
-- فالتنقيةُ ههنا حراسةٌ، وفي الشيفرةِ تخفيفٌ.
--
-- ## ثلاثةُ أصنافٍ في الحصيلةِ لا رقمٌ واحدٌ
--
-- `applied` كُتِبَ · `stale` سائقٌ موجودٌ وصفُّه أحدثُ (سويٌّ: نبضةٌ سبقَتها
-- كتابةٌ مباشرةٌ) · `missing` معرّفٌ لا صفَّ له في هذه المدينةِ (عطلٌ حقيقيٌّ:
-- سائقٌ حُذِفَ أو مدينةٌ خاطئةٌ). وخلطُهما كانَ سيجعلُ العطلَ يُقرأُ حالةً سويّةً
-- فيمرُّ صامتاً — وهوَ نفسُ سببِ `current` مع `written` في الكتابةِ المباشرةِ.
--
-- ## ولماذا `p_city_id` شرطٌ في `where` لا وسمٌ في السجلِّ
--
-- القاعدةُ ٠.٤: كلُّ استعلامٍ مقيَّدٌ بمدينةٍ. ودفعةٌ فيها معرّفُ سائقِ مدينةٍ
-- أخرى — بخطأِ إعدادٍ أو بمفتاحِ `Redis` خاطئٍ — تُعَدُّ `missing` ولا تُكتَبُ.
-- فحدُّ الاستئجارِ في الجملةِ نفسِها لا في نيّةِ المُنادي.
--
-- ## العودة (rollback)
--
-- توسيعٌ بحتٌ: صفوفُ إعداداتٍ ودالّةٌ **جديدةٌ** لا تُنشِئُ جدولاً ولا تُغيِّرُ
-- عموداً ولا تلمسُ دالّةً قائمةً. والنسخةُ السابقةُ من الشيفرةِ تعملُ على هذا
-- المخطّطِ بلا تغييرٍ: لا مُنادي لها فتبقى ساكنةً. والعودةُ إن لزمَت:
-- `drop function if exists persist_driver_location_batch(uuid, jsonb);` وحذفُ
-- المفاتيحِ الأربعةِ — وكلاهما `contract` في هجرةٍ منفصلةٍ لا ههنا.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ١) الأرقامُ الأربعةُ — لكلِّ مدينةٍ، مبدئيّةً حتّى يُراجِعَها مالكٌ
--
--    والقيَمُ أدناه مبدئيّةٌ (`is_provisional = true`) لا مقيسةٌ: لا قياسَ حِمْلٍ
--    على قاعدةِ إنتاجٍ حتّى تاريخِ هذه الهجرةِ، فلا يُدَّعى أنّها مثاليّةٌ. وهيَ
--    مُشتقّةٌ من نسقِ النبضِ القائمِ (تلغرام يبثُّ الموقعَ الحيَّ كلَّ ثوانٍ) لا
--    من فراغٍ، وتُغيَّرُ من اللوحةِ بلا نشرٍ.
-- ---------------------------------------------------------------------------

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select id, 'driver_location_hot_ttl_seconds', '120'::jsonb, 'number',
       'عمرُ الحالةِ الساخنةِ لموقعِ السائقِ في Redis، ثوانيَ — بعدَها يُنسى الموضعُ الساخنُ ويرجعُ حارسُ التسلسلِ إلى صفِّ القاعدةِ. وهوَ أيضاً مدّةُ حفظِ هذه الأرقامِ الأربعةِ في ذاكرةِ المحوّلِ، فتغييرُ إعدادٍ يسري خلالَ عمرٍ واحدٍ',
       true
from cities on conflict (city_id, key) do nothing;

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select id, 'driver_location_flush_interval_seconds', '10'::jsonb, 'number',
       'دورةُ إفراغِ قائمةِ انتظارِ المواقعِ إلى PostgreSQL، ثوانيَ — أقصى تأخّرٍ لصفِّ السائقِ عن حالتِه الساخنةِ في الحالِ السويِّ',
       true
from cities on conflict (city_id, key) do nothing;

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select id, 'driver_location_flush_batch_size', '200'::jsonb, 'number',
       'أقصى سائقٍ يُسحَبُ من قائمةِ الانتظارِ في شوطِ إفراغٍ واحدٍ — سقفُ حجمِ الدفعةِ المُرسَلةِ إلى الدالّةِ الذرّيّةِ في نداءٍ واحدٍ',
       true
from cities on conflict (city_id, key) do nothing;

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select id, 'driver_location_backlog_limit', '5000'::jsonb, 'number',
       'أقصى سائقٍ منتظِرٍ في قائمةِ انتظارِ الإفراغِ لمدينةٍ — عندَ بلوغِه لا يُضافُ سائقٌ جديدٌ إلى القائمةِ بل يُكتَبُ موضعُه مباشرةً كما في F4-01، فالتراكمُ يُؤجِّلُ التجميعَ ولا يُسقِطُ موضعاً',
       true
from cities on conflict (city_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- ٢) الاستمرارُ المجمَّعُ — دفعةٌ في نداءٍ ذرّيٍّ واحدٍ
--
--    شكلُ `p_batch`: مصفوفةُ كائناتٍ، لكلِّ كائنٍ `driver_id` (uuid نصّاً)
--    و`latitude` و`longitude` و`recorded_at_ms` (عدداً صحيحاً بالمللي ثانيةٍ)
--    و`accuracy_m` (أو `null`) و`verdict` (`ACCEPT` · `WARNING` · `ALERT`).
--
--    ولماذا المللي ثانيةُ عدداً لا `timestamptz` نصّاً: مصدرُ الطابعِ ذاكرةُ
--    Redis (درجةُ عضوٍ في مجموعةٍ مرتَّبةٍ)، ونقلُه رقماً يمنعُ تحوّلَ منطقةٍ
--    زمنيّةٍ في منتصفِ الطريقِ — وحارسُ التسلسلِ حكمُه على هذا الرقمِ.
-- ---------------------------------------------------------------------------

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
begin
  if p_city_id is null then
    return jsonb_build_object('ok', false, 'error', 'CITY_REQUIRED');
  end if;

  if p_batch is null or jsonb_typeof(p_batch) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'BATCH_MUST_BE_ARRAY');
  end if;

  -- دفعةٌ فارغةٌ ليست عطلاً: دورةُ إفراغٍ لم يبثَّ فيها أحدٌ.
  if jsonb_array_length(p_batch) = 0 then
    return jsonb_build_object('ok', true, 'applied', 0, 'stale', 0, 'missing', 0);
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
  )
  select (select count(*) from newest),
         (select count(*) from matched),
         (select count(*) from written)
    into v_total, v_matched, v_applied;

  return jsonb_build_object(
    'ok', true,
    'applied', v_applied,
    'stale', v_matched - v_applied,
    'missing', v_total - v_matched
  );
end;
$$;

revoke all on function persist_driver_location_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function persist_driver_location_batch(uuid, jsonb) to service_role;

comment on function persist_driver_location_batch(uuid, jsonb) is
  'F4-02: استمرارٌ مجمَّعٌ لمواقعِ السائقينَ — تنقيةٌ إلى أحدثِ إصلاحةٍ لكلِّ سائقٍ وحارسُ تسلسلٍ ومدينةٌ مقيَّدةٌ، في معاملةٍ واحدةٍ.';
