-- migration-phase: index
-- F12-09: فهرسُ المدينةِ والتاريخِ لطلبِ تزويدِ الهيئةِ

create index concurrently if not exists authority_data_requests_city_idx
  on authority_data_requests (city_id, created_at desc);
