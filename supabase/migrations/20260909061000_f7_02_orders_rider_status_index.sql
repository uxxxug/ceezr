-- الغرض: F7-02 / CAP-005 — فهرسٌ لطلباتِ راكبٍ بحالةٍ. `rider_id` مفتاحٌ خارجيٌّ
--   بلا فهرسٍ، والمُستدعيانِ في مسارِ طلبٍ تفاعليٍّ («أين طلبي؟» وسجلُّ الراكبِ)
--   فالمسحُ الكاملُ يُقاسُ في زمنِ استجابةِ مستخدمٍ لا في مهمّةٍ خلفيّةٍ.
-- الحالة: مُطبَّقةٌ بالمُطبِّقِ الآمنِ (F7-07) في طورِ `index` بلا معاملةٍ.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: packages/infrastructure/transport/order-adapters.ts
-- ما لا تفعله: لا تُغيِّرُ مخطّطاً ولا بيانةً، ولا تحجبُ الكتابةَ (`concurrently`).
-- migration-phase: index

create index concurrently if not exists orders_rider_status_idx
  on orders (rider_id, status);
