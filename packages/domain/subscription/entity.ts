/**
 * الغرض: حالة اشتراك السائق وأهليته لاستقبال العروض.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: domain/subscription
 * يُتوقع أن يستخدمه لاحقاً: domain/dispatch (فلترة المرشحين)، application/subscription
 * ملاحظات مستقبلية: الأسعار ومدة الشهر المجاني ليست هنا — مصدرها platform_settings حصراً.
 */

import type { CityId, DriverId, ServiceType } from "../../shared/kernel/index.ts";

export type SubscriptionPlan = "transport" | "delivery" | "both";
export type SubscriptionStatus = "trialing" | "active" | "expired" | "cancelled";

export interface Subscription {
  readonly driverId: DriverId;
  readonly cityId: CityId;
  readonly plan: SubscriptionPlan;
  readonly status: SubscriptionStatus;
  readonly trialEndsAt: Date | null;
  readonly currentPeriodEnd: Date | null;
  /**
   * طُلب الإلغاء والخدمة مستمرّة إلى `currentPeriodEnd` ثمّ تُغلق.
   *
   * ليس حالةً ثالثة في `status`: الاشتراك في هذه المدّة **سارٍ فعلاً**
   * وتصل صاحبه الطلبات، ومن جعله حالةً قطع خدمةً مدفوعة بلا ردّ.
   * وجوده في الكيان لأنّ الواجهة تحتاج أن تعرف أتعرض «إلغاء» أم «استئناف»،
   * ولو قرأته بنداءٍ منفصل لأمكن أن تختلف الأجوبة بين النداءين.
   */
  readonly cancelAtPeriodEnd: boolean;
}

/** الخدمات التي تغطيها الخطة. */
export function servicesCoveredByPlan(plan: SubscriptionPlan): readonly ServiceType[] {
  switch (plan) {
    case "transport":
      return ["transport"];
    case "delivery":
      return ["delivery"];
    case "both":
      return ["transport", "delivery"];
  }
}

/**
 * اشتراك فعّال = داخل الشهر المجاني، أو مدفوع لم تنتهِ فترته.
 * الملغى والمنتهي لا يستقبلان عروضاً مهما كان تاريخهما.
 */
export function isSubscriptionLive(subscription: Subscription, now: Date): boolean {
  if (subscription.status === "expired" || subscription.status === "cancelled") {
    return false;
  }
  if (subscription.status === "trialing") {
    return subscription.trialEndsAt !== null && subscription.trialEndsAt.getTime() > now.getTime();
  }
  return (
    subscription.currentPeriodEnd !== null &&
    subscription.currentPeriodEnd.getTime() > now.getTime()
  );
}

/** هل يحق لهذا الاشتراك استقبال عرض من هذا النوع؟ */
export function coversService(
  subscription: Subscription,
  service: ServiceType,
  now: Date,
): boolean {
  return (
    isSubscriptionLive(subscription, now) &&
    servicesCoveredByPlan(subscription.plan).includes(service)
  );
}
