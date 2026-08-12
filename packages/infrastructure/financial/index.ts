/**
 * الغرض: محوّلات (Adapters) وحدة financial — تنفيذ منافذ الدفع على القاعدة.
 * الحالة: منفّذ فعلياً — البند 8.
 * ينتمي إلى: infrastructure/financial
 * يُتوقع أن يستخدمه لاحقاً: apps/* عبر حقن التبعيات فقط، ولا يستوردها packages/domain/financial إطلاقاً
 * ملاحظات مستقبلية: مزوّد الدفع الفعلي (PaymentProvider) معلَّق حتى يحدده المالك.
 */

export {
  createPaymentRepository,
  createWebhookEventStore,
} from "./payment-adapters.ts";
export { createSubscriptionWalletRpc } from "./subscription-wallet-adapters.ts";
