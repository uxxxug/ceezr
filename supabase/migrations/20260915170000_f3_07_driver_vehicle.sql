-- =============================================================================
-- F3-07 — مركبتي + الشعار والباركود (SD-11)
--
-- migration-phase: expand
--
-- ما يُضاف: ثلاثةُ أعمدةٍ على `drivers` (سنةُ الصنعِ ومسارُ الشعارِ ومسارُ
-- الباركودِ) ودالّةُ قراءةٍ وتحديثٍ تُجمِعُ بياناتِ المركبةِ ووثائقَها في
-- نداءٍ واحدٍ. **ولا يُنشَأُ جدولٌ**: المركبةُ صفٌّ واحدٌ في `drivers` منذ
-- الهجرةِ الأولى، والوثائقُ في `driver_documents` منذ `F3-01`.
--
-- ولِمَ الأعمدةُ على `drivers` لا جدولٌ منفصلٌ
--
-- المركبةُ مِلكٌ لسائقٍ واحدٍ وواحدٌ فقط، والعلاقةُ واحد-لواحدٍ. فجدولٌ
-- منفصلٌ يُضيفُ ضمَّ صفَّينِ لكلِّ قراءةٍ بلا فائدةٍ، وعمودٌ ناقصٌ يُعطّلُ
-- الشاشةَ كلَّها. والأعمدةُ اختياريّةٌ كلُّها: سنةٌ غائبةٌ `null` لا صفراً،
-- ومسارُ شعارٍ غائٌب `null` لا سلسلةً فارغةً.
--
-- ولِمَ دالّةُ قراءةٍ لا استعلامٌ مباشرٌ
--
-- الملكيّةُ في القاعدةِ (القاعدة 0.5): `USER_NOT_FOUND` و`NOT_A_DRIVER`
-- من الدالّةِ لا من الطبقةِ. والوثائقُ الثلاثُ (رخصةُ السيرِ، التأمينُ،
-- الفحصُ الفنّيُّ) تُقرأُ من `driver_documents` بنوعِها وحالتِها وتاريخِ
-- انتهائِها — فيُجمَعُ الكلُّ في نداءٍ واحدٍ.
--
-- وما لا تفعله هذه الهجرةُ عن قصدٍ — (`ح-5`)
--
--   ــ **لا تُنشئُ باركوداً**: توليدُ الباركودِ من الشعارِ عملُ عرضٍ في
--      الشاشةِ، لا حقلٌ في القاعدةِ.
--   ــ **لا تُوقِّعُ روابطَ قراءةٍ**: عرضُ الشعارِ والباركودِ يحتاجُ
--      توقيعَ قراءةٍ، وهو **دَينٌ مُعلَنٌ** لا مُنفَّذٌ ههنا.
--   ــ **لا تُفعِّلُ تيليجرامَ**: `showScanQrPopup` يُستدعى من الشاشةِ لا
--      من القاعدةِ.
-- =============================================================================

-- ── ١) الأعمدةُ الثلاثةُ على `drivers` ──────────────────────────────────────

alter table drivers add column if not exists vehicle_year integer;
alter table drivers add column if not exists logo_object_path text;
alter table drivers add column if not exists barcode_object_path text;

comment on column drivers.vehicle_year is
  'سنةُ صنعِ المركبةِ — اختياريّةٌ، `null` لا صفراً (SD-11).';
comment on column drivers.logo_object_path is
  'مسارُ مِلفِّ الشعارِ في مخزنِ الكائناتِ — اختياريّ، `null` لا سلسلةً فارغةً (SD-11).';
comment on column drivers.barcode_object_path is
  'مسارُ مِلفِّ الباركودِ في مخزنِ الكائناتِ — اختياريّ، `null` لا سلسلةً فارغةً (SD-11).';

-- ── ٢) دالّةُ القراءةِ: `driver_vehicle(bigint)` ─────────────────────────────
-- تُجمِعُ بياناتِ المركبةِ الأساسيّةَ ووثائقَها الثلاثَ (رخصةُ السيرِ،
-- التأمينُ، الفحصُ الفنّيُّ) في نداءٍ واحدٍ. والملكيّةُ في القاعدةِ:
-- `USER_NOT_FOUND` و`NOT_A_DRIVER` من الدالّةِ لا من الطبقةِ.

