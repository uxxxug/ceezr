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
 * السائقون الذين يجب استبعادهم من دورة بثّ جديدة:
 * من رفض، ومن انتهت مهلته، ومن أُلغي عرضه — ومن لديه عرض معلَّق ما زال سارياً.
 */
export function driversToExclude(
  offers: readonly Offer[],
  timeoutSeconds: number,
  now: Date,
): readonly DriverId[] {
  const excluded = new Set<DriverId>();
  for (const offer of offers) {
    if (offer.status === "rejected" || offer.status === "expired" || offer.status === "cancelled") {
      excluded.add(offer.driverId);
      continue;
    }
    if (offer.status === "pending" && !isOfferExpired(offer, timeoutSeconds, now)) {
      excluded.add(offer.driverId);
    }
  }
  return [...excluded];
}
