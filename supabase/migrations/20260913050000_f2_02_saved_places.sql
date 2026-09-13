-- migration-phase: expand
-- =============================================================================
-- الغرض: الأماكنُ المحفوظةُ (المنزل/العمل/غيرُهما) وقراءةُ آخرِ الوجهاتِ —
--    البند `F2-02` (SR-02) والقسم 9.5 والعقودُ `GET/POST /v1/me/places`
--    و`GET /v1/me/recent-destinations` في القسم 9.8.
-- الحالة: منفّذ فعلياً — 2026-09-13 · البند `F2-02`.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `packages/infrastructure/places/places-store.ts` عبرَ الدوالِّ
--    الثلاثِ أدناه وحدَها، و`apps/gateway/src/routes/me-places.ts`.
-- ملاحظات مستقبلية: `SR-12` («أماكني») يُضيفُ حذفَ مكانٍ وإعادةَ تسميتِه، وموضعُ
--    ذاكَ هجرةٌ لاحقةٌ بدالّةٍ رابعةٍ لا تعديلُ هذه؛ و`F2-03` يكتبُ المكانَ من
--    الخريطةِ فيقرأُ `point` لا `label` وحدَه.
--
-- ## لماذا جدولٌ للأماكنِ ولا جدولَ للوجهاتِ الأخيرةِ
--
-- «آخرُ ثلاثِ وجهاتٍ» في SR-02 ليسَ بياناً جديداً: هوَ **قراءةٌ** من `orders`
-- التي فيها `dropoff` و`dropoff_label` منذُ المخطَّطِ الأساسيِّ. وجدولٌ ثانٍ
-- يُكرِّرُها يصيرُ مصدراً ثانياً للحقيقةِ يتباعدُ صامتاً عن الأوّلِ عندَ أيِّ
-- إلغاءٍ أو تصحيحٍ، ويحتاجُ مُزامِناً لا يملكُه أحدٌ. فالوجهاتُ دالّةُ قراءةٍ،
-- والأماكنُ المحفوظةُ جدولٌ لأنَّها **قرارُ مستخدمٍ** لا أثرُ معاملةٍ.
--
-- ## ولماذا `unique` جزئيٌّ على المنزلِ والعملِ وحدَهما
--
-- SR-02 يعرضُ «المنزل/العمل» بوصفِهما موضعَينِ مُعرَّفَينِ لا قائمةً، فمنزلانِ
-- لمستخدمٍ واحدٍ حالةٌ لا معنىً لها في الشاشةِ ولا جوابَ صادقاً لها. أمّا
-- `other` فقائمةٌ مفتوحةٌ (SR-12)، فلو شملَه الفريدُ لَمَنَعَ المكانَ الثانيَ.
-- ولذا فريدٌ **جزئيٌّ** بشرطٍ، لا فريدٌ على `(user_id, kind)` كلِّه.
--
-- ## والكتابةُ `insert … on conflict … do update` لا `delete` ثمَّ `insert`
--
-- تغييرُ المنزلِ تحديثُ موضعٍ لا إنشاءُ سجلٍّ ثانٍ: لا قيمةَ قانونيّةَ لتاريخِ
-- «منازلَ سابقةٍ» (بخلافِ الموافقاتِ في `F2-01`)، والحذفُ ثمَّ الإنشاءُ يجعلُ
-- المُعرَّفَ يتغيَّرُ فتُكسَرُ أيُّ إشارةٍ إليه. والذرّيّةُ من العبارةِ الواحدةِ
-- لا من معاملةٍ يُديرُها التطبيقُ (القاعدة 0.5).
--
-- ## والمدينةُ من صفِّ المستخدمِ
--
-- القاعدةُ 0.4 تُوجِبُ `city_id` على كلِّ جدولٍ، ومصدرُه `users.city_id` **يُقرأُ
-- داخلَ الدالّةِ** لا يُمرَّرُ وسيطاً — كما في `F2-01` وللسببِ نفسِه: وسيطٌ
-- يسمحُ بكتابةِ مكانٍ في مدينةٍ ليست مدينةَ صاحبِه، وذاكَ تلويثُ بيانٍ.
-- =============================================================================

