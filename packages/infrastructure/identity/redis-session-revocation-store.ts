/**
 * الغرض: محوّلُ مخزنِ إبطالِ الجلساتِ على Redis — قائمةُ منعٍ يقرؤها كلُّ تحقُّقٍ.
 *   الاستهلاكُ ذرّيٌّ بـ`SET key value EX ttl` عندَ الإبطال، والفحصُ بـ`GET key`.
 * الحالة: منفّذ — البند `SEC-18`.
 * ينتمي إلى: infrastructure/identity
 *
 * قواعدُ صارمةٌ في هذا الملف:
 *   ١) لا يُسجَّلُ `sessionId` ولا مفتاحُ Redis في السجلّات.
 *   ٢) الفشلُ في الوصولِ إلى Redis **إغلاقٌ لا فتحٌ**: لا تُقبَل الجلسةُ بلا فحص.
 *   ٣) العمرُ يُغطّي السقفَ المطلقَ للجلسة لا عمرَ الرمزِ الحاليّ.
 */

import type {
  RevocationStoreFailure,
  SessionRevocationStore,
} from "../../application/identity/ports.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { RedisClient } from "../redis/upstash.ts";

const KEY_PREFIX = "revoked-session:";

export function createRedisSessionRevocationStore(redis: RedisClient): SessionRevocationStore {
  return {
    async isRevoked(sessionId: string): Promise<Result<boolean, RevocationStoreFailure>> {
      const key = `${KEY_PREFIX}${sessionId}`;
      const result = await redis.command(["GET", key]);
      if (!result.ok) {
        return err({ kind: "STORE_UNAVAILABLE", detail: result.error.detail });
      }
      return ok(result.value !== null && result.value !== undefined);
    },

    async revoke(
      sessionId: string,
      ttlSeconds: number,
      _reason: string,
    ): Promise<Result<true, RevocationStoreFailure>> {
      const key = `${KEY_PREFIX}${sessionId}`;
      const ttl = Math.max(1, Math.ceil(ttlSeconds));
      const result = await redis.command(["SET", key, "1", "EX", String(ttl)]);
      if (!result.ok) {
        return err({ kind: "STORE_UNAVAILABLE", detail: result.error.detail });
      }
      return ok(true);
    },
  };
}
