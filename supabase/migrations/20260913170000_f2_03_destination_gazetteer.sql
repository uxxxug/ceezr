-- migration-phase: expand
-- =============================================================================
-- الغرض: دليلُ الوجهاتِ ومنطقةُ الخدمةِ وتطبيعُ البحثِ العربيِّ — البند `F2-03`
--    (`SR-03` في القسم 9.5: «بحثٌ نصّيٌّ + اختيارٌ من الخريطةِ + دبّوسٌ قابلٌ
--    للسحبِ معَ تأكيدِ العنوانِ + موقعي الحاليُّ»)، والعقدانِ الجديدانِ
--    `GET /v1/destinations/search` و`POST /v1/destinations/resolve` المُسجَّلانِ
--    بالإضافةِ في القسم 10.2.
-- الحالة: منفّذ فعلياً — 2026-09-13 · البند `F2-03`.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `packages/infrastructure/destinations/destinations-store.ts` عبرَ
--    الدالّتَينِ `search_destinations` و`resolve_destination` وحدَهما،
--    و`apps/gateway/src/routes/destinations.ts`.
-- يُتوقع أن يستخدمه لاحقاً: `F2-04` (التسعيرُ) يُبنى على نقطةٍ **مُصادَقةٍ** من
--    `resolve_destination` لا على إحداثيّةٍ خامٍّ من العميلِ؛ و`F3` (السائقُ)
--    يقرأُ `city_service_areas` نفسَها لحدِّ منطقةِ العملِ فلا حدَّ ثانيَ.
--
-- ## لماذا منطقةُ الخدمةِ **جدولُ بيانةٍ** لا ثابتٌ في الشِّفرةِ
--
-- حدُّ المدينةِ يتغيّرُ بقرارِ عملٍ لا بإصدارِ شِفرةٍ: تُوسَّعُ جدةُ حيّاً، وتُفتَحُ
-- مكةُ يوماً. فلو كانَ مضلَّعاً في TypeScript لَاحتاجَ كلُّ توسيعٍ نشرَ حزمةٍ،
-- ولَصارَ حدُّ المدينةِ محكوماً بجدولِ إصدارٍ لا بجدولِ تشغيلٍ. وههنا هوَ صفٌّ
-- بنسخةٍ (`area_version`) وبمصدرٍ مُعلَنٍ (`source`)، فاستبدالُه هجرةُ بيانةٍ
-- واحدةٌ لا تمسُّ سطراً من الشِّفرةِ.
--
-- **وحدُّ النسخةِ الأولى مُعلَنٌ لا مُجمَّلٌ**: `jed-envelope-v1` **مستطيلٌ
-- مُحيطٌ تقريبيٌّ** لا حدٌّ بلديٌّ رسميٌّ، ويشملُ بحراً غربَ الساحلِ ويسمحُ
-- بنقاطٍ خارجَ العمرانِ. فهوَ يمنعُ الخطأَ الجسيمَ (وجهةٌ في الرياضِ أو في
-- المحيطِ) ولا يُدَّعى أنَّه يمنعُ الخطأَ الدقيقَ. واستبدالُه بالحدِّ الرسميِّ
-- دَينٌ مُعلَنٌ في `docs/adr/0102-destination-selection-without-a-geocoder.md` §٦.
--
-- ## ولماذا دليلُ معالمَ **مملوكٌ** لا مزوّدُ ترميزٍ جغرافيٍّ
--
-- البحثُ النصّيُّ في `SR-03` يحتاجُ اسماً يصيرُ نقطةً. والطريقُ المعتادُ نداءُ
-- مزوّدٍ خارجيٍّ، وهوَ ممنوعٌ ههنا لسببَينِ مكتوبَينِ سلفاً: تعليمةُ المالكِ
-- `O-7` (منتَجٌ تجاريٌّ **مستقلٌّ**) وحاجزُ `check-egress-boundary` (`W-6`) الذي
-- يمنعُ مضيفاً غيرَ مُعلَنٍ. ولو أُدخِلَ مزوّدٌ لَصارَ أوّلُ فعلٍ في الرحلةِ
-- مرهوناً بعقدٍ تجاريٍّ وبحصّةِ نداءاتٍ وبمُضيفٍ يرى وجهةَ كلِّ راكبٍ.
--
-- فالمصادرُ الثلاثةُ للبحثِ كلُّها **ملكُ هذا المستودَعِ**: أماكنُ المستخدمِ
-- المحفوظةُ (`saved_places` — `F2-02`)، ووجهاتُه الأخيرةُ (قراءةٌ من `orders`)،
-- ودليلُ معالمَ (`destination_landmarks`) بإحداثيّاتٍ مُوثَّقةِ المصدرِ. ومزوّدٌ
-- خارجيٌّ يبقى **طبقةً غائبةً مُعلَنةً**: الشاشةُ تقولُ «ابحثْ بالاسمِ أو ضَعِ
-- الدبّوسَ» ولا تزعمُ أنَّها تعرفُ كلَّ عنوانٍ في المدينةِ.
--
-- ## ولماذا التطبيعُ العربيُّ **في القاعدةِ** لا في الشِّفرةِ وحدَها
--
-- «جده» و«جدّة» و«جِدَّة» و«جـدة» مدخلُ مستخدمٍ واحدٌ في أربعِ صورٍ. ولو طُبِّعَ
-- المدخلُ في الشِّفرةِ وبقيَ العمودُ خامّاً لَمَا طابقَ فهرسٌ شيئاً ولَصارَ كلُّ
-- بحثٍ مسحاً كاملاً للجدولِ. فالتطبيعُ دالّةٌ `immutable` ههنا، والعمودُ
-- `search_key` **مُولَّدٌ** منها (فلا يُكتَبُ يدويّاً فيتباعدَ عن اسمِه)، والفهرسُ
-- عليه في هجرةِ طورِ `index`.
--
-- ونسخةُ النطاقِ في `packages/domain/destinations/search-text.ts` تُطابِقُ هذه
-- **جدولَ حروفٍ بجدولِ حروفٍ** بحاجزِ `scripts/check-destination-contract.ts`،
-- وتُطابِقُها **مخرَجاً بمخرَجٍ** على PostgreSQL حقيقيٍّ في
-- `tests/integration/destinations.test.ts`. فالقاعدةُ 0.6 لا تُخالَفُ بنسختَينِ:
-- نسخةٌ واحدةٌ منطقاً، مُنفَّذةٌ في زمنَينِ، مُلزَمةٌ بالتطابقِ آليّاً.
--
-- ## ولماذا الرفضُ `OUTSIDE_SERVICE_AREA` في القاعدةِ لا في الشاشةِ
--
-- القاعدةُ 0.5: الحكمُ حيثُ البيانةُ. ولو فحصَتِ الشاشةُ الحدَّ لَكانَ أوّلُ
-- عميلٍ يُنادي العقدَ مباشرةً قادراً على غرسِ وجهةٍ خارجَ المدينةِ في `F2-04`
-- و`F2-05`. والفحصُ ههنا يعني أنَّ كلَّ نقطةٍ تدخلُ التسعيرَ مرَّت بحدٍّ واحدٍ.
--
-- ## وما لا تفعلُه هذه الهجرةُ عن قصدٍ — وحدودُها مُعلَنةٌ لا مضمرةٌ
--
--   ــ **لا تكتبُ وجهةً**: `resolve_destination` و`search_destinations` قراءتانِ
--      خالصتانِ. والوجهةُ تُكتَبُ حينَ يُنشَأُ الطلبُ (`F2-05`) لا قبلَه، فلا صفَّ
--      «وجهةٍ مختارةٍ» يُتركُ معلَّقاً بلا طلبٍ يملكُه.
--   ــ **لا تُنشئُ مستخدماً ولا مدينةً** (ADR 0035).
--   ــ **لا تُقدِّرُ مسافةَ طريقٍ**: `st_distance` مسافةُ خطٍّ مستقيمٍ، وتُسمّى
--      في الجوابِ `straight_distance_m` بهذا الاسمِ كي لا تُقرأَ مسافةَ مسارٍ.
--      مسافةُ المسارِ من `packages/maps` وموضعُها `F2-04`.
--   ــ **لا تُرتِّبُ بالقربِ إلّا داخلَ نتائجِ الدليلِ**: أقربُ معلَمٍ إلى دبّوسٍ
--      حكمٌ هندسيٌّ، أمّا ترتيبُ نتائجِ البحثِ النصّيِّ فبدقّةِ المطابقةِ ثمَّ
--      بمصدرِ الصفِّ — ومَن يخلطُ القربَ بالمطابقةِ يُقدِّمُ معلَماً قريباً لا
--      علاقةَ لاسمِه بما كُتبَ.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- `normalize_search_text` — طيُّ صورِ الحرفِ العربيِّ إلى صورةٍ واحدةٍ
--
-- `immutable` شرطٌ لا وصفٌ: العمودُ المُولَّدُ والفهرسُ لا يقبلانِ دالّةً غيرَها،
-- وهيَ كذلكَ بحقٍّ — لا تقرأُ جدولاً ولا إعداداً ولا وقتاً. و`translate` واحدةٌ
-- تكفي للطيِّ والحذفِ معاً: ما زادَ في `from` عن `to` يُحذَفُ، فالتشكيلُ
-- والتطويلُ في آخرِ `from` بلا مقابلٍ.
-- ----------------------------------------------------------------------------
create or replace function normalize_search_text(p_input text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $fn$
  select btrim(
           regexp_replace(
             regexp_replace(
               lower(
                 translate(
                   coalesce(p_input, ''),
                   -- الطيُّ واحداً بواحدٍ ثمَّ الحذفُ (تشكيلٌ وتطويلٌ) في الذيلِ.
                   'آأإٱىئةؤ٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹ـًٌٍَُِّْٰ',
                   'ااااييهو01234567890123456789'
                 )
               ),
               -- ما ليسَ حرفاً عربيّاً أو لاتينيّاً أو رقماً يصيرُ فاصلاً، فلا
               -- تُلصَقُ كلمتانِ بحذفِ شَرطةٍ بينَهما ولا يُبتلَعُ فرقُ معنىً.
               '[^0-9a-z\u0621-\u063A\u0641-\u064A]+', ' ', 'g'
             ),
             ' +', ' ', 'g'
           )
         );
$fn$;

revoke execute on function normalize_search_text(text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- `word_start_match` — «مطابقةُ بدايةِ كلمةٍ» رتبةً أولى لا بدايةَ الحقلِ وحدَها
--
-- مفتاحُ البحثِ يحملُ الاسمَينِ العربيَّ ثمَّ اللاتينيَّ في نصٍّ واحدٍ، فمَن كتبَ
-- `king f` بلوحةٍ إنجليزيّةٍ لا يُطابِقُ بدايةَ الحقلِ أبداً وإن طابَقَ بدايةَ
-- الاسمِ الذي يقصدُه. ولو بقيَت الرتبةُ على بدايةِ الحقلِ لَتذيَّلَت النتيجةُ
-- الصحيحةُ خلفَ مطابقاتِ منتصفِ الكلمةِ — فكانت الرتبةُ تُعاقِبُ لغةَ الكاتبِ.
--
-- `immutable` كسابقتِها ولذاتِ السببِ. وهيَ تعملُ على نصٍّ **مُطبَّعٍ سلفاً**:
-- الفراغُ الواحدُ فاصلُ الكلماتِ بعدَ `normalize_search_text`، فلا تُعيدُ تطبيعاً.
-- ----------------------------------------------------------------------------
create or replace function word_start_match(p_haystack text, p_needle text)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $fn$
  select coalesce(p_needle, '') <> ''
     and (
       coalesce(p_haystack, '') like p_needle || '%'
       or coalesce(p_haystack, '') like '% ' || p_needle || '%'
     );
$fn$;

revoke execute on function word_start_match(text, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- `city_service_areas` — حدُّ المدينةِ صفّاً بنسخةٍ ومصدرٍ
--
-- `city_id` فريدٌ **جزئيّاً على المُفعَّلِ** (هجرةُ طورِ `index`): حدٌّ واحدٌ
-- ساريٌ لكلِّ مدينةٍ، وأحدٌ سابقٌ يبقى صفّاً `is_active = false` لا يُحذَفُ —
-- فيُقرأُ لماذا قُبِلَت وجهةٌ في الأمسِ ورُفِضَت اليومَ (القاعدة ح-1 معنىً).
-- ----------------------------------------------------------------------------
create table if not exists city_service_areas (
  id           uuid primary key default gen_random_uuid(),
  city_id      uuid not null references cities(id),
  -- `MultiPolygon` لا `Polygon`: مدينةٌ ذاتُ جزرٍ أو ضاحيةٍ منفصلةٍ حالةٌ واقعيّةٌ،
  -- وتغييرُ النوعِ لاحقاً هجرةُ `switch` على جدولٍ حارٍّ — والسعةُ الآنَ أرخصُ.
  area         geography(MultiPolygon, 4326) not null,
  -- نسخةُ الحدِّ نصٌّ يُقرأُ في الجوابِ، فكلُّ قبولٍ أو رفضٍ يُعرَفُ بأيِّ حدٍّ حُكِمَ.
  area_version text not null check (length(trim(area_version)) between 1 and 64),
  -- مصدرُ الهندسةِ: من أينَ جاءَت ومَن يُصحِّحُها. و«تقريبيٌّ» يُقالُ ههنا نصّاً.
  source       text not null check (length(trim(source)) between 1 and 200),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists city_service_areas_set_updated_at on city_service_areas;
create trigger city_service_areas_set_updated_at before update on city_service_areas
  for each row execute function set_updated_at();

alter table city_service_areas enable row level security;

drop policy if exists city_service_areas_service_all on city_service_areas;
create policy city_service_areas_service_all on city_service_areas
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- `destination_landmarks` — دليلُ معالمَ مملوكٌ، والاسمُ المُطبَّعُ عمودٌ مُولَّدٌ
--
-- الصنفُ نصٌّ بقيدٍ ومصدرُه سجلُّ النطاقِ
-- `packages/domain/destinations/landmark-kinds.ts` (القاعدة 0.6)، ويُطابِقُه
-- الحاجزُ `scripts/check-destination-contract.ts` مجموعةً بمجموعةٍ لا احتواءً.
-- ----------------------------------------------------------------------------
create table if not exists destination_landmarks (
  id         uuid primary key default gen_random_uuid(),
  city_id    uuid not null references cities(id),
  kind       text not null check (kind in (
               'airport', 'port', 'terminal', 'district', 'landmark',
               'mosque', 'university', 'hospital', 'mall', 'stadium'
             )),
  name_ar    text not null check (length(trim(name_ar)) between 1 and 160),
  -- الاسمُ اللاتينيُّ مطلوبٌ: القسم 9.11 يُوجِبُ ثلاثَ لغاتٍ، والأرديّةُ تُخدَمُ
  -- بالعربيِّ حرفاً (رسمٌ واحدٌ) وبالإنجليزيِّ بحثاً — ومَن يكتبُ `jeddah` بلاتينيٍّ
  -- على لوحةٍ إنجليزيّةٍ يجبُ أن يجدَ شيئاً لا فراغاً.
  name_en    text not null check (length(trim(name_en)) between 1 and 160),
  point      geography(Point, 4326) not null,
  -- مصدرُ الإحداثيّةِ مكتوبٌ في الصفِّ نفسِه لا في وثيقةٍ تبعدُ عنه: إحداثيّةٌ بلا
  -- مصدرٍ لا تُصحَّحُ ولا تُراجَعُ، وهذا جدولٌ سيكبرُ بيدٍ بشريّةٍ.
  source     text not null check (length(trim(source)) between 1 and 300),
  is_active  boolean not null default true,
  -- مفتاحُ البحثِ **مُولَّدٌ**: لو كُتبَ يدويّاً لَتباعدَ عن الاسمِ عندَ أوّلِ
  -- تصحيحٍ إملائيٍّ ولَبقيَ الصفُّ يُطابِقُ كلمةً لا تُعرَضُ.
  search_key text generated always as (
               normalize_search_text(name_ar || ' ' || name_en)
             ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists destination_landmarks_set_updated_at on destination_landmarks;
create trigger destination_landmarks_set_updated_at before update on destination_landmarks
  for each row execute function set_updated_at();

alter table destination_landmarks enable row level security;

drop policy if exists destination_landmarks_service_all on destination_landmarks;
create policy destination_landmarks_service_all on destination_landmarks
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- البيانةُ الأولى — حدُّ جدةَ وعشرةُ معالمَ، وكلُّها بمصدرٍ مكتوبٍ
--
-- الإدخالُ `where not exists` لا `on conflict`: الفهرسُ الفريدُ في هجرةِ طورِ
-- `index` **بعدَ** هذه، فإسنادُ التماثُلِ إليه ههنا يُخفِقُ في أوّلِ تشغيلٍ.
-- والمُطبِّقُ يُعيدُ كلَّ ملفٍّ في كلِّ جولةٍ (ADR 0068)، فالتماثُلُ شرطُ صحّةٍ.
--
-- وجدةُ وحدَها: هيَ المدينةُ المُفعَّلةُ الوحيدةُ في `cities`، ودليلُ مدينةٍ
-- مُعطَّلةٍ بيانةٌ لا يقرأُها أحدٌ وتتقادمُ بلا مَن يُراجِعُها.
-- ----------------------------------------------------------------------------
insert into city_service_areas (city_id, area, area_version, source, is_active)
select c.id,
       -- مستطيلٌ مُحيطٌ: 21.25..21.85 شمالاً و39.05..39.40 شرقاً. يشملُ المطارَ
       -- شمالاً والبلدَ جنوباً وجامعةَ الملكِ عبدالعزيزِ شرقاً وبرجَ جدةَ شمالاً.
       st_multi(st_makeenvelope(39.05, 21.25, 39.40, 21.85, 4326))::geography,
       'jed-envelope-v1',
       'مستطيلٌ محيطٌ تقريبيٌّ مشتقٌّ من إحداثيّاتِ معالمِ المدينةِ المُوثَّقةِ أدناه — ليسَ حدّاً بلديّاً رسميّاً (ADR 0102 §6)',
       true
  from cities c
 -- الشرطُ يبتدئُ بـ`where not exists` **بهذا الترتيبِ** لا بعدَ شرطٍ آخرَ:
 -- هوَ الشكلُ الذي يعرفُه `scripts/lib/migration-safety.ts` تماثُلاً، وتقديمُ
 -- `c.code` عليه يجعلُ حاجزاً قائماً يقرأُ بذراً متماثلاً غيرَ متماثلٍ. والمعنى
 -- واحدٌ والشكلُ مقروءٌ لِحاجزٍ — فيُكتَبُ بالشكلِ الذي يُقرأُ.
 where not exists (
     select 1 from city_service_areas a
      where a.city_id = c.id and a.area_version = 'jed-envelope-v1'
   )
   and c.code = 'JED';

insert into destination_landmarks (city_id, kind, name_ar, name_en, point, source)
select c.id, s.kind, s.name_ar, s.name_en,
       st_setsrid(st_makepoint(s.lng, s.lat), 4326)::geography,
       s.source
  from cities c
  cross join (
    values
      ('airport',    'مطار الملك عبدالعزيز الدولي', 'King Abdulaziz International Airport', 21.67944,    39.15667,    'en.wikipedia.org/wiki/King_Abdulaziz_International_Airport'),
      ('port',       'ميناء جدة الإسلامي',          'Jeddah Islamic Port',                  21.483843,   39.173407,   'en.wikipedia.org/wiki/Jeddah_Islamic_Port'),
      ('district',   'جدة التاريخية (البلد)',        'Al-Balad Historic Jeddah',             21.483,      39.183,      'en.wikipedia.org/wiki/Al-Balad,_Jeddah'),
      ('district',   'وسط جدة',                     'Jeddah City Centre',                   21.54333,    39.17278,    'en.wikipedia.org/wiki/Jeddah'),
      ('landmark',   'نافورة الملك فهد',             'King Fahd Fountain',                   21.51556,    39.145,      'en.wikipedia.org/wiki/King_Fahd%27s_Fountain'),
      ('landmark',   'كورنيش جدة',                   'Jeddah Corniche',                      21.602056,   39.107333,   'en.wikipedia.org/wiki/Jeddah_Corniche'),
      ('landmark',   'برج جدة',                     'Jeddah Tower',                         21.734,      39.082917,   'en.wikipedia.org/wiki/Jeddah_Tower'),
      ('university', 'جامعة الملك عبدالعزيز',        'King Abdulaziz University',            21.49389,    39.25028,    'en.wikipedia.org/wiki/King_Abdulaziz_University'),
      ('stadium',    'مدينة الملك عبدالله الرياضية',  'King Abdullah Sports City',            21.76262694, 39.16509611, 'en.wikipedia.org/wiki/King_Abdullah_Sports_City'),
      ('mall',       'الرد سي مول',                  'Red Sea Mall',                         21.62778,    39.11111,    'en.wikipedia.org/wiki/Red_Sea_Mall')
  ) as s(kind, name_ar, name_en, lat, lng, source)
 -- وكذا ههنا: `where not exists` أوّلاً (الشرحُ أعلاه).
 where not exists (
     select 1 from destination_landmarks l
      where l.city_id = c.id and l.name_en = s.name_en
   )
   and c.code = 'JED';

-- ----------------------------------------------------------------------------
-- `resolve_destination` — الدبّوسُ يصيرُ وجهةً مُصادَقةً، أو رفضاً مُسمّىً
--
-- تُعيدُ `jsonb`: الرفضُ **جوابٌ يُقرأُ** لا استثناءٌ يُلتَقَطُ، كما في
-- `upsert_saved_place`. ومَن يرفعُ استثناءً لرفضِ عملٍ يجعلُ المحوّلَ يُصنِّفُه
-- «عطبَ مخزنٍ» فتقولُ الشاشةُ «حاوِلْ لاحقاً» لوجهةٍ لن تُقبَلَ أبداً.
--
-- وترتيبُ الأحكامِ مقصودٌ: مستخدمٌ، ثمَّ مدينةٌ مُفعَّلةٌ، ثمَّ حدٌّ مُعرَّفٌ، ثمَّ
-- الاحتواءُ. فكلُّ رفضٍ يقولُ سببَه الحقيقيَّ: «مدينتُك غيرُ مخدومةٍ» ليسَ
-- «وجهتُك خارجَ النطاقِ»، والخلطُ يُرسِلُ المستخدمَ يُحرِّكُ دبّوساً بلا جدوى.
-- ----------------------------------------------------------------------------
drop function if exists resolve_destination(bigint, double precision, double precision);

create or replace function resolve_destination(
  p_telegram_id bigint,
  p_lat double precision,
  p_lng double precision
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    users;
  v_city    cities;
  v_area    city_service_areas;
  v_point   geography(Point, 4326);
  v_near    record;
  v_found   boolean := false;
begin
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_POINT');
  end if;

  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_city from cities where id = v_user.city_id;
  if not found then
    -- مفتاحٌ أجنبيٌّ يمنعُ هذا؛ والفحصُ ههنا كي لا يُقرأَ `null` صامتاً لو تغيّرَ
    -- المخطَّطُ يوماً. عطبُ بيانةٍ يُعلَنُ ولا يُترجَمُ «خارجَ النطاقِ».
    return jsonb_build_object('ok', false, 'error', 'CITY_UNKNOWN');
  end if;

  if not v_city.is_active then
    return jsonb_build_object(
      'ok', false, 'error', 'CITY_NOT_SERVED',
      'city_code', v_city.code, 'city_name_ar', v_city.name_ar, 'city_name_en', v_city.name_en
    );
  end if;

  select * into v_area
    from city_service_areas
   where city_id = v_city.id and is_active
   order by created_at desc
   limit 1;
  if not found then
    -- مدينةٌ مُفعَّلةٌ بلا حدٍّ: عطبُ تهيئةٍ **يُعلَنُ**. والبديلُ الشائعُ («اقبلْ
    -- كلَّ نقطةٍ حتّى يُعرَّفَ الحدُّ») يجعلُ غيابَ البيانةِ يُوسِّعُ الخدمةَ صامتاً.
    return jsonb_build_object(
      'ok', false, 'error', 'SERVICE_AREA_NOT_DEFINED',
      'city_code', v_city.code, 'city_name_ar', v_city.name_ar, 'city_name_en', v_city.name_en
    );
  end if;

  v_point := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;

  if not st_covers(v_area.area, v_point) then
    return jsonb_build_object(
      'ok', false, 'error', 'OUTSIDE_SERVICE_AREA',
      'city_code', v_city.code, 'city_name_ar', v_city.name_ar, 'city_name_en', v_city.name_en,
      'area_version', v_area.area_version
    );
  end if;

  -- أقربُ معلَمٍ **وصفٌ** للنقطةِ لا بديلٌ عنها: النقطةُ المُعادةُ هيَ نقطةُ
  -- المستخدمِ بعينِها. والمسافةُ تُعادُ كي تعرفَ الشاشةُ أنَّ «قربَ كورنيشِ جدةَ»
  -- على بُعدِ ثلاثِ آلافِ مترٍ وصفٌ ضعيفٌ فتقولَه بحدرٍ أو تسكتَ عنه.
  select l.name_ar, l.name_en, l.kind,
         st_distance(l.point, v_point) as distance_m
    into v_near
    from destination_landmarks l
   where l.city_id = v_city.id and l.is_active
   order by l.point <-> v_point
   limit 1;
  v_found := found;

  return jsonb_build_object(
    'ok', true,
    'lat', p_lat,
    'lng', p_lng,
    'city_code', v_city.code,
    'city_name_ar', v_city.name_ar,
    'city_name_en', v_city.name_en,
    'area_version', v_area.area_version,
    'nearest', case
      when not v_found then null
      else jsonb_build_object(
        'name_ar', v_near.name_ar,
        'name_en', v_near.name_en,
        'kind', v_near.kind,
        -- الاسمُ يقولُ إنَّها مسافةُ خطٍّ مستقيمٍ: مسافةُ الطريقِ `F2-04`.
        'straight_distance_m', round(v_near.distance_m::numeric, 1)
      )
    end
  );
end;
$$;

revoke execute on function resolve_destination(bigint, double precision, double precision)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- `search_destinations` — ثلاثةُ مصادرَ في قائمةٍ واحدةٍ مرتَّبةٍ في القاعدةِ
--
-- الرتبةُ رقمٌ يُعادُ لا حكمٌ مضمرٌ: `0` مطابقةُ بدايةِ **كلمةٍ** (`word_start_match`)
-- و`1` مطابقةُ احتواءٍ داخلَ كلمةٍ.
-- والترتيبُ: الرتبةُ، ثمَّ أولويّةُ المصدرِ (محفوظٌ ثمَّ أخيرٌ ثمَّ دليلٌ)، ثمَّ
-- الاسمُ. ولماذا المحفوظُ أوّلاً: هوَ ما كتبَه المستخدمُ بنفسِه، ومعلَمٌ عامٌّ
-- يُزاحِمُ «المنزل» على كلمةِ «من» تجربةٌ سيّئةٌ يعرفُها كلُّ مَن جرّبَها.
--
-- والمطابقةُ على النصِّ المُطبَّعِ في الطرفَينِ: العمودُ مُولَّدٌ، والمدخلُ يُطبَّعُ
-- بالدالّةِ نفسِها. ومطابقةُ البدايةِ `like 'x%'` تستفيدُ من الفهرسِ
-- (`text_pattern_ops`)، ومطابقةُ الاحتواءِ لا تستفيدُ — وذاكَ **مقيسٌ ومحدودٌ**:
-- نطاقُها صفوفُ مدينةٍ واحدةٍ مُفعَّلةٍ (عشرةٌ اليومَ)، وفهرسُ ثلاثيّاتٍ
-- (`pg_trgm`) دَينٌ مُعلَنٌ في ADR 0102 §7 لا امتدادٌ يُنصَّبُ قبلَ الحاجةِ.
-- ----------------------------------------------------------------------------
drop function if exists search_destinations(bigint, text, integer);

create or replace function search_destinations(
  p_telegram_id bigint,
  p_query text,
  p_limit integer
) returns table (
  source     text,
  ref_id     uuid,
  kind       text,
  label_ar   text,
  label_en   text,
  lat        double precision,
  lng        double precision,
  match_rank integer
)
language sql
security definer
set search_path = public
as $$
  with asked as (
    select normalize_search_text(p_query) as q
  ),
  me as (
    select u.id as user_id, u.city_id
      from users u
     where u.telegram_id = p_telegram_id
  ),
  -- ١) أماكنُ المستخدمِ المحفوظةُ: لافتةٌ كتبَها هوَ، فتُعادُ في الحقلَينِ معاً
  --    (لا تُترجَمُ لافتةُ مستخدمٍ — وهوَ عينُ حكمِ `F2-02`).
  saved as (
    select 'saved'::text as source, p.id as ref_id, p.kind,
           p.label as label_ar, p.label as label_en,
           st_y(p.point::geometry) as lat, st_x(p.point::geometry) as lng,
           case when word_start_match(normalize_search_text(p.label), asked.q)
                then 0 else 1 end as match_rank
      from saved_places p
      join me on me.user_id = p.user_id
      cross join asked
     where asked.q <> ''
       and normalize_search_text(p.label) like '%' || asked.q || '%'
  ),
  -- ٢) الوجهاتُ الأخيرةُ: قراءةٌ من `orders` بنفسِ شروطِ `list_recent_destinations`
  --    (نقطةٌ ولافتةٌ، والمُكرَّرُ يُطوى بأحدثِه). ولا جدولَ ثانياً لها (القاعدة 0.6).
  recent as (
    select 'recent'::text as source, null::uuid as ref_id, null::text as kind,
           d.label as label_ar, d.label as label_en, d.lat, d.lng,
           case when word_start_match(normalize_search_text(d.label), asked.q)
                then 0 else 1 end as match_rank
      from (
        select distinct on (normalize_search_text(o.dropoff_label))
               trim(o.dropoff_label)     as label,
               st_y(o.dropoff::geometry) as lat,
               st_x(o.dropoff::geometry) as lng,
               o.created_at
          from orders o
          join riders r on r.id = o.rider_id
          join me     on me.user_id = r.user_id
         where o.dropoff is not null
           and coalesce(trim(o.dropoff_label), '') <> ''
         order by normalize_search_text(o.dropoff_label), o.created_at desc
      ) d
      cross join asked
     where asked.q <> ''
       and normalize_search_text(d.label) like '%' || asked.q || '%'
  ),
  -- ٣) دليلُ المعالمِ: مدينةُ المستخدمِ وحدَها. ودليلُ مدينةٍ أخرى ليسَ نتيجةً
  --    مفيدةً بل وجهةٌ لا سائقَ لها، ورفضُها بعدَ اختيارِها أسوأُ من إخفائِها.
  landmarks as (
    select 'landmark'::text as source, l.id as ref_id, l.kind,
           l.name_ar as label_ar, l.name_en as label_en,
           st_y(l.point::geometry) as lat, st_x(l.point::geometry) as lng,
           case when word_start_match(l.search_key, asked.q) then 0 else 1 end as match_rank
      from destination_landmarks l
      join me on me.city_id = l.city_id
      cross join asked
     where l.is_active
       and asked.q <> ''
       and l.search_key like '%' || asked.q || '%'
  ),
  merged as (
    select * from saved
    union all select * from recent
    union all select * from landmarks
  )
  select source, ref_id, kind, label_ar, label_en, lat, lng, match_rank
    from merged
   order by match_rank,
            case source when 'saved' then 0 when 'recent' then 1 else 2 end,
            label_ar
   limit least(greatest(coalesce(p_limit, 10), 1), 25);
$$;

revoke execute on function search_destinations(bigint, text, integer)
  from public, anon, authenticated;
