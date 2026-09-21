/**
 * الغرض: رسالةُ مآلِ البلاغِ للمُبلِّغِ على تيليجرام (`PD-021`). تُرسَلُ ببوتِ
 *   الراكبِ إن كانَ القرارُ `close`، وببوتِ الراكبِ كذلك إن كانَ `block_reporter` —
 *   فالمُبلِّغُ يُخبَرُ بالمآلِ العامِّ بلا كشفِ السببِ الداخليِّ. والنصُّ من القاموسِ
 *   بلغةِ المُبلِّغِ، ومعرّفُ المحادثةِ من الحمولةِ كما قرأتها القاعدةُ حيّةً لحظةَ
 *   الالتقاطِ.
 * الحالة: منفّذ فعلياً — 2026-09-21.
 * ينتمي إلى: infrastructure/notification
 * يُستخدم من: apps/workers/src/container.ts (عاملُ صندوقِ الصادرِ)
 */

import type {
  SafetyResolutionMessenger,
  SafetyResolutionNotice,
} from "../../application/safety/deliver-safety-resolution.ts";
import { t } from "../../shared/i18n/index.ts";
import { guard } from "../db/client.ts";
import type { IdentifyingSender } from "./telegram-negotiation-notifier.ts";

export function createTelegramSafetyResolutionMessenger(
  sender: IdentifyingSender,
): SafetyResolutionMessenger {
  return {
    sendResolution: (notice: SafetyResolutionNotice) =>
      guard("notifier.safetyResolution", async () => {
        const tr = t(notice.language);
        const key =
          notice.decision === "block_reporter"
            ? "safety.resolution_blocked"
            : "safety.resolution_closed";
        return sender.sendReturningId(notice.chatId, tr(key), null);
      }),
  };
}
