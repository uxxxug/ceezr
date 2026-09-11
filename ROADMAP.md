# WASLA MOVE — Roadmap

**Repository:** `noor-seez/ceezr` (this repository is WASLA MOVE)
**Last updated:** 2026-09-11
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
