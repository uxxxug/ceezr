-- migration-phase: expand
-- CAP-012: Route cache thresholds in platform_settings
-- Seeds min_change_meters and ttl_seconds for route caching
-- These thresholds prevent calling OSRM on every GPS ping

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, s.key, s.value, s.value_type, s.description_ar, s.is_provisional
from cities c
cross join (values
  ('route_cache_min_change_meters', '50'::jsonb, 'number', 'أقل مسافة (بالمتر) يعتبر تغيرها ذا معنى لإعادة حساب المسار', true),
  ('route_cache_ttl_seconds', '60'::jsonb, 'number', 'أقصى مدة (بالثواني) تعتبر فيها نتيجة المسار المخزنة صالحة', true)
) as s(key, value, value_type, description_ar, is_provisional)
on conflict (city_id, key) do nothing;
