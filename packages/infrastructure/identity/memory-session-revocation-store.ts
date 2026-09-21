/**
 * الغرض: محوّلُ مخزنِ إبطالِ الجلساتِ في الذاكرة — للنسخةِ الواحدةِ والاختبار.
 *   قائمةُ منعٍ بمسحٍ كسولٍ للعناصرِ المنتهية. لا يُشارَكُ بينَ العمليات.
 * الحالة: منفّذ — البند `SEC-18`.
 * ينتمي إلى: infrastructure/identity
 *
 * قواعدُ صارمة: لا يُسجَّلُ `sessionId` في السجلّات. والفشلُ مستحيلٌ ههنا (الذاكرةُ
 * المحليةُ لا تتعطّل)، لكنّ الواجهةَ تحتفظُ بنوعِ الفشلِ للتوافقِ مع المنفذِ.
 */

import type {
  RevocationStoreFailure,
  SessionRevocationStore,
} from "../../application/identity/ports.ts";
import { ok, type Result } from "../../shared/result/index.ts";

interface RevokedEntry {
  readonly expiresAtMs: number;
  readonly reason: string;
}

interface UserEpochEntry {
  readonly revokedAtMs: number;
  readonly expiresAtMs: number;
  readonly reason: string;
}

export function createMemorySessionRevocationStore(): SessionRevocationStore {
  const store = new Map<string, RevokedEntry>();
  /** عتباتُ إبطالِ المستخدمينَ (`SEC-18-ب`) — منفصلةٌ عن قائمةِ منعِ `jti`. */
  const userEpochs = new Map<string, UserEpochEntry>();

  function cleanup(nowMs: number): void {
    for (const [key, entry] of store) {
      if (entry.expiresAtMs <= nowMs) {
        store.delete(key);
      }
    }
  }

  return {
    async isRevoked(sessionId: string): Promise<Result<boolean, RevocationStoreFailure>> {
      const nowMs = Date.now();
      cleanup(nowMs);
      const entry = store.get(sessionId);
      if (entry === undefined) return ok(false);
      if (entry.expiresAtMs <= nowMs) {
        store.delete(sessionId);
        return ok(false);
      }
      return ok(true);
    },

    async revoke(
      sessionId: string,
      ttlSeconds: number,
      reason: string,
    ): Promise<Result<true, RevocationStoreFailure>> {
      const ttl = Math.max(1, Math.ceil(ttlSeconds));
      store.set(sessionId, {
        expiresAtMs: Date.now() + ttl * 1000,
        reason,
      });
      return ok(true);
    },

    async revokedAtMsForUser(
      telegramUserId: string,
    ): Promise<Result<number | null, RevocationStoreFailure>> {
      const nowMs = Date.now();
      const entry = userEpochs.get(telegramUserId);
      if (entry === undefined) return ok(null);
      if (entry.expiresAtMs <= nowMs) {
        userEpochs.delete(telegramUserId);
        return ok(null);
      }
      return ok(entry.revokedAtMs);
    },

    async revokeAllForUser(
      telegramUserId: string,
      atMs: number,
      ttlSeconds: number,
      reason: string,
    ): Promise<Result<true, RevocationStoreFailure>> {
      const ttl = Math.max(1, Math.ceil(ttlSeconds));
      /*
       * عتبةٌ أحدثُ لا تُدهَسُ بأقدمَ: الإبطالُ لا يُنقَضُ بطلبٍ متأخِّرٍ حملَ
       * لحظةً أسبقَ. والاختيارُ صريحٌ ههنا لأنَّ الذاكرةَ تسمحُ بهِ بلا كلفةٍ.
       */
      const existing = userEpochs.get(telegramUserId);
      const revokedAtMs =
        existing !== undefined && existing.expiresAtMs > Date.now()
          ? Math.max(existing.revokedAtMs, Math.floor(atMs))
          : Math.floor(atMs);
      userEpochs.set(telegramUserId, {
        revokedAtMs,
        expiresAtMs: Date.now() + ttl * 1000,
        reason,
      });
      return ok(true);
    },
  };
}