create or replace function driver_vehicle(p_telegram_user_id bigint)
returns table(
  vehicle_type text,
  plate_number text,
  vehicle_year int,
  logo_object_path text,
  barcode_object_path text,
  -- وثائقُ المركبةِ الثلاثُ: حالةٌ وتاريخُ انتهاءٍ
  registration_status text,
  registration_expires_at date,
  insurance_status text,
  insurance_expires_at date,
  inspection_status text,
  inspection_expires_at date
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    d.vehicle_type,
    d.plate_number,
    d.vehicle_year,
    d.logo_object_path,
    d.barcode_object_path,
    (select status::text from driver_documents dd
       where dd.driver_id = d.id and dd.doc_type = 'vehicle_registration'
       order by dd.updated_at desc limit 1),
    (select expires_at from driver_documents dd
       where dd.driver_id = d.id and dd.doc_type = 'vehicle_registration'
       order by dd.updated_at desc limit 1),
    (select status::text from driver_documents dd
       where dd.driver_id = d.id and dd.doc_type = 'insurance'
       order by dd.updated_at desc limit 1),
    (select expires_at from driver_documents dd
       where dd.driver_id = d.id and dd.doc_type = 'insurance'
       order by dd.updated_at desc limit 1),
    (select status::text from driver_documents dd
       where dd.driver_id = d.id and dd.doc_type = 'periodic_inspection'
       order by dd.updated_at desc limit 1),
    (select expires_at from driver_documents dd
       where dd.driver_id = d.id and dd.doc_type = 'periodic_inspection'
       order by dd.updated_at desc limit 1)
  from drivers d
  join users u on u.id = d.user_id
  where u.telegram_id = p_telegram_user_id;
$$;

-- ── ٣) دالّةُ التحديثِ: `update_driver_vehicle(bigint, text, text, int)` ────
-- تُحدِّثُ بياناتِ المركبةِ الأساسيّةَ فقط — النوعَ واللوحةَ وسنةَ الصنعِ.
-- الشعارُ والباركودُ يُرفعانِ بمسارِ مِلفٍّ من وثائقِ `F3-01` لا بهذه الدالّةِ.
-- والملكيّةُ في القاعدةِ: `USER_NOT_FOUND` و`NOT_A_DRIVER`.

create or replace function update_driver_vehicle(
  p_telegram_user_id bigint,
  p_vehicle_type text,
  p_plate_number text,
  p_vehicle_year int
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_driver_id uuid;
begin
  select d.id into v_driver_id
  from drivers d
  join users u on u.id = d.user_id
  where u.telegram_id = p_telegram_user_id;

  if v_driver_id is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  update drivers set
    vehicle_type = nullif(p_vehicle_type, ''),
    plate_number = nullif(p_plate_number, ''),
    vehicle_year = p_vehicle_year
  where id = v_driver_id;
end;
$$;

-- ── ٤) دالّةُ تحديثِ مسارَيْ الشعارِ والباركودِ ────────────────────────────
-- تُحدِّثُ مسارَيْ مِلفَّيْ الشعارِ والباركودِ في `drivers` بعدَ رفعِهما
-- بمسارِ `F3-01`. والملكيّةُ في القاعدةِ.

create or replace function update_driver_vehicle_assets(
  p_telegram_user_id bigint,
  p_logo_object_path text,
  p_barcode_object_path text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_driver_id uuid;
begin
  select d.id into v_driver_id
  from drivers d
  join users u on u.id = d.user_id
  where u.telegram_id = p_telegram_user_id;

  if v_driver_id is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  update drivers set
    logo_object_path = nullif(p_logo_object_path, ''),
    barcode_object_path = nullif(p_barcode_object_path, '')
  where id = v_driver_id;
end;
$$;

-- ── ٥) إعدادُ `vehicle_logo_max_bytes` لكلِّ مدينةٍ ─────────────────────────
-- سقفُ حجمِ مِلفِّ الشعارِ والباركودِ — إعدادُ مدينةٍ لا ثابتٌ في شيفرةٍ.

insert into platform_settings (city_id, key, value)
select c.id, 'vehicle_logo_max_bytes', '1048576'
from cities c
where not exists (
  select 1 from platform_settings ps
  where ps.city_id = c.id and ps.key = 'vehicle_logo_max_bytes'
)
on conflict do nothing;

insert into platform_settings (city_id, key, value)
select c.id, 'vehicle_logo_allowed_content_types', 'image/png,image/jpeg'
from cities c
where not exists (
  select 1 from platform_settings ps
  where ps.city_id = c.id and ps.key = 'vehicle_logo_allowed_content_types'
)
on conflict do nothing;
