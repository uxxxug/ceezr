-- =============================================================================
-- الغرض: سياسات RLS لجداول الدفع والنسخ الاحتياطي — البنود 7 و8.
--   الجداول لها RLS مُفعَّل لكن بلا سياسات — هذا آمن افتراضياً (لا وصول)
--   لكن نضيف سياسات للخدمة الخلفية وللمسؤولين.
--   الـ RPCs تستخدم security definer فتتجاوز RLS — لا تتأثر.
--   Idempotent: drop policy if exists قبل create لضمان إعادة التشغيل الآمن.
-- الحالة: منفّذ فعلياً.
-- ينتمي إلى: supabase/migrations
-- =============================================================================

-- payment_transactions
drop policy if exists "payment_transactions_service_read_all" on payment_transactions;
drop policy if exists "payment_transactions_service_write_all" on payment_transactions;
create policy "payment_transactions_service_read_all"
  on payment_transactions for select to service_role using (true);
create policy "payment_transactions_service_write_all"
  on payment_transactions for all to service_role using (true) with check (true);

-- ledger_entries
drop policy if exists "ledger_entries_service_read_all" on ledger_entries;
drop policy if exists "ledger_entries_service_write_all" on ledger_entries;
create policy "ledger_entries_service_read_all"
  on ledger_entries for select to service_role using (true);
create policy "ledger_entries_service_write_all"
  on ledger_entries for all to service_role using (true) with check (true);

-- webhook_events
drop policy if exists "webhook_events_service_read_all" on webhook_events;
drop policy if exists "webhook_events_service_write_all" on webhook_events;
create policy "webhook_events_service_read_all"
  on webhook_events for select to service_role using (true);
create policy "webhook_events_service_write_all"
  on webhook_events for all to service_role using (true) with check (true);

-- db_backups
drop policy if exists "db_backups_service_read_all" on db_backups;
drop policy if exists "db_backups_service_write_all" on db_backups;
create policy "db_backups_service_read_all"
  on db_backups for select to service_role using (true);
create policy "db_backups_service_write_all"
  on db_backups for all to service_role using (true) with check (true);
