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
export {
  type CreateWalletDeps,
  CreateWalletError,
  type CreateWalletInput,
  type CreateWalletOutcome,
  createWallet,
} from "./create-wallet.ts";
export {
  type GetWalletBalanceDeps,
  GetWalletBalanceError,
  type GetWalletBalanceInput,
  type GetWalletBalanceOutcome,
  getWalletBalance,
} from "./get-wallet-balance.ts";
export {
  type IssueInvoiceDeps,
  IssueInvoiceError,
  type IssueInvoiceInput,
  type IssueInvoiceOutcome,
  issueInvoice,
} from "./issue-invoice.ts";
export type {
  ChargeInitiation,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  PaymentRepository,
  SubscriptionInvoiceOutcome,
  SubscriptionRefundOutcome,
  SubscriptionRefundRequest,
  SubscriptionWalletRpcPort,
  SystemErrorSettlementRequest,
  WalletBalance,
  WalletCreation,
  WalletMutation,
  WalletTopUpRequest,
  WebhookEventStore,
} from "./ports.ts";
export {
  type RefundPaymentDeps,
  RefundPaymentError,
  type RefundPaymentInput,
  type RefundPaymentOutcome,
  refundPayment,
} from "./refund-payment.ts";
export {
  type SettleDriverPayoutDeps,
  SettleDriverPayoutError,
  type SettleDriverPayoutInput,
  type SettleDriverPayoutOutcome,
  settleDriverPayout,
} from "./settle-driver-payout.ts";
export {
  type SubscribePlanDeps,
  type SubscribePlanInput,
  type SubscribePlanOutcome,
  SubscriptionPaymentError,
  subscribePlan,
} from "./subscribe-plan.ts";
export {
  type TopUpWalletDeps,
  TopUpWalletError,
  type TopUpWalletInput,
  type TopUpWalletOutcome,
  topUpWallet,
} from "./top-up-wallet.ts";
