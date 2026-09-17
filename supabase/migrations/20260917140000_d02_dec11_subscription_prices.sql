-- migration-phase: backfill
-- D-02 / DEC-11 — تعديلُ أسعارِ الاشتراكِ بقرارِ المالكِ
-- 2026-09-17
-- المرجع: docs/decisions/DEC-11-20260917-owner-fare-policy.md
--
-- تعديلٌ تشغيليٌّ على `platform_settings`:
--   subscription_price_transport:  250 -> 150
--   subscription_price_delivery:  250 -> 150
--   subscription_price_both:      400 -> 300
--
-- لا بنيةَ تُكسَر: القيمُ تُقرَأُ ديناميكيًّا من `platform_settings` في كلِّ موضعٍ
-- (f3_06_driver_subscription_dashboard · admin_update_setting) — لا قيمَ صلبةَ في الكودِ.
--
-- السجلُّ التاريخيُّ يُحفَظُ: القيمُ القديمةُ كانت مُسجَّلةً في هجرةِ البذورِ (20260806120200)
-- بـ`250`/`250`/`400`، وهذا التعديلُ يُحدِّثُ القيمَ المُعاشةَ (live) في القاعدةِ بلا أثرٍ على
-- المعاملاتِ القائمةِ (price_amount في payment_transactions لقطةٌ تاريخيةٌ وقتَ التفعيل).

update platform_settings
   set value = '150'::jsonb
 where key = 'subscription_price_transport';

update platform_settings
   set value = '150'::jsonb
 where key = 'subscription_price_delivery';

update platform_settings
   set value = '300'::jsonb
 where key = 'subscription_price_both';
