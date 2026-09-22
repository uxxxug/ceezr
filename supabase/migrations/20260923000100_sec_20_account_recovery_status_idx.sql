-- الغرض: `SEC-20` — فهرسُ طابورِ المراجعةِ: المدينةُ والحالةُ وأقدمُ تقديمٍ أوّلًا.
--   `list_pending_account_recovery_requests` يقرأُ الطلباتِ المُعلَّقةَ مرتَّبةً
--   بـ`submitted_at desc` — بلا فهرسٍ فمسحُ الجدولِ كاملٌ في كلِّ فتحِ لوحةٍ.
-- الحالة: مُطبَّقةٌ بالمُطبِّقِ الآمنِ (F7-07) في طورِ `index` بلا معاملةٍ.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: `list_pending_account_recovery_requests()` · لوحةُ الاستردادِ في `apps/admin-dashboard`
-- ما لا تفعله: لا تُغيِّرُ مخطّطاً ولا بيانةً، ولا تحجبُ الكتابةَ (`concurrently`)، ولا تُنشئُ الفهرسَ إن وُجدَ.
-- migration-phase: index

create index concurrently if not exists account_recovery_requests_status_idx
  on account_recovery_requests (city_id, status, submitted_at desc);
