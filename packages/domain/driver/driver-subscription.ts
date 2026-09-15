/**
 * الغرض: كيانُ لوحِ اشتراكِ السائقِ — الحالُ والخطةُ والسعرُ والتجربةُ والتحذيرُ،
 *   وكلُّ رقمٍ من `platform_settings` لا من ثابتٍ (`F3-06` · `SD-07`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-06`.
 * ينتمي إلى: domain/driver
 * يُستخدم من: `packages/application/driver/driver-subscription.ts` ·
 *   `packages/infrastructure/driver/driver-subscription-store.ts`
 * يُتوقع أن يستخدمه لاحقاً: `F3-09` — تجديدُ الاشتراكِ يبدأُ الدفعَ لا يُتمُّه.
 * يحرسُه: scripts/check-driver-subscription-contract.ts
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ## لِمَ السعرُ في الكيانِ لا في الشاشةِ
 *
 * لأنَّ الشاشةَ تنسخُ السعرَ إن لم يصلها، والنسخةُ تتخلَّفُ. فالسعرُ يصلُها من
 * الخادمِ في الكيانِ، والخادمُ يقرأُه من `platform_settings` — فمصدرُ الحقيقةِ
 * واحدٌ للعرضِ وللتفعيلِ.
 *
 * ## وما لا يقولُه هذا الكيانُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقولُ «تجديدٌ»**: التجديدُ دفعٌ يبدأُه مسارٌ، والكيانُ يصفُ الحالَ.
 *   ــ **لا يقولُ هويّةَ راكبٍ**: لا حقلَ ههنا ولا في التاريخِ.
 *   ــ **لا يقولُ مزوّدَ دفعٍ مُحدَّداً**: المزوّدُ تهيئةٌ لا قرارُ كيانٍ.
 */

import type { SubscriptionPlan, SubscriptionStatus } from "../subscription/entity.ts";

/** أسعارُ الخططِ الثلاثِ — كلُّ رقمٍ من `platform_settings`. */
export interface SubscriptionPlanPrices {
  readonly transport: number;
  readonly delivery: number;
  readonly both: number;
}

/** لوحُ الاشتراكِ كما يُقرأُ من القاعدةِ. */
export interface DriverSubscriptionDashboard {
  /** اللحظةُ التي قيسَ عندها الجوابُ. */
  readonly serverTime: string;
  /** هل للسائقِ اشتراكٌ سارٍ؟ غيابُه ليسَ «منتهٍ» بل «لا اشتراكَ». */
  readonly hasSubscription: boolean;
  /** الأسعارُ الحاليّةُ للخططِ — تُعرَضُ حينَ لا اشتراكَ سارياً. */
  readonly planPrices: SubscriptionPlanPrices;
  readonly currency: string;
  readonly trialDays: number;
  readonly periodDays: number;
  /** الحقولُ التاليةُ موجودةٌ حينَ `hasSubscription = true` فقط. */
  readonly subscriptionId: string | null;
  readonly plan: SubscriptionPlan | null;
  readonly status: SubscriptionStatus | null;
  readonly isTrial: boolean | null;
  /** السعرُ الحاليُّ للخطةِ من الإعداداتِ — لا المخزونِ في الصفِّ. */
  readonly price: number | null;
  readonly trialEndsAt: string | null;
  readonly currentPeriodEnd: string | null;
  readonly endsAt: string | null;
  readonly daysLeft: number | null;
  readonly expiresSoon: boolean | null;
  readonly cancelAtPeriodEnd: boolean | null;
  readonly cancellationRequestedAt: string | null;
  readonly warningDays: number | null;
}

/** صفٌّ في تاريخِ دفعاتِ الاشتراكِ. */
export interface SubscriptionPaymentEntry {
  readonly transactionId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly provider: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string | null;
  readonly plan: string | null;
  readonly checkoutUrl: string | null;
}

/** تاريخُ الدفعاتِ بسقفٍ خادميٍّ. */
export interface DriverSubscriptionHistory {
  readonly serverTime: string;
  readonly limit: number;
  readonly entries: readonly SubscriptionPaymentEntry[];
}

/** مجالُ حالاتِ المعاملةِ المُنشَرةِ في التاريخِ. */
export const PAYMENT_STATUS_VALUES: readonly string[] = [
  "active",
  "pending",
  "past_due",
  "failed",
  "canceled",
  "expired",
  "refunded",
] as const;

export function isPaymentStatus(value: unknown): value is string {
  return typeof value === "string" && (PAYMENT_STATUS_VALUES as readonly string[]).includes(value);
}

/**
 * نتيجةُ التجديدِ — لا يُفعِّلُ الدفعُ الاشتراكَ، بل يُبدِئُ معاملةً. والتفعيلُ
 * حقُّ الويبهوكِ وحدَه بعدَ إعادةِ قراءةِ الدفعةِ من خادمِ المزوّدِ.
 *
 * والسعرُ ههنا **مُقاسٌ** من `platform_settings` لا مخزونٌ في الصفِّ: فالتجديدُ
 * يبدأُ دفعةً جديدةً بالسعرِ الحاليِّ، لا بالسعرِ القديمِ الذي دفعَه السائقُ
 * في المرّةِ السابقةِ.
 */
export interface DriverSubscriptionRenewal {
  /** معرِّفُ معاملةِ الدفعِ المُنشَأةِ. */
  readonly transactionId: string;
  /** رابطُ الدفعِ المستضافُ أو `null` إن كان المزوّدُ لا يُرجِعُ رابطاً. */
  readonly checkoutUrl: string | null;
  /** حالةُ المعاملةِ بعدَ النداءِ — `pending` أو `active` إن أكّدَ المزوّدُ فوراً. */
  readonly status: string;
  /** الخطةُ المُختارةُ للتجديدِ. */
  readonly plan: SubscriptionPlan;
  /** السعرُ المُقاسُ من `platform_settings` بالوحداتِ الصغرى (هلّات). */
  readonly amountMinor: number;
  /** العملةُ معَ السعرِ. */
  readonly currency: string;
}
