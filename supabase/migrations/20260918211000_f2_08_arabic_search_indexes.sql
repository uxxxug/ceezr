-- migration-phase: index
-- الغرض: فهارسُ `gin_trgm_ops` المُعبِّرةُ عن `normalize_search_text(pickup_label)`
--   و`normalize_search_text(dropoff_label)` — البند `F2-08` (ADR 0108).
--
-- ## لماذا التعبيريُّ لا العمودُ المُولَّدُ
--
-- العمودُ المُولَّدُ عمودٌ جديدٌ يُغيِّرُ مخطَّطَ `orders`، وفهرسُ `gin` على
-- تعبيرٍ ثابتٍ يُعطي المُرادَ دونَ تغييرِ المخطَّط. و`normalize_search_text`
-- `immutable` — شرطُ الفهرسِ التعبيريِّ، فلا حاجةَ إلى عمودٍ مُولَّدٍ.
--
-- ## `concurrently` وحدَه
--
-- `create index concurrently` لا تُقبَلُ داخلَ معاملةٍ، فالملفُّ وحدَه.

create index concurrently if not exists orders_pickup_label_trgm_idx
  on orders using gin (normalize_search_text(pickup_label) gin_trgm_ops);

create index concurrently if not exists orders_dropoff_label_trgm_idx
  on orders using gin (normalize_search_text(dropoff_label) gin_trgm_ops);
