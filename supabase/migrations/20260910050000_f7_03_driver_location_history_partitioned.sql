-- =============================================================================
-- migration-phase: expand
-- F7-03 / ADR-0074: تاريخُ موقعِ السائقِ سجلٌّ ملحَقٌ **مقسَّمٌ زمنيّاً** —
--   العائقانِ `CAP-009` (ثُلُثُه الثالثُ) و`CAP-010` (شطرُ التقسيمِ منه).
-- الحالة: منفّذ (توسيعٌ بحتٌ — جدولٌ جديدٌ ودالّتانِ جديدتانِ، ولا عمودَ قائمٌ
--   يُمَسُّ ولا دالّةٌ قائمةٌ تُغيَّرُ في هذا الملفِّ).
-- يبني على: 20260806120000 (`drivers`, `cities`)، 20260812010000 (طابعُ الإصلاحةِ
--   وجودتُها `last_location_*`)، 20260909140000 (الحالةُ الساخنةُ والدفعةُ).
-- ينتمي إلى: supabase/migrations.
--
-- ## ما تُغيّره هذه الهجرة
--
-- ١) `driver_location_history`: جدولٌ **ملحَقٌ** مقسَّمٌ بالمدى على `recorded_at`،
--    بقِسمةٍ **يوميّةٍ**، ومعَه قِسمٌ افتراضيٌّ شبكةَ أمانٍ.
-- ٢) `ensure_driver_location_partitions(integer)`: **مصدرُ الحقيقةِ الوحيدُ**
--    لشكلِ القِسمِ — تُنشئُ ما ينقصُ، وتترُكُ ما وُجِدَ، وتُرجِعُ حصيلةً مُسمّاةً
--    فيها عددُ صفوفِ القِسمِ الافتراضيِّ.
-- ٣) نداءٌ واحدٌ للدالّةِ يُنشئُ نافذةَ الأقسامِ الأولى.
--
-- ## لماذا جدولٌ أصلاً — والنظامُ لا يملكُ تاريخَ موقعٍ اليومَ
--
-- `drivers.last_location` عمودٌ **يُكتَبُ فوقَه**: كلُّ نبضةٍ مقبولةٍ تمحو ما
-- قبلَها. فلا صفَّ واحداً في المخطّطِ كلِّه يحفظُ مساراً. وعمودُ حلِّ `CAP-009`
-- في القسم 11 ثلاثيٌّ نصّاً — حالةٌ ساخنةٌ (تمَّ) + دفعةٌ (تمَّ) + **جدولُ
-- تاريخٍ مقسَّمٌ** — وهذا هوَ الثالثُ.
--
-- ## ولماذا القِسمةُ على `recorded_at` لا على `written_at`
--
-- الاستبقاءُ حكمٌ على عمرِ **الواقعةِ** لا على عمرِ الكتابةِ. وانحرافُ ساعةِ
-- الجهازِ ليسَ مفتوحاً بل **محدودٌ بعقدٍ قائمٍ**: `DEFAULT_GPS_POLICY` ترفضُ ما
-- تجاوزَ ٣٠٠ ثانيةٍ قِدَماً و٥ ثوانٍ استقبالاً. فأقصى ما يقعُ صفٌّ يهبطُ في قِسمِ
-- الأمسِ قربَ منتصفِ الليلِ — وهوَ قِسمٌ موجودٌ. فالحدُّ مقيسٌ في الشيفرةِ لا
-- مرجوٌّ.
--
-- ## ولماذا قِسمٌ افتراضيٌّ — وثمنُه مُعلَنٌ
--
-- لو غابَ قِسمُ يومٍ لتعطُّلِ مهمّةِ الصيانةِ، سقطَ الإدراجُ بخطأٍ، وخطأٌ في مسارِ
-- كتابةِ الموقعِ = توقُّفُ نبضِ التتبُّعِ كلِّه. وذلكَ ثمنٌ غيرُ مقبولٍ لعطلِ
-- صيانةٍ. والثمنُ المقابلُ مُعلَنٌ: قِسمٌ افتراضيٌّ غيرُ فارغٍ يمنعُ إنشاءَ قِسمِ
-- اليومِ الذي ابتلعَ صفوفَه — ولذلكَ تُرجِعُ الدالّةُ عددَ صفوفِه في حصيلتِها
-- فتُسجِّلَه المهمّةُ صراحةً. وإخلاؤه عملُ مشغِّلٍ بأدواتِ الأرشفةِ، وهيَ نطاقُ
-- `F7-06` لا نطاقُ هذا البندِ.
--
-- ## ولماذا الفهارسُ داخلَ الدالّةِ لا في ملفِّ فهرسٍ
--
-- علّةُ القاعدةِ الأولى من قواعدِ الهجرةِ مكتوبةٌ في الحاجزِ نفسِه: «قفلٌ يمنعُ
-- الكتابةَ على الجدولِ حتّى تنتهي — وعلى جدولٍ حارٍّ ذلكَ توقُّفُ خدمةٍ».
-- والقِسمُ **لحظةَ إنشائِه جدولٌ فارغٌ لا كاتبَ له ولا قارئَ**، فالفهرسُ عليه
-- لحظيٌّ ولا يقفلُ عملاً. ويُضافُ أنَّ `create index concurrently` **لا تُقبَلُ
-- أصلاً على جدولٍ أبٍ مقسَّمٍ**؛ والبديلُ الوحيدُ ملفُّ هجرةٍ لكلِّ يومٍ إلى
-- الأبدِ — ولا فهرسَ لقِسمٍ يُنشَأُ بعدَ الهجرةِ. والتفصيلُ في ADR-0074 §٥.
--
-- ## ولا مفاتيحَ أجنبيّةً
--
-- مفتاحٌ على `drivers` يضعُ قفلاً وقراءةً في مسارِ كلِّ كتابةِ موقعٍ — وهوَ الحملُ
-- الذي وُجِدَ البندُ لأجلِه. والتكاملُ محروسٌ حيثُ يُولَدُ الصفُّ: لا يُلحَقُ إلّا
-- من فرعِ `written`، وهوَ لا يُخرِجُ إلّا سائقاً موجوداً في مدينتِه.
--
-- ## العودة (rollback)
--
-- توسيعٌ بحتٌ: جدولٌ ودالّتانِ **جديدةٌ كلُّها**، ولا مُنادي لها في النسخةِ
-- السابقةِ من الشيفرةِ فتبقى ساكنةً. والعودةُ إن لزمَت:
--   `drop function if exists ensure_driver_location_partitions(integer);`
--   `drop table if exists driver_location_history cascade;`
-- وكلاهما `contract` في هجرةٍ منفصلةٍ لا ههنا.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ١) السجلُّ الملحَقُ
--
--    `source` يُميِّزُ كاتبَ الصفِّ: `direct` مسارُ `F4-01` المباشرُ، و`batch`
--    إفراغُ الدفعةِ في `F4-02`. وليسَ زينةً: حين يُقاسُ التأخّرُ بينَ الواقعةِ
--    وكتابتِها، يكونُ الفرقُ بينَ المسارَينِ بنيويّاً لا عارضاً، وخلطُهما يُخفي
--    أيَّهما تأخّرَ.
-- ---------------------------------------------------------------------------

