-- migration-phase: index
-- =============================================================================
-- SEC-19 — بندُ الترتيبِ ٣: فهرسُ `created_by_user_id` المتزامنُ
--
--   فهرسٌ على `trip_tracking_tokens.created_by_user_id` يُنشَأُ متزامنًا (بلا
--   قفلٍ حاجزٍ) لأنَّ الجدولَ حارٌّ، ولا يُقبَلُ `concurrently` داخلَ معاملةٍ.
-- =============================================================================

create index concurrently if not exists trip_tracking_tokens_created_by_user_id_idx
  on trip_tracking_tokens (created_by_user_id);
