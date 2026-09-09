-- الغرض: F7-02 / CAP-005 — فهرسٌ لطلبِ سائقٍ بحالةٍ. `assigned_driver_id` مفتاحٌ
--   خارجيٌّ بلا فهرسٍ ألبتّةَ، فكلُّ نبضةِ موقعٍ وكلُّ شوطِ خريطةٍ حيّةٍ كانَ يمسحُ
--   `orders` كاملاً. الشرطُ الجزئيُّ يُخرِجُ الطلباتَ غيرَ المُسنَدةِ فيبقى الفهرسُ
--   بحجمِ ما يُسألُ عنهُ.
-- الحالة: مُطبَّقةٌ بالمُطبِّقِ الآمنِ (F7-07) في طورِ `index` بلا معاملةٍ.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: tracking-queries · admin/queries · deactivate_stale_availability
-- ما لا تفعله: لا تُغيِّرُ مخطّطاً ولا بيانةً، ولا تحجبُ الكتابةَ (`concurrently`).
-- migration-phase: index

create index concurrently if not exists orders_assigned_driver_status_idx
  on orders (assigned_driver_id, status)
  where assigned_driver_id is not null;
