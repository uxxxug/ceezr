/**
 * الغرض: عرض الطلب المرسل لسائق ومهلة قبوله — منطق خالص يقابل جدول order_offers.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: domain/dispatch
 * يُتوقع أن يستخدمه لاحقاً: application/dispatch/{match-order,expire-offer}، apps/workers (Cron)
 * ملاحظات مستقبلية: الإلغاء الفعلي للعروض المنتهية يمرّ عبر الدالة الذرّية expire_stale_offers،
 *   وهذا الملف يقرّر "أيّها منتهٍ" فقط ولا يكتب في القاعدة.
 */

import type { DriverId, OrderId } from "../../shared/kernel/index.ts";

export type OfferStatus = "pending" | "accepted" | "rejected" | "expired" | "cancelled";

export interface Offer {
  readonly orderId: OrderId;
  readonly driverId: DriverId;
  readonly status: OfferStatus;
  readonly sentAt: Date;
  readonly round: number;
}

const MS_PER_SECOND = 1000;

/** لحظة انتهاء مهلة العرض — المهلة من platform_settings.offer_timeout_seconds. */
export function offerExpiresAt(offer: Offer, timeoutSeconds: number): Date {
  return new Date(offer.sentAt.getTime() + timeoutSeconds * MS_PER_SECOND);
}

/** هل انتهت مهلة العرض؟ العروض غير المعلَّقة لا تنتهي مهلتها. */
export function isOfferExpired(offer: Offer, timeoutSeconds: number, now: Date): boolean {
  if (offer.status !== "pending") return false;
  return now.getTime() >= offerExpiresAt(offer, timeoutSeconds).getTime();
}

/** الثواني المتبقية للسائق ليقبل — صفر إن انتهت. تُعرض في رسالة البوت. */
export function secondsRemaining(offer: Offer, timeoutSeconds: number, now: Date): number {
  const remainingMs = offerExpiresAt(offer, timeoutSeconds).getTime() - now.getTime();
  return Math.max(0, Math.ceil(remainingMs / MS_PER_SECOND));
}

/**
 * السائقون الذين يجب استبعادهم من دورة بثّ جديدة: من رفض، ومن أُلغي عرضه، ومن
 * لديه عرضٌ معلَّقٌ ما زال سارياً.
 *
 * **والصمتُ ليس رفضاً — المرحلة ١٤.** كانت الحالة `expired` تُستبعَد استبعاداً
 * دائماً، وكان ذلك يُبطل `max_broadcast_rounds` كلَّه ويُناقض قاعدةً أخرى في هذا
 * الملفّ نفسه: الاختبار «لا يستبعد من انتهت مهلته المعلَّقة فعلياً فيصبح متاحاً
 * لدورة جديدة» يُثبت أنّ المقصود أن يعود المتخلّف عن الردّ مؤهّلاً. فكانت القاعدتان
 * متعارضتين، وأيُّهما تُطبَّق يتوقّف على شيءٍ واحدٍ لا علاقة له بالسائق ولا بالطلب:
 * أَجَرَت مهمّةُ `expire-offers` شوطَها أم لا. فالسائقُ نفسه بالسلوك نفسه يُستبعَد
 * أو لا يُستبعَد بحسب توقيت مهمّةٍ خلفيّة.
 *
 * وقيسَ الأثر على قاعدةٍ حقيقية: مدينةٌ فيها سائقٌ واحدٌ متاحٌ، تجاهل عرضاً واحداً،
 * فصار الطلبُ لا يُبَثّ إليه أبداً — لا في الدورة الثانية ولا الثالثة — بينما
 * `max_broadcast_rounds = 3`. وسائقٌ يقود وهاتفه في جيبه لم يرَ إشعاراً في ٤٥ ثانية
 * لم يرفض شيئاً، والنظامُ يعامله كمن قال «لا».
 *
 * والحدُّ باقٍ ولم يُرفَع: `hasExhaustedBroadcastRounds` تحصر العرضَ على السائق نفسه
 * بعدد الدورات، والقيدُ الفريد `(order_id, driver_id, round)` يمنع التكرار داخل
 * الدورة. أمّا `rejected` فتبقى استبعاداً دائماً — من قال «لا» صراحةً لا يُسأل ثانيةً.
 */
export function driversToExclude(
  offers: readonly Offer[],
  timeoutSeconds: number,
  now: Date,
): readonly DriverId[] {
  const excluded = new Set<DriverId>();
  for (const offer of offers) {
    if (offer.status === "rejected" || offer.status === "cancelled") {
      excluded.add(offer.driverId);
      continue;
    }
    if (offer.status === "pending" && !isOfferExpired(offer, timeoutSeconds, now)) {
      excluded.add(offer.driverId);
    }
  }
  return [...excluded];
}
