-- migration-phase: validate
-- `F3-01` — مصادقةُ قيودِ `driver_documents` الثلاثةِ بقفلٍ أخفَّ.
--
-- القيودُ أُضيفَت `not valid` في طورِ التوسيعِ (`CAP-007`)، وههنا تُصادَقُ
-- فتصيرُ **حكماً على الصفوفِ القائمةِ** لا على الجديدِ وحدَه. والجدولُ
-- مولودٌ في الهجرةِ نفسِها فالمسحُ على صفرِ صفٍّ اليومَ — والصوابُ أن يُكتَبَ
-- الطورُ على وجهِه لا أن يُختصَرَ لأنَّ الجدولَ صغيرٌ الآنَ.
--
-- ويُقرأُ الأثرُ من الكاتالوجِ: `pg_constraint.convalidated` — لا من نصِّ هذه
-- الهجرةِ (`tests/integration/driver-documents.test.ts`).

alter table public.driver_documents validate constraint driver_documents_object_path_present;
alter table public.driver_documents validate constraint driver_documents_rejection_has_reason;
alter table public.driver_documents validate constraint driver_documents_accepted_has_expiry;
