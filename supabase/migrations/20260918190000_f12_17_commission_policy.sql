-- =============================================================================
-- F12-17 — سياسة العمولة المكتوبة والمرئية
-- -----------------------------------------------------------------------------
-- النموذج التجاري v1: اشتراك فقط، لا أجرة راكب. العمولة = 0%.
-- هذا إعدادٌ موثَّقٌ في platform_settings لكل مدينة (القاعدة 0.3 + 0.4)،
-- يُقرأ من القاعدة لا من الكود، ويُعرض للسائق في التطبيق.
-- لا يُدَّعى أنَّ السعرَ النهائيَّ محسومٌ أو أنَّ محرّكَ التسعيرِ مبنيٌّ —
-- DEC-11/F12-16 يحجبُ ذلك. ما يُدَّعى: سياسةٌ مكتوبةٌ ومرئيةٌ معدومةُ العمولة.
-- =============================================================================

-- زرعُ مفتاحَي العمولة لكل المدن إن لم يوجدا
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, s.key, s.value, s.value_type, s.description_ar, s.is_provisional
from cities c
cross join (values
  ('commission_rate', '0'::jsonb, 'number', 'نسبة عمولة المنصة من كل رحلة (0 = لا عمولة في نموذج الاشتراك فقط)', false),
  ('commission_collection_mechanism', '"none"'::jsonb, 'string', 'آلية تحصيل العمولة (none = لا تُحصَّل عمولة في نموذج الاشتراك فقط)', false)
) as s(key, value, value_type, description_ar, is_provisional)
on conflict (city_id, key) do nothing;
