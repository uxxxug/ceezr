-- migration-phase: index
-- الغرض: فهرسُ `gin_trgm_ops` المُعبِّرُ عن `normalize_search_text(dropoff_label)` — البند `F2-08` (ADR 0108).

create index concurrently if not exists orders_dropoff_label_trgm_idx
  on orders using gin (normalize_search_text(dropoff_label) gin_trgm_ops);
