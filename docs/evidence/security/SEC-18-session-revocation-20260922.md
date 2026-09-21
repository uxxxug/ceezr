# SEC-18 — Session revocation evidence

**Date:** 2026-09-22
**ADR:** [0173](../../adr/0173-session-revocation-is-a-per-jti-blocklist-built-into-the-session-reader.md)
**Item:** `SEC-18` in `docs/ROADMAP-MASTER.md` §11-و

## What was built

A per-`jti` session revocation blocklist, built into the `MiniAppSessionReader`
so that every session verification path checks revocation after signature
verification. The renewal path gets a separate check because it reads the
refresh token, not the access token.

### Files added

| File | Purpose |
|---|---|
| `packages/application/identity/ports.ts` | `SessionRevocationStore` port + `RevocationStoreFailure` types + `REVOKED` rejection reason |
| `packages/infrastructure/identity/redis-session-revocation-store.ts` | Redis adapter: `SET key 1 EX ttl` / `GET key` |
| `packages/infrastructure/identity/memory-session-revocation-store.ts` | In-memory adapter with lazy expiry for tests and single-instance |
| `packages/infrastructure/identity/revocable-session-reader.ts` | `createRevocableSessionReader` wrapper that adds revocation check to any `MiniAppSessionReader` |
| `tests/helpers/revocation-store.ts` | Test helper: `createTestRevocationStore()` |

### Files modified

| File | Change |
|---|---|
| `packages/application/identity/ports.ts` | `MiniAppSessionReader.read` made `async` (`Promise<Result<...>>`); `SessionRevocationStore` interface; `REVOKED` in `ViewerSessionRejectionReason` |
| `packages/application/identity/resolve-viewer.ts` | Removed separate `revocation` field (now in reader); `publicViewerCodeFor` maps `REVOKED` → `SESSION_INVALID` |
| `packages/application/identity/renew-miniapp-session.ts` | `revocation` dep + check before issuing new tokens |
| `packages/infrastructure/identity/miniapp-session.ts` | `createMiniAppSessionReader.read` made `async` |
| `packages/infrastructure/identity/index.ts` | Exports new adapters and wrapper |
| `apps/gateway/src/index.ts` | `createRevocableSessionReader` injected into all 34 deps objects; `revocation` kept on renew deps |
| `apps/gateway/src/realtime/adapters.ts` | `createSessionVerifier` takes `revocationStore` param; revocation check after `readMiniAppSession` |
| 26 use case files in `packages/application/` | `await deps.sessions.read()` + local `authenticate`/`openSession` helpers made `async` |
| 14+ test files | Mock readers made `async`; `revocation` field removed from `ResolveViewerDeps` tests; added to `RenewMiniAppSessionDeps` tests |

## Witness — behavioral, not existential

The requirement is that every verification path reads the revocation store —
a revoked session is rejected at every door.

### Three verification paths covered

1. **`authorizeViewer`** (resolve-viewer.ts) — the revocable reader is injected
   into `ResolveViewerDeps.sessions`. Every authenticated request goes through
   it. 26 call sites across 20+ use cases now `await` the reader.

2. **Realtime channel** (realtime/adapters.ts) — `createSessionVerifier` takes
   a `revocationStore` parameter and checks `isRevoked(sessionId)` after
   `readMiniAppSession` returns a valid session.

3. **Renewal path** (renew-miniapp-session.ts) — `RenewMiniAppSessionDeps` has
   a `revocation` field. The check runs before `issuer.issue()` — a revoked
   session cannot get a fresh access token through renewal.

### Architecture: revocable session reader

The `MiniAppSessionReader.read` interface was made `async`. The
`createRevocableSessionReader(reader, revocationStore)` wrapper:

1. Calls the underlying reader (signature verification, expiry check).
2. If valid, calls `revocationStore.isRevoked(sessionId)`.
3. Returns `REVOKED` if revoked, `NOT_CONFIGURED` if store unavailable.

The gateway injects this wrapper into all 34 dependency objects. No use case
code was modified for the revocation check itself — only the `async`/`await`
boundary moved.

### TTL: absolute session ceiling

The revocation entry's TTL is `MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS` (43200
seconds, 12 hours). This covers the absolute ceiling of the session, not just
the 10-minute access token. A revoked session cannot get fresh tokens through
renewal because the renewal path also checks revocation.

### Fail-closed

- Store unavailable → `NOT_CONFIGURED` → `503 SESSION_NOT_AVAILABLE`
- Revoked session → `REVOKED` → `SESSION_INVALID` (same as bad signature)
- No session is accepted when the store cannot be consulted

### Test results

```
Full suite: 5751 pass / 0 fail / 1440 skip / 18268 expect() calls
  - Mock readers return Promise<Result<...>>
  - Revocation check verified in authorizeViewer, realtime, and renewal paths
  - Fail-closed behavior verified
  - TTL covers absolute session ceiling
  - SOS path uses readSync (no revocation check — ADR-0077)
```

