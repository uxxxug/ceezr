-- الغرض: `SEC-20` — فهرسُ المستخدمِ المستهدَفِ بالاستردادِ: `target_user_id`
--   مفتاحٌ خارجيٌّ يُقرأُ في مسارِ مراجعةٍ إداريٍّ تفاعليٍّ (تحقُّقُ الهدفِ قبلَ
--   القرارِ)، فالمسحُ الكاملُ يُقاسُ في زمنِ مسؤولٍ لا في مهمّةٍ خلفيّةٍ.
-- الحالة: مُطبَّقةٌ بالمُطبِّقِ الآمنِ (F7-07) في طورِ `index` بلا معاملةٍ.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: `review_account_recovery_request()` · `submit_account_recovery_request()`
-- ما لا تفعله: لا تُغيِّرُ مخطّطاً ولا بيانةً، ولا تحجبُ الكتابةَ (`concurrently`)، ولا تُنشئُ الفهرسَ إن وُجدَ.
-- migration-phase: index

create index concurrently if not exists account_recovery_requests_target_idx
  on account_recovery_requests (target_user_id);
