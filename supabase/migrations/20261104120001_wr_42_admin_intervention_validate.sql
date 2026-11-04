-- migration-phase: expand
-- ============================================================================
-- `WR-42` — توثيقُ قيدِ `notification_outbox_kind_check` بعدَ توسيعِهِ بـ
-- `admin_order_intervention` في `20261104120000`. القيدُ مجموعةٌ فائقةٌ
-- للسابقِ (نمطُ `WR-13`: `not valid` في ملفِّ التوسيعِ، والتثبيتُ ههنا).
-- ============================================================================

alter table notification_outbox validate constraint notification_outbox_kind_check;
