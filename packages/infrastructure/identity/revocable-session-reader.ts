/**
 * الغرض: غلافٌ على `MiniAppSessionReader` يُضيفُ فحصَ الإبطالِ (`SEC-18`).
 *   يُغلِّفُ قارئَ الجلسةِ ومخزنَ الإبطالِ في قارئٍ واحدٍ — فلا يُمكنُ الوصولُ
 *   إلى جلسةٍ صحيحةٍ بلا فحصِ الإبطال. وهذا يضمنُ أنَّ كلَّ تحقُّقٍ يقرأُ القائمةَ.
 * الحالة: منفّذ — البند `SEC-18`.
 * ينتمي إلى: infrastructure/identity
 *
 * قواعدُ صارمة: الفشلُ في الوصولِ إلى مخزنِ الإبطالِ **إغلاقٌ لا فتحٌ**.
 */

import type {
  MiniAppSessionReader,
  RevocationStoreFailure,
  SessionRevocationStore,
  VerifiedViewerSession,
  ViewerSessionRejection,
} from "../../application/identity/ports.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";

/**
 * يُنشئ قارئَ جلسةٍ يفحصُ الإبطالَ بعدَ التحقّقِ التشفيريِّ. يُستعمَلُ مكانَ
 * `createMiniAppSessionReader` في كلِّ مسارٍ يحتاجُ تحقُّقًا من الجلسة.
 */
export function createRevocableSessionReader(
  reader: MiniAppSessionReader,
  revocation: SessionRevocationStore,
): MiniAppSessionReader {
  return {
    read: async (
      accessToken: string,
      nowMs: number,
    ): Promise<Result<VerifiedViewerSession, ViewerSessionRejection>> => {
      const session = await reader.read(accessToken, nowMs);
      if (!session.ok) return session;

      // فحصُ الإبطالِ (`SEC-18`): بعدَ التحقّقِ التشفيريِّ وقبلَ قبولِ الجلسة.
      const revoked = await revocation.isRevoked(session.value.sessionId);
      if (!revoked.ok) {
        // الفشلُ في الوصولِ إلى المخزنِ — إغلاقٌ لا فتحٌ.
        return err({ code: "SESSION_REJECTED", reason: "NOT_CONFIGURED" });
      }
      if (revoked.value) {
        return err({ code: "SESSION_REJECTED", reason: "REVOKED" });
      }

      /*
       * عتبةُ إبطالِ المستخدمِ (`SEC-18-ب`): الإبطالُ من اللوحةِ يستهدفُ **مستخدماً**
       * لا `jti`، فيُرفَضُ كلُّ رمزٍ أُصدِرَ **قبلَ** العتبةِ. وهذا يُغلِقُ الجلساتَ
       * القائمةَ كلَّها وسلاسلَ تجديدِها بلا سجلِّ جلساتٍ يُعَدُّ منه.
       *
       * والمقارنةُ `<` لا `<=`: العتبةُ تُضرَبُ بلحظةِ الإبطالِ، ورمزٌ أُصدِرَ في
       * المللي ثانيةِ نفسِها لم يسبقْها.
       */
      const revokedAtMs = await revocation.revokedAtMsForUser(session.value.telegramUserId);
      if (!revokedAtMs.ok) {
        // الفشلُ في الوصولِ إلى المخزنِ — إغلاقٌ لا فتحٌ.
        return err({ code: "SESSION_REJECTED", reason: "NOT_CONFIGURED" });
      }
      if (revokedAtMs.value !== null && session.value.issuedAtSeconds * 1000 < revokedAtMs.value) {
        return err({ code: "SESSION_REJECTED", reason: "REVOKED" });
      }
      return ok(session.value);
    },
    // `readSync` لا يفحصُ الإبطالَ — لمسارِ الاستغاثةِ (`SOS`) حصراً، حيثُ السلامةُ
    // تسبقُ الأمنَ (`ADR-0077`).
    readSync: (accessToken, nowMs) => reader.readSync(accessToken, nowMs),
  };
}

/**
 * نوعُ نتيجةِ فحصِ الإبطالِ للقارئِ القابلِ للإبطال. يُستعمَلُ في الاختبارات.
 */
export type { RevocationStoreFailure };
