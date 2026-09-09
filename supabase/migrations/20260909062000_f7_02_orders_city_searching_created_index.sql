-- الغرض: F7-02 / CAP-005 — فهرسٌ جزئيٌّ للطلباتِ الباحثةِ مُرتَّبةً بزمنِ الإنشاءِ.
--   `orders_city_status_idx (city_id, status)` يُرشِّحُ ولا يُعطي `created_at`
--   مُرتَّباً، فحلقتا إعادةِ البثِّ ومسحِ غيرِ المُسنَدِ كانتا تفرِزانِ في كلِّ شوطٍ.
--   و«الباحثُ» حالةٌ عابرةٌ فالفهرسُ الجزئيُّ يبقى صغيراً.
-- الحالة: مُطبَّقةٌ بالمُطبِّقِ الآمنِ (F7-07) في طورِ `index` بلا معاملةٍ.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: dispatch-adapters · unmatched-adapters
-- ما لا تفعله: لا تُغيِّرُ مخطّطاً ولا بيانةً، ولا تحجبُ الكتابةَ (`concurrently`).
-- migration-phase: index

create index concurrently if not exists orders_city_searching_created_idx
  on orders (city_id, created_at)
  where status = 'searching';
