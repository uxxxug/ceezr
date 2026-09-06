/**
 * الغرض: تفريغُ صفوفِ إشعارِ العروضِ المعلَّقةِ في اختباراتِ التكامل — يُقلِّدُ ما
 *   يفعلهُ عاملُ `deliver-offer-notifications` في الإنتاج، لكنَّه متزامنٌ هنا حتى
 *   يصلَ الإشعارُ إلى مُلتقِطِ الرسائلِ قبلَ التحقّقِ منه. منذُ BUG-004 لم يَعُدْ
 *   broadcastOffers يُرسِلُ الإشعارَ متزامنًا خارجَ المعاملة، بل يكتبُ صفَّهُ
 *   في open_offer_round ويتركُ التسليمَ للعامل. فاختباراتُ المسارِ الكاملِ التي
 *   كانت تتحقّقُ من وصولِ العرضِ للسائقِ تحتاجُ الآنَ إلى استنزافِ الصفِّ.
 * الحالة: أداةُ اختبارٍ فقط.
 * ينتمي إلى: tests/support
 */

import type { TelegramSender } from "../../apps/gateway/src/bots/driver/index.ts";
import { deliverOfferNotifications } from "../../apps/workers/src/jobs/deliver-offer-notifications.ts";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import { createOfferDeliveryPort } from "../../packages/infrastructure/dispatch/offer-notification-adapters.ts";
import { asIdentifyingSender } from "../../packages/infrastructure/notification/telegram-api-sender.ts";
import { createOfferPublisher } from "../../packages/infrastructure/notification/telegram-driver-notifier.ts";

/**
 * يستنزِفُ صفوفَ الإشعارِ المعلَّقةَ حتى لا يبقى عرضٌ بلا إشعار في الاختبارات.
 * يُكرِّرُ الدفعةَ لأنَّ عاملًا واحدًا قد يلتقطُ جزءًا فقط (حدُّ المحاولاتِ الأقصى
 * لكلِّ دفعة). يعودُ متى ما لم يُلتقطْ صفٌّ جديد — أي حين يصيرُ الصفُّ فارغًا.
 */
export async function drainOfferOutbox(sql: Sql, driverSender: TelegramSender): Promise<void> {
  const publisher = createOfferPublisher(sql, asIdentifyingSender(driverSender));
  const deliveries = createOfferDeliveryPort(sql);
  for (let i = 0; i < 20; i++) {
    const report = await deliverOfferNotifications({ deliveries, publisher });
    if (!report.ok) return;
    if (report.value.claimed === 0) return;
  }
}
