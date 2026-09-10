-- =============================================================================
-- migration-phase: expand
-- F7-06 / ADR-0075 / DEC-15: أرشفةُ أقسامِ `driver_location_history` خارجَ
--   القاعدةِ — الشطرُ الباقي من العائقِ `CAP-010`.
-- الحالة: منفّذ (توسيعٌ بحتٌ — جدولٌ جديدٌ ودالّتانِ جديدتانِ، ولا عمودَ قائمٌ
--   يُمَسُّ ولا دالّةٌ قائمةٌ تُغيَّرُ في هذا الملفِّ).
-- يبني على: 20260806120000 (`cities`)، 20260910050000 (`driver_location_history`
--   المقسَّمُ ومُنشئُ أقسامِه).
-- ينتمي إلى: supabase/migrations.
--
-- ## ما تُغيّره هذه الهجرة
--
-- ١) `location_archive_manifest`: **دفترُ ما خرجَ** — صفٌّ لكلِّ جزءٍ مرفوعٍ،
--    فيه عددُ صفوفِه وبصمتُه وحجمُه ووقتُ التحقّقِ منه.
-- ٢) `location_archive_due_days(integer, integer)`: تقرأُ الأقسامَ التي تجاوزَت
--    النافذةَ الساخنةَ، ومعَ كلِّ يومٍ عددُ صفوفِ كلِّ مدينةٍ فيه.
-- ٣) `location_archive_drop_day(date, integer)`: **الحارسُ الذي يملكُ الإسقاطَ
--    وحدَه** — لا يُسقِطُ قِسماً إلّا بعدَ أن يُطابِقَ عددَ صفوفِه بعددِ الصفوفِ
--    المرفوعةِ **المُتحقَّقِ منها** مدينةً مدينةً.
--
-- ## لماذا الحارسُ في SQL لا في TypeScript
--
-- لأنَّ الإسقاطَ **لا رجعةَ فيه**. وكلُّ حارسٍ يعيشُ في طبقةِ التطبيقِ يُتجاوَزُ
-- بنداءٍ مباشرٍ من `psql` أو من مهمّةٍ ثانيةٍ تُكتَبُ بعدَ سنةٍ ولا يقرأُ كاتبُها
-- شرطَ الأولى. أمّا الشرطُ داخلَ الدالّةِ فهوَ الشرطُ الوحيدُ الممكنُ: لا يُسقِطُ
-- القِسمَ أحدٌ إلّا بها، وهيَ لا تُسقِطُ إلّا بعدَ المطابقةِ. وذاكَ أقوى إنفاذٍ
-- آليٍّ متاحٍ — الأولويّةُ الرابعةُ من أولويّاتِ اختيارِ المسارِ.
--
-- ## ولماذا المطابقةُ بالعددِ لا بوجودِ ملفٍّ
--
-- «رُفِعَ ملفٌّ لهذا اليومِ» ليسَ دليلاً على شيءٍ: قد يكونُ فارغاً، وقد يكونُ
-- جزءاً واحداً من عشرةٍ سقطَ تسعتُها. فالمطابقةُ على **مجموعِ صفوفِ الأجزاءِ
-- المُتحقَّقِ منها = صفوفِ القِسمِ لكلِّ مدينةٍ**. ونقصُ صفٍّ واحدٍ يمنعُ
-- الإسقاطَ ويُرجِعُ سببَه مُسمّىً.
--
-- ## ولماذا `verified_at` عمودٌ منفصلٌ عن `exported_at`
--
-- لأنَّ الرفعَ وعدٌ والتحقّقَ إثباتٌ. صفٌّ فيه `exported_at` وحدَه يعني «قالَ
-- المخزنُ إنّه استلمَ»؛ ولا يُعتَدُّ به في المطابقةِ. والتحقّقُ **يُنزِلُ الملفَ
-- ثانيةً ويُطابِقُ بصمتَه** — فما لم يُقرأْ ما رُفِعَ فليسَ ثمّةَ نسخةٌ، إنّما
-- ملفٌّ مجهولُ المحتوى.
--
-- ## ولماذا `city_id` في الدفترِ — والقاعدةُ ٠.٤ ليست شكليّةً ههنا
--
-- الأرشفةُ تجري لكلِّ مدينةٍ على حِدَةٍ لا لليومِ كلِّه دفعةً. وليسَ ذلكَ امتثالاً
-- للقاعدةِ فحسبُ: يومَ يُحسَمُ `F12-15` وتختلفُ وجهةُ الأرشيفِ من مدينةٍ إلى
-- مدينةٍ، يكونُ التقسيمُ قائماً في الدفترِ منذُ اليومِ الأوّلِ ولا يُعادُ بناءُ
-- أرشيفٍ مضى.
--
-- ## العودة (rollback)
--
-- توسيعٌ بحتٌ: جدولٌ ودالّتانِ **جديدةٌ كلُّها**، ولا مُنادي لها في النسخةِ
-- السابقةِ من الشيفرةِ فتبقى ساكنةً. والعودةُ إن لزمَت هيَ **إيقافُ المهمّةِ**
-- بصورةِ الشيفرةِ السابقةِ؛ ولا تُسقَطُ الدالّتانِ ولا الدفترُ إذ الدفترُ نفسُه
-- هوَ ما يُثبِتُ أينَ ذهبَ ما خرجَ.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ١) دفترُ ما خرجَ
-- ---------------------------------------------------------------------------

