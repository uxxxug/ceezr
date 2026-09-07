# ADR 0058: SCL-001 — اعتماد PostgreSQL durable receipt بوصفه حلّ منع التكرار الموزَّع

**التاريخ:** 2026-09-08  
**الحالة:** مقبول  
**نسخ:** SCL-001 في `docs/ROADMAP-MASTER.md`

## السياق

يشترط بند SCL-001 في خارطة الطريق:

> «Map داخل العملية للـdedup → dedup موزَّع في Redis بمفتاح update_id وعمر محدود»

وقد اختار [ADR 0054](./0054-telegram-webhook-durable-ingest-and-dedup.md) PostgreSQL لا Redis لسجلّ الاستلام ومنع التكرار، مع نصٍّ صريحٍ بأنّ SCL-001 يبقى `[ ]`. والتنفيذ في `telegram_update_receipts` قائمٌ وعاملٌ، لكنّ نصّ SCL-001 يذكر Redis تحديداً، فلا يُغلق البند دون قرارٍ معماريّ ينسخ الشرط صراحةً.

## القرار

**اعتماد PostgreSQL durable receipt بوصفه حلّ SCL-001، ونسخ شرط Redis صراحةً.**

سجلّ `telegram_update_receipts` يُحقّق المتطلبات الأربعة جميعها:

| المتطلّب | كيف يُحقَّق |
|----------|------------|
| موزَّع | جدولٌ في PostgreSQL، كلُّ النسخ تقرأ وتكتب فيه |
| مفتاح update_id | المفتاح الأساسيّ `(bot, update_id)` — ذرّيٌّ بـ`ON CONFLICT DO NOTHING` |
| يمنع التكرار عبر عمليتين/اتصالين | `claim_telegram_update` ذرّيّة: إيداعٌ وحجزٌ في نداءٍ واحد، أو استرجاعٌ بـ`FOR UPDATE SKIP LOCKED` |
| عمر محدود | تنظيفٌ دوريّ: حذفُ الصفوف المختومة (`status = 'done'`) الأقدم من ٧ أيّام، وحذفُ المحجوزة المهجورة (`status = 'pending'` أو `'failed'`) الأقدم من ٢٤ ساعة |

## لماذا لا Redis

- **القاعدة 0.5:** كلُّ قرارٍ حرجٍ في دالّةٍ ذرّيّةٍ واحدةٍ. PostgreSQL يُحقّق هذا بـ`ON CONFLICT` و`FOR UPDATE SKIP LOCKED` — وهذه بدائيّاتٌ أصيلةٌ لا تُحاكى بسهولةٍ في Redis.
- **القاعدة 0.1:** مصدرٌ واحدٌ للحقيقة. وجودُ سجلٍّ dedup في Redis **و**سجلّ استلامٍ في PostgreSQL يعني نظامين لمنع التكرار، وكلٌّ منهما قد يخالف الآخر.
- **ADR 0054 §٤:** «القرارُ الذرّيُّ في القاعدةِ لا في Redis» — وهذا القرارُ معماريٌّ سابقٌ لا يُنسخ بسهولةٍ.
- **الحدّ الأدنى من التعقيد (المبدأ الأوّل):** Redis يُضيف مكوّناً آخر للإدارة والمراقبة، بلا فائدةٍ تُقابل: المنعُ الموزَّع في PostgreSQL يُحقّق نفس الضمان.

## العمر المحدود — التنظيف الدوريّ

يُضاف مهاجرةٌ تنشئ دالّةً تنظّف السجلّ:

```sql
-- حذف المختوم الأقدم من ٧ أيّام
delete from telegram_update_receipts
 where status = 'done' and completed_at < now() - interval '7 days';

-- حذف المهجور (pending/failed) الأقدم من ٢٤ ساعة
delete from telegram_update_receipts
 where status in ('pending', 'failed') and first_seen_at < now() - interval '24 hours';
```

وتُستدعى في مهمّةٍ مجدولةٍ (F5-10 عند جاهزيّته)، أو يدويّاً حتّى ذلك الحين.

## العواقب

- **إيجابيّة:** SCL-001 يُغلق بتنفيذٍ قائمٍ وعامل، لا يحتاج Redis إضافيّاً.
- **سلبيّة:** التنظيفُ غيرُ مؤتمتٍ حتّى F5-10 — لكنّ الجدول صغيرٌ (صفٌّ لكلّ تحديثٍ مُعالَج) ولا ينمو بلا تنظيفٍ إلى مستوىً يُؤثّر في الأداء.
- **محايدة:** ADR 0054 يبقى ساريّاً — هذا القرارُ يُكمّله لا ينسخه.

## مراجع

- [ADR 0054: Telegram Webhook Durable Ingest and Dedup](./0054-telegram-webhook-durable-ingest-and-dedup.md)
- `supabase/migrations/20260904090000_telegram_update_receipts.sql`
- `supabase/migrations/20260908020000_telegram_update_receipts_retention.sql`
- `docs/ROADMAP-MASTER.md` — SCL-001
