# SEC-19 بندُ ٤ — إسقاطُ `not null` عن `users.telegram_id`

**التاريخ:** 2026-09-22
**الفرع:** `feat/sec-19-drop-telegram-id-not-null`
**الترتيبُ المُلزِمُ:** البندُ الرابعُ والأخيرُ (١ ← ٢ ← ٣ ← **٤**)

## المُنجَزُ

هجرةٌ واحدةٌ: `20260922090000_sec_19_drop_telegram_id_not_null.sql`

```sql
alter table users alter column telegram_id drop not null;
```

## ما استُوفِيَ قبلَ هذا البابِ

| البندُ | الحالةُ | الدليلُ |
|---|---|---|
| ١) تحصينُ مسالكِ الإرسالِ (الخطواتُ ١–٥) | مُدمَجٌ | `SEC-19-send-path-classification-20260922.md` |
| ٢) `ADR 0175` + تقويةُ قيدِ التجهيلِ | مُدمَجٌ (`PR #207`) | `SEC-19-erasure-constraint-strengthening-20260922.md` |
| ٣) ربطُ `created_by` بـ`users.id` | مُدمَجٌ (`PR #208`) | `SEC-19-tracking-token-owner-binding-20260922.md` |

## ما لا يُمسُّ

- **الفهرسُ `unique`:** يَقبَلُ `null`اتٍ متعدِّدةً في PostgreSQL بلا تعديلٍ.
- **`erased_account_telegram_seq`:** لا يُنزَعُ — الصفوفُ القائمةُ تحملُ سوالبَ مُولَّدةً من المَعرِضِ. والتمثيلُ المستقبليُّ (`null`، `ADR 0175`) مسلكٌ للكتاباتِ الجديدةِ لا ترحيلٌ للقديمةِ.
- **لا ترحيلَ بياناتٍ:** المُعرِّفاتُ السالبةُ القائمةُ تبقى كما هيَ.
- **لا تغييرَ في التواقيعِ ولا في السطحِ العلنيِّ.**

## الاختبارُ

تحديثُ `tests/integration/erasure-check-against-absent-identity.test.ts`:

1. التوكيدُ القديمُ `attnotnull = true` → صارَ `attnotnull = false` (قياسٌ مباشرٌ على `pg_attribute`).
2. اختبارٌ جديدٌ: إدخالُ صفٍّ في `users` بـ`telegram_id = null` و`erased_at = now()` — يُقبَلُ. وإدخالُ صفٍّ مُجهَّلٍ يحملُ `full_name` — يُرفَضُ بالقيدِ `users_erased_rows_carry_no_identity`.
