/**
 * الغرض: تجميع حالات استخدام وحدة financial — اشتراك السائق الشهري فقط مفعّل (البند 8).
 * الحالة: منفّذ فعلياً — البند 8.
 * ينتمي إلى: application/financial
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway (البوتات/الويبهوك)، apps/workers، apps/admin-dashboard
 * ملاحظات مستقبلية: دفع العملاء/التجار/المؤسسات والمصاريف والتسويات هياكل فقط
 *   حتى أمر تفعيل صريح. البنية وحدها قائمة، وحالة الاستخدام الوحيدة المفعّلة:
 *   اشتراك السائق الشهري.
 */

export {
  type ConfirmPaymentDeps,
  type ConfirmPaymentInput,
  type ConfirmPaymentOutcome,
  confirmSubscriptionPayment,
  WebhookConfirmationError,
} from "./confirm-payment.ts";
export type {
  ChargeInitiation,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  PaymentRepository,
  WebhookEventStore,
} from "./ports.ts";
export {
  type SubscribePlanDeps,
  type SubscribePlanInput,
  type SubscribePlanOutcome,
  SubscriptionPaymentError,
  subscribePlan,
} from "./subscribe-plan.ts";
