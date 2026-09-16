-- migration-phase: validate
-- `F8-01` — مصادقةُ قيودِ شكلِ `request_id` الثلاثةِ.
--
-- أُضيفَت `not valid` في طورِ التوسيعِ (القاعدة ٢ · `CAP-007`)، وههنا تصيرُ
-- **حكماً على الصفوفِ القائمةِ** لا على الجديدِ وحدَه. والأعمدةُ مولودةٌ فارغةً
-- فالمسحُ يمرُّ على `null` كلِّه اليومَ — والصوابُ أن يُكتَبَ الطورُ على وجهِه
-- لا أن يُختصَرَ لأنَّ العمودَ جديدٌ (سابقةُ `20260915000300`).
--
-- ويُقرأُ الأثرُ من الكاتالوجِ — `pg_constraint.convalidated` — لا من نصِّ هذه
-- الهجرةِ (`tests/integration/request-correlation.test.ts`).

alter table audit_log validate constraint audit_log_request_id_shape;
alter table notification_outbox validate constraint notification_outbox_request_id_shape;
alter table ledger_entries validate constraint ledger_entries_request_id_shape;
