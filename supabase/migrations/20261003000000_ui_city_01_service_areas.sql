-- migration-phase: backfill
-- UI-CITY-01: مناطقُ خدمةٍ للمدنِ الأربعِ التي بلا منطقةٍ (MED · MKK · RUH · TIF).
-- بلا منطقةِ خدمةٍ تُرفَضُ كلُّ وجهةٍ في المدينةِ فلا يُطلَبُ مشوارٌ إطلاقاً.
-- مستطيلاتٌ محيطةٌ تقريبيّةٌ بنفسِ منهجِ `jed-envelope-v1` (ADR 0102 §6): تشملُ النطاقَ
-- العمرانيَّ والمطارَ، مشتقّةٌ من مركزِ المدينةِ في OpenStreetMap — ليست حدوداً بلديّةً رسميّةً.
-- ولا تتقاطعُ مستطيلاتُ المدنِ فيما بينَها (جدة ٣٩٫٠٥–٣٩٫٤٠ شرقاً، مكة ٣٩٫٧٠–٤٠٫٠٠، الطائف ٤٠٫٢٥–٤٠٫٦٥).
insert into city_service_areas (city_id, area, area_version, source, is_active)
select c.id,
       st_multi(st_makeenvelope(s.x0, s.y0, s.x1, s.y1, 4326))::geography,
       s.area_version,
       'مستطيلٌ محيطٌ تقريبيٌّ حولَ النطاقِ العمرانيِّ والمطارِ من OpenStreetMap — ليسَ حدّاً بلديّاً رسميّاً (ADR 0102 §6 · UI-CITY-01)',
       true
  from cities c
  join (values
    ('MED', 'med-envelope-v1', 39.45::double precision, 24.30::double precision, 39.80::double precision, 24.65::double precision),
    ('MKK', 'mkk-envelope-v1', 39.70::double precision, 21.25::double precision, 40.00::double precision, 21.60::double precision),
    ('RUH', 'ruh-envelope-v1', 46.45::double precision, 24.40::double precision, 47.10::double precision, 25.10::double precision),
    ('TIF', 'tif-envelope-v1', 40.25::double precision, 21.10::double precision, 40.65::double precision, 21.55::double precision)
  ) as s(code, area_version, x0, y0, x1, y1) on s.code = c.code
 where not exists (
     select 1 from city_service_areas a
      where a.city_id = c.id and a.is_active
   );
