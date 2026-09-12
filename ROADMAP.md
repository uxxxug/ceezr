# WASLA MOVE — Roadmap

**Repository:** `uxxxug/ceezr` (this repository is WASLA MOVE)
**Last updated:** 2026-09-11 (W-1 boundary audit · OPS-011 CI repair)
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
      **CI verdict, read per job from the API after the push** (`d550b93`, runs
      `34621144803` / `34621149899` / `34621144580`): the real-database job is
      now `success` with **638 pass / 11 skip / 0 fail** across 84 files, up
      from 636/11/2 — two more passes because the two failures became passes,
      not because a test was added. The e2e step, which never ran in the
      previous run because the job aborted before it, ran and passed (8 pass /
      0 fail), and both no-silent-skip gates exited `0`. `verify`,
      `chaos-multi-instance` and the roadmap-freshness workflow are `success`.
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

### Reservation `W-8` (second increment) — unforgeable CORE attestation and one readable blocker registry (opened 2026-09-12, before any file was edited)

Recorded **before** the first edit, per the reservation rule in
`docs/ROADMAP-MASTER.md` §25.

| Field | Value |
|---|---|
| Item | `W-8` — reconciliation and dry-run tooling for the job and identity migrations (second increment: close a hole the first increment left in its own refusal mechanism) |
| Branch | `feat/w8-attestation-and-blocker-registry`, cut from `main`@`bf4687e` |
| Measured hole | `deriveReconciliation` returns `RECONCILED` whenever a caller hands it a `CoreSide`. `CoreAttestation` is a **plain interface of three strings**, so any caller — a script, a test, a future adapter — can hand-write `{ readVia, closedDependency, measuredAt }` and obtain a green reconciliation while `DEP-CORE-007` is still open. Guard check ٦ only forbids the `RECONCILED` **literal** in production code; it cannot see a value derived at run time. So today the refusal rests on nobody trying, which is not a mechanism. Second measured hole: blocker identifiers (`DEP-CORE-001`…`007`, `O-1`, `O-2`, `B-1`…`B-5`) appear as bare string literals across at least 11 TypeScript files with no single readable source, so a typo, a silently renamed blocker, or a locally invented id reads as governance. |
| Scope reserved | `scripts/lib/wasla-blockers.ts` (new — the single machine-readable blocker registry) · `scripts/lib/wasla-migration-dry-run.ts` (attestation becomes issuable only through one factory that reads the registry) · `scripts/check-blocker-registry.ts` (new guard) · `scripts/check-migration-dry-run.ts` (added checks only; **no existing check weakened**) · `docs/wasla/blockers.md` (new, generated) · `tests/unit/wasla-blockers.test.ts` (new) · `tests/unit/check-blocker-registry.test.ts` (new) · `tests/unit/check-migration-dry-run.test.ts` (added cases only) · `package.json` (`ci` chain) · `.github/workflows/ci.yml` (`verify`, one step **before** the red `city_id` step) · `docs/adr/0087-*` (new) · `ROADMAP.md` · `docs/SYSTEM_STATE.md` · `docs/ROADMAP-MASTER.md` §25 · `docs/evidence/architecture/W-8-attestation-20260912.md` (new) |
| Scope **not** reserved and not touched | `scripts/migrate.ts` (ADR-0068) · every migration file · `scripts/lib/wasla-migration-matrix.ts` (read-only single source) · `ADR 0085` and `ADR 0084` (`ح-6`: published, never edited) · the `city_id` guard and rule 0.4 · the real-Redis test and Upstash secrets · `MASTER_DIRECTIVE` · every payment rule · any file in CORE or MARKET |
| Dependencies checked before opening | `DEP-CORE-007` (no shared CORE environment) is precisely what makes the hole reachable and stays **open**; this branch does not close it, it makes a green reconciliation **impossible to construct** while it is open. `B-1`/`B-2`/`B-3` block running any wave and are untouched. `O-1` and `O-2` are unrelated to this scope and are left red as recorded. |
| Conflicting work checked | no open pull request (checked 2026-09-12). No branch among the 38 `origin/*` refs carries `wasla-blockers`, `check-blocker-registry`, or `issueCoreAttestation`; the only files mentioning `CoreAttestation` are this item's own first-increment artifacts. |
| Claim ceiling | this item may **not** be marked `[x]`, and this increment does not raise the ceiling: `DEP-CORE-007` still leaves MOVE with no CORE side to reconcile, so **no reconciliation is completed** — the improvement is that a false green stops being possible rather than merely unattempted. `ح-4` still requires a read CI verdict while rule 0.4 keeps `verify` red for `O-1`, and `ح-5` still bars any production-proof claim. |

### Outcome `W-8` (second increment) — recorded 2026-09-12

Evidence: `docs/evidence/architecture/W-8-attestation-20260912.md` · decision:
`docs/adr/0087-blocker-registry-and-unforgeable-attestation.md`.

- **What changed.** `CoreAttestation` now carries a module-private `unique
  symbol` brand, so no file other than `scripts/lib/wasla-migration-dry-run.ts`
  can name the field. `issueCoreAttestation` is the only producer and refuses an
  **open** dependency, an **unknown** id, and a placeholder or blank
  `readVia`/`measuredAt`. `deriveReconciliation` re-checks the brand at run time,
  so a forged attestation yields `UNVERIFIABLE` — not `RECONCILED`, and not
  `DIVERGED` either, because claiming divergence is also claiming knowledge.
- **The hole was measured, not inferred.** This item's own test used to
  hand-write an attestation naming `DEP-CORE-007` — which is **open** — and
  obtained `RECONCILED`. `tsc` then failed on three existing lines the moment
  the brand was added; that failure is the proof.
- **One readable source.** `scripts/lib/wasla-blockers.ts` parses the three
  tables in this file into 16 blockers (15 open). It stores no state, so there
  is no second source of truth (rule 0.6), and `blockerStatus` **throws** on an
  unknown id instead of answering "closed".
- **New guard** `scripts/check-blocker-registry.ts`, 8 checks, wired into the
  `ci` chain and into `verify` **before** the red `city_id` step.
- **Deviation from the reservation, recorded.**
  `scripts/check-migration-dry-run.ts` was reserved but **not modified**: all
  new checks live in a separate guard so a CI read can tell which guard failed.
  The touched scope is narrower than the reserved scope. No existing check was
  weakened.
- **Not claimed.** No reconciliation happened, no CORE read happened,
  `DEP-CORE-007` stays open, `O-1` and `O-2` stay red and untouched, and `W-8`
  is **not** marked `[x]` (`ح-1`, `ح-4`).

### CI verdict for `W-8` (second increment) — read 2026-09-12 at `acf3027`

Read per job **and per step**, from the API, for three runs on the same sha —
not assumed (`ح-8`). Full record:
`docs/evidence/architecture/W-8-attestation-20260912.md` §حكمُ CI.

- `Roadmap freshness` (`34674941364`) **success**. `CI` on `push`
  (`34674941330`) and on `pull_request` #9 (`34674965765`) both **failure**,
  with identical job results: `تكامل على PostgreSQL حقيقي` success ·
  `فوضى متعدد المثيلات (F5-06)` success · `verify` failure ·
  `تكامل على Redis حقيقي` failure.
