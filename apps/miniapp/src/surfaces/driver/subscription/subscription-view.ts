/**
 * الغرض: نموذجُ عرضِ اشتراكِ السائقِ — دالّاتٌ نقيّةٌ تُحوِّلُ الردَّ إلى مفاتيحِ
 *   نصٍّ وأرقامٍ معروضةٍ، **بلا JSX وبلا شبكةٍ وبلا ساعةٍ** (`F3-06`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-06`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/subscription
 * يُستخدم من: `SubscriptionScreen.tsx`، ويُقاسُ مباشرةً في `tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: `F3-09` — تجديدُ الاشتراكِ نموذجُه لهُ لا ههنا.
 * يحرسُه: scripts/check-driver-subscription-contract.ts
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ## لِمَ السعرُ يُصاغُ من القاعدةِ ولا يُحسَبُ
 *
 * لأنَّ **الصياغةَ عرضٌ والسعرَ حقيقةٌ**: الخادمُ يُرسِلُ السعرَ لأنَّه يقرأُه من
 * الإعداداتِ، والشاشةُ تُصيِّرُه «ريالاً» لأنَّ إنساناً يقرأُ. ولو حسبَ العميلُ
 * السعرَ لَصارَ في العميلِ قرارُ مصدرٍ لا يخصُّه.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقرأُ ساعةً**: لا `Date.now()` ولا `new Date()` — والأيّامُ الباقيةُ
 *      من الخادمِ لا من فرقٍ عن ساعةِ جهازٍ.
 *   ــ **لا يُخترِعُ سعراً**: لا ثابتَ ولا افتراضَ — السعرُ من الجوابِ.
 *   ــ **لا يُقارِنُ سائقاً بسائقٍ**: لا رُتبةَ ولا متوسّطَ.
 *   ــ **لا يُخفي حقلاً غابَ**: «غيرُ معروفٍ» يُقالُ صراحةً لا يُمسَحُ.
 */

import type {
  ApiDriverSubscriptionDashboardResponse,
  ApiDriverSubscriptionHistoryResponse,
  ApiDriverSubscriptionRenewalResponse,
  ApiSubscriptionPaymentEntry,
  ApiSubscriptionPlanPrices,
} from "./subscription-contract.ts";

/** رموزُ العطبِ التي لهذه الشاشةِ نصٌّ لها — مُقابِلةٌ لقائمةِ الطبقةِ حرفاً. */
const KNOWN_ERRORS: ReadonlySet<string> = new Set([
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "SUBSCRIPTION_STORE_NOT_AVAILABLE",
  "NOT_A_DRIVER",
  "PAYMENT_PROVIDER_NOT_AVAILABLE",
  "PLAN_INVALID",
  "RENEWAL_FAILED",
]);

export function subscriptionErrorKey(code: string): string {
  return KNOWN_ERRORS.has(code)
    ? `driver.subscription.error.${code}`
    : "driver.subscription.error.UNKNOWN";
}

/**
 * أيُّ الأعطابِ **تُعادُ المحاولةُ فيه بزرٍّ**. و`SUBSCRIPTION_STORE_NOT_AVAILABLE`
 * منها: القاعدةُ قد تعودُ في دقيقةٍ، فزرُّ إعادةٍ أصدقُ من شاشةٍ ميّتةٍ. أمّا
 * «ليسَ سائقاً» فليسَ منها: إعادةُ النداءِ تردُّ الرفضَ عينَه.
 */
export function isRetryableSubscriptionError(code: string): boolean {
  return (
    code === "SUBSCRIPTION_STORE_NOT_AVAILABLE" ||
    code === "SESSION_NOT_AVAILABLE" ||
    code === "UNKNOWN"
  );
}

export interface PlanPriceModel {
  readonly key: "transport" | "delivery" | "both";
  readonly labelKey: string;
  readonly price: number;
  readonly currency: string;
}

