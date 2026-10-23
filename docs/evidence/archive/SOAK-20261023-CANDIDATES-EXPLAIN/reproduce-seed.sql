-- إعادة إنتاج تجربة EXPLAIN — منصة PostgreSQL 18.4 محلية عليها كل هجرات المستودع
-- (290) + postgis. البذر يحاكي شكل نهاية الموجة: آلاف السائقين في المدينة
-- والمتاح منهم عشرات فقط (المولد يستقدم سائقًا جديدًا لكل رحلة ويبقى غير متاح).

-- بذر السائقين (يُنفَّذ على دفعات 500 ثم 2000 ثم 4700)
create or replace function add_wave_drivers(n int, n_available int, start_tg bigint)
returns void as $$
begin
  insert into users (id, role, telegram_id, city_id, is_blocked)
  select gen_random_uuid(), 'driver', start_tg + g,
         (select id from cities where code='JED'), false
  from generate_series(1, n) g;

  insert into drivers (id, user_id, city_id, verification_status,
                       last_location, last_location_at, last_location_quality,
                       rating_average, rating_count)
  select u.id, u.id, u.city_id, 'verified',
         st_setsrid(st_makepoint(39.05 + random()*0.35, 21.25 + random()*0.6), 4326)::geography,
         now() - interval '30 seconds', 'ACCEPT', 4.5, 10
  from users u
  where u.telegram_id >= start_tg and u.telegram_id < start_tg + n;

  insert into driver_availability (city_id, driver_id, is_available)
  select (select id from cities where code='JED'), u.id,
         (row_number() over (order by u.telegram_id)) <= n_available
  from users u
  where u.telegram_id >= start_tg and u.telegram_id < start_tg + n;

  insert into subscriptions (city_id, driver_id, plan, status)
  select (select id from cities where code='JED'), u.id, 'transport', 'trialing'
  from users u
  where u.telegram_id >= start_tg and u.telegram_id < start_tg + n;

  insert into driver_capabilities (city_id, driver_id, service, is_enabled)
  select u.city_id, u.id, 'transport', true
  from users u
  where u.telegram_id >= start_tg and u.telegram_id < start_tg + n;
end;
$$ language plpgsql;

-- المُصلِح: الفهرس الجزئي (هجرة 20261023210000)
-- create index concurrently if not exists driver_availability_available_city_driver_idx
--   on driver_availability (city_id, driver_id) where (is_available);

-- مسبار الاستعلام (شكل استعلام ترشيح السائقين: مرشحات صلبة + KNN + حد 50)
--   select d.id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng
--   from drivers d
--   join users u on u.id = d.user_id
--   left join driver_availability a on a.driver_id = d.id
--   where d.city_id = (select id from cities where code='JED')
--     and u.is_blocked = false
--     and d.verification_status = 'verified'
--     and a.is_available = true
--     and d.last_location is not null
--     and d.last_location_quality is distinct from 'ALERT'
--     and st_dwithin(d.last_location,
--                    st_setsrid(st_makepoint(39.19, 21.55), 4326)::geography, 10000)
--   order by d.last_location <-> st_setsrid(st_makepoint(39.19, 21.55), 4326)::geography
--   limit 50;
