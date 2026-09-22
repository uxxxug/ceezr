# SEC-19 — ربطُ `created_by` بـ`users.id` توسيعًا (بندُ الترتيبِ ٣)

**التاريخ:** 2026-09-22
**الفرع:** `feat/sec-19-created-by-binds-to-users-id`
**الحاكم:** `SEC-19` (`docs/ROADMAP-MASTER.md:764`)، بندُ الترتيبِ ٣ من حجزِ
`SEC-19` في `ROADMAP.md`.

## المشكلةُ

`trip_tracking_tokens.created_by bigint not null` يخزِّنُ معرّفَ تيليجرام لا
`users.id`. فإذا زالَ ربطُ `users.telegram_id` (بعدَ التجهيلِ أو بعدَ `drop not
null`) صارَت رموزُ التتبُّعِ بلا مالكٍ — لا يَستطيعُ صاحبُها إلغاءَها ولا
يَستطيعُ التجهيلُ حذفَها.

## ما يُنفَّذُ في هذا الطورِ (توسيعٌ)

### ١. العمودُ الجديدُ والتعبئةُ والربطُ

`supabase/migrations/20260922080000_sec_19_tracking_token_owner_expand.sql`
(طورُ `contract`) و`20260922080100` (طورُ `validate`):

- إضافةُ `created_by_user_id uuid` (قابلٌ للغيابِ مؤقَّتًا).
- تعبئتُه من `users.id` عبرَ `users.telegram_id = trip_tracking_tokens.created_by`.
- ربطٌ خارجيٌّ `not valid` إلى `users(id)`، يُصادَقُ في طورِ `validate`.
- فهرسٌ على `created_by_user_id` للقراءةِ والحذفِ.

### ٢. تحديثُ الدوالّ

`supabase/migrations/20260922080200_sec_19_tracking_token_owner_functions.sql`
(طورُ `contract`):

- **`issue_tracking_token`**: تلتقطُ `u.id` أثناءَ فحصِ الملكيّةِ وتكتبُه في
  `created_by_user_id` معَ `created_by` التراثيِّ.
- **`revoke_tracking_token`**: تَحُلُّ `users.id` من `p_telegram_id` وتطابقُ
  بـ`created_by_user_id`، معَ احتفاظٍ تراثيٍّ للصفوفِ التي `created_by_user_id`
  فيها `null`.
- **`revoke_order_tracking_tokens`**: نفسُ المنطقِ.
- **`export_my_data`**: تُصدِّرُ رموزَ التتبُّعِ بـ`created_by_user_id` معَ
  احتفاظٍ تراثيٍّ.
- **`erase_my_account`**: تَحذُفُ رموزَ التتبُّعِ بـ`created_by_user_id = v_user.id`
  معَ احتفاظٍ تراثيٍّ — في مسارَي الراكبِ والسائقِ.

### ٣. سياسةُ التجهيلِ

`packages/shared/config/erasure-policy.ts`: `linkedBy` صارَ
`trip_tracking_tokens.created_by_user_id → users.id`.

## ما لا يُدَّعى

- **لا يُدَّعى أنَّ `created_by bigint` أُسقِطَ** — هوَ باقٍ مسلكاً تراثيّاً.
- **لا يُدَّعى أنَّ `created_by_user_id` `not null`** — الصفوفُ التي لم تُعَيَّن
  (تتيمةٌ) تبقى `null`.
- **لا يُدَّعى أنَّ التواقيعَ العامةَ تُغُيِّرَت** — `p_telegram_id` يبقى الوسيطَ.
- **لا يُدَّعى نشرٌ حيٌّ ولا حمِلٌ قِيسَ** (`ح-5`).

## التراجعُ

- العمودُ الجديدُ: `alter table trip_tracking_tokens drop column if exists
  created_by_user_id` — لا أثرَ تخريبيٌّ.
- الدوالّ: `create or replace` يُعيدُ النسخَ السابقةَ (من `20260920110000` للاستخراجِ
  والتجهيل، ومن `20260814150000` و`20260814170000` للإصدارِ والإلغاء).
