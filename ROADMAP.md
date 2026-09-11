# WASLA MOVE — Roadmap

**Repository:** `uxxxug/ceezr` (this repository is WASLA MOVE)
**Last updated:** 2026-09-11 (W-1 boundary audit)
**Last milestone:** `W-1` boundary audit landed as a machine-checked registry;
first real CI verdict read and its two failures root-caused (`OPS-011`)
(`scripts/lib/wasla-boundary-registry.ts` + `scripts/check-boundary-audit.ts`,
ADR-0080). Still no application code, no migration and no CORE traffic.

> **Correction (2026-09-11, additive — nothing below is deleted).** Earlier
> entries in this file record the canonical remotes under the `noor-seez`
> account. The live remotes are `uxxxug/ceezr` (this repository) and
> `uxxxug/wasla-core`; `noor-seez/ceezr` does not resolve. The consequence is
> recorded in "Done" below: the account-level Actions block is a property of
> the old account, so a real CI verdict is obtainable here. The original
> statements are kept in place as the record of what was believed when they
> were written.

## What this project is

WASLA MOVE is the field execution system of WASLA. It is a permanently
independent repository with its own code, data, tests, CI and releases.

```
MARKET creates the work.  MOVE executes the work.  CORE coordinates it.
```

| System | Repository | Role |
|---|---|---|
| WASLA CORE | `uxxxug/wasla-core` | shared operating layer and coordinator |
| WASLA MOVE | `uxxxug/ceezr` | this repository — field execution |
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
      **Superseded 2026-09-11 (see the correction at the top):** that block
      belongs to the `noor-seez` account. On `uxxxug/ceezr` both workflows are
      active and the repository had zero runs of any kind, so the `W-1` push is
      the first push here that can produce a verdict. The verdict actually read
      after the push is recorded in
      `docs/evidence/architecture/W-1-20260911.md` — not inferred from a local
      green run.
- [x] **Roadmap-freshness gate proven on a real CI run** (added 2026-09-11,
      additive — the unchecked line above is kept as the historical record and
      is not deleted). Run `34617842960` on `66d733d` concluded `success`: the
      `W-1` push touched `scripts/`, `docs/` and `package.json` and did update
      this file, so the gate passed. Verdict read per job from the API.
- [x] **`W-1` — Boundary audit.** Every table in `supabase/migrations`
      classified `KEEP` / `REFACTOR` / `MOVE_TO_CORE` / `RETIRE` with owner and
      rationale, plus a column-level layer for boundary breaches inside tables
      that stay. Source of truth is
      `scripts/lib/wasla-boundary-registry.ts`; `docs/wasla/boundary-audit.md`
      is generated from it; `scripts/check-boundary-audit.ts` fails CI if a
      table is unclassified, a registry entry is dead, a declared column does
      not exist, or the document diverges from the registry.
      Tally: `KEEP=14` · `REFACTOR=12` · `MOVE_TO_CORE=18` · `RETIRE=0` over 44
      tables. Decision: ADR-0080. Evidence:
      `docs/evidence/architecture/W-1-20260911.md`.
      **Classification is not permission to migrate:** zero rows moved, and
      "Migrated" below is still empty.

- [x] **`OPS-011` — Two stale integration assertions repaired** (test-side
      only; see `docs/ROADMAP-MASTER.md` §11-د). The first real CI run in this
      repository (`34617842924`) failed the real-database job on two assertions
      that predate the WASLA work and had never been executed here, because
      this repository had never run Actions and the integration suite
      self-skips without `TEST_DATABASE_URL`.
      (a) `tests/integration/driver-location-batch-persist.test.ts` case 9 sent
      `JSON.stringify(batch)` into a `::jsonb` slot; `postgres.js` serialises
      the value itself for a `jsonb` cast, so the payload was encoded twice and
      reached `persist_driver_location_batch` as a JSON *string* — the function
      correctly answered `BATCH_MUST_BE_ARRAY`, and the ADR-0076 fallback the
      case is named after was never exercised. A second, masked defect: the
      verdict field was spelled `quality` while the SQL reads `verdict`. Fixed
      with `sql.json(...)`, which is the same path the production adapter uses
      (`packages/infrastructure/geo/driver-location-batch-persistence.ts:73`).
      (b) `tests/integration/worker-service-separation.test.ts:238` asserted a
      free-form Arabic sentence that `F8-03` / ADR-0078 replaced with the
      structured log `{"event":"embedded_worker.disabled",...}`. The assertion
      now matches the dotted latin event code enforced by
      `scripts/check-structured-logging.ts` — stronger, not weaker; the
      governing `expect(beat).toBe(false)` is untouched.
      No function, migration, application file, gate, timeout or coverage floor
      was changed, and no test was skipped. Evidence:
      `docs/evidence/correctness/OPS-011-20260911.md`.
