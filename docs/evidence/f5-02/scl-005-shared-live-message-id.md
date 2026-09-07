# دليل SCL-005 — خريطة tripId→messageId مشتركة في القاعدة

**البند:** SCL-005  
**المرحلة:** F5-02  
**التاريخ:** 2026-09-08  
**الدرجة:** مُختبَر  

## المشكلة

كان معرّف رسالة بثّ الموقع الحيّ (messageId) محفوظاً في خريطةٍ في ذاكرة العملية. نسخةٌ أخرى لا تعرفه، فتفتح رسالةً ثانية للرحلة نفسها — تظهر للعميل خريطتان.

## الحل

عمودٌ في جدول `orders`: `live_message_id text`. يُكتب بذريّة، ويُقرأ عند بدء البثّ، ويُمسح عند الإغلاق.

### المطالبة الذرّيّة

```sql
UPDATE orders SET live_message_id = $1 WHERE id = $2 AND live_message_id IS NULL RETURNING id
```

ترجع صفّاً إن نجحت المطالبة، وفراغاً إن سبقتنا نسخةٌ أخرى.

### الوراثة عبر النسخ

عند `open === undefined` و`target.liveMessageId !== null`:
1. تُحدَّث الرسالة فوراً بـ`channel.update()` — لا تُكتفي بالتخزين
2. إن فشل التحديث (الرسالة ماتت): يُمسح المعرّف ويُبدأ بثٌّ جديد
3. تُخزَّن الحالة في الذاكرة

### الإغلاق عبر النسخ

`closeTrip` عند غياب البثّ في الذاكرة:
1. تقرأ `customerOf(tripId)` من القاعدة
2. إن وُجد `liveMessageId`: تُوقف الرسالة
3. تُمسح القاعدة دائماً

## الأدلّة

| الأصل | المسار |
|-------|-------|
| المهاجرة | `supabase/migrations/20260908010000_orders_live_message_id.sql` |
| التنفيذ | `packages/infrastructure/tracking/tracking-queries.ts` |
| التطبيق | `packages/application/tracking/customer-live-relay.ts` |
| الربط | `apps/gateway/src/container.ts` |
| اختبار الوحدة | `tests/unit/tracking-realtime.test.ts` (٣ اختبارات SCL-005) |
| اختبار التكامل | `tests/integration/scl-005-live-message-id.test.ts` |

## النتائج

- `claimLiveMessageId` ذرّيّة: مطالبتان متزامنتان، فائزةٌ واحدة
- `clearLiveMessageId` تُلغي المعرّف فتُرى `null` في القراءة التالية
- `customerOf` تعيد `liveMessageId` من القاعدة
- نسختان: A تبدأ بثّاً، B تَرِث المعرّف وتُحدّث الرسالة (لا تفتح ثانية)
- 2184 اختبار pass / 0 fail
