-- الغرض: F7-02 / CAP-005 — فهرسٌ لترشيحِ سجلِّ التدقيقِ بالفعلِ والكيانِ.
--   `audit_log_entity_idx (entity_type, entity_id)` يسراهُ `entity_type` وهوَ غيرُ
--   مُرشَّحٍ في مهمّةِ التحذيرِ، فلا بادئةَ صحيحةَ لها؛ والجدولُ من أسرعِ الجداولِ
--   نموّاً: صفٌّ لكلِّ تبديلِ حضورٍ وكلِّ إسنادٍ وكلِّ قرارٍ إداريٍّ.
-- الحالة: مُطبَّقةٌ بالمُطبِّقِ الآمنِ (F7-07) في طورِ `index` بلا معاملةٍ.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: مهمّةُ تحذيرِ الاشتراكاتِ المنتهيةِ قريباً
-- ما لا تفعله: لا تُغيِّرُ مخطّطاً ولا بيانةً، ولا تحجبُ الكتابةَ (`concurrently`).
-- migration-phase: index

create index concurrently if not exists audit_log_action_entity_idx
  on audit_log (action, entity_id);
