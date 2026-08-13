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
    // الرابط المحفوظ لا `null`: الضغطة الثانية على زرّ الاشتراك مسارٌ طبيعيّ لا
    // خطأ، وإعادةُ معاملةٍ معلّقة بلا رابط كانت تسجن السائق بين معاملةٍ لا
    // يستطيع دفعها ومفتاحٍ يمنع إنشاء غيرها.
    return ok({
      transactionId: existing.value.id,
      checkoutUrl: readCheckoutUrl(existing.value.metadata),
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
      checkoutUrl: readCheckoutUrl(created.value.transaction.metadata),
      status: created.value.transaction.status,
    });
  }

  // بدء الدفع عند المزوّد — لا يُخزّن أي بيانات حسّاسة (البند 8.9).
  const charge = await deps.provider.chargeSubscription({
    transactionId: created.value.transaction.id,
    driverId: input.driverId,
    amount: { amount: price.value.amount, currency: price.value.currency },
    purpose: "driver_subscription",
    idempotencyKey: input.idempotencyKey,
  });
  if (!charge.ok) {
    return err(new SubscriptionPaymentError(charge.error.detail));
  }

  // لا تُؤكّد فاتورة الدفع المستضافة: معرّفها ليس معرّف الدفعة النهائي. المزوّد
  // يعيد معرّف الدفعة وحالتها من خادمه عند الويبهوك فقط.
  if (charge.value.providerTransactionId !== null && charge.value.status !== "pending") {
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

  // حفظ الرابط قبل إعادته: من هنا فقط تصير الضغطة الثانية قادرةً على استعادته.
  // وفشلُ الحفظ لا يُسقط المحاولة — الفاتورة أُنشئت فعلاً وحجبُ رابطها عن السائق
  // بعد إنشائها يجمع الضررين: لا دفع، ومفتاحٌ يمنع محاولةً أخرى.
  let checkoutUrl = charge.value.checkoutUrl;
  if (checkoutUrl !== null) {
    const stored = await deps.payments.recordCheckoutUrl({
      transactionId: created.value.transaction.id,
      checkoutUrl,
    });
    if (stored.ok) checkoutUrl = stored.value.checkoutUrl;
  }

  return ok({
    transactionId: created.value.transaction.id,
    checkoutUrl,
    status: charge.value.status,
  });
}

/** يقرأ رابط الدفع المحفوظ من metadata، ولا يثق بنوعٍ غير نصّ. */
function readCheckoutUrl(metadata: Readonly<Record<string, unknown>>): string | null {
  const value = metadata.checkout_url;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export type { ChargeInitiation };
