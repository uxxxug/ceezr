/**
 * الغرض: تأكيد دفع اشتراك السائق عند وصول ويبهوك من مزوّد الدفع — البند 8.3.
 *   التدفق: Webhook → تحقّق التوقيع (في المسار) → Idempotency (هنا) →
 *   confirmPayment (ذرّي: يحدّث الحالة + يُفعّل الاشتراك + دفتر الأستاذ).
 * الحالة: منفّذ فعلياً — البند 8.
 * ينتمي إلى: application/financial
 */

import type {
  PaymentTransactionId,
  PaymentTransactionStatus,
} from "../../domain/financial/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { PaymentRepository, WebhookEventStore } from "./ports.ts";

export interface ConfirmPaymentInput {
  readonly transactionId: PaymentTransactionId;
  readonly providerTransactionId: string;
  readonly newStatus: PaymentTransactionStatus;
  /** مبلغ وعملة الدفعة من إعادة القراءة لدى مزوّد الدفع. */
  readonly providerAmount: number;
  readonly providerCurrency: string;
  /** معرّف حدث الويبهوك لمنع المعالجة المكررة. */
  readonly webhookEventId: string;
  readonly provider: string;
  readonly rawPayload: string;
}

export interface ConfirmPaymentDeps {
  readonly payments: PaymentRepository;
  readonly events: WebhookEventStore;
}

export class WebhookConfirmationError {
  readonly code = "WEBHOOK_CONFIRMATION_FAILURE" as const;
  constructor(readonly detail: string) {}
}

export interface ConfirmPaymentOutcome {
  readonly transactionId: PaymentTransactionId;
  readonly status: PaymentTransactionStatus;
  readonly duplicate: boolean;
}

/**
 * يعالج ويبهوك تأكيد الدفع. Idempotency على معرّف الحدث:
 * الحدث نفسه مرّتين لا يُفعّل الاشتراك مرّتين بل يُهمل بأمان.
 */
export async function confirmSubscriptionPayment(
  input: ConfirmPaymentInput,
  deps: ConfirmPaymentDeps,
): Promise<Result<ConfirmPaymentOutcome, WebhookConfirmationError>> {
  // RPC واحد يربط ادعاء الحدث بالتأكيد: لا سباق بين تسجيل حدثين وتفعيلين.
  // لا يُسجل حدث مرفوض؛ فيبقى للمزوّد أن يعيد إرساله بعد إصلاح العطل المؤقت.
  if (deps.payments.confirmWebhookPayment === undefined) {
    return err(
      new WebhookConfirmationError("PAYMENT_REPOSITORY_DOES_NOT_SUPPORT_VERIFIED_WEBHOOKS"),
    );
  }
  const confirmed = await deps.payments.confirmWebhookPayment({
    transactionId: input.transactionId,
    providerTransactionId: input.providerTransactionId,
    newStatus: input.newStatus,
    providerAmount: input.providerAmount,
    providerCurrency: input.providerCurrency,
    provider: input.provider,
    webhookEventId: input.webhookEventId,
    rawPayload: input.rawPayload,
  });
  if (!confirmed.ok) {
    return err(new WebhookConfirmationError(confirmed.error.detail));
  }

  return ok({
    transactionId: confirmed.value.transaction.id,
    status: confirmed.value.transaction.status,
    duplicate: confirmed.value.duplicate,
  });
}
