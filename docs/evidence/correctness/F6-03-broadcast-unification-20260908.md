# F6-03 المرحلة 3 — توحيد مستقبِلي البثّ في صندوق الصادر الموحَّد

**التاريخ:** 2026-09-08
**العنصر:** F6-03 (البند `n` في ROADMAP-MASTER.md)
**المرحلة:** 3 من 4 (expand-then-contract)
**القرار:** ADR-0061 (صندوق الصادر الموحَّد)
**الحالة:** موسِّعة — الهجرة والأغلفة والاختبارات خضراء، بانتظار الدمج

## الملخّص

توحيد جدول `broadcast_recipients` في `notification_outbox` عبر نوعٍ جديدٍ
`broadcast_recipient`. الدوال الأربع (`create_broadcast`،
`claim_broadcast_recipients`، `finish_broadcast_delivery`، `cancel_broadcast`)
أُعيد تعريفها كأغلفةٍ على الصندوق الموحَّد، محافظةً على تواقيعها القديمة
تمامًا. جدول الحملة `broadcast_campaigns` يبقى جدولَ الحقيقة للحملة —
المستقبِلون وحدَهم يُوحَّدون.

## الهجرات المضافة

| الملفّ | الغرض |
|---|---|
| `20260908030000_unified_outbox_broadcast_recipient.sql` | نوع `broadcast_recipient` + حالة `canceled` + أعمدة `broadcast_campaign_id`/`recipient_user_id` + قيد شكل جزئي + تفريد ماديّ + 4 أغلفة دوال |
| `20260908030500_unified_outbox_broadcast_backfill.sql` | ترحيل بيانات idempotent من `broadcast_recipients` إلى `notification_outbox` |

## القرارات التصميمية

### 1. النوع والحالة
- نوع `broadcast_recipient` مُضافٌ إلى قيد `notification_outbox_kind_check`.
- حالة `canceled` مُضافة إلى قيد `notification_outbox_status_check` (كانت
  `failed` فقط من المرحلة 2). لا توجد حالة `sent` — التخزين الداخليّ موحَّدٌ
  على `delivered`.
- ترجمة الحالات: `sent`→`delivered`، `failed`→`failed`، `canceled`→`canceled`،
  `pending`/`sending` كما هي.

### 2. أعمدة التشغيل لا payload
- `broadcast_campaign_id uuid references broadcast_campaigns(id) on delete cascade`.
- `recipient_user_id uuid references users(id) on delete cascade`.
- السبب: `claim` و`finish` و`cancel` وإكمال الحملة كلّها تعتمد على `campaign_id`
  و`user_id` كقيود تشغيليّة وفهارس، لا كبيانات عرض. وضعها في payload وحدَه
  كان سيُضعف القيود والفهارس ويُجبر cast متكرّرًا.

### 3. قيد الشكل الجزئي
```sql
notification_broadcast_shape check (
  kind <> 'broadcast_recipient'
  or (broadcast_campaign_id is not null
      and recipient_user_id is not null
      and chat_id is not null and chat_id <> 0
      and language_code is not null)
)
```
يضمن أنّ كلّ مستقبِلٍ بثٍّ يحمل حملتَه ومستقبِلَه ومحادثته ولغته — لا رسالةٌ
ناقصةٌ تصدر.

### 4. التفريد الماديّ
- `dedup_key = 'broadcast:' || campaign_id || ':' || user_id` (قيد
  `notification_broadcast_dedup_shape` يُلزم هذه الصياغة الثابتة).
- فهرس فريد جزئيّ `notification_outbox_broadcast_recipient_uidx` على
  `(broadcast_campaign_id, recipient_user_id) where kind='broadcast_recipient'`
  يحفظ معنى القيد القديم `broadcast_recipients_once` حتّى لو أخطأ بناء
  `dedup_key`.

### 5. آثار إكمال الحملة (الخطر الإضافيّ)
محفوظةٌ تمامًا داخل غلاف `finish_broadcast_delivery`:
- بعد تحديث صفّ المستقبِل، يُختم `broadcast_campaigns.status='completed'` حين
  لا يبقى `pending` ولا `sending` في `notification_outbox` لتلك الحملة.
- الحملة المُلغاة لا تُختم هنا (تبقى `canceled`).
- الختم محسوبٌ من الصفوف لا مُعلَنٌ من العامل: إعادةُ تشغيلٍ في منتصف الشوط
  لا تختم حملةً ناقصةً.

### 6. استرجاع الحجوز المتروكة
محفوظٌ في غلاف `claim_broadcast_recipients` كما في الأصل: صفٌّ في `sending`
مع `claimed_at` أقدم من المهلة يُعاد `pending` ويُبطل رمزُ حجزِه القديم
(`error_code='CLAIM_ABANDONED'`). الفهرس
`notification_outbox_broadcast_abandoned_idx` يدعم هذا الاستعلام.

### 7. الإلغاء
غلاف `cancel_broadcast` يُلغي المستقبِلين المعلَّقين في `notification_outbox`
(`status='canceled'`) فقط — لا يلمس الجاري (`sending`) فهو محجوزٌ بيدِ عامل.
الحملة تُلغى، وسجلّ التدقيق يُكتب كما هو.

## التحقّق

### قاعدة نظيفة من الصفر
- 75 هجرة بلا إخفاق (73 سابقة + 2 جديدتان).
- 51 اختبارًا حرجًا (بثّ 13، بثّ HTTP 7، تذاكر 18، تجربة 5، سلامة 5) + 3
  أخرى = كلها خضراء.
- lint (biome) على الملفات المُعدَّلة: نظيف.
- schema-contract: 87 دالّة و23 جدولًا.
- 8 حرّاس: كلها خضراء (التحذيرات الموجودة مسبقًا في forward-only migrations
  وbench test ليست من تعديلاتي).

### الترحيل (backfill)
مُتحقَّقٌ يدويًّا: صفٌّ قديم `status='sent'` مع `message_id` و`sent_at` رُحِّل
إلى `delivered` مع `delivered_message_id` و`delivered_at` مضبوطة،
و`broadcast_campaign_id` و`recipient_user_id` مُعبّآن. Idempotent: إعادة
التشغيل لم تُضف صفًّا.

## إدخالات rollback-registry
4 إدخالات لـ`revoke_function` على الهجرة `20260908030000` (الدوال الأربع
المُعاد تعريفها)، مع `coupledDeploy: true` لأنّ الكود والهجرة يجب أن يُنشَرا
معًا.

## ما تبقّى
- المرحلة 4 (التقليص): إسقاط الجداول القديمة الثلاثة (`broadcast_recipients`،
  `subscription_notices`، `safety_incident_deliveries`) بعد استقرار التسليم من
  المصدر الموحَّد.
- 3 جولات CI خضراء متتالية قبل قلب `n` إلى `[x]` (ح-4).
