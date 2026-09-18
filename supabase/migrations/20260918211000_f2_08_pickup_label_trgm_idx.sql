-- migration-phase: index
-- الغرض: فهرسُ `gin_trgm_ops` المُعبِّرُ عن `normalize_search_text(pickup_label)` — البند `F2-08` (ADR 0108).

create index concurrently if not exists orders_pickup_label_trgm_idx
  on orders using gin (normalize_search_text(pickup_label) gin_trgm_ops);
