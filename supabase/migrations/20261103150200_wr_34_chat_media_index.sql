-- migration-phase: index
-- ────────────────────────────────────────────────────────────────────────────
-- WR-34 · فهرسُ مكنسةِ مرفقاتِ المحادثة — `claim_order_chat_media_sweep` تقرأُ
-- بالحالةِ والعمر. طورُ الفهرسِ بلا معاملةٍ (CAP-007).
-- التراجع: `drop index concurrently if exists order_chat_attachments_status_created_idx;`
-- ────────────────────────────────────────────────────────────────────────────

create index concurrently if not exists order_chat_attachments_status_created_idx
  on order_chat_attachments (status, created_at);
