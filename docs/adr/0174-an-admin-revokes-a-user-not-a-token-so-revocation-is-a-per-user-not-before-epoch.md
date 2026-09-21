# ADR 0174 — An admin revokes a user, not a token, so revocation is a per-user not-before epoch

**Status:** Proposed — implemented and locally measured, not production-proven (`ح-5`).
**Date:** 2026-09-22
**SEC item:** `SEC-18` (§11-و of `docs/ROADMAP-MASTER.md`), remedy legs 2 and 3.

## Context

ADR 0173 built the enforcement engine: a per-`jti` blocklist consulted by all
three session verification paths. That engine closed the gap it was measured
against, and left two legs of the `SEC-18` remedy unbuilt — a fact recorded at
the time rather than papered over, which is why `SEC-18` stayed `[~]`:

1. **No one can pull the trigger.** The blocklist had no writer reachable by a
   human. A store with no admin path is a mechanism, not a remedy.
2. **No durable record of the decision.** Revocation is a consequential act
   against a named person. An act with no audit row cannot be reviewed, and an
   act that cannot be reviewed is not governed.

The operational fact that shapes everything below: **an admin knows a user, not
a `jti`.** A support agent handling "my phone was stolen" holds a person — a
Telegram id, a name, a phone. They do not hold the opaque session identifiers of
that person's live tokens, and no admin surface could reasonably show them.

## Decision

### 1. Revocation is a per-user not-before epoch, not a session registry

To revoke by user with a `jti` blocklist, the system would have to enumerate that
user's live `jti`s — which requires a **session registry**: every issuance
recorded under its user. We rejected that, for a reason in the code rather than a
matter of taste:

`createMiniAppSessionIssuer.issue()` is **synchronous and does not expose the
`jti`** it mints. Registering issuances means making it async and widening its
return. But `requestMiniAppSos` is held to exactly one `await` — on `triggerSos`
— by the ADR 0077 isolation guard (`scripts/check-sos-intake-isolation.ts`). An
async issuer adds a second `await` on the SOS intake path, so a registry design
either breaks that guard or forces SOS to stop issuing sessions. **A design that
must disable an existing guard to fit is the wrong design.**

The epoch needs no issuance hook at all. `revoked-user:{telegramUserId}` holds a
millisecond timestamp; a token is dead if it was **issued before** that instant.
Reading a key the verifier already reaches for costs nothing new, and issuance
stays untouched — and therefore ADR 0077 stays intact.

The comparison is strict (`<`, not `<=`): a token issued in the same millisecond
as the revocation survives. That direction is deliberate. The alternative would
let an epoch kill a session minted by the very next login, and an admin who
revokes a stolen device must still be able to tell the owner to sign back in.

### 2. Renewal checks the epoch too — this is correctness, not defence in depth

Renewal mints a **fresh `iat`**. A reader-only epoch check is therefore
bypassable by a single renewal: the new access token is younger than the epoch
and passes. Revocation would degrade into "logged out within ten minutes, then
back for the remaining twelve hours" — which is not revocation.

So `renewMiniAppSession` checks the epoch as well, and it measures the epoch
against **when the session started**, not against the refresh token's own `iat`.
Refresh tokens rotate; their `iat` is as young as the last renewal, so comparing
against it reproduces the same hole one level up. `startedAtSeconds` is derived
in infrastructure as `absoluteExpiresAtSeconds - absoluteTtlSeconds`, using the
*injected* TTL rather than the module constant, so a test that injects a shorter
ceiling still computes a truthful session start.

The consequence worth naming: an epoch kills the whole renewal chain of any
session that began before it, not merely the current access token.

### 3. Enforcement happens before logging

Order in the route is: validate the reason → write the epoch → write the audit
row. Not the reverse. Both orders can fail; the two failures are not equal.

- **Log-then-enforce** can leave an audit row for a revocation that never took
  effect. The record would assert a fact about the world that is false, and a
  reviewer has no way to tell that row from a true one. A log that reports
  attempts as acts is worse than no log, because an innocent is accused by it.
- **Enforce-then-log** can leave the user revoked but the act unrecorded. The
  enforced state is the safe one, and the route returns `REVOKED_BUT_NOT_LOGGED`
  (500) rather than claiming success, so the admin retries. Retrying is safe
  because striking the epoch again is idempotent — the memory store keeps the
  *newer* timestamp (`Math.max`) and Redis simply overwrites — and the retry
  writes the missing row.

We accept the surviving hole explicitly: a revocation whose logging fails
repeatedly is enforced and unrecorded. It is visible as a 500 and in the
`admin.miniapp_sessions_revoked` structured log line with `ok: false`.

### 4. The `revocation` dependency is optional in the type but fails closed

Making the store a required dependency of the admin surface would break roughly
ten construction sites, most of them tests that have nothing to do with
revocation. Making it optional risks the silent-hole failure mode: a deployment
wired without a store where the route quietly appears to succeed.

So it is optional in the type and **fails closed at runtime** — absent store
yields 503 `SESSION_REVOCATION_NOT_AVAILABLE` and writes no audit row. The hole
is not left to hope: `tests/integration/admin-dashboard.test.ts` builds an admin
surface without the store and measures the 503 and the absent row.

### 5. The reason set is validated in both the route and the database, and the drift is guarded

Revocation takes a reason from a closed set of five. The set is enforced twice:
in the route (`isSessionRevocationReason`) and inside
`admin_revoke_miniapp_sessions` (an inline `in (...)`). This is not redundancy by
accident:

- The RPC is `security definer` and is the **authority** — it must not trust a
  caller.
- The route must validate *before* enforcing, because enforcement precedes
  logging (§3) and an unvalidated reason would strike an epoch that the database
  then refuses to record.

Two copies of a list drift. The drift is therefore **measured, not hoped for**:
`tests/unit/session-revocation-user-epoch.test.ts` reads the migration file from
disk, extracts its `in (...)` literals, and asserts they equal
`SESSION_REVOCATION_REASONS` exactly. Adding a reason to one place and not the
other fails CI.

## Consequences

- Admins revoke by user through `POST /admin/users/:id/revoke-sessions`, a CSRF
  form POST consistent with every other admin mutation.
- The `audit_log` row carries the **target's** `city_id`, not the actor's, so
  revocations read by where they landed rather than where the admin sat.
- The migration is purely additive (a new function, no schema change), so it is
  rollback-safe per `ح-8`.
- `REQUIRED_AUDITED_FUNCTION_COUNT` rose 18 → 19.
- Not proven in production (`ح-5`). Specifically unmeasured: behaviour under a
  real Redis eviction of an epoch key before its TTL, and concurrent revocation
  of the same user from two admin sessions.

## Alternatives rejected

- **Session registry keyed by user.** Rejected: requires an async issuer, which
  breaks the ADR 0077 SOS isolation guard (§1).
- **Deleting the user's refresh tokens.** Rejected: refresh tokens are stateless
  signed values, not rows; there is nothing to delete.
- **Shortening the absolute TTL instead.** Rejected: it narrows the exposure
  window for everyone without giving anyone the ability to revoke, and trades a
  permanent cost in re-logins for no mechanism.
