/**
 * الغرض: تغليف منافذ الدفع لتسجيل إنشاء المعاملة والتأكيد والفشل وتكرار ويبهوك الدفع
 *   عند مصدر النتيجة، بلا بيانات بطاقة أو معرّفات معاملات في وسوم Prometheus.
 * الحالة: منفّذ فعلياً — يحتاج تركيبه في index.ts كما في WIRING_METRICS.md.
 * ينتمي إلى: apps/gateway/src/observability
 * يُتوقع أن يستخدمه لاحقاً: مسار ويبهوك الدفع وتدفق اشتراك السائق.
 * ملاحظات مستقبلية: لا تُسجّل provider أو transactionId كوسوم لأنها عالية التعدد.
 */

import type {
  ConfirmPaymentDeps,
  PaymentRepository,
  WebhookEventStore,
} from "../../../../packages/application/financial/index.ts";
import type { OperationalMetrics } from "../../../../packages/infrastructure/observability/index.ts";

export function instrumentPaymentRepository(
  payments: PaymentRepository,
  metrics: OperationalMetrics,
): PaymentRepository {
  return {
    create: async (input) => {
      const result = await payments.create(input);
      if (!result.ok) metrics.recordPaymentFailure();
      else if (!result.value.alreadyExists) metrics.recordPaymentCreated();
      return result;
    },
    findById: (id) => payments.findById(id),
    findByIdempotencyKey: (key) => payments.findByIdempotencyKey(key),
    recordCheckoutUrl: (input) => payments.recordCheckoutUrl(input),
    confirmPayment: async (input) => {
      const result = await payments.confirmPayment(input);
      if (result.ok) metrics.recordPaymentConfirmed();
      else metrics.recordPaymentFailure();
      return result;
    },
  };
}

export function instrumentWebhookEventStore(
  events: WebhookEventStore,
  metrics: OperationalMetrics,
): WebhookEventStore {
  return {
    record: async (eventId, provider, payload, transactionId) => {
      const result = await events.record(eventId, provider, payload, transactionId);
      if (!result.ok) metrics.recordPaymentFailure();
      else if (!result.value) metrics.recordPaymentWebhookDuplicate();
      return result;
    },
  };
}

export function instrumentPaymentConfirmationDeps(
  deps: ConfirmPaymentDeps,
  metrics: OperationalMetrics,
): ConfirmPaymentDeps {
  return {
    payments: instrumentPaymentRepository(deps.payments, metrics),
    events: instrumentWebhookEventStore(deps.events, metrics),
  };
}
