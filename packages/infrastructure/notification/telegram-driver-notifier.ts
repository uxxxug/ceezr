/**
 * الغرض: إخطار السائق بعرض حقيقي: يقرأ معرّف دردشته ولغته من القاعدة، ويرسل نصّاً من القواميس
 *   مع زرّي قبول ورفض يحملان معرّف الطلب. لا نصّ مكتوب هنا ولا معرّف مُخمَّن.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة 2.1.
 * ينتمي إلى: infrastructure/notification
 * يُستخدم من: apps/workers/src/container.ts عبر منفذ OfferPublisher
 * ملاحظات مستقبلية: سائق حجب البوت يُبلَّغ عنه كـ unreachable ليُستبعد من الدورة التالية.
 */

import type { Keyboard } from "../../application/bots/types.ts";
import type {
  OfferNotification,
  OfferPublisher,
} from "../../application/dispatch/broadcast-offers.ts";
import { t } from "../../shared/i18n/index.ts";
import { guard, type Sql } from "../db/client.ts";
import type { IdentifyingSender } from "./telegram-negotiation-notifier.ts";

/**
 * الناشر غير المتزامن لعروض التوصيل: يُستخدمه عاملُ تسليم الإشعار (BUG-004 outbox).
 * يعيد مُعرِّف الرسالة الفعليّ (message_id) من تلغرام — فهو دليلُ التسليم الفعليّ
 * الذي يُخزَّن في عمود `delivered_message_id`. هذا على نقيض `OutboundSender` القديم
 * الذي كان يعيد booleanًا فلا يُمكن إثباتُ التسليم ولا منعُ الإعادة المكرَّرة.
 *
 * `IdentifyingSender` هو ذاته منفذُ إشعارات التفاوض — تُعيد `sendReturningId`
 * معرِّفَ الرسالة (string) أو null عند الفشل. نُحوِّل null إلى فشل صريح.
 */

/** إرسالٌ فعلي إلى المنصّة — يحقّقه محوّل grammY في apps/gateway. */
export interface OutboundSender {
  send(chatId: string, text: string, keyboard: Keyboard | null): Promise<boolean>;
}

interface DriverContactRow {
  readonly telegram_id: string;
  readonly language_code: string;
}

const KM_DECIMALS = 1;

/**
 * ناشرُ الإشعار لِعاملِ تسليم عروض التوصيل (BUG-004 — نمط Outbox). يُبنى في
 * `apps/workers/src/container.ts` ويُمرَّر إلى عامل `deliver-notifications`.
 *
 * وهو يُعيدُ مُعرِّفَ الرسالة الفعليَّ (message_id) لا booleanًا — فهو الدليلُ الذي
 * يُخزَّن في `delivered_message_id` لمنعِ إعادةِ الإرسالِ بعد نجاحٍ سابق.
 *
 * يُلقي `DRIVER_CONTACT_NOT_FOUND` عند غيابِ سجلِّ التواصل، و`TELEGRAM_SEND_FAILED`
 * عند إرجاعِ `sendReturningId` لـnull — وكلاهما يُحوَّلان عبر `guard` إلى
 * `PortFailureError` يُعاد معالجته من عاملِ التسليم (إعادةُ المحاولة أو الأَماتة).
 */
export function createOfferPublisher(sql: Sql, sender: IdentifyingSender): OfferPublisher {
  return {
    publishOffer: (notification: OfferNotification) =>
      guard("publisher.publishOffer", async () => {
        const rows = await sql<DriverContactRow[]>`
          select u.telegram_id, u.language_code
            from drivers d
            join users u on u.id = d.user_id
           where d.id = ${notification.driverId}
        `;
        const contact = rows[0];
        if (contact === undefined) {
          throw new Error("DRIVER_CONTACT_NOT_FOUND");
        }

        const tr = t(contact.language_code);
        // PD-051: ترتيبُ بطاقةِ العرضِ — خدمةٌ ← من أينَ ← إلى أينَ ← مسافة/وقتٌ ← قيود.
        // البياناتُ كلُّها من الطلبِ الموجودِ مسبقًا — إعادةُ ترتيبٍ لا بياناتٍ جديدة.
        const serviceLabel =
          notification.service === "transport"
            ? tr("driver.offer_card_service_transport")
            : notification.service === "delivery"
              ? tr("driver.offer_card_service_delivery")
              : (notification.service ?? "");
        const lines: string[] = [];
        if (notification.service !== null) {
          lines.push(tr("driver.offer_card_service", { service: serviceLabel }));
        }
        if (notification.pickupLabel !== null && notification.pickupLabel !== "") {
          lines.push(tr("driver.offer_card_from", { pickup: notification.pickupLabel }));
        }
        if (notification.dropoffLabel !== null && notification.dropoffLabel !== "") {
          lines.push(tr("driver.offer_card_to", { dropoff: notification.dropoffLabel }));
        }
        lines.push(
          tr("driver.offer_card_distance", {
            distance: notification.distanceKm.toFixed(KM_DECIMALS),
          }),
        );
        lines.push(tr("driver.offer_card_time", { seconds: notification.expiresInSeconds }));
        if (notification.notes !== null && notification.notes !== "") {
          lines.push(tr("driver.offer_card_notes", { notes: notification.notes }));
        }
        const text = lines.join("\n");
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
                data: `offer:reject:${notification.offerId}`,
              },
            ],
          ],
        };
        const messageId = await sender.sendReturningId(String(contact.telegram_id), text, keyboard);
        if (messageId === null) {
          throw new Error("TELEGRAM_SEND_FAILED");
        }
        return messageId;
      }),
  };
}
