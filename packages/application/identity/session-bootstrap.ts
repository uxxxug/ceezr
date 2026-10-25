/**
 * الغرض: قراءةُ إقلاعِ الجلسةِ المُدمَجةُ — حسابُ صاحبِ الجلسةِ وسجلُّ موافقاتِه
 *   **بعبارةٍ واحدةٍ** تُعادُ منها نتيجتا المنفذَينِ المستقلَّينِ كما كانتا (`LOAD-01`).
 * الحالة: منفّذ فعلياً — `LOAD-01` · قياسُ الإشغالِ في
 *   `docs/evidence/capacity/LOAD01-SESSION-BOOTSTRAP-COALESCE-20261025/RESULT.md`.
 * ينتمي إلى: application/identity
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/routes/session-telegram.ts` (`bootstrapReads`).
 *
 * لماذا؟ مبادلةُ الجلسةِ تُضمِّنُ قراءتَي `GET /v1/me` و`GET /v1/consents` (`ADR 0210`)،
 * وكانت كلٌّ منهما تأخذُ اتصالاً من مجمَّعِ الطلباتِ (حدُّه المحميُّ `gatewayRequest: 5`).
 * والقياسُ (`LOAD01-C1`) أنَّ مسكَ الاتصالِ على المقعدِ تحكمُه حلقةُ أحداثِ البوّابةِ لا
 * زمنُ القاعدةِ؛ فإسقاطُ أخذةٍ كاملةٍ من كلِّ إقلاعٍ يُنقِصُ الإشغالَ لا زمنَ SQL وحدَه.
 *
 * ما لا يفعله عن قصدٍ:
 *   ــ لا يُخزِّنُ شيئاً بين طلبَينِ: الذاكرةُ **لكلِّ نداءِ إقلاعٍ** وحدَه، فلا يتقادمُ حجبٌ
 *      ولا دورٌ (قرارُ الدفعةِ 11: رفضُ تخزينِ حلِّ المُشاهِدِ لأنه يؤخِّرُ أثرَ الحجبِ).
 *   ــ لا يُغيِّرُ حالةَ استخدامٍ: `resolveViewer` و`readConsentStatus` تُستدعيانِ كما هما
 *      بمنفذَينِ يقرآنِ من اللقطةِ نفسِها؛ فالحكمُ والتحقّقُ من الرمزِ في مكانِهما.
 *   ــ لا يُخفي فشلاً: فشلُ العبارةِ يعودُ خطأً **للقراءتَينِ كلتيهما**، فتُحذفانِ من الردِّ
 *      ويعودُ العميلُ إلى مسارَيهما المستقلَّينِ كما يفعلُ عندَ أيِّ فشلٍ في التضمين.
 */

import type { RecordedConsent } from "../../domain/consent/consent-decision.ts";
import { err, type Result } from "../../shared/result/index.ts";
import type { ConsentRecordReader, ConsentStoreFailure } from "../consent/ports.ts";
import type { ViewerAccount, ViewerAccountReader, ViewerLookupFailure } from "./ports.ts";

/** نتيجتا المنفذَينِ كما يُعيدُهما كلٌّ منهما منفرداً — بلا شكلٍ ثالث. */
export interface SessionBootstrapSnapshot {
  readonly account: Result<ViewerAccount | null, ViewerLookupFailure>;
  readonly consents: Result<readonly RecordedConsent[], ConsentStoreFailure>;
}

/**
 * قراءةٌ واحدةٌ لكليهما. **لا ترمي**: الفشلُ يعودُ في الحقلَينِ (`READER_ERROR` ·
 * `STORE_ERROR`) كما كانَ سيعودُ من كلِّ منفذٍ لو فشلَت عبارتُه.
 */
export interface SessionBootstrapSnapshotReader {
  read(telegramUserId: string): Promise<SessionBootstrapSnapshot>;
}

const SNAPSHOT_FAILED: SessionBootstrapSnapshot = {
  account: err({ code: "VIEWER_LOOKUP_FAILED", reason: "READER_ERROR" }),
  consents: err({ code: "CONSENT_STORE_FAILED", reason: "STORE_ERROR" }),
};

/**
 * منفذا قراءةٍ يتقاسمانِ لقطةً واحدةً **لكلِّ معرّفٍ في هذا النداءِ**. يُنشأُ زوجٌ جديدٌ
 * لكلِّ إقلاعٍ ثمَّ يُرمى؛ فالقراءةُ الثانيةُ لا تصلُ القاعدةَ، ولا شيءَ يعيشُ بعدَ الطلب.
 */
export function coalescedBootstrapPorts(reader: SessionBootstrapSnapshotReader): {
  readonly accounts: ViewerAccountReader;
  readonly consents: ConsentRecordReader;
} {
  const memo = new Map<string, Promise<SessionBootstrapSnapshot>>();
  const snapshot = (telegramUserId: string): Promise<SessionBootstrapSnapshot> => {
    const known = memo.get(telegramUserId);
    if (known !== undefined) return known;
    const pending = reader.read(telegramUserId).catch(() => SNAPSHOT_FAILED);
    memo.set(telegramUserId, pending);
    return pending;
  };
  return {
    accounts: {
      findByTelegramUserId: async (telegramUserId) => (await snapshot(telegramUserId)).account,
    },
    consents: {
      listForTelegramUser: async (telegramUserId) => (await snapshot(telegramUserId)).consents,
    },
  };
}
