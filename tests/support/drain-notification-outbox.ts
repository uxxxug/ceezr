/**
 * الغرض: تفريغُ صفوفِ صندوقِ الصادرِ المعلَّقةِ في اختباراتِ التكامل — يُقلِّدُ ما
 *   يفعلهُ عاملُ `deliver-notifications` في الإنتاج، لكنَّه متزامنٌ هنا حتى
 *   يصلَ الإشعارُ إلى مُلتقِطِ الرسائلِ قبلَ التحقّقِ منه. منذُ BUG-004 لم يَعُدْ
 *   أثرُ الإشعارِ يقعُ متزامنًا خارجَ المعاملة، بل يُودَعُ صفُّهُ داخلَها
 *   ويُتركُ التسليمُ للعامل. فاختباراتُ المسارِ الكاملِ التي كانت تتحقّقُ من
 *   وصولِ العرضِ للسائقِ تحتاجُ الآنَ إلى استنزافِ الصفِّ.
 * الحالة: أداةُ اختبارٍ فقط.
 * ينتمي إلى: tests/support
 */

import type { TelegramSender } from "../../apps/gateway/src/bots/driver/index.ts";
import { deliverNotifications } from "../../apps/workers/src/jobs/deliver-notifications.ts";
import {
  createAgreedHandler,
  createTurnClosedHandler,
  createTurnOpenedHandler,
} from "../../packages/application/dispatch/deliver-negotiation-notification.ts";
import { createOfferNotificationHandler } from "../../packages/application/dispatch/deliver-offer-notification.ts";
import { createDisputeResolutionHandler } from "../../packages/application/dispute/deliver-dispute-resolution.ts";
import type { NotificationHandler } from "../../packages/application/notification/deliver-notification.ts";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import { createNotificationOutboxPort } from "../../packages/infrastructure/notification/notification-outbox-adapters.ts";
import {
  asIdentifyingSender,
  asSupportSender,
} from "../../packages/infrastructure/notification/telegram-api-sender.ts";
import { createOfferPublisher } from "../../packages/infrastructure/notification/telegram-driver-notifier.ts";
import { createTelegramNegotiationMessenger } from "../../packages/infrastructure/notification/telegram-negotiation-notifier.ts";
import { createTicketOwnerNotifier } from "../../packages/infrastructure/notification/telegram-support-notifier.ts";

/**
 * يستنزِفُ صفوفَ الإشعارِ المعلَّقةَ حتى لا يبقى إشعارٌ بلا تسليمٍ في الاختبارات.
 * يُكرِّرُ الدفعةَ لأنَّ عاملًا واحدًا قد يلتقطُ جزءًا فقط (حدُّ المحاولاتِ الأقصى
 * لكلِّ دفعة). يعودُ متى ما لم يُلتقطْ صفٌّ جديد — أي حين يصيرُ الصفُّ فارغًا.
 * ومعالجُ نوعِ العرضِ مربوطٌ دائمًا، وما زادَ عليه يُمرَّرُ صريحًا: نوعٌ بلا معالجٍ
 * خطأٌ مُعلَنٌ لا صفٌّ يُهمَلُ بصمتٍ.
 */
export async function drainNotificationOutbox(
  sql: Sql,
  driverSender: TelegramSender,
  handlers: Readonly<Record<string, NotificationHandler>> = {},
): Promise<void> {
  const publisher = createOfferPublisher(sql, asIdentifyingSender(driverSender));
  const outbox = createNotificationOutboxPort(sql);
  const all = { offer: createOfferNotificationHandler(publisher), ...handlers };
  for (let i = 0; i < 20; i++) {
    const report = await deliverNotifications({ outbox, handlers: all });
    if (!report.ok) return;
    if (report.value.claimed === 0) return;
  }
}

/**
 * معالجاتُ أنواعِ دورةِ غيرِ المشتركينِ كما يربطُها عاملُ التسليمِ في الإنتاج:
 * مُرسِلانِ لا واحدٌ — رسالةُ السائقِ من بوتِه ورسالةُ الراكبِ من بوتِه، وإلّا
 * لم تصلْ أصلًا. تُبنى هنا مرّةً ليتّبعَ الاختبارُ الربطَ الحقيقيَّ.
 */
export function negotiationHandlers(
  driverSender: TelegramSender,
  riderSender: TelegramSender,
): Readonly<Record<string, NotificationHandler>> {
  const messenger = createTelegramNegotiationMessenger(
    asIdentifyingSender(driverSender),
    asIdentifyingSender(riderSender),
  );
  return {
    negotiation_turn_opened: createTurnOpenedHandler(messenger),
    negotiation_turn_closed: createTurnClosedHandler(messenger),
    negotiation_agreed: createAgreedHandler(messenger),
  };
}

/**
 * معالجُ نوعِ قرارِ الدعمِ كما يربطُه عاملُ التسليمِ في الإنتاج: مُرسِلانِ لا
 * واحدٌ — صاحبُ التذكرةِ يُبلَّغُ من البوتِ الذي يحاورُه هو. تُبنى هنا مرّةً
 * ليتّبعَ الاختبارُ الربطَ الحقيقيَّ لا نسخةً منه تتقادمُ في كلِّ ملفٍّ.
 */
export function disputeResolutionHandler(
  driverSender: TelegramSender,
  riderSender: TelegramSender,
): NotificationHandler {
  return createDisputeResolutionHandler({
    driver: createTicketOwnerNotifier(asSupportSender(driverSender)),
    rider: createTicketOwnerNotifier(asSupportSender(riderSender)),
  });
}
