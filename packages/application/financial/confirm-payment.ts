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
  // Idempotency: سجّل الحدث أولاً. إن كان مكرَّراً أوقف بلا معالجة.
  const recorded = await deps.events.record(input.webhookEventId, input.provider, input.rawPayload);
  if (!recorded.ok) {
    return err(new WebhookConfirmationError(recorded.error.detail));
  }
  if (!recorded.value) {
    // حدث مكرَّر — أعد حالة المعاملة الحالية بلا إعادة التأكيد.
    const existing = await deps.payments.findById(input.transactionId);
    if (!existing.ok) {
      return err(new WebhookConfirmationError(existing.error.detail));
    }
    return ok({
      transactionId: input.transactionId,
      status: existing.value?.status ?? input.newStatus,
      duplicate: true,
    });
  }

  // تأكيد ذرّي: يحدّث الحالة + معرّف المزوّد + يُفعّل الاشتراك + دفتر الأستاذ.
  const confirmed = await deps.payments.confirmPayment({
    transactionId: input.transactionId,
    providerTransactionId: input.providerTransactionId,
    newStatus: input.newStatus,
  });
  if (!confirmed.ok) {
    return err(new WebhookConfirmationError(confirmed.error.detail));
  }

  return ok({
    transactionId: confirmed.value.id,
    status: confirmed.value.status,
    duplicate: false,
  });
}
