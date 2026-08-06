-- =============================================================================
-- وَصْلة — المرحلة 2.1 — بذر المدن الأربع و platform_settings
-- المدن تُنشأ is_active = false لأن معرّفات قروبات تيليجرام لم تُسلَّم بعد.
-- قيد cities_active_requires_groups يمنع تفعيل أي مدينة قبل ربط قروباتها الثلاثة.
-- =============================================================================

insert into cities (code, name_ar, name_en, is_active)
values
  ('JED', 'جدة',    'Jeddah', false),
  ('MKK', 'مكة',    'Makkah', false),
  ('RUH', 'الرياض', 'Riyadh', false),
  ('TIF', 'الطائف', 'Taif',   false)
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- الإعدادات: نفس المجموعة لكل مدينة (البند 0.4 يفرض city_id هنا أيضاً)
--   is_provisional = false -> قيمة محسومة في الأمر الحاكم
--   is_provisional = true  -> قيمة مبدئية بإذن المالك، تنتظر مراجعته
-- ----------------------------------------------------------------------------
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, s.key, s.value, s.value_type, s.description_ar, s.is_provisional
from cities c
cross join (values
  ('subscription_price_transport', '250'::jsonb,    'number', 'سعر اشتراك مشاوير فقط شهرياً',                    false),
  ('subscription_price_delivery',  '250'::jsonb,    'number', 'سعر اشتراك توصيل فقط شهرياً',                     false),
  ('subscription_price_both',      '400'::jsonb,    'number', 'سعر اشتراك الخدمتين معاً شهرياً',                  false),
  ('currency',                     '"SAR"'::jsonb,  'string', 'عملة التسعير',                                    false),
  ('trial_days',                   '30'::jsonb,     'number', 'مدة الشهر المجاني بالأيام',                       false),
  ('search_radius_km',             '10'::jsonb,     'number', 'نصف قطر البحث عن سائق بالكيلومتر',                true),
  ('offer_timeout_seconds',        '45'::jsonb,     'number', 'مهلة قبول العرض قبل الانتقال للدورة التالية',      false),
  ('broadcast_batch_size',         '5'::jsonb,      'number', 'عدد السائقين في كل دورة بثّ',                     false),
  ('max_broadcast_rounds',         '3'::jsonb,      'number', 'عدد دورات البثّ قبل الذهاب لقروب الإسناد',        true),
  ('match_weight_proximity',       '0.7'::jsonb,    'number', 'وزن القرب في معادلة نقاط المطابقة',               true),
  ('match_weight_rating',          '0.3'::jsonb,    'number', 'وزن التقييم في معادلة نقاط المطابقة',             true),
  ('default_rating_for_new_driver','4.5'::jsonb,    'number', 'تقييم السائق الجديد قبل أول تقييم حقيقي',         true),
  ('supported_languages',          '["ar"]'::jsonb, 'array',  'اللغات المدعومة — تتوسّع في المرحلة 2.6',         false)
) as s(key, value, value_type, description_ar, is_provisional)
on conflict (city_id, key) do nothing;
