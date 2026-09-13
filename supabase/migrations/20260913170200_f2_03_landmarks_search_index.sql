-- migration-phase: index
-- =============================================================================
-- الغرض: فهرسُ مطابقةِ البدايةِ على مفتاحِ البحثِ المُطبَّعِ (البند `F2-03`).
-- الحالة: مُطبَّقةٌ بالمُطبِّقِ الآمنِ في طورِ `index` بلا معاملةٍ.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `search_destinations` — فرعُ `like q || '%'` وحدَه.
-- ما لا تفعله: لا تُسرِّعُ مطابقةَ الاحتواءِ `like '%q%'` — تلكَ مسحٌ مُعلَنٌ ومحدودٌ بصفوفِ مدينةٍ واحدةٍ، وفهرسُ الثلاثيّاتِ دَينٌ في ADR 0102 §7.
--
-- ## العودة (rollback)
--
-- `drop index concurrently if exists destination_landmarks_search_idx;` — بلا فقدِ بيانةٍ ولا كسرِ دالّةٍ؛ يصيرُ البحثُ مسحاً.
--
-- ## ولماذا `text_pattern_ops`
--
-- الفهرسُ الافتراضيُّ يُبنى على ترتيبِ الحروفِ في `collation` القاعدةِ، و`like 'x%'` لا يستخدمُه إلّا في `collation` من نوعِ `C`. و`text_pattern_ops` يُرتِّبُ بايتاً بايتاً فيصيرُ الفهرسُ مستخدَماً فعلاً — وإلّا لَكانَ فهرساً يُقرأُ في الوثيقةِ ولا يُقرأُ في الخطّةِ.
-- =============================================================================

create index concurrently if not exists destination_landmarks_search_idx
  on destination_landmarks (city_id, search_key text_pattern_ops)
  where is_active;
