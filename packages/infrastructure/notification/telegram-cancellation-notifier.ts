/**
 * الغرض: رسالةُ إلغاءِ الطلبِ للسائقِ على تيليجرام. تُرسَلُ ببوتِ السائقِ حصراً،
 *   وبلا لوحةِ أزرارٍ عمداً: الطلبُ انتهى فأيُّ زرٍّ باقٍ يدعو إلى فعلٍ لا محلَّ له.
 *   والمُسنَدُ يُخاطَبُ بنصٍّ آخرَ لأنّه كان في طريقِه فعلًا. ولا حرفَ مكتوبٌ هنا:
 *   النصُّ من القاموسِ بلغةِ السائقِ، ومعرّفُ المحادثةِ من الحمولةِ كما قرأتها
 *   القاعدةُ حيّةً لحظةَ الالتقاطِ.
 * الحالة: منفّذ فعلياً — 2026-09-06.
 * ينتمي إلى: infrastructure/notification
 * يُستخدم من: apps/workers/src/container.ts (عاملُ صندوقِ الصادرِ)
 * ملاحظات مستقبلية: سحبُ بطاقةِ العرضِ من محادثةِ السائقِ يُضافُ هنا إن قُرِّرَ.
 */

import type {
  CancellationMessenger,
  CancellationNotice,
} from "../../application/dispatch/deliver-cancellation-notification.ts";
import { t } from "../../shared/i18n/index.ts";
import { guard } from "../db/client.ts";
import type { IdentifyingSender } from "./telegram-negotiation-notifier.ts";

export function createTelegramCancellationMessenger(
  driverSender: IdentifyingSender,
): CancellationMessenger {
  return {
    sendOrderCancelled: (notice: CancellationNotice) =>
      guard("notifier.orderCancelled", async () => {
        const tr = t(notice.language);
        const key = notice.wasAssigned
          ? "driver.order_cancelled_assigned"
          : "driver.order_cancelled_offer";
        return driverSender.sendReturningId(notice.chatId, tr(key), null);
      }),
  };
}
