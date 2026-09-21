# SEC-17 — initData replay prevention evidence

**Date:** 2026-09-21
**ADR:** [0172](../../adr/0172-initdata-replay-is-a-single-use-fingerprint-not-a-lifetime-check.md)
**Item:** `SEC-17` in `docs/ROADMAP-MASTER.md` §11-و

## What was built

A single-use replay guard (`InitDataReplayGuard`) inserted into the session
exchange path, after signature verification and before session issuance.

### Files added

| File | Purpose |
|---|---|
| `packages/application/identity/ports.ts` | `InitDataReplayGuard` port + `ReplayGuardFailure` types |
| `packages/infrastructure/identity/redis-init-data-replay-guard.ts` | Redis adapter: `SET key NX EX ttl` |
| `packages/infrastructure/identity/memory-init-data-replay-guard.ts` | In-memory adapter for tests and single-instance |
| `tests/unit/init-data-replay-guard.test.ts` | Guard behavior: first-use, replay, TTL expiry, no raw storage |
| `tests/unit/exchange-telegram-session-replay.test.ts` | Integration into exchange path: replay rejected, bad sig doesn't consume, stale doesn't consume, store-down fails closed |

### Files modified

| File | Change |
|---|---|
| `packages/application/identity/exchange-telegram-session.ts` | `replayGuard` dep + `INIT_DATA_REPLAYED` / `REPLAY_GUARD_UNAVAILABLE` error variants |
| `apps/gateway/src/routes/session-telegram.ts` | Route maps `REPLAY_GUARD_UNAVAILABLE` → 503 |
| `apps/gateway/src/index.ts` | Guard wired: Redis if multi-instance, in-memory if single |
| `packages/infrastructure/identity/index.ts` | Exports new adapters |

## Witness — behavioral, not existential

The requirement is «شاهدٌ يُثبِتُ رفضَ الإعادةِ لا وجودَ المخزن» — a witness
that proves replay rejection, not the existence of the store.

### Test results

```
tests/unit/init-data-replay-guard.test.ts:
  5 pass / 0 fail
  - First exchange succeeds, second with same text rejected as REPLAYED
  - Different text does not collide
  - Fingerprint expires with TTL window
  - Negative TTL corrected to 1 second
  - Raw initData not stored

tests/unit/exchange-telegram-session-replay.test.ts:
  4 pass / 0 fail
  - First exchange succeeds, second rejected as INIT_DATA_REJECTED
  - Bad signature does not consume fingerprint (verifier runs first)
  - Stale auth_date does not consume fingerprint (rejected before guard)
  - Store unavailable → 503 SESSION_NOT_AVAILABLE (fail-closed)

Full suite: 5738 pass / 0 fail / 1440 skip (integration tests requiring real PostgreSQL/Redis)
```

## What is measured

- **Replay rejection**: the same `initData` presented twice is rejected on the
  second attempt with `REPLAYED`.
- **Ordering**: a bad signature or stale `auth_date` does not consume the
  fingerprint — the verifier runs first, and only verified payloads reach the
  guard.
- **Fail-closed**: when the store is unavailable, no session is issued.
- **No raw storage**: the fingerprint is `sha256(initData)`, not the raw string.

## What is not claimed (`ح-5`)

- No real Redis was consulted in these tests (in-memory adapter used).
- No real attacker replayed a captured payload.
- No concurrency was measured on a live multi-instance system.
- The guard is not `SEC-18` (session revocation) or `SEC-19` (nullable telegram_id).
- The in-memory adapter does not share state across processes.
