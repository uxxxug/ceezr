/**
 * الغرض: حالة استخدام اشتراك السائق المدفوع — البند 8.3 (Subscription Payment Flow).
 *   التدفق: Driver → subscribe-plan → إنشاء PaymentTransaction →
 *   PaymentProvider.chargeSubscription() → (ويبهوك) → تأكيد → activate_subscription.
 * الحالة: منفّذ فعلياً — البند 8.
 * ينتمي إلى: application/financial
 * ملاحظات مستقبلية: لا يُعاد بناء منطق الاشتراك القائم؛ طبقة الدفع خطوة قبله.
 *   `subscribe-plan` كان هيكلاً فارغاً، وهنا يُفعَّل بالقدر الذي يربط الدفع
 *   بتفعيل الاشتراك عبر الدالة الذرّية `activate_subscription` القائمة.
 */

import type { SubscriptionPlan } from "../../domain/subscription/entity.ts";
import type { CityId, DriverId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import type { ChargeInitiation, PaymentProvider, PaymentRepository } from "./ports.ts";

export interface SubscribePlanInput {
  readonly driverId: DriverId;
  readonly cityId: CityId;
  readonly plan: SubscriptionPlan;
  /** مفتاح الإيدمبوتنسي لمنع إنشاء معاملة مكررة عند إعادة المحاولة. */
  readonly idempotencyKey: string;
}

export interface SubscribePlanDeps {
  readonly payments: PaymentRepository;
  readonly provider: PaymentProvider;
  /** يقرأ سعر الاشتراك من platform_settings (لا قيمة تجارية في الكود). */
  readonly priceReader: (
    cityId: CityId,
    plan: SubscriptionPlan,
  ) => Promise<Result<{ amount: number; currency: string }, PortFailureError>>;
}

export interface SubscribePlanOutcome {
  readonly transactionId: string;
  readonly checkoutUrl: string | null;
  readonly status: string;
}

export class SubscriptionPaymentError {
  readonly code = "SUBSCRIPTION_PAYMENT_FAILURE" as const;
  constructor(readonly detail: string) {}
}

/**
 * يبدأ اشتراكاً مدفوعاً: ينشئ معاملة دفع (PENDING)، ويستدعي المزوّد.
 * التأكيد النهائي يحدث عند وصول الويبهوك من المزوّد (confirmSubscriptionPayment).
 *
 * هذا هو `subscribe-plan` الذي كان هيكلاً فارغاً — مُفعّل هنا بالقدر الذي يربط
 * الدفع بتفعيل الاشتراك، لا بإعادة بناء كل منطق الاشتراك.
 */
export async function subscribePlan(
  input: SubscribePlanInput,
  deps: SubscribePlanDeps,
): Promise<Result<SubscribePlanOutcome, SubscriptionPaymentError>> {
  const price = await deps.priceReader(input.cityId, input.plan);
  if (!price.ok) {
    return err(new SubscriptionPaymentError(price.error.detail));
  }

  // الإيدمبوتنسي (خط 1): فحص سريع قبل الإنشاء — يمنع معظم الاستدعاءات المكررة.
  const existing = await deps.payments.findByIdempotencyKey(input.idempotencyKey);
  if (!existing.ok) {
    return err(new SubscriptionPaymentError(existing.error.detail));
  }
  if (existing.value !== null) {
    return ok({
      transactionId: existing.value.id,
      checkoutUrl: null,
      status: existing.value.status,
    });
  }

  // إنشاء معاملة PENDING ذرّياً مع حماية التكرار على مفتاح الإيدمبوتنسي.
  const created = await deps.payments.create({
    driverId: input.driverId,
    amount: { amount: price.value.amount, currency: price.value.currency },
    purpose: "driver_subscription",
    provider: deps.provider.name,
    providerTransactionId: null,
    status: "pending",
    idempotencyKey: input.idempotencyKey,
    metadata: { plan: input.plan, cityId: input.cityId },
  });
  if (!created.ok) {
    return err(new SubscriptionPaymentError(created.error.detail));
  }

  // الإيدمبوتنسي (خط 2 — حسم السباق): إن أعاد create معاملة موجودة سلفاً،
  // لا نستدعي المزوّد. create_payment RPC ذرّي: يعيد already_exists=true
  // عند التزاحم، فلا يُستدعى المزوّد مرّتين مهما حدث.
  if (created.value.alreadyExists) {
    return ok({
      transactionId: created.value.transaction.id,
      checkoutUrl: null,
      status: created.value.transaction.status,
    });
  }

  // بدء الدفع عند المزوّد — لا يُخزّن أي بيانات حسّاسة (البند 8.9).
  const charge = await deps.provider.chargeSubscription({
    driverId: input.driverId,
    amount: { amount: price.value.amount, currency: price.value.currency },
    purpose: "driver_subscription",
    idempotencyKey: input.idempotencyKey,
  });
  if (!charge.ok) {
    return err(new SubscriptionPaymentError(charge.error.detail));
  }

  // تحديث معرّف المزوّد إن بدأ العملية فوراً.
  if (charge.value.providerTransactionId !== null) {
    const confirmed = await deps.payments.confirmPayment({
      transactionId: created.value.transaction.id,
      providerTransactionId: charge.value.providerTransactionId,
      newStatus: charge.value.status,
    });
    if (!confirmed.ok) {
      return err(new SubscriptionPaymentError(confirmed.error.detail));
    }
    return ok({
      transactionId: confirmed.value.id,
      checkoutUrl: charge.value.checkoutUrl,
      status: confirmed.value.status,
    });
  }

  return ok({
    transactionId: created.value.transaction.id,
    checkoutUrl: charge.value.checkoutUrl,
    status: charge.value.status,
  });
}

export type { ChargeInitiation };
