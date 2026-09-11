-- الغرض: `W-5` — فهرسٌ جزئيٌّ للحدثِ الصادرِ المستحقِّ للإرسالِ: ما لم يُسلَّمْ ولم يمُتْ.
--   عمودُه `next_attempt_at` وحدَه لأنَّ الحاجزَ يحجزُ صفّاً واحداً مُرتَّباً بهِ،
--   وقياسُ عمرِ الطابورِ (`MOVE_EVENT_OUTBOX_OLDEST_AGE_LIMIT_SECONDS`) يقرؤه كذلك.
-- الحالة: مُطبَّقةٌ بالمُطبِّقِ الآمنِ (`F7-07`) في طورِ `index` بلا معاملةٍ — 2026-09-11.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: `claim_move_event_delivery` وقياسُ ضغطِ الطابورِ العكسيِّ
-- ما لا تفعله: لا تُغيِّرُ مخطّطاً ولا بيانةً، ولا تحجبُ الكتابةَ (`concurrently`).
-- migration-phase: index
--
-- ## لماذا ملفٌّ وحدَه لا سطرٌ في ترحيلةِ الجدولِ
--
-- بعينِ حُجّةِ سابقتَيها. وإفرادُه يجعلُ تراجعَه تراجُعَ ملفٍّ واحدٍ: إسقاطُ فهرسٍ
-- لا يمسُّ جدولاً ولا بيانةً، وهوَ ما يجعلُ الاستعادةَ رخيصةً.

create index concurrently if not exists move_event_outbox_due_idx
  on move_event_outbox (next_attempt_at)
  where delivered_at is null and dead_at is null;
