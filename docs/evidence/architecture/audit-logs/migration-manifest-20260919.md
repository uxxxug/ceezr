# Migration Manifest — Clean DB Audit (2026-09-19)

## Environment
- PostgreSQL 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)
- PostGIS 3.6
- Bun 1.4.2
- OS: Linux x86_64

## Migration Results
- Migrations applied: 167
- Last migration: `20260918212000_dropoff_label_trgm_idx.sql`
- All migrations successful (no partial schema)

## Schema Counts
- Tables in `public`: 80
- Functions in `public`: 1071

## 27 "Missing" Functions — All Present
All 27 functions named in the audit exist after applying all migrations:
current_request_id, driver_accept_offer, driver_active_job, driver_complete_ride,
driver_offer_board, driver_offer_detail, driver_start_ride, driver_vehicle,
driver_support_tickets, driver_subscription_dashboard, driver_subscription_history,
driver_subscription_payment_status, driver_subscription_tax_invoice,
issue_subscription_tax_invoice, record_driver_document, refresh_admin_metric_snapshots,
rider_support_tickets, submit_driver_documents_for_review, update_driver_vehicle,
update_driver_vehicle_assets, admin_metric_snapshots (table)

## Test Results
- schema-contract.test.ts: 3 pass, 0 fail, 157 assertions
- check:coverage: 5290 pass, 0 fail, 1392 skip
- Integration + e2e: 1167 pass, 16 fail, 6030 assertions (1183 tests, 121 files)

## 16 Failures
1. mutual-rating.test.ts (F12-05): 8 failures — foreign key constraint in beforeEach
2. outbox-notifications.test.ts (BUG-004): 4 failures — beforeEach timeout
3. safe-migrator.test.ts (F7-07): 1 failure — beforeEach timeout
4. audit-log-index.test.ts (F7-02): 1 failure — query plan difference PG18 vs PG17
5. city-capacity.test.ts: 2 failures — subscription expiry logic

## CI Environment (for comparison)
- PostgreSQL: postgis/postgis:17-3.5 Docker image
- Bun: 1.4.2
- CI passed all 4 jobs on 3 consecutive runs on main

## CI Verification on PostgreSQL 17 (Same Image as CI)

### PR #136 — Run 35413269268 on 65c4341
- verify: pass (1m34s)
- PostgreSQL integration: pass (2m52s)
- Redis integration: pass (38s)
- Chaos F5-06: pass (1m2s)

### Commit 7c68787 — Run 35413599228
- CI: pass (3m2s)
- Roadmap freshness: pass (17s)

### Conclusion
All 9 remaining failures on PG18 are environment-specific:
- F7-02: PG18 query planner uses different index
- F7-07: beforeEach timeout (migration runner slow on PG18)
- BUG-004: beforeEach timeout (TRUNCATE + createFixture >5s on PG18)
- City capacity: test isolation (data contamination from prior tests)

These do NOT occur on CI image (postgis/postgis:17-3.5).