export interface SubscriptionDashboardModel {
  readonly serverTime: string;
  readonly hasSubscription: boolean;
  readonly planPrices: readonly PlanPriceModel[];
  readonly currency: string;
  readonly trialDays: number;
  readonly periodDays: number;
  readonly subscriptionId: string | null;
  readonly plan: string | null;
  readonly planLabelKey: string | null;
  readonly status: string | null;
  readonly statusLabelKey: string | null;
  readonly isTrial: boolean | null;
  readonly price: number | null;
  readonly trialEndsAt: string | null;
  readonly currentPeriodEnd: string | null;
  readonly endsAt: string | null;
  readonly daysLeft: number | null;
  readonly daysLeftLabelKey: string | null;
  readonly expiresSoon: boolean | null;
  readonly cancelAtPeriodEnd: boolean | null;
  readonly cancellationRequestedAt: string | null;
  readonly warningDays: number | null;
}

function planLabelKey(plan: string): string {
  return `driver.subscription.plan.${plan}`;
}

function statusLabelKey(status: string): string {
  return `driver.subscription.status.${status}`;
}

function toPlanPrices(
  prices: ApiSubscriptionPlanPrices,
  currency: string,
): readonly PlanPriceModel[] {
  return [
    { key: "transport", labelKey: planLabelKey("transport"), price: prices.transport, currency },
    { key: "delivery", labelKey: planLabelKey("delivery"), price: prices.delivery, currency },
    { key: "both", labelKey: planLabelKey("both"), price: prices.both, currency },
  ];
}

export function toSubscriptionDashboard(
  response: ApiDriverSubscriptionDashboardResponse,
): SubscriptionDashboardModel {
  const planPrices = toPlanPrices(response.plan_prices, response.currency);
  const plan = response.plan;
  const status = response.status;

  return {
    serverTime: response.server_time,
    hasSubscription: response.has_subscription,
    planPrices,
    currency: response.currency,
    trialDays: response.trial_days,
    periodDays: response.period_days,
    subscriptionId: response.subscription_id,
    plan,
    planLabelKey: plan === null ? null : planLabelKey(plan),
    status,
    statusLabelKey: status === null ? null : statusLabelKey(status),
    isTrial: response.is_trial,
    price: response.price,
    trialEndsAt: response.trial_ends_at,
    currentPeriodEnd: response.current_period_end,
    endsAt: response.ends_at,
    daysLeft: response.days_left,
    daysLeftLabelKey:
      response.days_left === null
        ? null
        : response.days_left === 0
          ? "driver.subscription.days_left.today"
          : "driver.subscription.days_left.remaining",
    expiresSoon: response.expires_soon,
    cancelAtPeriodEnd: response.cancel_at_period_end,
    cancellationRequestedAt: response.cancellation_requested_at,
    warningDays: response.warning_days,
  };
}

export interface SubscriptionPaymentEntryModel {
  readonly transactionId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly provider: string;
  readonly status: string;
  readonly statusLabelKey: string;
  readonly createdAt: string;
  readonly updatedAt: string | null;
  readonly plan: string | null;
  readonly planLabelKey: string | null;
  readonly checkoutUrl: string | null;
}

export function toSubscriptionPaymentEntry(
  entry: ApiSubscriptionPaymentEntry,
): SubscriptionPaymentEntryModel {
  const statusKey = `driver.subscription.payment.status.${entry.status}`;
  return {
    transactionId: entry.transaction_id,
    amountMinor: entry.amount_minor,
    currency: entry.currency,
    provider: entry.provider,
    status: entry.status,
    statusLabelKey: statusKey,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    plan: entry.plan,
    planLabelKey: entry.plan === null ? null : planLabelKey(entry.plan),
    checkoutUrl: entry.checkout_url,
  };
}

export interface SubscriptionHistoryModel {
  readonly limit: number;
  readonly entries: readonly SubscriptionPaymentEntryModel[];
}

export function toSubscriptionHistory(
  response: ApiDriverSubscriptionHistoryResponse,
): SubscriptionHistoryModel {
  return {
    limit: response.limit,
    entries: response.entries.map(toSubscriptionPaymentEntry),
  };
}

export interface SubscriptionRenewalModel {
  readonly transactionId: string;
  readonly checkoutUrl: string | null;
  readonly status: string;
  readonly plan: string;
  readonly amountMinor: number;
  readonly currency: string;
}

export function toSubscriptionRenewal(
  response: ApiDriverSubscriptionRenewalResponse,
): SubscriptionRenewalModel {
  return {
    transactionId: response.transaction_id,
    checkoutUrl: response.checkout_url,
    status: response.status,
    plan: response.plan,
    amountMinor: response.amount_minor,
    currency: response.currency,
  };
}
