-- migration-phase: expand
-- CAP-012: Route cache thresholds in platform_settings
-- Seeds min_change_meters and ttl_seconds for route caching
-- These thresholds prevent calling OSRM on every GPS ping

INSERT INTO platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
VALUES
  ('jed', 'route_cache_min_change_meters', '50', 'integer', 'أقل مسافة (بالمتر) يعتبر تغيرها ذا معنى لإعادة حساب المسار', true),
  ('jed', 'route_cache_ttl_seconds', '60', 'integer', 'أقصى مدة (بالثواني) تعتبر فيها نتيجة المسار المخزنة صالحة', true),
  ('makkah', 'route_cache_min_change_meters', '50', 'integer', 'أقل مسافة (بالمتر) يعتبر تغيرها ذا معنى لإعادة حساب المسار', true),
  ('makkah', 'route_cache_ttl_seconds', '60', 'integer', 'أقصى مدة (بالثواني) تعتبر فيها نتيجة المسار المخزنة صالحة', true)
ON CONFLICT (city_id, key) DO NOTHING;
