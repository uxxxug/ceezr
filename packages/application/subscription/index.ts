/**
 * الغرض: تجميع حالات استخدام وحدة subscription.
 * الحالة: مُفعَّل جزئياً — الإلغاء والاستئناف والترقية منفَّذة فعلياً (الأمر
 *   الثاني، قرار المالك 2026-08-12). بقيّة ملفات المجلد ما زالت «هيكل فقط»
 *   ولا تُصدَّر من هنا كي لا يُوهم التصدير بوجود تنفيذ:
 *     • start-trial.ts — التنفيذ الفعليّ قائم في
 *       packages/infrastructure/subscription/subscription-adapters.ts
 *       (createTrialRpc) ويُستدعى من حوار السائق. الملف هيكلٌ باقٍ للتوافق.
 *     • subscribe-plan.ts — التنفيذ الفعليّ في
 *       packages/application/financial/subscribe-plan.ts.
 *     • expire-subscriptions.ts — منفَّذ فعلياً بالكامل (لا هيكل): يحمل
 *       expireDueSubscriptions وwarnExpiringSubscriptions وSubscriptionLifecycleRpcPort.
 *       يُستورد مباشرةً من apps/workers، ولا يُصدَّر من هنا كي لا يتغيّر سطح
 *       الاستيراد القائم.
 *     • check-subscription-status.ts — القراءة عبر SubscriptionReader.findLive.
 *     • renew-subscription.ts — هيكل فقط فعلاً: لا دالّة `renew_subscription`
 *       في القاعدة رغم ذكرها في docs/MASTER_DIRECTIVE.md:35. التجديد يحدث
 *       اليوم عبر مسار الدفع (subscribe-plan → confirm_payment). فجوة توثيق
 *       معلنة، لا تنفيذ صامت.
 * ينتمي إلى: application/subscription
 */

export {
  type CancelSubscriptionDeps,
  CancelSubscriptionError,
  type CancelSubscriptionInput,
  type CancelSubscriptionOutcome,
  cancelSubscription,
  type ResumeSubscriptionOutcome,
  resumeSubscription,
} from "./cancel-subscription.ts";
export type {
  CancellationOutcome,
  ResumeOutcome,
  SubscriptionChangeRpcPort,
  UpgradeApplied,
  UpgradeQuote,
} from "./ports.ts";
export {
  type UpgradeAppliedOutcome,
  type UpgradePaymentRequiredOutcome,
  type UpgradePlanDeps,
  UpgradePlanError,
  type UpgradePlanInput,
  type UpgradePlanOutcome,
  upgradePlan,
} from "./upgrade-plan.ts";
