-- migration-phase: expand
-- UI-SEARCH-01: «حي الروضة» لا يجدُ «الروضة». الأحياءُ في الدليلِ مُسمّاةٌ بلا «حي»
-- (كما في OpenStreetMap)، والراكبُ يكتبُها بها. فتُنزَعُ من **سؤالِ** البحثِ وحدَه
-- كلمةُ نوعٍ عامّةٌ في أوّلِه (حي · شارع · طريق) متى بقيَ بعدَها شيءٌ. والمطابقةُ
-- احتواءٌ (`like '%q%'`) فاسمٌ مخزَّنٌ يبدأُ بها («طريق الملك») يبقى موجوداً. ولا يُمَسُّ المخزونُ ولا مفتاحُ البحثِ.
-- الدالّةُ نفسُها حرفاً عدا تعريفِ `asked`؛ و`create or replace` يحفظُ الصلاحيّاتِ.
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
    select case
             when normalize_search_text(p_query) ~ '^(حي|شارع|طريق) .+'
               then regexp_replace(normalize_search_text(p_query), '^(حي|شارع|طريق) ', '')
             else normalize_search_text(p_query)
           end as q
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