create table if not exists driver_location_history (
  city_id uuid not null,
  driver_id uuid not null,
  position geography(Point, 4326) not null,
  recorded_at timestamptz not null,
  written_at timestamptz not null default now(),
  accuracy_m double precision,
  quality text not null,
  source text not null
) partition by range (recorded_at);

comment on table driver_location_history is
  'F7-03 / ADR-0074: أثرُ مواضعِ السائقينَ المقبولةِ — ملحَقٌ لا يُحدَّثُ، مقسَّمٌ يوميّاً على طابعِ الجهازِ. ليسَ مصدرَ الموضعِ الحاليِّ: ذاكَ `drivers.last_location` وحدَه.';

-- ---------------------------------------------------------------------------
-- ٢) مُنشئُ الأقسامِ — مُتماثِلٌ، ويُرجِعُ حصيلةً لا صمتاً
--
--    النافذةُ: من أمسِ إلى `p_days_ahead` يوماً أماماً. والأمسُ ليسَ ترفاً:
--    إصلاحةٌ مقبولةٌ عمرُها خمسُ دقائقَ تهبطُ في قِسمِ الأمسِ إذا وقعَت في أوّلِ
--    دقائقِ اليومِ.
-- ---------------------------------------------------------------------------

create or replace function ensure_driver_location_partitions(
  p_days_ahead integer default 14
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := coalesce(p_days_ahead, 14);
  v_day date;
  v_name text;
  v_created text[] := array[]::text[];
  v_existing integer := 0;
  v_default_rows bigint := 0;
begin
  if v_days < 0 or v_days > 366 then
    return jsonb_build_object('ok', false, 'error', 'DAYS_AHEAD_OUT_OF_RANGE');
  end if;

  -- القِسمُ الافتراضيُّ أوّلاً: شبكةُ الأمانِ تسبقُ ما تحرسُه.
  if to_regclass('public.driver_location_history_default') is null then
    execute 'create table driver_location_history_default '
         || 'partition of driver_location_history default';
    execute 'create index driver_location_history_default_city_driver_idx '
         || 'on driver_location_history_default (city_id, driver_id, recorded_at desc)';
    v_created := v_created || 'driver_location_history_default'::text;
  end if;

  v_day := (current_date - 1);
  while v_day <= (current_date + v_days) loop
    v_name := 'driver_location_history_' || to_char(v_day, 'YYYYMMDD');

    if to_regclass('public.' || v_name) is null then
      execute format(
        'create table %I partition of driver_location_history for values from (%L) to (%L)',
        v_name,
        v_day::timestamptz,
        (v_day + 1)::timestamptz
      );
      -- فهرسُ القراءةِ الوحيدُ المعروفُ اليومَ: مسارُ سائقٍ في نافذةٍ، مقيَّداً
      -- بمدينةٍ (القاعدةُ ٠.٤). ولا يُضافُ فهرسٌ لقارئٍ لم يُكتَبْ بعدُ.
      execute format(
        'create index %I on %I (city_id, driver_id, recorded_at desc)',
        v_name || '_city_driver_idx',
        v_name
      );
      v_created := v_created || v_name::text;
    else
      v_existing := v_existing + 1;
    end if;

    v_day := v_day + 1;
  end loop;

  -- عددُ صفوفِ القِسمِ الافتراضيِّ: الحالُ الشاذُّ يُرى ولا يمرُّ صامتاً.
  execute 'select count(*) from driver_location_history_default' into v_default_rows;

  return jsonb_build_object(
    'ok', true,
    'created', to_jsonb(v_created),
    'existing', v_existing,
    'default_rows', v_default_rows
  );
end;
$$;

comment on function ensure_driver_location_partitions(integer) is
  'F7-03 / ADR-0074: تُنشئُ أقسامَ `driver_location_history` اليوميّةَ من أمسِ إلى `p_days_ahead` أماماً، وتُرجِعُ حصيلةً فيها عددُ صفوفِ القِسمِ الافتراضيِّ. مُتماثِلةٌ: نداءٌ ثانٍ لا يُنشئُ شيئاً ولا يسقطُ.';

-- ---------------------------------------------------------------------------
-- ٣) النافذةُ الأولى — بالدالّةِ نفسِها لا بنسخةٍ ثانيةٍ من شكلِ القِسمِ
-- ---------------------------------------------------------------------------

select ensure_driver_location_partitions(14);
