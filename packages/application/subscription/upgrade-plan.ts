/**
 * الغرض: ترقية خطّة اشتراك السائق إلى «الاثنين» (نقل + توصيل).
 * الحالة: منفّذ فعلياً — الأمر الثاني، وفق قرار المالك المؤرّخ 2026-08-12.
 *   (كان هذا الملف «هيكل فقط»؛ نصّه القديم `export {}` وترويسته تقول
 *   «لا تُضِف منطقاً هنا قبل أمر تفعيل صريح» — وقد صدر الأمر.)
 * ينتمي إلى: application/subscription
 * يستخدمه: apps/gateway (حوار السائق)، apps/admin-dashboard لاحقاً.
 *
 * مساران، والفرق بينهما ليس تفصيلاً:
 *   • داخل التجربة المجّانية: لا شيء مدفوع، فلا فرق مستحقّ — الترقية تُطبَّق
 *     فوراً بلا معاملة دفع. وليست ثغرة: `start_trial` تسمح ببدء التجربة على
 *     «الاثنين» ابتداءً، فتغيير الخطّة داخلها لا يمنح السائق ما لم يكن يملكه.
 *   • داخل دورة مدفوعة: يُنشأ طلب دفع بالفرق، ولا تُطبَّق الترقية قبل تأكيد
 *     الدفع. التطبيق يحدث داخل `confirm_payment` في المعاملة نفسها، فلا توجد
 *     لحظة يكون فيها المال مقبوضاً والخطّة غير مرقّاة.
 *
 * لا يُحسب أي مبلغ في هذا الملف: الفرق يأتي من `plan_upgrade_quote` التي تقرأ
 *   `platform_settings`. مصدرٌ واحد للرقم يمنع أن يُعرض على السائق مبلغٌ ثم
 *   تتحقّق القاعدة من مبلغٍ آخر لو غُيّرت الأسعار بين الخطوتين.
 *
 * نطاق صريح: التقسيط الزمنيّ (proration) غير مُنفَّذ — المستحقّ هو فرق السعرين
 *   كاملاً بلا نسبةٍ للأيام المتبقية. سياسة تجارية تنتظر قرار المالك، ولم
 *   تُخترع هنا.
 *
 * الترويسة القديمة ذكرت «عبر RPC ذرّي renew_subscription»، وهو خطأ توثيقيّ:
 *   `renew_subscription` غير موجودة في القاعدة. الدالّات الفعلية:
 *   `plan_upgrade_quote` و`upgrade_plan`.
 */

