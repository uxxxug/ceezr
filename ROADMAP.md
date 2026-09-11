# WASLA MOVE — Roadmap

**Repository:** `noor-seez/ceezr` (this repository is WASLA MOVE)
**Last updated:** 2026-09-11 (consolidation cycle)
**Last milestone:** Roadmap and roadmap-freshness gate introduced and exercised. No application code has been changed yet by the WASLA integration work.

## What this project is

WASLA MOVE is the field execution system of WASLA. It is a permanently
independent repository with its own code, data, tests, CI and releases.

```
MARKET creates the work.  MOVE executes the work.  CORE coordinates it.
```

| System | Repository | Role |
|---|---|---|
| WASLA CORE | `noor-seez/wasla-core` | shared operating layer and coordinator |
| WASLA MOVE | `noor-seez/ceezr` | this repository — field execution |
| WASLA MARKET | `skyosv10-art/wasla` | commerce |

No monorepo, no merged repositories, no shared runtime package, no
cross-database access between the three.

## Ownership boundary

**MOVE owns:** drivers and driver profiles, capabilities, eligibility,
availability, vehicles and vehicle qualification, fleets and fleet operations,
Operational Jobs, Rides, delivery execution, dispatch, matching, offers,
assignment, tracking and route/execution state, Proof of Delivery, safety and
SOS, driver and rider operational surfaces, operational admin functions.

**MOVE does not own:** identity, sessions, principals, roles and permissions,
organizations and tenancy, payments, wallets, ledger, settlement,
subscriptions and entitlements, reputation scoring, notification delivery,
channel abstraction, audit of shared concerns, fulfillment coordination
(all CORE) — nor merchants, stores, products, catalog, inventory, commercial
orders or marketplace search (all MARKET).

**Canonical model:** a Ride is a kind of Operational Job. A Delivery is a kind
of Operational Job. An Operational Job is never a Commercial Order.

## Current state of this repository (observed, not assumed)

- Bun workspace; `apps/`: `gateway`, `workers`, `miniapp`, `admin`,
  `admin-dashboard`. `packages/`: `domain`, `application`, `infrastructure`,
  `shared`, `maps`, `tracking`, `agent-core`.
- Supabase/PostgreSQL migrations under `supabase/`.
- One CI workflow: `.github/workflows/ci.yml`.
- Layered modular monolith: domain / application / infrastructure.

## Done

- [x] Roadmap established at the repository root.
- [x] Roadmap-freshness gate (`scripts/check-roadmap.mjs` +
      `.github/workflows/roadmap.yml`): a push that changes implementation and
      does not update this file fails CI.
- [ ] Gate proven on a live CI run — **not proven here**: GitHub Actions is
      currently blocked on this account with "The job was not started because
      recent account payments have failed or your spending limit needs to be
      increased." Every workflow run in this repository, including runs from
      before this change, fails at job start for that reason. The gate is
      proven on the MARKET repository, where Actions does run (see below).

Nothing else has been changed in this repository by the WASLA integration work.

## In progress

Nothing at this commit.

## Remaining, in dependency order

1. Boundary audit: inventory every identity, session, role, payment, wallet,
   subscription, reputation and notification concern currently living in this
   repository, and mark each `KEEP` / `REFACTOR` / `MOVE_TO_CORE` / `RETIRE`.
2. Migration matrix per entity, published in `docs/migration/`.
3. Adopt the CORE identity contract: authenticate against CORE, stop treating
   a Telegram account as the user.
4. Canonical Operational Job model, distinct from any legacy order table.
5. Consume `core.fulfillment.created`; produce `move.job.completed` through a
   transactional outbox with the canonical event envelope.
6. Remove any direct commercial coupling with MARKET; all cross-system traffic
   goes through CORE APIs or events.
7. Hand payment, wallet, ledger and subscription concerns to CORE; keep only
   operational references.
8. Reconciliation and dry-run tooling for the job and identity migrations.
9. Cutover and rollback rehearsal.

## Status of items 4 and 5, recorded 2026-09-11 (additive; item text unchanged)

Branch `feat/w4-w5-operational-job-and-core-lifecycle`, from `main`@`30e024e`.
Governing decision: `docs/adr/0081-operational-job-and-core-event-boundary.md`.
Evidence: `docs/evidence/architecture/W-4-W-5-20260911.md`.

Delivered and measured:

