# ADR 0173 — Session revocation is a per-jti blocklist built into the session reader

**Status:** Proposed — implemented and locally measured, not production-proven (`ح-5`).
**Date:** 2026-09-22
**SEC item:** `SEC-18` (§11-و of `docs/ROADMAP-MASTER.md`)

## Context

`DEC-07` made Telegram the sole identity provider. A session, once issued, lives
for its full absolute lifetime (12 hours, `MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS`)
unless its signature is broken. There is no way to revoke a session that is still
cryptographically valid — a compromised token keeps working until it expires.

`SEC-18` is the second gap the owner named. The replay guard (`SEC-17`, ADR 0172)
prevents re-use of `initData` for session exchange; it does not revoke a session
that is already issued. A stolen access token, or a stolen refresh token, works
for the full 12-hour ceiling.

The system has three session verification paths:

1. **`authorizeViewer`** (resolve-viewer.ts) — the gateway's middleware for every
   authenticated request. Reads the access token and returns a `Viewer`.
2. **`readMiniAppSession`** (realtime/adapters.ts) — the WebSocket ride channel's
   independent verification. Reads the access token and establishes a live
   session for driver tracking.
3. **`refresh.read()`** (renew-miniapp-session.ts) — the renewal path. Reads the
   refresh token and issues a new access token. The refresh grant carries the
   same `sessionId` (`jti`) across the whole renewal chain.

All three paths must consult the revocation store. A revoked session must be
rejected at every door, not just the middleware.

## Decision

A per-`jti` blocklist is inserted into the session reader itself, so that every
call to `MiniAppSessionReader.read` checks revocation after signature verification.
The renewal path gets a separate check because it reads the refresh token, not
the access token. The realtime path gets a separate check because it calls
`readMiniAppSession` directly, not through the `MiniAppSessionReader` interface.

### Revocation key: `jti` (session ID)

The key is the `jti` field from the session payload — the stable session ID that
survives renewal. Revoking by `jti` revokes the entire renewal chain, because the
refresh grant carries the same `jti`. There is no need for a "revoke all sessions
for a user" feature yet; that is a future item, not a precondition for SEC-18.

### Architecture: revocable session reader

The `MiniAppSessionReader.read` interface was made `async` (returns
`Promise<Result<...>>`). A `createRevocableSessionReader(reader, revocationStore)`
wrapper was created that:

1. Calls the underlying reader (signature verification, expiry check).
2. If the session is valid, calls `revocationStore.isRevoked(sessionId)`.
3. Returns `REVOKED` if the session is revoked, `NOT_CONFIGURED` if the store is
   unavailable (fail-closed).

The gateway injects this revocable reader into all 34 dependency objects. Every
use case that calls `deps.sessions.read()` now goes through the revocable reader —
no use case code was modified for the revocation check. The 26 call sites were
made `await`-able, and local `authenticate`/`openSession` helpers were made
`async`.

### TTL: absolute session ceiling

The revocation entry's TTL is `MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS` (43200
seconds, 12 hours). This is the absolute ceiling of the session, not the
10-minute access token lifetime. A revoked session cannot get a fresh access
token through renewal, because the renewal path also checks revocation.

### Fail-closed

If the revocation store is unavailable (Redis down, network error):
- `authorizeViewer` returns `503 SESSION_NOT_AVAILABLE` — the request is rejected.
- The realtime channel returns `403` — the WebSocket is closed.
- The renewal path returns `503 SESSION_NOT_AVAILABLE` — no new tokens are issued.

**A session is never accepted when the store cannot be consulted.**

### Public code: `SESSION_INVALID`

The public rejection code for a revoked session is `SESSION_INVALID` — the same
as a bad signature or a malformed token. The attacker learns nothing about
whether the session was revoked or never valid.

## What is not claimed

- **Not production-proven** (`ح-5`): no real Redis was consulted, no real revoked
  session was tested on a live system. What is measured is the revocation check's
  behavior under controlled inputs.
- **Not "revoke all user sessions"**: revocation is per-`jti`. A feature to revoke
  all sessions for a user (e.g., on password change) is a future item, not a
  precondition for SEC-18.
- **Not a session store**: the revocation store is a blocklist, not a full session
  store. Active sessions are still stateless JWT-like tokens. The store only
  records revoked session IDs.
- **Not cross-instance in-memory**: the in-memory adapter does not share state
  across processes. A multi-instance deployment with `SESSION_STORE != redis`
  would have per-instance revocation stores — each instance would only know about
  sessions revoked on that instance. This is recorded, not hidden.

## Consequences

- The `MiniAppSessionReader.read` interface is now `async`. All 26 call sites
  and 3 local helper functions (`authenticate`, `openSession`, the realtime
  adapter's verification) were made `async` and `await`-able. This is a broad but
  mechanical change — no logic was modified, only the async boundary moved.
- The gateway constructs the revocable reader once and injects it into all 34
  dependency objects. The `revocation` field was removed from `ResolveViewerDeps`
  (the check is now inside the reader). The `revocation` field remains on
  `RenewMiniAppSessionDeps` (the renewal path checks by `sessionId` from the
  refresh token, not from the access token).
- A new `503` failure mode exists: if Redis is down, no authenticated request is
  accepted. This is the correct trade-off for a single-provider system.
- The `publicViewerCodeFor` function maps `REVOKED` → `SESSION_INVALID`, so the
  public API does not leak whether a session was revoked.
