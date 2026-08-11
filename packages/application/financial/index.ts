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
  confirmSubscriptionPayment,
  type ConfirmPaymentDeps,
  type ConfirmPaymentInput,
  type ConfirmPaymentOutcome,
  WebhookConfirmationError,
} from "./confirm-payment.ts";
export {
  subscribePlan,
  type SubscribePlanDeps,
  type SubscribePlanInput,
  type SubscribePlanOutcome,
  SubscriptionPaymentError,
} from "./subscribe-plan.ts";
export {
  type ChargeInitiation,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type PaymentProvider,
  type PaymentRepository,
  type WebhookEventStore,
} from "./ports.ts";