- `operational_jobs`: canonical operational job, unique per `fulfillment_id`, with
  opaque CORE/MARKET references (no foreign key to `orders` or to any legacy
  table). Five states, five transitions, each transition a single database
  function that asserts its source state in the same `where`; seven check
  constraints that make a fabricated terminal state impossible.
- `core_event_inbox` keyed by `event_id` (redelivery returns `applied: false`),
  and `move_event_outbox` holding the ten envelope fields as columns with a
  unique `dedup_key` of `move.job.<type>:<fulfillment_id>`. Events are enqueued
  inside the state-change transaction, not after it.
- CORE contracts vendored verbatim from CORE@`511624b` into
  `docs/contracts/core/` with sha256 provenance, plus a new CI gate
  `check:core-contract-parity` that diffs the vendored schema against the
  emitted envelope, the state machine and both migrations.
- `move_event_outbox` is declared as a durable queue in the `F6-06` backpressure
  registry with all six limits homed in `packages/shared/config/move-event-outbox.ts`
  as code constants (the queue has no `city_id`, so per-city settings rows would
  mean reading a limit from an arbitrary city). The claim and abandon functions
  carry no default values; the adapter passes the declared constants.
- Each of the three partial indexes lives in its own `-- migration-phase: index`
  migration using `create index concurrently`, as `CAP-007` forbids both a
  blocking index and a concurrent index inside a transaction.
- Measured: 37 unit cases (128 expectations) and 33 integration cases on a real
  PostgreSQL 18.6, zero failures, covering all ten required behaviours
  (intake, accept, reject, complete, fail, cancel, no success before its
  precondition, no pending state after exit, idempotency on retry, envelope
  parity with CORE).

Not delivered, and why:

- No network transport to CORE. `MoveEventShipper` is a port with no production
  adapter, because `DEP-CORE-001` (no CORE ingress endpoint for `move.job.*`)
  is still open.
- The two migrations are **not** merge-ready: `scripts/check-migrations.ts`
  fails with three sovereign-rule-0.4 violations (`city_id`) for
  `operational_jobs`, `core_event_inbox` and `move_event_outbox`. The gate is
  correct and was not weakened, exempted, frozen or bypassed. See `DEP-CORE-006`
  below and ADR-0081 for the rejected alternatives.

Neither item 4 nor item 5 is claimed as complete.

## CI verdicts on branch `feat/w4-w5-operational-job-and-core-lifecycle` (additive)

Local green is not a verdict (governance `ح-8`). Each push below is followed by
the per-job conclusion actually read from the GitHub Actions API.

| Commit | `verify` | real PostgreSQL | real Redis | multi-instance chaos | Roadmap freshness |
| --- | --- | --- | --- | --- | --- |
| `b4a58f2` (run `34628804244`) | fail — `check-migrations` rule 0.4 (`DEP-CORE-006`) | fail — 4 cases | fail — `O-2` secrets absent | pass | pass |
| `def9a20` (run `34629792395`) | fail — same sovereign blocker | fail — 2 cases | fail — `O-2` | pass | fail — commit touched `supabase/` without a roadmap change |

Root causes found and fixed at their source, none by weakening a test:

- **This branch's own defect.** `create function` grants `execute` to `public` by
  default; the eleven new `security definer` functions were therefore executable
  by `anon` and `authenticated`, which
  `tests/integration/database-privilege-surface.test.ts` and `hostile-surface`
  correctly rejected. Both W-4/W-5 migrations now `revoke execute … from public,
  anon, authenticated` and `grant … to service_role`, as every earlier service
  function in this repository does. Fixed in `def9a20`.
- **`OPS-012` — an inverted witness in `worker-service-separation.test.ts`.** The
  test asserted the free-text line `«العامل المدمج غير مُفعَّل»`, which `F8-03`
  replaced with the event code `embedded_worker.disabled`; the phrase survives
  only as a source comment, so the assertion passed when the gateway *crashed*
  (Bun prints the source excerpt, comment included) and failed when the gateway
  started cleanly. It now asserts the emitted event code.
- **`OPS-013` — two real defects in `driver-location-batch-persist.test.ts`
  case 9.** (a) The payload was bound as `${JSON.stringify(batch)}::jsonb`, so
  postgres.js re-serialised the string once the parameter type was known and the
  function received a JSON string, answering `BATCH_MUST_BE_ARRAY`; it now uses
  `sql.json(...)` exactly as the production adapter does — a hazard already
  documented in `broadcast-adapters.ts` and `payment-adapters.ts`. (b) The payload
  named the field `quality`, while `jsonb_to_recordset` reads `verdict`, so the
  row was silently rejected (`applied: 0`) and the intended case (a payload
  missing only `observed_at_ms`) was never actually measured. Both fixed; the
  case now passes on a real database for the first time.

