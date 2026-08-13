/**
 * الغرض: تغليف منافذ الدفع لتسجيل إنشاء المعاملة والتأكيد والفشل وتكرار ويبهوك الدفع
 *   عند مصدر النتيجة، بلا بيانات بطاقة أو معرّفات معاملات في وسوم Prometheus.
 * الحالة: منفّذ فعلياً — يحتاج تركيبه في index.ts كما في WIRING_METRICS.md.
 * ينتمي إلى: apps/gateway/src/observability
 * يُتوقع أن يستخدمه لاحقاً: مسار ويبهوك الدفع وتدفق اشتراك السائق.
 * ملاحظات مستقبلية: لا تُسجّل provider أو transactionId كوسوم لأنها عالية التعدد.
 *
 * ## الغلاف يُنشر من الأصل ثمّ يُبدِل — ولا يُعاد بناء المنفذ من الصفر
 *
 * كان هذا الغلاف يُعدّد دوالّ `PaymentRepository` واحدةً واحدة، فأسقط
 * `confirmWebhookPayment` — وهي اختيارية في العقد فلم يرفضها المدقّق. ولأنّ
 * `apps/gateway/src/index.ts` يغلّف المستودع الحقيقي بهذا الغلاف قبل تمريره لمسار
 * الويبهوك، ولأنّ `confirmSubscriptionPayment` يرفض قطعاً إن غابت تلك الدالة، فقد
 * كان كلّ ويبهوك دفع في الإنتاج يُردّ 409 ولا يُفعَّل أيّ اشتراك مدفوع — مع مسارٍ
 * مختبر بالكامل لأنّ اختباراته تمرّر المستودع بلا غلاف.
 *
 * فالقاعدة هنا: الغلاف ينشر الأصل (`...payments`) ثمّ يُبدِل ما يقيسه وحده.
 * فأيّ دالةٍ تُضاف للمنفذ لاحقاً تمرّ كما هي، ولا تُفقَد قدرةٌ لمجرّد أنّ الرصد
 * لا يقيسها.
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
  const wrapped: PaymentRepository = {
    ...payments,
    create: async (input) => {
      const result = await payments.create(input);
      if (!result.ok) metrics.recordPaymentFailure();
      else if (!result.value.alreadyExists) metrics.recordPaymentCreated();
      return result;
    },
    confirmPayment: async (input) => {
      const result = await payments.confirmPayment(input);
      if (result.ok) metrics.recordPaymentConfirmed();
      else metrics.recordPaymentFailure();
      return result;
    },
  };
  // المسار الذرّي للويبهوك يُقاس كما يُقاس التأكيد العادي، ولا يُلفَّ إن غاب عن
  // الأصل: لفّه حينها يخلق دالةً لا وجود لها، فيرى `confirmSubscriptionPayment`
  // قدرةً مدّعاة ثم يفشل داخلها.
  if (payments.confirmWebhookPayment !== undefined) {
    const confirmWebhook = payments.confirmWebhookPayment.bind(payments);
    return {
      ...wrapped,
      confirmWebhookPayment: async (input) => {
        const result = await confirmWebhook(input);
        if (result.ok) metrics.recordPaymentConfirmed();
        else metrics.recordPaymentFailure();
        return result;
      },
    };
  }
  return wrapped;
}

export function instrumentWebhookEventStore(
  events: WebhookEventStore,
  metrics: OperationalMetrics,
): WebhookEventStore {
  return {
    ...events,
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
    ...deps,
    payments: instrumentPaymentRepository(deps.payments, metrics),
    events: instrumentWebhookEventStore(deps.events, metrics),
  };
}
