# ADR 0172 — initData replay is a single-use fingerprint, not a lifetime check

**Status:** Proposed — implemented and locally measured, not production-proven (`ح-5`).
**Date:** 2026-09-21
**SEC item:** `SEC-17` (§11-و of `docs/ROADMAP-MASTER.md`)

## Context

`DEC-07` made Telegram the sole identity provider for the first launch. A single
provider turns every gap in the identity layer into a gap in the whole system —
there is no second door to cover it.

`SEC-17` is the first of five gaps the owner named as conditions that persist even
in a Telegram-only model. The existing `initData` verifier (`F1-03`) checks the
cryptographic signature and the `auth_date` staleness window. **It does not check
whether the same signed payload has already been consumed.** A captured `initData`
string — valid, signed, within its freshness window — can be replayed as many
times as an attacker can submit it before the 300-second window closes.

The existing check is an age check, not a use check. A 5-minute-old proof is
rejected; a 5-second-old proof that has already been used is accepted.

## Decision

A single-use replay guard is inserted into the session exchange path, **after**
signature verification and **before** session issuance. The guard consumes a
fingerprint of the raw `initData` atomically, and rejects any subsequent
presentation of the same payload within its acceptance window.

### Fingerprint

The fingerprint is `sha256(rawInitData)` — a digest of the entire signed string,
not of the `hash` field alone. The `hash` field is Telegram's signature; the
fingerprint is ours. Two different `initData` strings with the same `hash` would
fail signature verification, so the fingerprint is unique to a specific signed
payload.

The raw `initData` is never stored, never logged, never passed beyond the guard's
boundary. Only the digest enters the store.

### Ordering

The guard is consulted **after** the verifier returns `ok` and **before** the
issuer is called. This ordering is mandatory:

1. A bad signature must not consume a fingerprint — otherwise an attacker
   floods the store with junk, then presents a valid payload that is rejected
   as "already used" even though it was never accepted.
2. A stale `auth_date` must not consume a fingerprint — the payload is already
   rejected for a different reason, and the store should not retain it.
3. The issuer must not be called before the guard returns `ok` — a replayed
   payload that reaches the issuer produces a second session for one proof.

### TTL

The fingerprint's TTL is the **remaining lifetime** of the acceptance window:
`maxAge - (now - authDate)`. This is not a fixed duration. A payload presented
at the edge of its window has a near-zero TTL; a fresh payload has the full 300
seconds. The fingerprint expires exactly when the payload itself becomes stale —
no earlier (which would allow replay after expiry) and no later (which would
retain data beyond its usefulness).

### Fail-closed

If the store is unavailable (Redis down, network error), the guard returns
`STORE_UNAVAILABLE` and the session exchange returns `503 SESSION_NOT_AVAILABLE`.
**A session is never issued when the guard cannot be consulted.** This is the
correct security posture for a single-provider identity system: the absence of
the check is not the absence of the threat.

### Store selection

- **Redis** (multi-instance): `SET key 1 NX EX ttl` — a single atomic command.
  The first consumer wins; the second gets `null` and is rejected as `REPLAYED`.
- **In-memory** (single-instance): a `Map` with lazy expiry. Used when
  `SESSION_STORE` is not `redis`. Adequate for the current `numInstances: 1`
  deployment; **not adequate for multi-instance** — that is `SEC-18` and `F9`.

The same `SESSION_STORE` flag that governs the session store and rate limiter
governs the replay guard. One question — "are we more than one process?" —
determines the adapter.

## What is not claimed

- **Not production-proven** (`ح-5`): no real Redis was consulted, no real
  attacker replayed a payload, no concurrency was measured on a live system.
  What is measured is the guard's behavior under controlled inputs.
- **Not `SEC-18`**: session revocation and a server-side session store are a
  separate item. The replay guard prevents re-use of `initData`; it does not
  revoke an already-issued session.
- **Not `SEC-19`**: making `telegram_id` nullable is a structural migration
  that is a precondition for `ARCH-014`, not for replay prevention.
- **Not cross-instance in-memory**: the in-memory adapter does not share state
  across processes. A multi-instance deployment with `SESSION_STORE != redis`
  would have per-instance replay guards — each instance would accept the same
  `initData` once. This is recorded, not hidden.

## Consequences

- The session exchange path is now async where it was synchronous — the guard
  is a `Promise`. The route handler already awaited the exchange; the verifier
  and issuer remain synchronous.
- A new `503` failure mode exists: if Redis is down, no new sessions can be
  issued. This is the correct trade-off for a single-provider system.
- The public rejection code for replay is `INIT_DATA_REJECTED` — the same as a
  bad signature. The attacker learns nothing about whether the payload was
  replayed or never valid.
