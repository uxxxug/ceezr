-- migration-phase: index
-- =============================================================================
-- `SEC-19` · الساقُ «ب-٢» — فهرسُ الصفوفِ غيرِ القابلةِ للتسليمِ
--
-- رفيقُ `20260922040000_sec_19_outbox_undeliverable_state.sql`: فهرسٌ جزئيٌّ على
-- `undeliverable` وحدَها. مرآةٌ لـ`notification_outbox_dead_idx` الذي بُنيَ
-- في `20260908050000` للصفوفِ الميّتةِ. لوحةُ الإدارةِ تسألُ «ما تعذَّرَ
-- تسليمُه في هذه المدينةِ؟».
--
-- **طورُ `index`**: `create index concurrently` لا يُقبَلُ داخلَ معاملةٍ،
-- فالملفُّ وحدَه بلا رفيقٍ. والقفلُ `SHARE` أخفُّ من `SHARE UPDATE EXCLUSIVE`
-- ولا يمنعُ الكتابةَ.
-- =============================================================================

create index concurrently if not exists notification_outbox_undeliverable_idx
  on notification_outbox (city_id, died_at desc)
  where status = 'undeliverable';
