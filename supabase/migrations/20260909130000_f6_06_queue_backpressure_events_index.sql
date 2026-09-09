-- migration-phase: index
-- F6-06 / CAP-007: فهرسٌ متزامنٌ لأثرِ ضغطِ الطابورِ.
-- فُصلَ عن هجرةِ التوسيعِ لأنَّ CREATE INDEX CONCURRENTLY لا يُنفَّذُ داخلَ معاملةٍ.

create index concurrently if not exists queue_backpressure_events_recent_idx
  on queue_backpressure_events (city_id, queue, minute_bucket desc);
