-- migration-phase: validate
-- =============================================================================
-- SEC-19 — بندُ الترتيبِ ٣: مصادقةُ ربطِ `created_by_user_id` الخارجيِّ
--
--   تُصادِقُ هذه الهجرةُ الربطَ الخارجيَّ
--   `trip_tracking_tokens_created_by_user_id_fkey` الذي أُضيفَ `not valid` في
--   هجرةِ `20260922080000`. المصادقةُ تَتمُّ بقفلِ `SHARE UPDATE EXCLUSIVE` —
--   أخفَّ من قفلِ الإضافةِ — فلا تُحجَبُ الكتابةُ.
--
--   **لماذا المصادقةُ آمنةٌ:** التعبئةُ أخذتْ `users.id` من `users.telegram_id`
--   المُطابِقِ، فكلُّ قيمةٍ في `created_by_user_id` هي `users.id` قائمٌ فعلاً.
--   والصفوفُ التي لم تُعَيَّن (تتيمةٌ) تبقى `null`، والربطُ الخارجيُّ يَقبَلُ
--   `null`.
-- =============================================================================

alter table trip_tracking_tokens
  validate constraint trip_tracking_tokens_created_by_user_id_fkey;