create table if not exists location_archive_manifest (
  city_id uuid not null references cities (id),
  partition_date date not null,
  part integer not null,
  object_name text not null,
  remote_file_id text not null,
  row_count bigint not null,
  bytes bigint not null,
  sha256 text not null,
  exported_at timestamptz not null default now(),
  verified_at timestamptz,
  primary key (city_id, partition_date, part)
);

alter table location_archive_manifest enable row level security;

comment on table location_archive_manifest is
  'F7-06 / ADR-0075 / DEC-15: دفترُ أجزاءِ أرشيفِ تاريخِ الموقعِ — صفٌّ لكلِّ جزءٍ مرفوعٍ لمدينةٍ في يومٍ. `verified_at` هوَ الإثباتُ الوحيدُ المُعتَدُّ به في شرطِ الإسقاطِ.';

-- ---------------------------------------------------------------------------
-- ٢) الأيّامُ المستحقّةُ — قراءةٌ صرفةٌ لا تُغيِّرُ شيئاً
--
--    اسمُ القِسمِ هوَ مصدرُ تاريخِه (`driver_location_history_YYYYMMDD`) — وهوَ
--    ما تُنشئُه `ensure_driver_location_partitions` وحدَها، فلا اجتهادَ في
--    التسميةِ ولا صيغةَ ثانيةً. والقِسمُ الافتراضيُّ مستثنىً صراحةً: صفوفُه لا
--    يومَ لها معلوماً، فأرشفتُه بيومٍ مُخترَعٍ كذبٌ في الدفترِ.
-- ---------------------------------------------------------------------------

create or replace function location_archive_due_days(
  p_hot_days integer default 14,
  p_max_days integer default 3
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hot integer := coalesce(p_hot_days, 14);
  v_max integer := coalesce(p_max_days, 3);
  v_cutoff date;
  v_rec record;
  v_days jsonb := '[]'::jsonb;
  v_cities jsonb;
  v_seen integer := 0;
begin
  if v_hot < 1 or v_hot > 3650 then
    return jsonb_build_object('ok', false, 'error', 'HOT_DAYS_OUT_OF_RANGE');
  end if;
  if v_max < 1 or v_max > 366 then
    return jsonb_build_object('ok', false, 'error', 'MAX_DAYS_OUT_OF_RANGE');
  end if;

  v_cutoff := current_date - v_hot;

  for v_rec in
    select
      c.relname as partition_name,
      to_date(right(c.relname, 8), 'YYYYMMDD') as day
    from pg_class c
    join pg_inherits i on i.inhrelid = c.oid
    join pg_class p on p.oid = i.inhparent
    where p.relname = 'driver_location_history'
      and c.relname ~ '^driver_location_history_[0-9]{8}$'
      and to_date(right(c.relname, 8), 'YYYYMMDD') < v_cutoff
    order by 2 asc
  loop
    exit when v_seen >= v_max;

    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(''city_id'', s.city_id, ''rows'', s.n)), ''[]''::jsonb)
         from (select city_id, count(*) as n from %I group by city_id) s',
      v_rec.partition_name
    ) into v_cities;

    v_days := v_days || jsonb_build_array(jsonb_build_object(
      'day', to_char(v_rec.day, 'YYYY-MM-DD'),
      'partition', v_rec.partition_name,
      'cities', v_cities
    ));
    v_seen := v_seen + 1;
  end loop;

  return jsonb_build_object('ok', true, 'cutoff', to_char(v_cutoff, 'YYYY-MM-DD'), 'days', v_days);
end;
$$;

