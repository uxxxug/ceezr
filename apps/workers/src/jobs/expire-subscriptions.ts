/**
 * الغرض: مهمّتان دوريّتان لدورة حياة الاشتراك: إنهاء ما استحقّ الانتهاء، وتحذير
 *   من يقترب انتهاؤه قبل يوم أو يومين.
 * الحالة: منفّذ فعلياً — المرحلة 2.6 الخطوة 02.
 * ينتمي إلى: apps/workers/src/jobs
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/index.ts (Cron: الإنهاء كل ربع ساعة، التحذير كل ست ساعات)
 * ملاحظات مستقبلية: عند إضافة التجديد المدفوع التلقائي يُستدعى قبل الإنهاء في نفس الشوط.
 */

import type { PortFailureError } from "../../../../packages/application/ports/index.ts";
import type {
  ExpireSubscriptionsOutcome,
  SubscriptionLifecycleRpcPort,
  WarnExpiringDependencies,
  WarnExpiringReport,
} from "../../../../packages/application/subscription/expire-subscriptions.ts";
import {
  expireDueSubscriptions,
  warnExpiringSubscriptions,
} from "../../../../packages/application/subscription/expire-subscriptions.ts";
import type { CityId } from "../../../../packages/shared/kernel/index.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";

export interface ExpireSubscriptionsDependencies {
  readonly rpc: SubscriptionLifecycleRpcPort;
}

/**
 * الاشتراك المنتهي الذي لا تزال حالته 'active' ضررٌ مزدوج: سائقٌ يتلقّى عروضاً لم
 * يدفع مقابلها، وإيرادٌ في لوحة الإدارة يعدّه قائماً. لا شيء في النظام يصحّح هذا
 * الصفّ إلّا هذه المهمّة، فعائدها صفراً هو السليم وليس فشلاً صامتاً.
 */
export async function expireSubscriptions(
  deps: ExpireSubscriptionsDependencies,
): Promise<Result<ExpireSubscriptionsOutcome, PortFailureError>> {
  return expireDueSubscriptions({ rpc: deps.rpc });
}

export interface WarnExpiringSubscriptionsInput {
  /** المدينةُ التي تخصّها هذه المهمّة: القائمةُ تُرشَّح بها في القاعدة. */
  readonly cityId: CityId;
  /** عدد الأيام قبل الانتهاء — يُقرأ من إعدادات المدينة في المشغّل لا هنا. */
  readonly days: number;
}

export async function warnExpiringSoon(
  input: WarnExpiringSubscriptionsInput,
  deps: WarnExpiringDependencies,
): Promise<Result<WarnExpiringReport, PortFailureError>> {
  return warnExpiringSubscriptions({ cityId: input.cityId, days: input.days }, deps);
}
