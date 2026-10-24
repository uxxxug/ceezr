CREATE OR REPLACE FUNCTION public.add_wave_drivers(n integer, n_available integer, start_tg bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
  where u.telegram_id between start_tg + 1 and start_tg + n;

  insert into driver_availability (city_id, driver_id, is_available)
  select (select id from cities where code='JED'), u.id,
         (row_number() over (order by u.telegram_id)) <= n_available
  from users u
  where u.telegram_id between start_tg + 1 and start_tg + n;

  insert into subscriptions (city_id, driver_id, plan, status)
  select (select id from cities where code='JED'), u.id, 'transport', 'trialing'
  from users u
  where u.telegram_id between start_tg + 1 and start_tg + n;

  insert into driver_capabilities (city_id, driver_id, service, is_enabled)
  select u.city_id, u.id, 'transport', true
  from users u
  where u.telegram_id between start_tg + 1 and start_tg + n;
end;
$function$