## Cross-repository dependencies on CORE, recorded 2026-09-11

Recorded here only. No change is made to CORE or MARKET from this repository.

| # | What is missing in CORE | What it blocks here |
|---|---|---|
| DEP-CORE-001 | No network ingress that accepts `move.job.*` events | Outbox delivery for item 5; shipper has no production adapter |
| DEP-CORE-002 | No cheap entitlement read | Item 7 (payment/wallet/subscription handover) |
| DEP-CORE-003 | No city/geography change event | Item 1 execution and item 2 |
| DEP-CORE-004 | No Telegram channel adapter | Item 6 |
| DEP-CORE-005 | No mutual repository access, so vendored contract freshness cannot be verified automatically | Contract parity stays a manually compared sha256 fingerprint |
| DEP-CORE-006 | `core.fulfillment.created` carries no city or geography, and `organization_id` / `order_reference` are opaque here | Landing the item 4 and 5 schema under sovereign rule 0.4; also driver assignment later, since drivers are city-bound |

## Owner decisions required, recorded 2026-09-11

| # | Decision | Why it cannot be taken by an executor here |
|---|---|---|
| O-1 | Either CORE adds city/geography to `core.fulfillment.created` (`DEP-CORE-006`), or a new governing appendix extends the closed `domain-ingress receipt` class to cover `core_event_inbox` and `move_event_outbox` and rules on `operational_jobs` | The 2026-09-04 governing appendix states the class is closed and can only be extended by a new governing appendix from the owner — not by an ADR, a comment in a migration, or an exception in a guard |
| O-2 | Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` as repository secrets | The `real-redis` CI job asserts a real Redis (`OPS-006`) and must not be weakened, silenced or skip-classified; the previous secrets belonged to the former repository account |

## Migrated

Nothing.

## Retired

Nothing. No legacy component is switched off before its replacement is proven.

## Blockers

| # | Blocker | Impact | What unblocks it |
|---|---|---|---|
| B-1 | Production data inventory unknown (row counts, duplicate identities, live jobs) | No migration can be planned against real volumes | Read access to production, or an exported inventory |
| B-2 | Duplicate-identity merge policy undecided | Identity handover to CORE cannot complete | An owner decision on canonical selection and conflict rules |
| B-3 | No CORE database or environment provisioned | Integration against CORE cannot be executed end-to-end yet | Infrastructure decision and provisioning |
| B-4 | Regulatory pricing policy undecided | Operational pricing inputs cannot be finalised | A legal/regulatory decision |
| B-5 | No production release approval | No production deployment will be attempted | Explicit owner approval |

## Open questions

- Which existing tables here are the true source of truth for a job today, and
  which are legacy duplicates?
- How much identity state in this repository is live versus residual?
- Which operational surfaces are actually in production use?

## Risks

| Risk | Severity | Note |
|---|---|---|
| Legacy order/ride/job tables overlapping the canonical model | high | Must be mapped before any write path changes |
| Identity duplicated between this repository and MARKET | high | No automatic merge is permitted |
| Silent behaviour change during refactor | medium | Existing tests must pass before and after each step |

## Tests that pass at this commit

Unchanged from before this commit — the existing suite is untouched. The WASLA
integration work has added no test here yet.

## Not proven yet

- Integration with CORE (not attempted).
- Any data migration.
- Any cutover or rollback.

## Cross-repository status (recorded 2026-09-11)

- WASLA CORE canonical repository: `noor-seez/wasla-core` — permanently
  independent. It is not merged here, not vendored here, and not a shared
  package. CORE published its Money (double-entry ledger, wallets,
  authorization/capture) and Fulfillment coordination cycle at commit
  `f0eccc4bf2`, verified locally: typecheck clean, 37/37 tests, governance,
  contract and migration gates passing.
- No cross-repository integration has started. This repository still emits and
  consumes nothing from CORE.
- Nothing in this repository is left uncommitted by the WASLA work: every
  change made here is published on `main`.
- GitHub Actions on the `noor-seez` account is blocked at account level
  (billing/spending limit): workflow jobs are created but start zero steps, so
  CI results for this repository cannot be produced until billing is resolved.
