/**
 * الغرض: رسالةُ بلاغِ المفقودِ للسائقِ على تيليجرام (`F12-07`). تُرسَلُ ببوتِ
 *   السائقِ حصراً، وبلا لوحةِ أزرارٍ عمداً: الفعلُ «فتِّشْ سيّارتَك» لا ينتظرُ
 *   موافقةً ولا زرّاً. والنصُّ من القاموسِ بلغةِ السائقِ، ومعرّفُ المحادثةِ من
 *   الحمولةِ كما قرأتها القاعدةُ حيّةً لحظةَ الالتقاطِ.
 * الحالة: منفّذ فعلياً — 2026-09-18.
 * ينتمي إلى: infrastructure/notification
 * يُستخدم من: apps/workers/src/container.ts (عاملُ صندوقِ الصادرِ)
 */

import type {
  LostItemMessenger,
  LostItemNotice,
} from "../../application/dispatch/deliver-lost-item-notification.ts";
import { t } from "../../shared/i18n/index.ts";
import { guard } from "../db/client.ts";
import type { IdentifyingSender } from "./telegram-negotiation-notifier.ts";

export function createTelegramLostItemMessenger(
  driverSender: IdentifyingSender,
): LostItemMessenger {
  return {
    sendLostItemReport: (notice: LostItemNotice) =>
      guard("notifier.lostItemReport", async () => {
        const tr = t(notice.language);
        return driverSender.sendReturningId(
          notice.chatId,
          tr("driver.lost_item_report", { reference: notice.reference }),
          null,
        );
      }),
  };
}
