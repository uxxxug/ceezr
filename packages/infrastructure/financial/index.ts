/**
 * الغرض: محوّلات (Adapters) وحدة financial — تنفيذ منافذ الدفع على القاعدة.
 * الحالة: منفّذ فعلياً — البند 8.
 * ينتمي إلى: infrastructure/financial
 * يُتوقع أن يستخدمه لاحقاً: apps/* عبر حقن التبعيات فقط، ولا يستوردها packages/domain/financial إطلاقاً
 * ملاحظات مستقبلية: يُختار المزوّد في تركيب التطبيق عبر المصنع؛ لا تُقرأ الأسرار هنا.
 */

export { createMoyasarProvider, PAYMENT_METADATA_TRANSACTION_ID } from "./moyasar-provider.ts";
export {
  createPaymentRepository,
  createWebhookEventStore,
} from "./payment-adapters.ts";
export {
  createPaymentProvider,
  type PaymentProviderName,
  type PaymentProviderSecrets,
} from "./payment-provider-factory.ts";
export { createSubscriptionWalletRpc } from "./subscription-wallet-adapters.ts";