import type { SubscriptionPlan } from "../../domain/subscription/entity.ts";
import type { CityId, DriverId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { PaymentProvider, PaymentRepository } from "../financial/ports.ts";
import type { SubscriptionChangeRpcPort, UpgradeQuote } from "./ports.ts";

export interface UpgradePlanInput {
  readonly driverId: DriverId;
  readonly cityId: CityId;
  /** الخطّة المطلوبة. القاعدة ترفض ما ليس ترقيةً فعلية. */
  readonly newPlan: SubscriptionPlan;
  /** مفتاح الإيدمبوتنسي لمنع معاملة دفع مكرّرة عند إعادة المحاولة. */
  readonly idempotencyKey: string;
}

export interface UpgradePlanDeps {
  readonly changes: SubscriptionChangeRpcPort;
  readonly payments: PaymentRepository;
  readonly provider: PaymentProvider;
}

/** الترقية طُبّقت فوراً — حالة التجربة المجّانية. */
export interface UpgradeAppliedOutcome {
  readonly kind: "applied";
  readonly subscriptionId: string;
  readonly plan: SubscriptionPlan;
  readonly periodEnd: Date | null;
  readonly alreadyOnPlan: boolean;
}

/** الترقية تنتظر دفع الفرق — حالة الدورة المدفوعة. */
export interface UpgradePaymentRequiredOutcome {
  readonly kind: "payment_required";
  readonly transactionId: string;
  readonly amountDue: number;
  readonly currency: string;
  readonly checkoutUrl: string | null;
  readonly status: string;
}

export type UpgradePlanOutcome = UpgradeAppliedOutcome | UpgradePaymentRequiredOutcome;

export class UpgradePlanError {
  readonly code = "UPGRADE_PLAN_FAILURE" as const;
  constructor(
    /** NO_LIVE_SUBSCRIPTION | ALREADY_ON_PLAN | PLAN_NOT_AN_UPGRADE | UPGRADE_PRICE_NOT_HIGHER | عطل منفذ. */
    readonly detail: string,
  ) {}
}

/**
 * يحوّل المبلغ من الوحدة الأساسية (ريال) إلى الوحدة الصغرى (هلّة).
 * لا يُدخَل هنا أي سعر، ولا يُقرّر أي فرق: تحويل وحدة فقط.
 *
 * وجودها ليس تزييناً: `platform_settings` تحفظ الأسعار بالريال (400)،
 * و`Money.amount` مُعرَّف في domain/financial/entity.ts:41 بالوحدات الصغرى.
 * أول نسخة من هذا الملف مرّرت 150 مباشرةً، فكانت ستُنشئ معاملة بـ١٫٥ ريال
 * بدل ١٥٠ — أي ترقيةً بمائة من المائة خسارة. كشفه قراءة تعريف `Money`.
 */
function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

export async function upgradePlan(
  input: UpgradePlanInput,
  deps: UpgradePlanDeps,
): Promise<Result<UpgradePlanOutcome, UpgradePlanError>> {
  const quoted = await deps.changes.quoteUpgrade(input.driverId, input.newPlan);
  if (!quoted.ok) {
    return err(new UpgradePlanError(quoted.error.detail));
  }
  const quote: UpgradeQuote = quoted.value;
  if (!quote.ok) {
    return err(new UpgradePlanError(quote.error ?? "UNKNOWN"));
  }

  // المسار المجّاني: التجربة. تُطبَّق مباشرةً عبر الدالّة الذرّية.
  if (!quote.paymentRequired) {
    const applied = await deps.changes.applyUpgrade(input.driverId, input.newPlan, null);
    if (!applied.ok) {
      return err(new UpgradePlanError(applied.error.detail));
    }
    if (!applied.value.ok) {
      return err(new UpgradePlanError(applied.value.error ?? "UNKNOWN"));
    }
    const value = applied.value;
    if (value.subscriptionId === null || value.plan === null) {
      return err(new UpgradePlanError("UPGRADED_WITHOUT_SUBSCRIPTION_STATE"));
    }
    return ok({
      kind: "applied",
      subscriptionId: value.subscriptionId,
      plan: value.plan,
      periodEnd: value.periodEnd,
      alreadyOnPlan: value.alreadyOnPlan,
    });
  }

  if (quote.currency === null) {
    return err(new UpgradePlanError("QUOTE_WITHOUT_CURRENCY"));
  }
  if (quote.amountDue <= 0) {
    // القاعدة قالت «الدفع مطلوب» ثم أعادت مبلغاً غير موجب: تناقضٌ يُرفض بدل
    // أن يُنشأ طلب دفع بصفر يُفعّل ترقيةً بلا مقابل.
    return err(new UpgradePlanError("QUOTE_AMOUNT_NOT_POSITIVE"));
  }

  const money = { amount: toMinorUnits(quote.amountDue), currency: quote.currency } as const;

  // الإيدمبوتنسي (خط ١): فحص سريع قبل الإنشاء.
  const existing = await deps.payments.findByIdempotencyKey(input.idempotencyKey);
  if (!existing.ok) {
    return err(new UpgradePlanError(existing.error.detail));
  }
  if (existing.value !== null) {
    return ok({
      kind: "payment_required",
      transactionId: existing.value.id,
      amountDue: quote.amountDue,
      currency: quote.currency,
      checkoutUrl: null,
      status: existing.value.status,
    });
  }

  // `upgrade: true` في الوسم ليس زينة: منه تعرف `confirm_payment` أن هذه
  // المعاملة ترقيةٌ تُغيّر الخطّة في مكانها، لا اشتراكٌ جديد يُمدّد الدورة.
  const created = await deps.payments.create({
    driverId: input.driverId,
    amount: money,
    purpose: "driver_subscription",
    provider: deps.provider.name,
    providerTransactionId: null,
    status: "pending",
    idempotencyKey: input.idempotencyKey,
    metadata: {
      plan: input.newPlan,
      cityId: input.cityId,
      upgrade: true,
      previousPlan: quote.currentPlan,
    },
  });
  if (!created.ok) {
    return err(new UpgradePlanError(created.error.detail));
  }

  // الإيدمبوتنسي (خط ٢ — حسم السباق): معاملة موجودة سلفاً لا تُستدعى للمزوّد.
  if (created.value.alreadyExists) {
    return ok({
      kind: "payment_required",
      transactionId: created.value.transaction.id,
      amountDue: quote.amountDue,
      currency: quote.currency,
      checkoutUrl: null,
      status: created.value.transaction.status,
    });
  }

  const charge = await deps.provider.chargeSubscription({
    transactionId: created.value.transaction.id,
    driverId: input.driverId,
    amount: money,
    purpose: "driver_subscription",
    idempotencyKey: input.idempotencyKey,
  });
  if (!charge.ok) {
    return err(new UpgradePlanError(charge.error.detail));
  }

  return ok({
    kind: "payment_required",
    transactionId: created.value.transaction.id,
    amountDue: quote.amountDue,
    currency: quote.currency,
    checkoutUrl: charge.value.checkoutUrl,
    status: charge.value.status,
  });
}
