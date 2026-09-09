-- الغرض: F7-02 / CAP-005 — فهرسٌ زمنيٌّ لسجلِّ الحضورِ. الاستعلامانِ نافذةُ زمنٍ
--   وترشيحُ المدينةِ فيهما اختياريٌّ، فلا يخدمُهما `attendance_log_city_idx` ولا
--   `attendance_log_driver_time_idx` الذي يسراهُ `driver_id`. والعمودُ الزمنيُّ
--   يسرى عن قصدٍ لأنَّ الترشيحَ الثابتَ هوَ النافذةُ لا المدينةُ.
-- الحالة: مُطبَّقةٌ بالمُطبِّقِ الآمنِ (F7-07) في طورِ `index` بلا معاملةٍ.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/admin/queries.ts (الحضورُ وساعاتُ العملِ)
-- ما لا تفعله: لا تُغيِّرُ مخطّطاً ولا بيانةً، ولا تحجبُ الكتابةَ (`concurrently`).
-- migration-phase: index

create index concurrently if not exists attendance_log_changed_at_idx
  on attendance_log (changed_at desc);