revoke all on function location_archive_due_days(integer, integer) from public, anon, authenticated;
grant execute on function location_archive_due_days(integer, integer) to service_role;

comment on function location_archive_due_days(integer, integer) is
  'F7-06: أقسامُ تاريخِ الموقعِ التي تجاوزَت النافذةَ الساخنةَ، ومعَ كلِّ يومٍ عددُ صفوفِ كلِّ مدينةٍ. قراءةٌ صرفةٌ.';

-- ---------------------------------------------------------------------------
-- ٣) الإسقاطُ — ولا يُسقِطُ إلّا بعدَ المطابقةِ
--
--    والفصلُ قبلَ الإسقاطِ عن قصدٍ: `detach` يُخرِجُ القِسمَ من الأصلِ فيصيرُ
--    جدولاً قائماً بذاتِه، ثمَّ يُسقَطُ. ولو سقطَ النداءُ بينَهما لبقيَ الجدولُ
--    منفصلاً بصفوفِه كلِّها — لا صفَّ يضيعُ، والشوطُ التالي يجدُه ويُتِمُّ.
-- ---------------------------------------------------------------------------

create or replace function location_archive_drop_day(
  p_day date,
  p_hot_days integer default 14
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hot integer := coalesce(p_hot_days, 14);
  v_name text;
  v_rows bigint;
  v_mismatch record;
  v_dropped bigint := 0;
begin
  if p_day is null then
    return jsonb_build_object('ok', false, 'error', 'DAY_REQUIRED');
  end if;
  if v_hot < 1 or v_hot > 3650 then
    return jsonb_build_object('ok', false, 'error', 'HOT_DAYS_OUT_OF_RANGE');
  end if;

  -- شرطُ النافذةِ يُعادُ فحصُه ههنا ولو فحصَه المُنادي: الدالّةُ تُنادى من مهمّةٍ
  -- اليومَ، ومن يدٍ غداً — والحارسُ الذي يثقُ بمُناديه ليسَ حارساً.
  if p_day >= (current_date - v_hot) then
    return jsonb_build_object('ok', false, 'error', 'DAY_INSIDE_HOT_WINDOW');
  end if;

  v_name := 'driver_location_history_' || to_char(p_day, 'YYYYMMDD');

  if to_regclass('public.' || v_name) is null then
    return jsonb_build_object('ok', true, 'status', 'already-dropped', 'partition', v_name);
  end if;

  execute format('select count(*) from %I', v_name) into v_rows;

  -- المطابقةُ مدينةً مدينةً: صفوفُ القِسمِ لمدينةٍ = مجموعُ صفوفِ أجزائِها
  -- المُتحقَّقِ منها. ومدينةٌ في القِسمِ بلا دفترٍ تظهرُ ههنا بفارقٍ موجبٍ.
  execute format(
    'select s.city_id, s.n as partition_rows, coalesce(m.n, 0) as archived_rows
       from (select city_id, count(*) as n from %I group by city_id) s
       left join (
         select city_id, sum(row_count) as n
           from location_archive_manifest
          where partition_date = %L and verified_at is not null
          group by city_id
       ) m on m.city_id = s.city_id
      where coalesce(m.n, 0) <> s.n
      limit 1',
    v_name,
    p_day
  ) into v_mismatch;

  if v_mismatch.city_id is not null then
    return jsonb_build_object(
      'ok', false,
      'error', 'ARCHIVE_INCOMPLETE',
      'partition', v_name,
      'city_id', v_mismatch.city_id,
      'partition_rows', v_mismatch.partition_rows,
      'archived_rows', v_mismatch.archived_rows
    );
  end if;

  execute format('alter table driver_location_history detach partition %I', v_name);
  execute format('drop table %I', v_name);
  v_dropped := v_rows;

  return jsonb_build_object(
    'ok', true,
    'status', 'dropped',
    'partition', v_name,
    'dropped_rows', v_dropped
  );
end;
$$;

revoke all on function location_archive_drop_day(date, integer) from public, anon, authenticated;
grant execute on function location_archive_drop_day(date, integer) to service_role;

comment on function location_archive_drop_day(date, integer) is
  'F7-06 / DEC-15: يُسقِطُ قِسمَ يومٍ تجاوزَ النافذةَ الساخنةَ **بعدَ** مطابقةِ صفوفِه بصفوفِ أرشيفِه المُتحقَّقِ منه مدينةً مدينةً. يُرجِعُ ARCHIVE_INCOMPLETE ولا يُسقِطُ عندَ أيِّ فارقٍ.';
