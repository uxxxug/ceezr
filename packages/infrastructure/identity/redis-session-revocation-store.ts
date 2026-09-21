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
/**
 * مفتاحُ عتبةِ إبطالِ **كلِّ جلساتِ مستخدمٍ** (`SEC-18-ب`). وقيمتُهُ لحظةُ
 * الإبطالِ بالمللي ثانيةِ لا `1`، إذ المطلوبُ مقارنةٌ بـ`iat` لا وجودٌ مجرَّدٌ.
 */
const USER_KEY_PREFIX = "revoked-user:";

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

    async revokedAtMsForUser(
      telegramUserId: string,
    ): Promise<Result<number | null, RevocationStoreFailure>> {
      const key = `${USER_KEY_PREFIX}${telegramUserId}`;
      const result = await redis.command(["GET", key]);
      if (!result.ok) {
        return err({ kind: "STORE_UNAVAILABLE", detail: result.error.detail });
      }
      const raw = result.value;
      if (raw === null || raw === undefined) return ok(null);
      /*
       * قيمةٌ موجودةٌ لا تُقرَأُ عتبةً **ليسَت لاعتبةَ**: المفتاحُ موجودٌ فالإبطالُ
       * مضروبٌ، والقراءةُ هي التي أعجزتْ. فتُردُّ إخفاقاً — والقارئُ يُغلِقُ.
       */
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        return err({ kind: "STORE_UNAVAILABLE", detail: "revocation epoch is unreadable" });
      }
      return ok(parsed);
    },

    async revokeAllForUser(
      telegramUserId: string,
      atMs: number,
      ttlSeconds: number,
      _reason: string,
    ): Promise<Result<true, RevocationStoreFailure>> {
      /*
       * والسببُ لا يُحفَظُ هاهنا **ولا يُدَّعى أنَّهُ محفوظٌ**: هذا المخزنُ
       * **إنفاذٌ** وقيمتُهُ تفنى بانتهاءِ العمرِ، فلا يصلُحُ سجلَّ قرارٍ.
       * وسجلُّ القرارِ المعمُولُ بهِ هو `audit_log` في `PostgreSQL` (`ADR 0174`).
       */
      const key = `${USER_KEY_PREFIX}${telegramUserId}`;
      const ttl = Math.max(1, Math.ceil(ttlSeconds));
      const result = await redis.command(["SET", key, String(Math.floor(atMs)), "EX", String(ttl)]);
      if (!result.ok) {
        return err({ kind: "STORE_UNAVAILABLE", detail: result.error.detail });
      }
      return ok(true);
    },
  };
}
