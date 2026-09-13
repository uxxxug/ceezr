-- الغرض: `W-5` — فهرسٌ جزئيٌّ لأحداثِ CORE التي لم تُطبَّقْ بعدُ (`processed_at is null`).
--   يُرتَّبُ بـ`received_at` لأنَّ المُطبِّقَ يأخذُ الأقدمَ أوّلاً، ويكتفي بصفٍّ
--   واحدٍ فيتوقّفُ المسحُ عندَ أوّلِ مُستحقٍّ ولا يفرِزُ.
-- الحالة: مُطبَّقةٌ بالمُطبِّقِ الآمنِ (`F7-07`) في طورِ `index` بلا معاملةٍ — 2026-09-11.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: مُطبِّقُ الوارِدِ في `apply_core_fulfillment_created`
-- ما لا تفعله: لا تُغيِّرُ مخطّطاً ولا بيانةً، ولا تحجبُ الكتابةَ (`concurrently`).
-- migration-phase: index
--
-- ## لماذا ملفٌّ وحدَه لا سطرٌ في ترحيلةِ الجدولِ
--
-- بعينِ حُجّةِ سابقتِها: الفهرسُ المتزامنُ لا يجري في معاملةٍ، فيُفرَدُ في ملفٍّ
-- يُصرِّحُ طورَ `index` (`CAP-007`).

create index concurrently if not exists core_event_inbox_unprocessed_idx
  on core_event_inbox (received_at)
  where processed_at is null;