create table if not exists saved_places (
  id         uuid primary key default gen_random_uuid(),
  city_id    uuid not null references cities(id),
  user_id    uuid not null references users(id) on delete cascade,
  -- الصنفُ نصٌّ بقيدٍ ومصدرُه سجلُّ النطاقِ `packages/domain/places/place-kinds.ts`
  -- (القاعدة 0.6)، ويُقابِلُه الحاجزُ `scripts/check-place-kinds.ts` حرفاً بحرفٍ.
  kind       text not null check (kind in ('home', 'work', 'other')),
  -- التسميةُ نصُّ **مستخدمٍ** لا مفتاحُ نصٍّ: هيَ ما كتبَه هوَ، فلا تُترجَمُ.
  -- وحدُّها ههنا حدُّ تخزينٍ لا حدُّ منتَجٍ، ومَن يقصُّها عندَ العرضِ فالشاشةُ.
  label      text not null check (length(trim(label)) between 1 and 120),
  point      geography(Point, 4326) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- والفهارسُ الأربعةُ **في هجرةٍ ثانيةٍ** بطورِ `index` (`20260913050100`): فهرسٌ
-- بلا `concurrently` يأخذُ قفلاً يمنعُ الكتابةَ (`CAP-007`)، و`concurrently` لا
-- يجوزُ داخلَ معاملةٍ يملكُها المُطبِّقُ. ومنها الفريدُ الجزئيُّ الذي تستندُ إليه
-- `on conflict` أدناه — فترتيبُ الطابعَينِ شرطُ صحّةٍ لا ذوقُ تنظيمٍ.

drop trigger if exists saved_places_set_updated_at on saved_places;
create trigger saved_places_set_updated_at before update on saved_places
  for each row execute function set_updated_at();

alter table saved_places enable row level security;

-- لا سياسةَ لـ`anon` ولا لـ`authenticated`: لا يلمسُ الجدولَ إلّا دورُ الخدمةِ
-- عبرَ الدوالِّ أدناه، والتطبيقُ المصغَّرُ يمرُّ بالبوّابةِ بجلسةٍ موقَّعةٍ (9.8).
drop policy if exists saved_places_service_all on saved_places;
create policy saved_places_service_all on saved_places
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- `upsert_saved_place` — كتابةٌ ذرّيّةٌ، والحالةُ في الجوابِ لا في عددِ الصفوفِ
--
-- تُعيدُ `jsonb`: «أُنشِئَ» أم «حُدِّثَ» جزءٌ من الجوابِ يُقرأُ، لا يُستنتَجُ.
-- و`other` لا يدخلُ الفريدَ الجزئيَّ فيُنشَأُ صفّاً جديداً في كلِّ نداءٍ —
-- **وهذا مقصودٌ ومُعلَنٌ**: قائمةٌ مفتوحةٌ، وإدارتُها (`SR-12`) بندٌ آخرُ.
-- ----------------------------------------------------------------------------
drop function if exists upsert_saved_place(bigint, text, text, double precision, double precision);

create or replace function upsert_saved_place(
  p_telegram_id bigint,
  p_kind text,
  p_label text,
  p_lat double precision,
  p_lng double precision
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  users;
  v_point geography(Point, 4326);
  v_row   saved_places;
  v_new   boolean;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    -- لا يُنشَأُ صفُّ مستخدمٍ ههنا (ADR 0035): غيابُه حالةٌ تُعادُ لا تُصنَعُ.
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  v_point := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;

  if p_kind in ('home', 'work') then
    insert into saved_places (city_id, user_id, kind, label, point)
    values (v_user.city_id, v_user.id, p_kind, p_label, v_point)
    on conflict (user_id, kind) where kind in ('home', 'work')
    do update set label = excluded.label, point = excluded.point
    returning * into v_row;
    -- «أُنشِئَ الآنَ» يُعرَفُ بتساوي الختمَينِ لا بـ`found`: `do update` يُعيدُ
    -- صفّاً في الحالتَينِ، والزنادُ يُحرِّكُ `updated_at` عندَ التحديثِ وحدَه.
    v_new := v_row.created_at = v_row.updated_at;
  else
    insert into saved_places (city_id, user_id, kind, label, point)
    values (v_user.city_id, v_user.id, p_kind, p_label, v_point)
    returning * into v_row;
    v_new := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', case when v_new then 'created' else 'updated' end,
    'place_id', v_row.id,
    'city_id', v_row.city_id,
    'kind', v_row.kind,
    'label', v_row.label,
    'lat', st_y(v_row.point::geometry),
    'lng', st_x(v_row.point::geometry),
    -- الختمُ يُعادُ من الصفِّ لا يُختَرَعُ في المحوّلِ بساعةِ الخادمِ: ساعةُ
    -- التطبيقِ وساعةُ القاعدةِ تختلفانِ، وردٌّ يقولُ «حُدِّثَ في لحظةٍ» غيرِ
    -- اللحظةِ المكتوبةِ يجعلُ ترتيبَ العميلِ يخالفُ ترتيبَ القراءةِ التاليةِ.
    'updated_at', v_row.updated_at
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- `list_saved_places` — قراءةُ أماكنِ صاحبِ المعرّفِ وحدَه
--
-- الترتيبُ مُعلَنٌ في القاعدةِ لا مُتروكٌ للعميلِ: المنزلُ ثمَّ العملُ ثمَّ
-- الباقي بالأحدثِ. وشاشةُ SR-02 تعرضُ «المنزل/العمل» موضعَينِ ثابتَينِ، فترتيبٌ
-- غيرُ مضمونٍ يجعلُها تقلِبُهما بينَ نداءَينِ بلا سببٍ يراه المستخدمُ.
-- ----------------------------------------------------------------------------
drop function if exists list_saved_places(bigint);

create or replace function list_saved_places(p_telegram_id bigint)
returns table (
  place_id uuid,
  kind text,
  label text,
  lat double precision,
  lng double precision,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select p.id,
         p.kind,
         p.label,
         st_y(p.point::geometry),
         st_x(p.point::geometry),
         p.updated_at
    from saved_places p
    join users u on u.id = p.user_id
   where u.telegram_id = p_telegram_id
   order by case p.kind when 'home' then 0 when 'work' then 1 else 2 end,
            p.updated_at desc;
$$;

-- ----------------------------------------------------------------------------
-- `list_recent_destinations` — قراءةٌ من `orders` لا جدولٌ ثانٍ
--
-- **الشروطُ مُعلَنةٌ لا مُخفاةٌ**: وجهةٌ ذاتُ نقطةٍ وتسميةٍ (فلا سطرَ بلا ما
-- يُعرَضُ)، ولطلبٍ لصاحبِ المعرّفِ نفسِه، وبالتسميةِ المُهيَّأةِ تُطوى المُكرَّراتُ
-- فيُبقى أحدثُها. والإلغاءُ **لا يُستثنى**: مَن ألغى رحلةً إلى وجهةٍ ما فوجهتُه
-- هيَ هيَ، وحجبُها يُخفي أكثرَ ما يُتوقَّعُ في الشاشةِ. أمّا `p_limit` فوسيطٌ
-- بحدٍّ أقصى ههنا: «ثلاثٌ» قيمةُ منتَجٍ تُقرَّرُ في النطاقِ لا في القاعدةِ
-- (القاعدة 0.3)، والحدُّ الأقصى حراسةُ مصدرٍ.
-- ----------------------------------------------------------------------------
drop function if exists list_recent_destinations(bigint, integer);

create or replace function list_recent_destinations(p_telegram_id bigint, p_limit integer)
returns table (label text, lat double precision, lng double precision, last_used_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select d.label, d.lat, d.lng, d.last_used_at
    from (
      select distinct on (lower(trim(o.dropoff_label)))
             trim(o.dropoff_label)            as label,
             st_y(o.dropoff::geometry)        as lat,
             st_x(o.dropoff::geometry)        as lng,
             o.created_at                     as last_used_at
        from orders o
        join riders r on r.id = o.rider_id
        join users  u on u.id = r.user_id
       where u.telegram_id = p_telegram_id
         and o.dropoff is not null
         and coalesce(trim(o.dropoff_label), '') <> ''
       order by lower(trim(o.dropoff_label)), o.created_at desc
    ) d
   order by d.last_used_at desc
   limit least(greatest(coalesce(p_limit, 3), 1), 20);
$$;

-- ----------------------------------------------------------------------------
-- سطحُ الصلاحياتِ: الدوالُّ الثلاثُ `security definer`، و`execute` مُمنوحٌ
-- لـ`public` عندَ الإنشاءِ افتراضاً في PostgreSQL — فلو بقيَ لصارَت كلُّ واحدةٍ
-- ثقباً يتجاوزُ RLS ويكتبُ أو يقرأُ باسمِ أيِّ معرّفٍ. فيُسحَبُ صريحاً كما في
-- كلِّ دالّةٍ في هذا المستودَعِ، ولا يُمنَحُ لـ`service_role` بالإضافةِ لأنَّه
-- مالكُ المخطَّطِ ويصلُ إليها بملكيّتِه لا بمِنحةٍ.
-- ----------------------------------------------------------------------------
revoke execute on function upsert_saved_place(bigint, text, text, double precision, double precision) from public, anon, authenticated;

revoke execute on function list_saved_places(bigint) from public, anon, authenticated;

revoke execute on function list_recent_destinations(bigint, integer) from public, anon, authenticated;
