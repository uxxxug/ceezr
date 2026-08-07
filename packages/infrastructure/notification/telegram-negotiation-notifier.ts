/**
 * الغرض: كل رسائل دورة غير المشتركين على تلغرام: بطاقة القروب، بطاقة الإسناد، إخطارات
 *   فتح الدور وإغلاقه والاتفاق، وتمرير الرسائل بين الطرفين. لا نصّ مكتوب هنا:
 *   كل حرف من القواميس، وكل معرّف محادثة يأتي محسوباً من طبقة التطبيق لا مُخمَّناً.
 * الحالة: منفّذ فعلياً — المرحلة 2.3.
 * ينتمي إلى: infrastructure/notification
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts، apps/workers
 * ملاحظات مستقبلية: تعديل بطاقة القروب بعد الاتفاق (editMessageText) يُضاف في المرحلة 4.
 */

import type { Keyboard } from "../../application/bots/types.ts";
import type {
  EscalationCard,
  EscalationGroupPublisher,
} from "../../application/dispatch/escalate-unmatched-order.ts";
import type {
  UnsubscribedCard,
  UnsubscribedGroupPublisher,
} from "../../application/dispatch/publish-to-unsubscribed-group.ts";
import type {
  NegotiationNotifier,
  NegotiationParties,
} from "../../application/dispatch/register-unsubscribed-claim.ts";
import type {
  RelaySender,
  RelaySide,
} from "../../application/dispatch/relay-negotiation-message.ts";
import { DEFAULT_LANGUAGE, t } from "../../shared/i18n/index.ts";
import { guard } from "../db/client.ts";
import type { OutboundSender } from "./telegram-driver-notifier.ts";

/**
 * مُرسِل يعيد معرّف الرسالة — تحتاجه بطاقة القروب لتُعدَّل أو تُشار إليها لاحقاً،
 * بخلاف OutboundSender الذي يكتفي بنجاح/فشل.
 */
export interface IdentifyingSender {
  /** يعيد معرّف الرسالة المنشورة، أو null إن رفضها تلغرام. */
  sendReturningId(chatId: string, text: string, keyboard: Keyboard | null): Promise<string | null>;
}

/** لغة القروب: قروب مدينة لا لغة له، فالافتراضية هي لغة النظام. */
function groupLanguage(): string {
  return DEFAULT_LANGUAGE;
}

export function createUnsubscribedGroupPublisher(
  sender: IdentifyingSender,
): UnsubscribedGroupPublisher {
  return {
    publishCard: (card: UnsubscribedCard) =>
      guard("publisher.unsubscribedCard", async () => {
        const tr = t(groupLanguage());
        const serviceLabel = tr(
          card.service === "transport" ? "driver.service_transport" : "driver.service_delivery",
        );
        const text = tr("group.unsub_card", {
          service: serviceLabel,
          area: card.areaLabel,
          cycle: card.cycle,
          notes: card.notes ?? tr("group.unsub_no_notes"),
        });
        const keyboard: Keyboard = {
          kind: "inline",
          rows: [
            [
              {
                label: tr("group.unsub_accept_button"),
                data: `unsub:claim:${card.negotiationId}`,
              },
            ],
          ],
        };
        return sender.sendReturningId(card.groupId, text, keyboard);
      }),
  };
}

export function createEscalationGroupPublisher(
  sender: IdentifyingSender,
): EscalationGroupPublisher {
  return {
    publishEscalation: (card: EscalationCard) =>
      guard("publisher.escalationCard", async () => {
        const tr = t(groupLanguage());
        const serviceLabel = tr(
          card.service === "transport" ? "driver.service_transport" : "driver.service_delivery",
        );
        const text = tr("group.escalation_card", {
          service: serviceLabel,
          area: card.areaLabel,
          cycles: card.cyclesTried,
          reason: tr(`group.escalation_reason_${card.reason}`),
          order: card.orderId,
        });
        return sender.sendReturningId(card.groupId, text, null);
      }),
  };
}

/** طرفا القناة: كل رسالة تذهب لصاحبها بلغته هو، لا بلغة الطرف الآخر. */
export function createTelegramNegotiationNotifier(
  driverSender: OutboundSender,
  riderSender: OutboundSender,
): NegotiationNotifier {
  return {
    notifyTurnOpened: (parties: NegotiationParties, deadlineSeconds: number) =>
      guard("notifier.turnOpened", async () => {
        const driverTr = t(parties.driverLanguage);
        const riderTr = t(parties.riderLanguage);

        await driverSender.send(
          parties.driverChatId,
          driverTr("negotiation.driver_turn_opened", {
            seconds: deadlineSeconds,
            position: parties.position,
          }),
          null,
        );

        const riderKeyboard: Keyboard = {
          kind: "inline",
          rows: [
            [
              {
                label: riderTr("negotiation.rider_agree_button"),
                data: `unsub:agree:${parties.negotiationId}`,
              },
              {
                label: riderTr("negotiation.rider_decline_button"),
                data: `unsub:decline:${parties.negotiationId}`,
              },
            ],
          ],
        };
        await riderSender.send(
          parties.riderChatId,
          riderTr("negotiation.rider_turn_opened", {
            seconds: deadlineSeconds,
            position: parties.position,
          }),
          riderKeyboard,
        );
      }),

    notifyTurnClosed: (parties: NegotiationParties, reason: "declined" | "expired") =>
      guard("notifier.turnClosed", async () => {
        const key =
          reason === "expired"
            ? "negotiation.driver_turn_closed_expired"
            : "negotiation.driver_turn_closed_declined";
        await driverSender.send(parties.driverChatId, t(parties.driverLanguage)(key), null);
        await riderSender.send(
          parties.riderChatId,
          t(parties.riderLanguage)("negotiation.rider_turn_closed"),
          null,
        );
      }),

    notifyAgreed: (parties: NegotiationParties) =>
      guard("notifier.agreed", async () => {
        await driverSender.send(
          parties.driverChatId,
          t(parties.driverLanguage)("negotiation.agreed_driver"),
          null,
        );
        await riderSender.send(
          parties.riderChatId,
          t(parties.riderLanguage)("negotiation.agreed_rider"),
          null,
        );
      }),
  };
}

/** التمرير: من السائق إلى العميل والعكس، كلٌّ ببوته هو لأن المحادثتين منفصلتان. */
export function createTelegramRelaySender(
  driverSender: OutboundSender,
  riderSender: OutboundSender,
): RelaySender {
  return {
    relay: (parties: NegotiationParties, from: RelaySide, text: string) =>
      guard("relay.send", async () => {
        if (from === "driver") {
          const tr = t(parties.riderLanguage);
          return riderSender.send(
            parties.riderChatId,
            tr("negotiation.relay_from_driver", { text }),
            null,
          );
        }
        const tr = t(parties.driverLanguage);
        return driverSender.send(
          parties.driverChatId,
          tr("negotiation.relay_from_rider", { text }),
          null,
        );
      }),
  };
}
