/**
 * الغرض: استرداد دفعة اشتراك إلى ائتمان المحفظة أو إلى المزوّد.
 * الحالة: منفّذ فعلياً في 2026-08-13؛ كان الملف هيكلاً (`export {}`) وصدر أمر التفعيل.
 * القرار ومسوّغه: القاعدة تقفل دفعة الاشتراك وتحفظ سجلاً فريداً لكل دفعة، فتمنع استرداداً ثانياً أو مبلغاً يتجاوز المدفوع.
 */
import type { PaymentTransactionId } from "../../domain/financial/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { SubscriptionWalletRpcPort } from "./ports.ts";
export interface RefundPaymentInput {
  readonly paymentId: PaymentTransactionId;
  readonly amountMinor: number;
  readonly destination: "wallet_credit" | "provider_refund";
  readonly actorUserId: string | null;
  readonly reason: string;
  readonly reference: string;
}
export interface RefundPaymentDeps {
  readonly wallets: SubscriptionWalletRpcPort;
}
export interface RefundPaymentOutcome {
  readonly refundId: string;
  readonly walletId: string | null;
  readonly alreadyRefunded: boolean;
  readonly destination: string | null;
}
export class RefundPaymentError {
  readonly code = "REFUND_PAYMENT_FAILURE" as const;
  constructor(readonly detail: string) {}
}
export async function refundPayment(
  input: RefundPaymentInput,
  deps: RefundPaymentDeps,
): Promise<Result<RefundPaymentOutcome, RefundPaymentError>> {
  const result = await deps.wallets.refund(input);
  if (!result.ok) return err(new RefundPaymentError(result.error.detail));
  if (!result.value.ok || result.value.refundId === null)
    return err(new RefundPaymentError(result.value.error ?? "REFUND_REJECTED"));
  return ok({
    refundId: result.value.refundId,
    walletId: result.value.walletId,
    alreadyRefunded: result.value.alreadyRefunded,
    destination: result.value.destination,
  });
}
