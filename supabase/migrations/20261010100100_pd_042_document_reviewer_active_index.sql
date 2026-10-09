-- الغرض: `PD-042` — منحٌ قائمٌ واحدٌ لكلِّ (مستخدمٍ · مدينة)، ويخدمُ `is_document_reviewer`
--   التي تُنادى في كلِّ فتحِ وثيقةٍ وكلِّ قرار. السحبُ ختمٌ لا حذف، فالفهرسُ جزئيٌّ.
-- الحالة: تُطبَّقُ بالمُطبِّقِ الآمنِ (F7-07) في طورِ `index` بلا معاملة.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: `is_document_reviewer()` · `admin_set_document_reviewer()`
-- ما لا تفعله: لا تُغيِّرُ مخطّطاً ولا بيانة، ولا تحجبُ الكتابة (`concurrently`).
-- migration-phase: index

create unique index concurrently if not exists driver_document_reviewers_active_uidx
  on driver_document_reviewers (user_id, city_id) where revoked_at is null;
