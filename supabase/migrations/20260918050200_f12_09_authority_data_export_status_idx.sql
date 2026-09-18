-- migration-phase: index
-- F12-09: فهرسُ الحالةِ والموعدِ لرصدِ انقضاءِ طلباتِ التزويدِ

create index concurrently if not exists authority_data_requests_status_idx
  on authority_data_requests (status, deadline_at);