- [ ] **`real-redis` CI job cannot pass in this repository — environment
      blocker, not a code defect.** The job runs with `REQUIRE_REAL_REDIS=1`
      and `tests/support/real-redis.ts:52` refuses to proceed without a real
      Redis, which is exactly what `OPS-006` requires; the guard must not be
      weakened, silenced or reclassified as a skip. `UPSTASH_REDIS_REST_URL`
      and `UPSTASH_REDIS_REST_TOKEN` were configured on the old `noor-seez`
      repository and are absent from `uxxxug/ceezr`. Provisioning an Upstash
      account and setting repository secrets is outside the agent's authority.
      Set both secrets, re-run, then record the verdict.

Nothing else has been changed in this repository by the WASLA integration work.

## In progress

Nothing at this commit.

## Remaining, in dependency order

Item ids `W-1` … `W-9` are stable and are the ids used in commits, ADRs,
evidence files and the execution log in `docs/ROADMAP-MASTER.md` §25.

1. `W-1` — **done, see "Done" above.** Boundary audit: inventory every
   identity, session, role, payment, wallet, subscription, reputation and
   notification concern currently living in this repository, and mark each
   `KEEP` / `REFACTOR` / `MOVE_TO_CORE` / `RETIRE`.
2. `W-2` — Migration matrix per entity, published in `docs/migration/`.
3. `W-3` — Adopt the CORE identity contract: authenticate against CORE, stop
   treating a Telegram account as the user. Blocked by `B-2` and `B-3`.
4. `W-4` — Canonical Operational Job model, distinct from any legacy order
   table.
5. `W-5` — Consume `core.fulfillment.created`; produce `move.job.completed`
   through a transactional outbox with the canonical event envelope. Blocked by
   `DEP-CORE-001` (CORE exposes no network ingress for `move.job.*`).
6. `W-6` — Remove any direct commercial coupling with MARKET; all cross-system
   traffic goes through CORE APIs or events.
7. `W-7` — Hand payment, wallet, ledger and subscription concerns to CORE;
   keep only operational references. Blocked by `DEP-CORE-002` (dispatch reads
   subscription entitlement on the hot path).
8. `W-8` — Reconciliation and dry-run tooling for the job and identity
   migrations.
9. `W-9` — Cutover and rollback rehearsal. Blocked by `B-5`.

## Dependencies on CORE (recorded here, fixed by the CORE agent)

This repository never edits CORE or MARKET. Detail and rationale in
`docs/wasla/boundary-audit.md` §6.

| # | Dependency | Blocks |
|---|---|---|
| `DEP-CORE-001` | CORE has no network ingress for `move.job.accepted` / `move.job.rejected` / `move.job.completed`; they are consumed only on an in-process local bus | `W-5` |
| `DEP-CORE-002` | No cheap entitlement read for a hot path — dispatch checks driver subscription on every broadcast round | `W-7` |
| `DEP-CORE-003` | CORE geography reference emits no change event to refresh the `cities` projection in MOVE | `W-1` disposition execution, `W-2` |
| `DEP-CORE-004` | No Telegram channel adapter in CORE, while every operational surface in MOVE is on Telegram | `W-6` |

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
  which are legacy duplicates? **Partially answered by `W-1`:** `orders` is the
  operational job table (a Ride or a Delivery), not a commercial order, and no
  duplicate job table exists in the schema. Whether rows in it are live is
  still unknown (`B-1`).
- How much identity state in this repository is live versus residual?
- Which operational surfaces are actually in production use?

## Risks

| Risk | Severity | Note |
|---|---|---|
| Legacy order/ride/job tables overlapping the canonical model | high | Must be mapped before any write path changes |
| Identity duplicated between this repository and MARKET | high | No automatic merge is permitted |
| Silent behaviour change during refactor | medium | Existing tests must pass before and after each step |

## Tests that pass at this commit

The pre-existing suite is untouched. `W-1` added one unit test file,
`tests/unit/check-boundary-audit.test.ts` (10 tests), most of them negative:
they corrupt the input and require the gate to fail, because a gate whose red
path is never exercised proves nothing when it is green.

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