### حكمُ CI على `main` (`ح-4`) — يُضافُ ولا يُمحى

مقروءٌ **بالوظيفةِ لا بالجولةِ**، كما في سابقةِ `ح-4`. ولا إعادةَ تشغيلٍ لبصمةٍ
واحدةٍ تُحسَبُ جولةً ثانيةً: كلُّ جولةٍ على بصمةٍ متمايزةٍ على `main`.

| # | الجولةُ | البصمةُ | `verify` | PostgreSQL | Redis | فوضى (F5-06) | Roadmap freshness |
|---|---|---|---|---|---|---|---|
| ١ | `35660794565` | `96414e32` (دمجُ `#199`) | ✅ | ✅ | ✅ | ✅ | ✅ `35660794540` |
| ٢ | `35661430725` | `ad73e996` (تسجيلُ الحكمِ) | ✅ | ✅ | ✅ | ✅ | ✅ `35661430756` |
| ٣ | `35662011538` | `b5a08b80` (تسجيلُ الجولتَينِ) | ✅ | ✅ | ✅ | ✅ | ✅ `35662011506` |

**شرطُ `ح-4` مُستوفٌ**: ثلاثُ جولاتٍ خضراءَ متتاليةٍ على `main` ببصماتٍ متمايزةٍ،
الوظائفُ الأربعُ `success` في الثلاثِ ومعَها `Roadmap freshness`.

### ومعَ ذلكَ لا `[x]` — ساقانِ من نصِّ البندِ لم تُبنَيا (`ح-5`)

عمودُ العلاجِ الجذريِّ في `SEC-18` يطلبُ **ثلاثَ سواقٍ** لا ساقًا واحدةً:
«مخزنُ جلساتٍ أو قائمةُ منعٍ يقرؤُها كلُّ تحقُّقٍ، **معَ مسارِ إبطالٍ منَ اللوحةِ وسجلِّ قرارٍ**».

| الساقُ | الحالةُ | المقيسُ في الشِّيفرةِ |
|---|---|---|
| قائمةُ منعٍ يقرؤُها كلُّ تحقُّقٍ | **مبنيّةٌ** | `createRevocableSessionReader` في المساراتِ الثلاثةِ |
| مسارُ إبطالٍ منَ اللوحةِ | **غيرُ مبنيّةٍ** | `SessionRevocationStore.revoke` **بلا موضعِ نداءٍ إنتاجيٍّ واحدٍ** — لا مسلكَ بوّابةٍ ولا زرَّ لوحةٍ يُبطِلُ جلسةً. فالقدرةُ موجودةٌ ولا يدَ تبلُغُها |
| سجلُّ قرارٍ | **غيرُ مبنيٍّ** | المحوّلُ الإنتاجيُّ (Redis) يُسمّي السببَ `_reason` **ويُهمِلُهُ بحرفِهِ**. ومخزنُ الذّاكرةِ يحفظُهُ في المسارِ لا في سجلٍّ دائمٍ يُدقَّقُ |

فالمبنيُّ **محركُ الإنفاذِ لا واجهةُ القرارِ**: لو أُبطِلَت جلسةٌ لأُنفِذَ الإبطالُ في كلِّ
مسارٍ حالًا — ولكنّ لا أحدَ يقدِرُ أن يُبطِلَها اليومَ من اللوحةِ، ولا يُسأَلُ من أبطَلَ ولمَ.
وقلبُ البندِ إلى `[x]` بهذا **ادِّعاءٌ** (`ح-5`) وتعديلُ معنى نصٍّ بلا إذنٍ (`ح-1`) —
سابقةُ `F7-08` عَينُها: استوفى الجولاتِ الثلاثَ **وبقِيَ `[~]`**.
**فالاستيفاءُ يُسجَّلُ ولا يُصرَفُ.**

**SEC-18 يبقى `[~]`** — `ح-4` مُستوفٌ، والحاجزُ القائمُ ساقانِ من نصِّ البندِ لم تُبنَيا.

## What is measured

- **Revocation enforcement**: every `deps.sessions.read()` call goes through
  the revocable reader — 26 call sites across 20+ use cases.
- **Renewal path**: revoked `sessionId` is rejected before `issuer.issue()`.
- **Realtime path**: revoked `sessionId` is rejected after `readMiniAppSession`.
- **Fail-closed**: store unavailable → `SESSION_NOT_AVAILABLE` / `503`.
- **Public code**: `REVOKED` → `SESSION_INVALID` (no oracle for attacker).

## What is not claimed

- **Not production-proven** (`ح-5`): no real Redis was consulted, no real revoked
  session was tested on a live system.
- **Not "revoke all user sessions"**: revocation is per-`jti`.
- **Not a full session store**: the revocation store is a blocklist only.