- In `verify`: Lint, Typecheck and Test all **success**; the three existing
  guards (`W-2`, egress, dry-run) **success**; and step 18, the **new blocker
  registry guard, `success`** — it actually ran and returned a verdict rather
  than reading `skipped`. Step 19, the `city_id` gate, is **failure** (`O-1`,
  rule 0.4, root cause in CORE) and steps 20–54 are `skipped` behind it, which
  is exactly why step 18 was placed **before** it.
- Redis job fails at step 8 (`O-2`, missing Upstash secrets). No test was
  changed and no secret was added.
- Therefore: `منفّذ · مختبَر · متحقَّق منه` for the guard and the issuer only.
  **Not** `مُثبَت`, and `W-8` is still **not** `[x]` — `verify` stays red for
  `O-1`, `DEP-CORE-007` stays open, and `ح-5` bars any production claim.

### Reservation `W-6` (second increment) — runtime egress gate (opened 2026-09-12, before any file was edited)

Recorded **before** the first edit, per the reservation rule in
`docs/ROADMAP-MASTER.md` §25. This is a **second increment on the same item**,
not a new item, and it closes a limit the first increment declared about itself.

| Field | Value |
|---|---|
| Item | `W-6` — remove any direct commercial coupling with MARKET; all cross-system traffic goes through CORE APIs or events |
| Branch | `feat/w6-runtime-egress-gate`, cut from `main`@`227cb4d` |
| What this increment closes | the first increment recorded, in its own "not claimed" section: **"No runtime egress blocking exists. The guard fails at build time."** A build-time guard reads the code; it does not stand between the process and the network. So a call built at runtime, or a client pointed at a host other than the one it declares, passes the build and still leaves the machine. |
| Scope reserved | `packages/shared/wasla/egress-registry.ts` (**moved** from `scripts/lib/wasla-egress-registry.ts`, so build-time guard and runtime gate read **one** source) · `packages/infrastructure/egress/egress-gate.ts` (new, the runtime gate) · `scripts/check-egress-boundary.ts` (new checks; no existing check weakened) · the four server-side call sites that reach the network (`packages/infrastructure/wasla/core-event-shipper.ts` · `packages/infrastructure/backup/google-drive-adapter.ts` · `packages/infrastructure/financial/moyasar-provider.ts` · `packages/infrastructure/financial/tap-provider.ts`) · `tests/unit/egress-gate.test.ts` (new) · `tests/unit/check-egress-boundary.test.ts` · `docs/wasla/egress-boundary.md` (regenerated, never hand-edited) · `docs/adr/0086-*` (new) · `ROADMAP.md` · `docs/SYSTEM_STATE.md` · `docs/ROADMAP-MASTER.md` §25 · `docs/evidence/architecture/W-6-runtime-20260912.md` (new) |
| Scope **not** reserved and not touched | `docs/adr/0084-*` (published — `ح-6`) · the `city_id` gate and rule 0.4 · the real-Redis job and `tests/support/real-redis.ts` · `MASTER_DIRECTIVE` · every payment **business** rule (only the transport line changes) · the browser-side `fetch` in the miniapp, the tracking page and the admin layout (they run in the user's browser, not in this process) · any file in CORE or MARKET |
| Dependencies checked before opening | `DEP-CORE-004` still blocks the **channel-handover** half and is untouched by this increment. `DEP-CORE-002` still owns the two payment providers (`W-7`); this increment does not remove them, it puts them behind the gate and leaves their declared debt exactly as it is. `O-1` and `O-2` are unrelated to this scope and are **not** worked around: `verify` stays red at the `city_id` step and the Redis job stays red for missing secrets. |
| Conflicting work checked | zero open pull requests at `227cb4d`, and no local or remote ref carries an `infrastructure/egress` or `egress-gate` path (scanned every `refs/remotes/origin/*` ref on 2026-09-12) |
| Claim ceiling | this item still may **not** be marked `[x]`. `DEP-CORE-004` leaves the channel half open, and `ح-4` needs a read CI verdict while rule 0.4 keeps `verify` red. What this increment may claim, and no more: **an outbound call from this process is denied at runtime unless it is declared, and it is bound to the destination that declares it.** The gate cannot know MARKET's domain (`DEP-CORE-005`) — it enforces declaration, not domain identity, exactly as `ADR 0084` does. |

### `W-6` second increment — measured outcome (recorded 2026-09-12, local only until CI rules)

Additive record. It corrects the reservation above **by addition**, not by rewriting it (`ح-8`).

| Field | Value |
|---|---|
| Decision | `ADR 0086` — runtime egress gate; complements `ADR 0084`, revokes nothing |
| Where the gate landed | `packages/shared/wasla/egress-gate.ts` — **not** `packages/infrastructure/egress/` as reserved. Measured reason: one caller is `packages/maps`, which may not import from `infrastructure` (guarded layer boundary), so the reserved location forced a choice between breaking a boundary and leaving a destination outside the gate. It moved to `shared` — the lowest layer everyone imports, and where the registry itself now lives. |
| Call sites wired | **nine files** for **eleven** gated destinations, not the four named in the reservation. The reservation listed only the bare-`fetch` sites; measuring the whole registry showed six more destinations reaching the network through an injected or library transport (telegram, metrics, three translation providers, OSRM, Upstash). Leaving them out would have made the gate optional. |
| Registry call sites corrected | `telegram-bot-api` → `telegram-client.ts` (where grammY's transport is built) and `upstash-redis-rest` → `packages/infrastructure/redis/upstash.ts` (the gateway file is a re-export). Recorded, not silently changed. |
| Static guard | checks ١١ (stale scan exemption), ١٢ (no bare `fetch` in server code outside the gate; three browser sites declared with reasons, each required to exist **and** actually contain a `fetch`), ١٣ (every `gated` destination's call site must import the gate and name its own id). No check ١..١٠ was weakened, silenced or removed. |
| Startup guard | `assertEgressEnvironment(process.env)` in `apps/gateway/src/index.ts`, after config load and **before** container build; the ordering is asserted by a test, not described in prose. |
| Local measurement (not a verdict — `ح-8`) | `bun test` 3035 pass · 829 skip · 0 fail · 10666 `expect()` · 3864 tests · 288 files (`main` measured 3008 pass; **+27** new cases: 17 gate, 10 guard) · `biome check .` 1114 files, no fixes · typecheck clean · `check:egress-boundary`, `check:migration-matrix`, `check:migration-dry-run`, `check-skip-classification`, `check-adr-numbering` all pass |
| Still not claimable | `[x]` on `W-6` (channel half blocked by `DEP-CORE-004`; `ح-4` needs a CI verdict and rule 0.4 keeps `verify` red) · any network-layer enforcement (needs a proxy/firewall the repository does not own — `B-1`/`B-5`) · that a configured host really is CORE (`DEP-CORE-005`) |
| Untouched, deliberately | `ADR 0084` · the `city_id` gate and rule 0.4 · the real-Redis job and its test · `MASTER_DIRECTIVE` · every payment business rule · `O-1` and `O-2`, which stay open and are not worked around; no secret was added to the repository |

### `W-6` second increment — CI verdict, read per job and per step (recorded 2026-09-12)

Branch `feat/w6-runtime-egress-gate`@`9669dbf`, PR [#8](https://github.com/uxxxug/ceezr/pull/8),
runs `34673628192` (push) and `34673661270` (pull request), Roadmap freshness `34673628196` `success`.

| Job | Conclusion (identical in both runs) |
|---|---|
| PostgreSQL integration | **success** |
| multi-instance chaos (F5-06) | **success** |
| `verify` | **failure** — at step 18 only |
| real-Redis integration | **failure** — step 8 (`O-2`) |

In `verify`: Lint, Typecheck and Test **success** (the 27 new cases run inside Test) ·
step 15 (`W-2` guard) **success** · **step 16 — the egress boundary guard, which runs
the new checks ١١/١٢/١٣ — success** · step 17 (`W-8` guard) **success** ·
step 18 (`city_id`) **failure** · steps 19–54 **skipped**.

The two reds are the same owner blockers already red on `main`@`227cb4d`, at the same job
and the same step: `O-1` (`DEP-CORE-006`, rule 0.4, root cause in CORE) and `O-2` (Upstash
secrets). **This increment added no red, weakened no gate, silenced no step and classified
none as skipped.** The run is not claimed green, and no item is marked `[x]` (`ح-4`).

### Reservation `W-6` — egress boundary (opened 2026-09-12, before any file was edited)

Recorded **before** the first edit, per the reservation rule in
`docs/ROADMAP-MASTER.md` §25.

| Field | Value |
|---|---|
| Item | `W-6` — remove any direct commercial coupling with MARKET; all cross-system traffic goes through CORE APIs or events |
| Branch | `feat/w6-egress-boundary`, cut from `main`@`0c25ca0` |
| Scope reserved | `scripts/lib/wasla-egress-registry.ts` (new) · `scripts/check-egress-boundary.ts` (new) · `docs/wasla/egress-boundary.md` (new, generated) · `tests/unit/check-egress-boundary.test.ts` (new) · `package.json` (`ci` chain) · `.github/workflows/ci.yml` (`verify` job, one added step) · `docs/adr/0084-*` (new) · `ROADMAP.md` · `docs/SYSTEM_STATE.md` · `docs/ROADMAP-MASTER.md` §25 · `docs/evidence/architecture/W-6-20260912.md` (new) |
| Scope **not** reserved and not touched | every payment provider adapter, the Telegram wrapper layer, the CORE shipper, every existing guard, every migration, and any file in CORE or MARKET |
| Dependencies checked before opening | `DEP-CORE-004` (no Telegram channel adapter in CORE) blocks the **channel-handover** half of this item and cannot be closed from this repository. `DEP-CORE-002` blocks removing the two payment providers, which is item `W-7`'s scope, not this one. Neither blocks declaring the egress surface and gating it, which is what this branch does. `O-1` and `O-2` are unrelated to this scope. |
| Conflicting work checked | no open pull request, and no branch on `origin` carries a `check-egress-boundary` guard or a `docs/wasla/egress-boundary.md` path (checked against every `origin/*` ref on 2026-09-12; the only match for the string was `packages/agent-core/evaluation/regressionChecks.ts`, an unrelated false positive) |
| Claim ceiling | this item may **not** be marked `[x]`. Two reasons, both recorded before any code was written: `DEP-CORE-004` leaves the channel half open, and `ح-4` requires a read CI verdict while rule 0.4 keeps `verify` red for `O-1`. What this branch may claim is narrower than the item: the egress surface becomes **declared and gated**, so a direct MOVE↔MARKET destination fails the build instead of being merely absent today. |

### Reservation `W-8` — dry-run and reconciliation tooling (opened 2026-09-12, before any file was edited)

Recorded **before** the first edit, per the reservation rule in
`docs/ROADMAP-MASTER.md` §25.

| Field | Value |
|---|---|
| Item | `W-8` — reconciliation and dry-run tooling for the job and identity migrations |
| Branch | `feat/w8-migration-dry-run-and-reconcile`, cut from `main`@`0c25ca0` |
| Scope reserved | `scripts/lib/wasla-migration-dry-run.ts` (new) · `scripts/check-migration-dry-run.ts` (new) · `scripts/wasla-migration-dry-run.ts` (new, the runnable tool) · `docs/migration/dry-run-and-reconciliation.md` (new, generated) · `tests/unit/check-migration-dry-run.test.ts` (new) · `tests/integration/migration-dry-run-read-only.test.ts` (new) · `package.json` (`ci` chain) · `.github/workflows/ci.yml` (`verify` job, one added step) · `docs/adr/0085-*` (new) · `ROADMAP.md` · `docs/SYSTEM_STATE.md` · `docs/ROADMAP-MASTER.md` §25 · `docs/evidence/architecture/W-8-20260912.md` (new) |
| Scope **not** reserved and not touched | `scripts/migrate.ts` (the single lawful applier, ADR-0068) · every migration file · `scripts/lib/wasla-migration-matrix.ts` and `scripts/lib/wasla-boundary-registry.ts` (read-only inputs, single sources of truth) · every existing guard · any file in CORE or MARKET |
| Dependencies checked before opening | `B-1` (production inventory unknown), `B-2` (identity-merge policy), `B-3` (no CORE environment) and `DEP-CORE-007` (no shared CORE environment) all block **running** a wave against real systems. None of them blocks building the tooling and proving its safety invariant, which is what this branch does. What they do block is any claim of a completed reconciliation — and that is enforced, not merely noted. |
| Conflicting work checked | no branch on `origin` (34 refs) carries a dry-run or reconciliation path, and the only pre-existing `reconcile*` files are unrelated domain use cases (`packages/application/financial/reconcile-pending-payments.ts`, `packages/application/subscription/*`, `packages/application/enterprise-integration/reconcile-integration-state.ts`). The one open pull request is [#4](https://github.com/uxxxug/ceezr/pull/4) (`W-6`), which touches no file in this scope. |
| Claim ceiling | this item may **not** be marked `[x]`. The tooling can be built and its safety invariant measured on a real PostgreSQL, but **no reconciliation can be completed** while `DEP-CORE-007` leaves MOVE with no real CORE source to reconcile against, and `ح-4` requires a read CI verdict while rule 0.4 keeps `verify` red for `O-1`. What this branch may claim: a dry-run that **provably cannot write**, and a reconciler that **provably cannot report a false green**. |

### Reservation `W-2` — migration matrix (opened 2026-09-12, before any file was edited; artifacts landed, see the `W-2` status section below)

Recorded **before** the first edit so that no second executor opens the same
scope, per the reservation rule in `docs/ROADMAP-MASTER.md` §25.

| Field | Value |
|---|---|
| Item | `W-2` — migration matrix per entity, published in `docs/migration/` |
| Branch | `feat/w2-migration-matrix`, cut from `main`@`8d031c2` |
| Scope reserved | `scripts/lib/wasla-migration-matrix.ts` (new) · `scripts/check-migration-matrix.ts` (new) · `docs/migration/matrix.md` (new, generated) · `tests/unit/check-migration-matrix.test.ts` (new) · `package.json` (`ci` chain) · `.github/workflows/ci.yml` (`verify` job, one added step) · `docs/adr/0083-*` (new) · `ROADMAP.md` · `docs/SYSTEM_STATE.md` · `docs/ROADMAP-MASTER.md` §25 · `docs/evidence/architecture/W-2-20260912.md` (new) |
| Scope **not** reserved and not touched | every existing migration, every existing guard, `scripts/check-migrations.ts`, `scripts/lib/wasla-boundary-registry.ts`, the `real-redis` job, and any file in CORE or MARKET |
| Dependencies checked before opening | `W-1` is done and its registry is the single source of truth this item reads. `B-1` (production inventory unknown) and `DEP-CORE-003` (no CORE geography change event) block **execution** of any wave in the matrix, not the authoring of the matrix itself — so the plan is deliverable and no wave may be marked executed. `O-1` and `O-2` are unrelated to this scope. |
| Conflicting work checked | no open pull request, and no branch on `origin` carries a `docs/migration/` path or a `check-migration-matrix` guard (checked against every `origin/*` ref on 2026-09-12) |
| Claim ceiling | this item may **not** be marked `[x]`: `ح-4` requires a read CI verdict, and rule 0.4 keeps `verify` red for `O-1`, so the matrix lands as a plan with its own gate and nothing is claimed executed. "Migrated" stays empty. |

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

## Status of item 5 transport, recorded 2026-09-12 (additive; item text unchanged)

Governing decision: `docs/adr/0082-core-event-transport-both-directions.md`.
Evidence: `docs/evidence/architecture/W-5-TRANSPORT-20260912.md`.

`DEP-CORE-001` is **closed**: CORE now exposes a network ingress that accepts
`move.job.*` (CORE `d2c38e3`, read at CORE@`1231817757446560a0ecd061bd9c4f3a2a1c9fe4`).
The transport contract was vendored verbatim into `docs/contracts/core/transport/`
with sha256 provenance, and both directions are now implemented and measured:

- Outbound: `packages/infrastructure/wasla/core-event-shipper.ts` posts the
  envelope to `POST {CORE_EVENTS_BASE_URL}/v1/events` with a bearer token and an
  `AbortController` timeout. Status classification lives in one place
  (`classifyCoreSubmitStatus`) and `check:core-contract-parity` now parses CORE's
  own retry table out of the vendored document and compares every row against
  that function, so a change on CORE's side breaks our gate instead of producing
  retries that can never succeed.
- Permanent failures die on attempt 1. New migration
  `20260912000000_w5_permanent_delivery_failure.sql` replaces
  `abandon_move_event_delivery` with a five-argument version taking
  `p_permanent boolean default false`; the verdict is enforced in the database,
  not in code that can crash between reading the response and writing the row.
  Declared in `scripts/lib/rollback-registry.ts` (`code-only`, does not break the
  previous release: a four-argument call resolves to the default `false`).
- Inbound: `apps/gateway/src/routes/core-event-intake.ts` serves
  `/webhook/core-events`. It bounds the body, computes HMAC-SHA256 over the exact
  received bytes and compares with `timingSafeEqual` **before** parsing, and maps
  every outcome onto the status class CORE reads as retry or as death. A missing
  or too-short secret returns `503` and never weakens verification; in
  `apps/gateway/src/index.ts` the route is not mounted at all without the secret,
  so absence reads as `404` rather than as a false accept.
- Idempotency stays in the database only (`core_event_inbox` keyed by `event_id`).
  No in-process dedup cache, which would be a second source of truth that fails
  on the first second instance or restart.
- Draining is a bounded worker job: `shipDueMoveEvents` plus `ship-move-events`
  every 15 s, registered only when `CORE_EVENTS_BASE_URL` and
  `CORE_EVENTS_BEARER_TOKEN` are present, with the absence logged once.

A false piece of evidence was found and fixed at its source: `biome` had
reformatted two schemas that `PROVENANCE.md` claims are byte-for-byte copies, so
two recorded sha256 fingerprints were wrong while the claim stayed in the file.
The bytes were restored from CORE@`511624b`, `docs/contracts` is now excluded
from the formatter, and a new gate `check:vendored-contract-integrity` recomputes
every fingerprint on every run and fails on a changed byte, a vendored file with
no fingerprint, or a fingerprint with no file. The gate itself is measured
against planted breaches in `tests/unit/check-vendored-contract-integrity.test.ts`.

Measured locally: 2614 unit cases (0 fail), 7 new integration cases wiring the
real shipper and the real intake route to a real PostgreSQL 18.6 (0 fail), 35
lifecycle integration cases (0 fail). Local green is not a verdict (`ح-8`); see
the CI verdict table.

Still not claimed as complete. `check-migrations.ts` still fails with the three
sovereign-rule-0.4 violations (`DEP-CORE-006` / `O-1`), and no delivery to a real
CORE environment has been measured (`DEP-CORE-007`).

## Status of item `W-2`, recorded 2026-09-12 (additive; item text unchanged)

The item text above is untouched (`ح-1`). This section records what exists at
this commit and, just as importantly, what is **not** claimed.

### What was built

`W-2` asked for a migration matrix per entity, published in `docs/migration/`.
It was built as a **checked registry**, not a hand-written document — the same
shape as `W-1`, and for the same reason: a plan that lives only in a document
goes stale **without a single wrong line**, and a plan believed to be current is
more dangerous than a missing one.

| Artifact | Path |
|---|---|
| Registry (single source of truth) | `scripts/lib/wasla-migration-matrix.ts` |
| CI guard, 10 checks | `scripts/check-migration-matrix.ts` |
| Generated document | `docs/migration/matrix.md` |
| Negative unit tests, 27 cases | `tests/unit/check-migration-matrix.test.ts` |
| Architecture decision | `docs/adr/0083-migration-matrix-registry.md` |
| Evidence | `docs/evidence/architecture/W-2-20260912.md` |

Coverage: 7 closed mechanisms · 7 waves · one entry for each of the 47 inventory
tables · 7 column plans matching `WASLA_COLUMN_CONCERNS` one-for-one. Disposition
and owner are **read from the `W-1` registry, never restated** — no second source
of truth for a disposition that could drift silently.

### What is explicitly NOT claimed

- **No row was migrated.** "Migrated" and "Retired" below both still read
  "Nothing." The guard's tenth check couples the two: any entry claiming
  execution while "Migrated" is empty fails `verify`. Every entry carries
  `executed: false` literally.
- **No wave is executable today.** Row counts, duplicate identities and live job
  counts are unknown (`B-1`); identity-merge policy is unresolved (`B-2`); no
  CORE integration environment exists (`B-3`). Waves 2, 3 and 5 additionally
  depend on `DEP-CORE-003`, `DEP-CORE-002` and `DEP-CORE-004` — all of which are
  CORE-side and out of this repository's scope.
- **The matrix does not authorise anything.** It is a plan with a gate, and the
  gate measures completeness, consistency and truthfulness of the claim — not
  the correctness of a chosen mechanism, which stays an architectural judgement
  reviewed by reading (ADR-0083 §6).
- **`W-2` is not marked `[x]`.** `ح-4` requires a read CI verdict, and `verify`
  is red on main for sovereign rule 0.4 (`O-1`, an owner decision). Grading:
  **مُختبَر** for the guard (27 negative cases pass locally), **مُنفَّذ** for the
  matrix itself. Not مُتحقَّق منه and not مَقيس.

## Status of item `W-6`, recorded 2026-09-12 (additive; item text unchanged)

The item text above is untouched (`ح-1`). This section records what exists at
this commit and what is **not** claimed.

### What was measured before anything was written

`W-6` asks that no direct commercial coupling with MARKET exist and that all
cross-system traffic go through CORE. The repository was measured first, and the
finding was not what the item's wording implies:

- **The condition already holds.** Not one host in production code resolves to
  MARKET. The `packages/{domain,application,infrastructure}/marketplace/*` files
  are **not** commercial coupling — each is an inert eight-line placeholder
  (`export {}` plus a header comment).
- **But it holds by accident, not by enforcement.** No line in the repository
  fails if someone adds `fetch("https://<market>/v1/orders")` tomorrow. The
  requirement was a rule in a document, and a document does not fail a build.
- **MARKET's domain is unknown to this repository** (`DEP-CORE-005`: no mutual
  access). So enforcement cannot rest on matching a domain name.

### What was built

A **closed registry** of egress destinations in
`scripts/lib/wasla-egress-registry.ts` — a single source of truth with fifteen
declared destinations — gated by `scripts/check-egress-boundary.ts` in `verify`.

The logic is **inverted relative to a blocklist**: the question is not "is this
host forbidden?" but "is this host **declared**?". An undeclared host fails the
build whatever its name; declaring one requires a `system` field; and
`system: "MARKET"` is rejected outright. A blocklist was rejected because a list
of domains this repository does not know is a guard with nothing behind it.

Three governing checks and seven consistency checks. Twenty-eight negative tests
in `tests/unit/check-egress-boundary.test.ts` seed each breach and assert the
guard fails. `docs/wasla/egress-boundary.md` is generated from the registry and
fenced by generation markers; editing it by hand fails the build (rule 0.6).
Decision: `docs/adr/0084-egress-boundary-registry.md`.

### Two claims the guard itself corrected

Recorded because they are evidence the checks bind on their author:

- Four host exemptions (`example.com` and siblings) were written from inference.
  The comment-stripped scan then measured that **none of them appears** in
  production code — all four were in explanatory prose. All were deleted, and a
  check now forbids a dead exemption, because an unused exemption is an open hole
  with nothing on the other side of it.
- Three declared call-site paths were written from inference. Check 8 rejected
  them as non-existent files; they were corrected by measurement.

### What is explicitly NOT claimed

- **The item is not fulfilled and is not marked `[x]`.** `W-6` has two halves.
  The *egress* half — the surface is declared, and a direct MOVE↔MARKET
  destination now fails the build — is delivered. The *channel-handover* half
  cannot be done from this repository: `DEP-CORE-004` records that CORE exposes
  no Telegram channel adapter, so the channel cannot be moved behind CORE.
- **No runtime egress blocking exists.** The guard fails at build time. An
  operator who points `CORE_EVENTS_BASE_URL` at a different host is not caught
  by it; only the documentation of the key is measured, never its value.
- **The scan is lexical, not a dataflow analysis.** It runs two passes over
  comment-stripped production code, which is what caught the dynamically built
  `api.deepl.com`, but a host assembled from scattered fragments at runtime can
  still escape it. All limits are declared in ADR 0084 §"الحدودُ المُعلَنةُ".
- **The two direct commercial integrations remain.** `api.moyasar.com` and
  `api.tap.company` are called directly from MOVE. They are not a `W-6` breach —
  MARKET is not a party — but they are declared debt: the class
  `COMMERCIAL_PENDING_HANDOVER` forces a `handover` field naming `W-7` as the
  removing item and `DEP-CORE-002` as the blocker, and the guard verifies both
  ids are actually declared in this file.
- Grading: **مُختبَر** for the guard (28 negative cases pass locally),
  **مُنفَّذ** for the registry. Not مُتحقَّق منه and not مَقيس — `ح-4` needs a
  read CI verdict and `verify` stays red for `O-1`.

## CI verdicts on branch `feat/w6-egress-boundary` (additive)

Local green is not a verdict (`ح-8`). Read from the GitHub Actions API after the
push, per job **and per step**, not summarised.

| Commit | `verify` | real PostgreSQL | real Redis | multi-instance chaos | Roadmap freshness |
|---|---|---|---|---|---|
| `9f3b848` (push `34666026785`) | `failure` | `success` | `failure` | `success` | `success` (`34666026757`) |
| `9f3b848` (PR [#4](https://github.com/uxxxug/ceezr/pull/4), run `34666029771`) | `failure` | `success` | `failure` | `success` | — |

**The one thing this item measures.** The `verify` job log was read step by step:

| Step | Verdict | Name |
|---|---|---|
| 15 | `success` | migration matrix guard (`W-2`) |
| **16** | **`success`** | **egress boundary guard (`W-6`) — the step this item adds** |
| 17 | `failure` | no table without `city_id` (sovereign rule 0.4) |
| 18–30 | `skipped` | everything after the red step, **including step 25, the `W-1` guard** |

So the new guard **ran and passed at CI**, not only locally. And step 25 being
`skipped` is the read proof that placing the step before the red gate was not
cosmetic ordering: had it gone after, this item's guard would be `skipped` too
and would carry **no verdict at all**, while being reported as delivered.

**Rule 0.4 was not weakened, silenced, reclassified as a skip, or deferred.** It
is the very next step, it failed with the same message it fails with on `main`,
and the job's `conclusion` stayed `failure`.

**Both reds precede this item and do not come from it.** Both are red on `main`
at `0c25ca0` with the same job and the same step: `O-1` (rule 0.4, root cause in
CORE, `DEP-CORE-006`) and `O-2` (missing Upstash secrets — the real-Redis job
fails at step 8, "session tests on real Redis"). Both are owner decisions.

**The run is not claimed green, and `W-6` is not marked `[x]` (`ح-4`).** What is
now proven beyond local measurement is narrower than the item and stated as such:
the egress surface is declared and gated at CI. Grading:
**مُنفَّذ · مُختبَر · مُتحقَّق منه (the guard alone)**.

## CI verdicts on branch `feat/w8-migration-dry-run-and-reconcile` (additive)

Read per job **and per step** from the API at `c80201c` (run `34668335278`;
Roadmap-freshness run `34668335236` = `success`). `verify` **failure** ·
`تكامل على PostgreSQL حقيقي` **success** · `فوضى متعدد المثيلات (F5-06)`
**success** · `تكامل على Redis حقيقي` **failure** at step 8.

In `verify`: Lint, Typecheck and Test all `success`; step 15 (`W-2` matrix guard)
`success`; **step 16 — the `W-8` guard — `success`**; step 17 (`city_id`)
**failure**; steps 18–30 all `skipped`. So the item's guard was measured and
passed, and the only red after it is the rule-0.4 gate, i.e. `O-1`
(`DEP-CORE-006`) — **prior to this item, not caused by it** — plus the Redis job
red for `O-2`. Both are red on `main` at `0c25ca0` in the same job and the same
step. Placing the step **before** `city_id` is what gave it a verdict at all;
everything after read `skipped`.

Every step of the PostgreSQL job is green, including step 10, which runs this
item's integration test, and step 12, which fails if integration tests are
skipped silently — so the test **ran** and was not silently skipped.

**Two reds in the first push, each measured rather than assumed (additive).** At
`fd35b34` (run `34667308032`), `verify` was red at step 8 Test and the PostgreSQL
job was red. The first was **a real defect of mine**: the pinned skip-registry
count test (85 files / 764 cases) failed because I added the 86th entry — which
`check-skip-classification` requires for the new integration test — **after** my
last full test run and pushed without re-measuring. The guard did exactly its
job: it stopped the registry growing silently. Counts raised to 86 / 770, both
**printed by that guard**, not invented; the earlier description kept. The
second was **not from this item, and that was measured**:
`tests/integration/admin-service-separation.test.ts` failed to boot a gateway on
port `46432` — a file this item does not touch — and **re-running the same job on
the same commit read `success`**, so the failure is not reproducible; that job is
green on `main`. The fragility is recorded rather than buried: that test derives
its port from `process.pid % 1000` inside a ten-port window, which reduces
collisions without preventing them, and its teardown kills the process without
waiting for the port to be released. **Declared debt outside this item's
reservation**, to be fixed under its own item — nothing was weakened, nothing
classified as a skip, and the re-run was to measure reproducibility, not to hide
a red.

## Status of item `W-8`, recorded 2026-09-12 (additive; item text unchanged)

Item text is untouched (`ح-1`). This section records measured state only.

**Built.** `scripts/lib/wasla-migration-dry-run.ts` (single source: 6 probes, the
closed reconciliation vocabulary, `deriveReconciliation`, a schema reader) ·
`scripts/wasla-migration-dry-run.ts` (the runnable tool) ·
`scripts/check-migration-dry-run.ts` (7-check guard, `--write` generator) ·
`docs/migration/dry-run-and-reconciliation.md` (generated between markers) ·
`tests/unit/check-migration-dry-run.test.ts` (42 tests, mostly negative) ·
`tests/integration/migration-dry-run-read-only.test.ts` (6 tests on a real
PostgreSQL) · ADR 0085 · guard wired into `ci` and into `verify` **before** the
red `city_id` step.

**Two invariants, both enforced rather than promised.** The dry-run **cannot
write**: every probe runs inside `BEGIN TRANSACTION READ ONLY ISOLATION LEVEL
REPEATABLE READ` on a **reserved** connection, so the engine itself rejects any
write with `25006`, and the transaction is rolled back regardless. The reconciler
**cannot emit a false green**: `RECONCILED` is unconstructible without a
`CoreAttestation`, `DIVERGED` likewise, and `coreRows` stays absent rather than
becoming `0`. While `DEP-CORE-007` is recorded open in this file, writing
`RECONCILED` in the tool's code **fails `verify`**; when it closes, that check
lapses on its own with no edit.

**A real measurement caught a real defect, recorded not erased.** The
real-database test failed on its first run with `UNSAFE_TRANSACTION`. The root
cause was not the library but the tool: on an unreserved pool, `READ ONLY` opens
on one connection while the probe runs on another — the invariant was declared
and the behaviour contradicted it. Neither review, types, unit tests nor `biome`
caught it; only measurement on a real engine did. Fixed at the cause by
reserving one connection, **without disabling the library's protection, without
weakening the test, and without classifying anything as a skip** — plus a new
guard check and a negative test so it cannot return silently. Third time a guard
or measurement has failed on its own author here; the first two were in `W-6`.

**Measured locally.** `bun test` → **2968 pass · 829 skip · 0 fail** · 10538
`expect()` across 3797 tests in 286 files. `biome check .` → 1109 files, no
fixes. `typecheck` passed. Real PostgreSQL → **6 pass · 0 fail** · 48 `expect()`,
including the write attempt failing with `25006`. Ran end to end: wave 1 measured
`users` = 2 rows, the rest 0; wave 6 measured `orders` = 0; wave 3 **refused with
exit 2** as out of scope. Every reconciliation row `UNVERIFIABLE`.

**Not claimed.** No `[x]`. No wave executed (`B-1`, `B-2`, `B-3` are owner
decisions and the tool prints entry conditions without evaluating them). No
reconciliation completed (`DEP-CORE-007`). The read-only invariant was measured
on a **test** database, not a production-like one (`ح-5`) — the property belongs
to the engine so it is expected to carry over, but expectation is not
measurement. Numbers above are **not** production counts (`B-1` unread).
Grading: **مُنفَّذ · مُختبَر · مَقيس** (the read-only invariant alone) — **not**
`مُثبَت`.

## CI verdicts on branch `feat/w2-migration-matrix` (additive)

Local green is not a verdict (`ح-8`). Filled in from the GitHub Actions API after
the push, per job, not summarised.

| Commit | `verify` | real PostgreSQL | real Redis | multi-instance chaos | Roadmap freshness |
|---|---|---|---|---|---|
| `a587923` (push `34664552923`) | `failure` | `success` | `failure` | `success` | `success` |
| `a587923` (PR [#3](https://github.com/uxxxug/ceezr/pull/3), run `34664586565`) | `failure` | `success` | `failure` | `success` | — |

**What this item actually measures.** The job log was read step by step, not as a
rolled-up conclusion. In both runs:

| Step | Name | Conclusion |
|---|---|---|
| 15 | مصفوفةُ الهجرةِ شاملةٌ ومتماسكةٌ ولا تدّعي تنفيذاً (W-2 / ADR 0083) | **`success`** |
| 16 | منع أي جدول بلا `city_id` في المخططات | **`failure`** |
| 24 | جردُ حدودِ WASLA (W-1) | `skipped` |

The `W-2` guard is therefore **proven at CI, not only locally**. Step 24 being
`skipped` is the read evidence that moving the step ahead of the red one was not
cosmetic: without the move this item's guard would have been `skipped` too — no
verdict at all — and "implemented" would have been claimed for a gate that never
ran.

The rule-0.4 gate was **not weakened**: it fails at step 16 with the same message
it fails with on `main`, and the job conclusion stays `failure`. Both reds are
pre-existing on `main` (run `34661342014` at `8d031c2`) — same jobs, same failing
steps, no regression introduced here. `O-1` and `O-2` are owner decisions.

The run is **not** claimed to be green.

## CI verdicts on branch `feat/w4-w5-operational-job-and-core-lifecycle` (additive)

Local green is not a verdict (governance `ح-8`). Each push below is followed by
the per-job conclusion actually read from the GitHub Actions API.

| Commit | `verify` | real PostgreSQL | real Redis | multi-instance chaos | Roadmap freshness |
| --- | --- | --- | --- | --- | --- |
| `b4a58f2` (run `34628804244`) | fail — `check-migrations` rule 0.4 (`DEP-CORE-006`) | fail — 4 cases | fail — `O-2` secrets absent | pass | pass |
| `def9a20` (run `34629792395`) | fail — same sovereign blocker | fail — 2 cases | fail — `O-2` | pass | fail — commit touched `supabase/` without a roadmap change |
| `4f93c24` (run `34632270113`) | fail — same sovereign blocker (`check-migrations`, three rule-0.4 lines, read from the job log) | **pass** | fail — `O-2` | pass | pass |
| `7bf983b` (run `34655832337`) | fail — `check-business-constants` rejected `type RejectStatus = 400 \| 401 \| 415 \| 422 \| 503;` (HTTP status literals read as a subscription price), read from the job log; the sovereign rule-0.4 blocker was never reached in this run | **pass** | fail — `O-2` | pass | pass |
| `54dcf29` (run `34656430731`) | fail — **only** `check-migrations` rule 0.4, three lines read from the job log (`operational_jobs`, `core_event_inbox`, `move_event_outbox`): the `DEP-CORE-006` / `O-1` blocker and nothing else | **pass** | fail — `O-2` | pass | pass |
| `1fa9efa` (run `34657798076`, merge of `origin/main` after PR #1 landed) | fail — **only** `check-migrations` rule 0.4, same three lines (`DEP-CORE-006` / `O-1`) | **pass** | fail — `O-2` | pass | pass |
| `1fa9efa` (run `34657801218`, same commit, second trigger) | fail — same sovereign blocker | fail — **1 case**: `location-race-conditions.test.ts:210` expected sequence `> 5`, received `4` — the same commit passed this job in run `34657798076`, so the job is order-dependent, not the code (`OPS-016`) | fail — `O-2` | pass | pass |
| `e2b33a5` (runs `34658811488` and `34658815106`) | fail — **only** `check-migrations` rule 0.4, the same three lines (`DEP-CORE-006` / `O-1`), read from the job log | **pass in both runs** (`OPS-016` fixed; the flake is gone) | fail — `O-2` | pass | pass |
| `7a03ed3` — **the merge commit on `main`** (run `34659597153`) | fail — **only** `check-migrations` rule 0.4, the same three lines, read from the job log | **pass** | fail — `O-2` | pass | pass |

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
- **`OPS-016` — an order-dependent witness in `location-race-conditions.test.ts`.**
  The same commit `1fa9efa` passed the real-PostgreSQL job in one run and failed
  it in the other, on one assertion: published sequences had to be strictly
  increasing **in delivery order**. The sequence is allocated inside a single
  `update` in `session-repository.ts`, but the event is published *after* that
  transaction commits, in `live-tracking.ts`, outside any lock — so of two
  concurrent fixes the holder of sequence 5 may publish before the holder of 4.
  Nothing in `ADR 0053` promises delivery order; the *number* is the order, and
  the consumer sorts by it. The assertion therefore measured the scheduler, which
  the test's own docblock forbids. The witness is now order-independent (no
  sequence issued twice, measured on the set) and was **strengthened** in
  exchange: device stamps are checked in *sequence* order, and the highest
  published sequence must equal the row's `last_sequence`. The test was run ten
  times in a row locally with zero failures. No production code changed, no
  assertion was removed, and no skip was added.
- **`OPS-014` — the business-constant guard could not see a status-code union.**
  `scripts/check-business-constants.ts` forbids the literals `250`, `400` and `45`
  outside `platform_settings`, and exempts HTTP status codes — but its exemption
  only recognised response-call shapes (`c.json(...)`, `new Response(...)`,
  `status: <ddd>`, `rejected(c, "CODE", <ddd>)`). The new intake route constrains
  its reject codes with a type (`type RejectStatus = 400 | 401 | 415 | 422 | 503`)
  instead of an open `number`, so CI read `400` as a hardcoded subscription price
  and failed `verify` before it ever reached the known sovereign blocker. Fixed by
  making the guard **more precise, not more permissive**: a second narrow
  exemption matches only a whole line that is a type alias whose name ends in
  `Status` assigned a union of three-digit numbers. A price
  (`const subscriptionPrice = 400`), a mixed union (`400 | 45`), a `type Price`
  and a status alias followed by a price on the same line all still fail, and
  each of those cases is asserted in `tests/unit/check-business-constants.test.ts`.
  This defect is this branch's own, and it is recorded rather than hidden: the
  route keeps its typed status codes, the guard keeps its teeth.
- **`OPS-015` — the new integration file was an unclassified skip.**
  `check-skip-classification` (`OPS-009`) failed because
  `tests/integration/wasla-core-transport.test.ts` gates on `TEST_DATABASE_URL`
  without a registry entry. Registered in `scripts/lib/skip-registry.ts` with
  reason, activation, owner and critical path, and the lifecycle entry's measured
  count was raised from 33 to 35. The pinned totals in
  `tests/unit/skip-audit.test.ts` were raised to the numbers the gate itself
  prints (85 files, 764 cases) with the previous note kept, not deleted.
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
| DEP-CORE-001 | ~~No network ingress that accepts `move.job.*` events~~ — **CLOSED** by CORE `d2c38e3`, read at CORE@`1231817` on 2026-09-12 | Was blocking outbox delivery for item 5; the production shipper now exists |
| DEP-CORE-002 | No cheap entitlement read | Item 7 (payment/wallet/subscription handover) |
| DEP-CORE-003 | No city/geography change event | Item 1 execution and item 2 |
| DEP-CORE-004 | No Telegram channel adapter | Item 6 |
| DEP-CORE-005 | No mutual repository access, so vendored contract freshness cannot be verified automatically | Contract parity stays a manually compared sha256 fingerprint |
| DEP-CORE-006 | `core.fulfillment.created` carries no city or geography, and `organization_id` / `order_reference` are opaque here | Landing the item 4 and 5 schema under sovereign rule 0.4; also driver assignment later, since drivers are city-bound |
| DEP-CORE-007 | No shared CORE environment and no service credential for MOVE, so no delivery to a real CORE can be measured | Item 5 can only be measured against CORE's written contract, never against CORE itself |

## Owner instruction O-5, recorded 2026-09-12 (merge ordered with a red sovereign gate)

On 2026-09-12 the repository owner instructed, verbatim: «قم دمج كل شي إلى
المستودع ، وقم بإصلاح الدمج السابق ، وقم بدمج طلب الدمج الموجود في المستودع».
This entry was written **before** the merge was performed, so that the merge is
never read as a green verdict. The merge landed on 2026-09-12 as merge commit
`7a03ed3`, and the verdict actually read on `main` afterwards (run
`34659597153`) is the last row of the table above: `verify` still fails on the
same three rule-0.4 lines and nothing else, real PostgreSQL passes, real Redis
still fails on `O-2`, chaos and roadmap-freshness pass. So the gate was neither
satisfied nor silenced by merging — it fails on `main` exactly as it failed on
the branch. The state of the gates at the time
of the instruction is recorded below verbatim.

- **What is red at the time of this instruction, and why.** `verify` failed on exactly one gate:
  `check-migrations`, sovereign rule 0.4, three lines — `operational_jobs`,
  `core_event_inbox`, `move_event_outbox` carry no `city_id`. They cannot carry a
  truthful one: `core.fulfillment.created` from CORE contains no city and no
  geography (`DEP-CORE-006`), so a `city_id` here would be invented, not
  received. The real-Redis job failed on `O-2` (Upstash secrets are not present
  in this repository's Actions secrets). Both were declared blockers before this
  instruction, not discovered by it.
- **What is *not* done to make it green.** The gate is not disabled, not
  weakened, not skipped, and no exemption is added to
  `scripts/check-migrations.ts`. No test is relaxed. `check-migrations` will keep
  failing for these three tables until `DEP-CORE-006` closes or the owner publishes a
  governing appendix to rule 0.4. Nothing in this repository may be read as
  «مَقيس» or «مُثبَت» on the strength of a merge (`ح-4` · `ح-5`).
- **What closes it.** Either CORE adds city/geography to
  `core.fulfillment.created` (then the three tables take a received `city_id`),
  or the owner publishes a narrow, written appendix to rule 0.4 naming exactly
  these three tables and the reason. Until one of the two happens, `O-1` stays
  open.

## Owner decisions required, recorded 2026-09-11

| # | Decision | Why it cannot be taken by an executor here |
|---|---|---|
| O-1 | Either CORE adds city/geography to `core.fulfillment.created` (`DEP-CORE-006`), or a new governing appendix extends the closed `domain-ingress receipt` class to cover `core_event_inbox` and `move_event_outbox` and rules on `operational_jobs` | The 2026-09-04 governing appendix states the class is closed and can only be extended by a new governing appendix from the owner — not by an ADR, a comment in a migration, or an exception in a guard |
| O-2 | Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` as repository secrets | The `real-redis` CI job asserts a real Redis (`OPS-006`) and must not be weakened, silenced or skip-classified; the previous secrets belonged to the former repository account |
| O-3 | Issue a CORE bearer service credential for MOVE and set `CORE_EVENTS_BASE_URL` / `CORE_EVENTS_BEARER_TOKEN` on the worker | Credentials in CORE are owned by CORE; this repository must not mint or assume them, and the shipping job stays unregistered without them |
| O-4 | Provision a CORE `event_subscription` for `core.*` pointing at `https://<gateway>/webhook/core-events` with a signing secret of at least 32 characters, and set `CORE_INBOUND_SIGNING_SECRET` on the gateway | CORE's outbound contract states subscriptions are operator-provisioned and the secret is never echoed back; this repository receives what was provisioned and does not provision it |

## Migrated

Nothing.

## Retired

Nothing. No legacy component is switched off before its replacement is proven.

## Status of item `W-9`, measured 2026-09-12 (additive; item text unchanged)

Item text is untouched (`ح-1`). This records **why the item cannot be executed**,
measured against the repository rather than inferred from the one-line note.

**`B-5` is real, and it is not the only thing blocking this item.** A cutover
and rollback rehearsal has to rehearse cutting over **to CORE**, and the
following are all recorded open in this same file: `B-5` (no production release
approval), `B-3` (no CORE database or environment provisioned), `DEP-CORE-007`
(no shared CORE environment, which is what forces every reconciliation row in
`W-8` to be `UNVERIFIABLE`), and `B-1` (production inventory unknown — row
counts, duplicate identities, live jobs). A rehearsal whose target does not
exist and whose volumes are unknown would rehearse **nothing**, and calling it
green would be exactly the false green that `W-8` was built to make
unconstructible.

**What already exists, and what it does not cover.** `OPS-010` provides a
schema-rollback path that is genuinely measured: `scripts/lib/rollback-audit.ts`
(static reading of migrations for anything a previous image depended on),
`scripts/check-rollback-safety.ts` (the static gate), and
`scripts/rollback-schema-drill.ts`, which CI runs on a real PostgreSQL as step 9
of the `تكامل على PostgreSQL حقيقي` job — read `success` at `c80201c`. That
covers **rolling a schema forward safely so a previous code image still runs**.
It does **not** cover this item: a WASLA cutover rehearsal is about moving
identity, payment and job ownership between two systems and back, which needs
the second system.

**No `[x]`, no reinterpretation.** The item is not silently rescoped into
documentation, and no rehearsal is claimed. The state is
**قيد التنسيق — blocked**, waiting on the owner.

## Merge state on `main`, measured 2026-09-12 (additive)

**Every open pull request is merged; none remains open.** `#1` `W-1` · `#2`
`W-4`/`W-5` · `#3` `W-2` · `#4` `W-6` · `#5` `W-8` · `#6` the `W-9` blocker
record. `main` = `0d1a29e`.

**`#5` and `#6` were merged by explicit owner instruction, and that is recorded
rather than implied.** Rule 0.7 asks for an independent reviewer; no independent
reviewer exists on this repository today, and the owner directed the merge in
writing. The rule is **not** amended by this: the ledger says the merge authority
was the owner, not an independent review, so a later reader can tell the
difference.

**Both conflicts caused by the earlier `#4` merge were resolved by union, never
by deletion.** In `.github/workflows/ci.yml` the `W-6` egress step and the `W-8`
dry-run step both survive, and both sit **before** the red `city_id` gate —
measured three times now, a guard step placed after it reads `skipped` and
therefore carries no verdict at all. In `package.json` the `ci` chain runs both
guards and both `check:*` keys are kept. In `ROADMAP.md`, `docs/SYSTEM_STATE.md`
and `docs/ROADMAP-MASTER.md` every section of `W-6`, `W-8` and `W-9` is preserved
in recording order with no character erased (`ح-8`).

**CI verdict on `main` at `0d1a29e`, read per job and per step** (run
`34670417918`; Roadmap-freshness `34670417911` = `success`):
`تكامل على PostgreSQL حقيقي` **success** · `فوضى متعدد المثيلات (F5-06)`
**success** · `verify` **failure** · `تكامل على Redis حقيقي` **failure** at step
8. In `verify`: Lint, Typecheck, Test `success`; **step 15 (`W-2`) `success` ·
step 16 (`W-6`) `success` · step 17 (`W-8`) `success`**; step 18 (`city_id`)
**failure**; everything after `skipped`.

**So all three WASLA guards are green on `main`, and the two reds are the two
owner blockers, unchanged.** `O-1` (`DEP-CORE-006`) — rule 0.4, tables from
`W-4`/`W-5` carry no `city_id`, root cause in CORE — and `O-2` — the real-Redis
job needs `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Both were
already red at `0c25ca0` and at `ef1f9ca` in the same job and the same step, so
merging changed neither.

**Measured locally on `main` after all merges:** `bun test` → **3008 pass · 829
skip · 0 fail** · 10598 `expect()` across 3837 tests in 287 files · `biome check .`
1112 files, no fixes · `typecheck` passed · all three guards pass · 85 ADRs with
unique numbers · skip classification 86 files / 770 cases.

**Nothing is marked `[x]`.** Merging is not a state flip: `ح-4` needs a read CI
verdict for the item's own claim, and `ح-5` needs a production-like environment.
`W-3`, `W-7` and `W-9` remain blocked on owner decisions and resources.

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
