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
import { createOfferNotificationHandler } from "../../packages/application/dispatch/deliver-offer-notification.ts";
import type { NotificationHandler } from "../../packages/application/notification/deliver-notification.ts";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import { createNotificationOutboxPort } from "../../packages/infrastructure/notification/notification-outbox-adapters.ts";
import { asIdentifyingSender } from "../../packages/infrastructure/notification/telegram-api-sender.ts";
import { createOfferPublisher } from "../../packages/infrastructure/notification/telegram-driver-notifier.ts";

/**
 * يستنزِفُ صفوفَ الإشعارِ المعلَّقةَ حتى لا يبقى إشعارٌ بلا تسليمٍ في الاختبارات.
 * يُكرِّرُ الدفعةَ لأنَّ عاملًا واحدًا قد يلتقطُ جزءًا فقط (حدُّ المحاولاتِ الأقصى
 * لكلِّ دفعة). يعودُ متى ما لم يُلتقطْ صفٌّ جديد — أي حين يصيرُ الصفُّ فارغًا.
 * ومعالجُ نوعِ العرضِ مربوطٌ دائمًا، وما زادَ عليه يُمرَّرُ صريحًا: نوعٌ بلا معالجٍ
 * خطأٌ مُعلَنٌ لا صفٌّ يُهمَلُ بصمتٍ.
 */
export async function drainOfferOutbox(
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
