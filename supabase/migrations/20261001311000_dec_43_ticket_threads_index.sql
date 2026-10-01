-- migration-phase: index
-- ────────────────────────────────────────────────────────────────────────────
-- DEC-43 · فهرسُ رسائلِ التذاكرِ — طورُ الفهرسِ بلا معاملةٍ (CAP-007).
-- ────────────────────────────────────────────────────────────────────────────

create index concurrently if not exists ticket_messages_ticket_id_idx on ticket_messages (ticket_id, created_at);
