# `SEC-19` · الساقُ «ب-٢» — حالةُ «غيرُ قابلٍ للتسليمِ» الصريحةُ في `notification_outbox`

**التاريخُ:** 2026-09-22 · **الحالُ:** مُنفَّذٌ محلّيًّا · **لا مسلكَ إرسالٍ حُصِّنَ**
**الأصلُ:** `docs/evidence/security/SEC-19-send-path-classification-20260922.md` · **الخطوةُ السابقةُ:** `docs/evidence/security/SEC-19-telegram-id-inventory-20260922.md`

---

## المسألةُ المقيسةُ

`notification_outbox.status` كانَ يعرفُ سبعَ حالاتٍ: `pending` · `sending` ·
`delivered` · `dead` · `failed` · `canceled` · `in_app_only` — وليسَ فيها
«غيرُ قابلٍ للتسليمِ». فـ`dead` تعني **فشلاً بعدَ جهدٍ** (استُنفِدَت المحاولاتُ)،
ووضعُ «لا قناةَ أصلاً» فيها يخلِطُ ما أُمِرتُ بفصلِه ويُلوِّثُ كلَّ مقياسٍ يعُدُّ
`dead` بوصفِها عطباً تشغيليّاً. و`in_app_only` قرارُ سياسةٍ من
`notification_kind_policy` لا تعذُّرٌ — فإعادةُ استخدامِها تخلِطُ الاختيارَ بالعجزِ.

والحلُّ المُقترَحُ في وثيقةِ التصنيفِ: إضافةُ حالةٍ **صريحةٍ** مستقلّةٍ.

## ما أُنجِزَ

ثلاثةُ هجراتٍ على `notification_outbox` لا على `users`:

### ١) `20260922040000_sec_19_outbox_undeliverable_state.sql` (طورُ `contract`)

- **يُسقِطُ** قيدَ `notification_outbox_status_check` القديمَ (الذي لا يقبلُ
  `undeliverable`) ويُعيدُ إنشاءَه بصراحةٍ أوسعَ: تُضافُ `undeliverable` إلى
  القائمةِ المغلقةِ. والقيدُ الجديدُ بـ`not valid` فلا يُمسحُ الجدولُ تحتَ قفلٍ
  حاجزٍ.
- **يُضيفُ** `notification_undeliverable_pair`: قيدٌ منفصلٌ (لا توسيعٌ لـ
  `notification_dead_pair`) يُلزِمُ `died_at` و`dead_reason` للحالةِ الجديدةِ —
  كما يُلزِمُ `notification_dead_pair` الحالةَ `dead`.
- **يُضيفُ** `notification_undeliverable_reason_check`: قائمةٌ مغلقةٌ من ثلاثةِ
  أسبابٍ لا رابعَ — `TELEGRAM_ID_MISSING` · `TELEGRAM_DELIVERY_UNAVAILABLE` ·
  `TELEGRAM_DELIVERY_NOT_REQUIRED`. ولا يُشمَلُ `TELEGRAM_DELIVERY_FAILED` لأنَّه
  فشلٌ عارضٌ (مسلكُ `dead` بـ`MAX_ATTEMPTS`) لا «لا قناةَ».

### ٢) `20260922040100_sec_19_outbox_undeliverable_validate.sql` (طورُ `validate`)

- يُصادِقُ القيودَ الثلاثةَ بقفلٍ أخفَّ (`SHARE UPDATE EXCLUSIVE`) لا يمنعُ
  الكتابةَ.

### ٣) `20260922040200_sec_19_outbox_undeliverable_index.sql` (طورُ `index`)

- `create index concurrently` لفهرسٍ جزئيٍّ على `undeliverable` وحدَها — مرآةٌ
  لـ`notification_outbox_dead_idx` الذي بُنيَ في `20260908050000`.

## الاختبارُ

`tests/integration/notification-outbox-undeliverable-state.test.ts` — عشرةُ اختباراتٍ
على PostgreSQL حقيقيٍّ:

1. القيدُ المنشورُ يقبلُ `undeliverable` (من `pg_constraint`).
2. `undeliverable` بلا `died_at` و`dead_reason` يُرفَضُ.
3. `undeliverable` بـ`died_at` و`dead_reason` مقبولٌ.
4. `undeliverable` بسببٍ خارجِ القائمةِ يُرفَضُ.
5. `TELEGRAM_DELIVERY_UNAVAILABLE` سببٌ مقبولٌ.
6. `TELEGRAM_DELIVERY_NOT_REQUIRED` سببٌ مقبولٌ.
7. `dead` بحالةٍ قائمةٍ لا تزالُ تعملُ (لا انحدارَ في القيدِ الأوّلِ).
8. `in_app_only` تبقى صالحةً بلا `dead_reason` (لا خلطُ سياسةٍ بتعذُّرٍ).
9. القيدُ `notification_undeliverable_pair` منشورٌ في القاعدةِ.
10. القيدُ `notification_undeliverable_reason_check` منشورٌ في القاعدةِ.

## النمطُ المُتَّبَعُ

`20260813070000_safety_delivery_skip_misconfigured.sql` يُسمّي الإعدادَ الناقصَ
بسببٍ مقروءٍ (`ESCALATION_GROUP_MISSING`) ولا يُعيدُ محاولةً لا تنجحُ. فالأسبابُ
هنا امتدادُ نمطٍ قائمٍ لا اختراعٌ.

## ما لا يُدَّعى (`ح-5`)

- **لا مسلكَ إرسالٍ واحدٍ حُصِّنَ.** هذه الخطوةُ تُضيفُ الحالةَ وحدَها.
- **لا قياسَ أمامَ غيابٍ تامٍّ**: `telegram_id` عمودٌ `not null` (مقيسٌ)، فلا
  صفَّ `undeliverable` يُنشَأُ اليومَ. والقيدُ يُتيحُ الإعلانَ لا يُنفِّذُه.
- **لا ADR جديدٍ**: القرارُ مُسجَّلٌ في وثيقةِ التصنيفِ وفي ROADMAP. والحالةُ
  تمكّنٌ لا سياسةٌ — فالسياسةُ تُتَّخذُ في الطورِ التالي (الحرسُ في
  `claim_notification_delivery`).
- **`in_app_only` لم تُمَسَّ**: معناها قرارُ سياسةٍ لا تعذُّرٌ، ووضعُ التعذُّرِ
  فيها كانَ سيخلِطُ الاختيارَ بالعجزِ.
- **`dead` لم يُمَسَّ**: قيدُه `notification_dead_pair` باقٍ بحرفِه، ولم يُوسَّعْ.
- **`users` لم تُلمَسْ**: لا عمودُ `telegram_id` ولا قيدُ `not null`.
