-- migration-phase: validate
-- =============================================================================
-- `SEC-19` · الساقُ «ب-٢» — تصديقُ قيودِ حالةِ «غيرُ قابلٍ للتسليمِ»
--
-- رفيقُ `20260922040000_sec_19_outbox_undeliverable_state.sql` (طورُ `contract`):
-- ثلاثةُ قيودٍ أُضيفت بـ`not valid` فلا مَسحَ تحتَ قفلٍ حاجزٍ. وهنا يُصادَقُ
-- كلُّ واحدٍ منها بقفلٍ أخفَّ (`SHARE UPDATE EXCLUSIVE`) لا يمنعُ الكتابةَ.
--
-- **ولا يُدَّعى أنَّ القيدَ صادَقَ**: القياسُ على قاعدةٍ حقيقيّةٍ في CI هو
-- الحكمُ، لا نصُّ الهجرةِ. والقاعدةُ قد تكون متأخّرةً عن `main` كما قِيسَ
-- في الساقِ الأُولى (`ح-4`).
-- =============================================================================

alter table notification_outbox
  validate constraint notification_outbox_status_check;

alter table notification_outbox
  validate constraint notification_undeliverable_pair;

alter table notification_outbox
  validate constraint notification_undeliverable_reason_check;
