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
  SessionRevocationStatus,
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

/**
 * قيمةُ مفتاحِ العتبةِ إلى مللي ثوانٍ. قيمةٌ موجودةٌ لا تُقرَأُ عتبةً **ليسَت لاعتبةَ**:
 * المفتاحُ موجودٌ فالإبطالُ مضروبٌ، والقراءةُ هي التي أعجزتْ. فتُردُّ إخفاقاً — والقارئُ يُغلِقُ.
 */
function readEpoch(raw: unknown): Result<number | null, RevocationStoreFailure> {
  if (raw === null || raw === undefined) return ok(null);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return err({ kind: "STORE_UNAVAILABLE", detail: "revocation epoch is unreadable" });
  }
  return ok(parsed);
}

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
      return readEpoch(result.value);
    },

    async checkSession(
      sessionId: string,
      telegramUserId: string,
    ): Promise<Result<SessionRevocationStatus, RevocationStoreFailure>> {
      /*
       * `LOAD-01`: `MGET` بدلَ `GET` ثمَّ `GET` — رحلةٌ واحدةٌ إلى Upstash لكلِّ تحقُّقٍ من
       * جلسة. والمعنى حرفاً كالفحصَين المتتابعَين: وجودُ أيِّ قيمةٍ في مفتاحِ الجلسةِ إبطالٌ،
       * والعتبةُ تُقرأُ بـ`readEpoch` نفسِها، وأيُّ ردٍّ لا يُفهَمُ شكلُه إخفاقٌ والقارئُ يُغلِق.
       */
      const result = await redis.command([
        "MGET",
        `${KEY_PREFIX}${sessionId}`,
        `${USER_KEY_PREFIX}${telegramUserId}`,
      ]);
      if (!result.ok) {
        return err({ kind: "STORE_UNAVAILABLE", detail: result.error.detail });
      }
      const values = result.value;
      if (!Array.isArray(values) || values.length !== 2) {
        return err({ kind: "STORE_UNAVAILABLE", detail: "revocation status is unreadable" });
      }
      // ترتيبُ الحكمِ كالمتتابعِ: جلسةٌ مُبطَلةٌ تُرفَضُ «مُبطَلةً» قبلَ أن تُقرأَ العتبةُ أصلاً،
      // فعتبةٌ لا تُقرَأُ لا تُحوِّلُ «مُبطَلة» إلى «غيرِ مُهيَّأ» (اختبارُ التكافؤِ يحرسُ هذا).
      if (values[0] !== null && values[0] !== undefined) {
        return ok({ sessionRevoked: true, userRevokedAtMs: null });
      }
      const epoch = readEpoch(values[1]);
      if (!epoch.ok) return epoch;
      return ok({ sessionRevoked: false, userRevokedAtMs: epoch.value });
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
