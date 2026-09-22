# SEC-19 — `erase_my_account` يكتبُ `null` لا السالبَ (متابعةُ البابِ الرابعِ)

**التاريخ:** 2026-09-22
**الكيان:** `users.telegram_id`
**المرجع:** [PR #209](https://github.com/uxxxug/ceezr/pull/209) (أسقطَ `not null`)، هذا التغييرُ (يكتبُ `null`).

## الفجوةُ

البابُ الرابعُ (PR #209) أسقطَ قيدَ `not null` عن `users.telegram_id`، فأصبحَ
العمودُ يَقبَلُ `null`. لكنَّ `erase_my_account()` كانَ لا يزالُ يكتبُ
`v_sentinel` (معرّفٌ سالبٌ من `erased_account_telegram_seq`) إلى العمودِ،
لا `null`. فالذي نُفِّذَ هوَ السماحُ بالتمثيلِ `null`، لا استعمالُه فعليًّا
في مسارِ التجهيلِ الجديدِ.

## التغييرُ

هجرةٌ واحدةٌ: `20260922100000_sec_19_erase_writes_null_telegram_id.sql`
- `create or replace function erase_my_account(bigint)` معَ تغييرٍ واحدٍ:
  `update users set telegram_id = v_sentinel` → `update users set telegram_id = null`
- `v_sentinel` يبقى لحقولِ `chat_id` في `broadcast_recipients` و
  `notification_outbox` و`subscription_notices` — فهذه الأعمدةُ لا تقبلُ `null`
  (قيدُ `chat_id <> 0`).

## ولا يُنزَعُ `erased_account_telegram_seq`

الصفوفُ القائمةُ (قبلَ هذا التغييرِ) تحملُ سوالبَ مُولَّدةً من
`erased_account_telegram_seq`. وتبقى كما هيَ — لا ترحيلَ. هذا تمثيلٌ
للكتاباتِ الجديدةِ لا ترحيلٌ للقديمةِ.

## أمانُ المُشغِّلِ

`mark_identity_before_erasure()` يقرأُ `OLD.telegram_id` (القيمةَ قبلَ
التحديثِ) لا `NEW.telegram_id`. فانتقالُ `NEW.telegram_id` من `v_sentinel`
إلى `null` لا يُأثِّرُ في أثرِ الهويّةِ المكتوبِ في `identity_marks`.

## التدقيقُ الساكنُ لقراءاتِ `users.telegram_id`

صُنِّفَتِ الاستخداماتُ:

| النوعُ | الأمانُ معَ `null` | الملاحظاتُ |
|---|---|---|
| `where telegram_id = p_telegram_id` | آمنٌ | لا يُطابِقُ `null` — الدالّةُ تُرجِعُ `NOT_FOUND` |
| `String(row.telegram_id)` في TypeScript | مُحَصَّنٌ | مسالكُ الإرسالِ مُغطَّاةٌ بخطواتِ SEC-19 ١–٥ |
| `identity_hash(old.telegram_id::text)` | آمنٌ | يقرأُ `OLD` لا `NEW` |
| `apply_identity_mark_on_signup` | آمنٌ | `new.telegram_id is null` → تخطَّى |
| `seed_carried_standing` | آمنٌ | `v_telegram_id is null` → تخطَّى |

## الاختبارُ

اختبارُ تكاملٍ في `tests/integration/tracking-token-owner-binding.test.ts`:

1. يُنشِئُ مستخدمًا/طلبًا/رمزَ تتبُّعٍ
2. يُلغي الطلبَ (`cancelled`)
3. يُنادي `erase_my_account()`
4. يَتحقَّقُ:
   - `telegram_id IS NULL`
   - `erased_at IS NOT NULL`
   - `full_name IS NULL` و`phone IS NULL` و`telegram_username IS NULL`
   - `trip_tracking_tokens` لذلك `user_id` = 0
   - القيدُ `users_erased_rows_carry_no_identity` موجودٌ ويَرفُضُ صفًّا
     مُجهَّلاً يحملُ اسمًا

## مسالكُ الإرسالِ و`null`

مسلكُ `claim_notification_delivery()` (الخانقُ) مُغطَّى بخطواتِ SEC-19 ١–٥:
التحويلُ `String(null)` يُرفَضُ، والرسالةُ تُفشَّلُ بـ`UNDISCLOSED_TARGET`.
وباقي المسالكِ إمَّا مُحَصَّنةٌ بفحصِ `null` صراحةً
(`telegram-driver-notifier.ts:70`) أو مُغطَّاةٌ بتدقيقٍ ساكنٍ —
لا مسارَ إرسالٍ يُحاولُ إرسالَ `null` دونَ حارسٍ.

## الخلاصةُ

`erase_my_account()` يكتبُ `null` إلى `users.telegram_id` للحساباتِ
المُجهَّلةِ من الآنَ فصاعدًا. والسوالبُ القائمةُ تبقى. والقيدُ
`users_erased_rows_carry_no_identity` يحرسُ المعنى.
