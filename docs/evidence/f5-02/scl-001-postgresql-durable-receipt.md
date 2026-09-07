# دليل SCL-001 — منع التكرار الموزَّع في PostgreSQL

**البند:** SCL-001  
**المرحلة:** F5-02  
**التاريخ:** 2026-09-08  
**الدرجة:** مُختبَر  

## المشكلة

كان منع تكرار تحديثات تيليجرام خريطةً في ذاكرة العملية. إعادةُ الإقلاع تمحو القرار، والتحديثُ المُعالَج يُعالَج ثانيةً. والأسوأ: طلبٌ مرفوضٌ بـ429 كان قد استهلك `update_id` في الوسم، فإعادةُ تيليجرام تُبتلَع بوصفها «مكرَّراً» — فقدٌ دائمٌ للأصل.

## الحل

سجلُّ استلامٍ صامدٌ في PostgreSQL: `telegram_update_receipts`. المفتاح الأساسيّ `(bot, update_id)` يمنع التكرار ذرّيّاً بـ`ON CONFLICT DO NOTHING`. الحجزُ بـ`claim_telegram_update` ذرّيّةٌ: إيداعٌ وحجزٌ في نداءٍ واحد. الختمُ بـ`finish_telegram_update` لصاحبِ الرمزِ وحدَه.

## العمر المحدود

دالّةُ `cleanup_telegram_update_receipts` تحذف:
- المختوم (`status = 'done'`) الأقدم من ٧ أيّام
- المهجور (`pending`/`failed`) الأقدم من ٢٤ ساعة

## القرار الحوكمي

[ADR 0058](../../adr/0058-scl-001-postgresql-durable-receipt.md) ينسخ شرط Redis صراحةً ويعتمد PostgreSQL durable receipt بوصفه حلّ SCL-001.

## الأدلّة

| الأصل | المسار |
|-------|-------|
| المهاجرة الأصليّة | `supabase/migrations/20260904090000_telegram_update_receipts.sql` |
| مهاجرة التنظيف | `supabase/migrations/20260908020000_telegram_update_receipts_retention.sql` |
| ADR 0058 | `docs/adr/0058-scl-001-postgresql-durable-receipt.md` |
| اختبار التكامل | `tests/integration/scl-001-dedup-retention.test.ts` |

## النتائج

- `claim_telegram_update` ذرّيّة: مطالبتان متزامنتان، فائزةٌ واحدة (claimed)، الأخرى ترى العمل جارٍ (in_progress)
- `finish_telegram_update` يختم بصاحب الرمز وحدَه؛ رمزٌ آخر يحصل على `NOT_CLAIMED_BY_CALLER`
- `cleanup_telegram_update_receipts` يحذف المختوم القديم والمهجور القديم، ويُبقي الحديث
- 2184 اختبار pass / 0 fail
