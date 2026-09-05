/**
 * الغرض: إخطار السائق بعرض حقيقي: يقرأ معرّف دردشته ولغته من القاعدة، ويرسل نصّاً من القواميس
 *   مع زرّي قبول ورفض يحملان معرّف الطلب. لا نصّ مكتوب هنا ولا معرّف مُخمَّن.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة 2.1.
 * ينتمي إلى: infrastructure/notification
 * يُتوقع أن يستخدمه لاحقاً: application/dispatch/broadcast-offers عبر منفذ DriverNotifier
 * ملاحظات مستقبلية: سائق حجب البوت يُبلَّغ عنه كـ unreachable ليُستبعد من الدورة التالية.
 */

import type { Keyboard } from "../../application/bots/types.ts";
import type {
  CancellationNotice,
  DriverNotifier,
  OfferNotification,
} from "../../application/dispatch/broadcast-offers.ts";
import { t } from "../../shared/i18n/index.ts";
import { guard, type Sql } from "../db/client.ts";

/** إرسالٌ فعلي إلى المنصّة — يحقّقه محوّل grammY في apps/gateway. */
export interface OutboundSender {
  send(chatId: string, text: string, keyboard: Keyboard | null): Promise<boolean>;
}

interface DriverContactRow {
  readonly telegram_id: string;
  readonly language_code: string;
}

const KM_DECIMALS = 1;

export function createTelegramDriverNotifier(sql: Sql, sender: OutboundSender): DriverNotifier {
  return {
    notifyOffer: (notification: OfferNotification) =>
      guard("notifier.notifyOffer", async () => {
        const rows = await sql<DriverContactRow[]>`
          select u.telegram_id, u.language_code
            from drivers d
            join users u on u.id = d.user_id
           where d.id = ${notification.driverId}
        `;
        const contact = rows[0];
        if (contact === undefined) return false;

        const tr = t(contact.language_code);
        const text = tr("driver.offer_received", {
          distance: notification.distanceKm.toFixed(KM_DECIMALS),
          seconds: notification.expiresInSeconds,
        });
        const keyboard: Keyboard = {
          kind: "inline",
          rows: [
            [
              {
                label: tr("driver.offer_accept_button"),
                data: `offer:accept:${notification.orderId}`,
              },
              {
                label: tr("driver.offer_reject_button"),
                /**
                 * الرفضُ يحمِلُ `offerId` لا `orderId`: كلُّ زرٍّ مُعلَّقٌ على عرضٍ
                 * بعينِه، فيُرفَضُ عرضٌ واحدٌ لا كلُّ عرضٍ معلَّقٍ للسائقِ على الطلبِ (`BUG-003`).
                 * ومعرّفُ العرضِ uuid (٦٣ حرفاً)، فيَبلى `offer:reject:<uuid>` ٥٠ حرفاً —
                 * تحتَ حدِّ تلغرامَ ٦٤ لـ`callback_data`.
                 */
                data: `offer:reject:${notification.offerId}`,
              },
            ],
          ],
        };
        return sender.send(String(contact.telegram_id), text, keyboard);
      }),

    /**
     * إخطار الإلغاء. بلا لوحة أزرار عمداً: الطلب انتهى، فأي زرّ باقٍ يدعو إلى
     * فعل لا محلّ له. والمُسنَد يُخاطَب بنصّ آخر لأنه كان في طريقه فعلاً.
     */
    notifyCancelled: (notice: CancellationNotice) =>
      guard("notifier.notifyCancelled", async () => {
        const rows = await sql<DriverContactRow[]>`
          select u.telegram_id, u.language_code
            from drivers d
            join users u on u.id = d.user_id
           where d.id = ${notice.driverId}
        `;
        const contact = rows[0];
        if (contact === undefined) return false;

        const tr = t(contact.language_code);
        const text = tr(
          notice.wasAssigned ? "driver.order_cancelled_assigned" : "driver.order_cancelled_offer",
        );
        return sender.send(String(contact.telegram_id), text, null);
      }),
  };
}
