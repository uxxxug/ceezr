/**
 * الغرض: منافذ تغييرات الاشتراك — الإلغاء والاستئناف وترقية الخطّة.
 *   العقود وحدها هنا؛ التنفيذ في packages/infrastructure/subscription،
 *   والمزدوجات في tests/support.
 * الحالة: منفّذ فعلياً — الأمر الثاني، وفق قرار المالك المؤرّخ 2026-08-12.
 * ينتمي إلى: application/subscription
 * ملاحظات: لا يُحسب في هذه الطبقة أي مبلغ ولا يُقارن أي سعر. المبالغ كلّها
 *   تُقرأ من `plan_upgrade_quote` التي تقرأ `platform_settings` — مصدرٌ واحد
 *   يمنع اختلاف الرقم المعروض على السائق عن الرقم الذي تتحقّق منه الترقية.
 */

import type { SubscriptionPlan, SubscriptionStatus } from "../../domain/subscription/entity.ts";
import type { CityId, DriverId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

/** نتيجة طلب إلغاء — الخدمة تستمرّ إلى `serviceUntil` ثم تُغلق. */
export interface CancellationOutcome {
  readonly ok: boolean;
  /** سبب الرفض من القاعدة: NO_LIVE_SUBSCRIPTION | DRIVER_NOT_FOUND. */
  readonly error: string | null;
  readonly subscriptionId: string | null;
  /** true إن كان الإلغاء مطلوباً سابقاً — الطلب المكرَّر لا يُخطئ. */
  readonly alreadyCancelled: boolean;
  readonly status: SubscriptionStatus | null;
  /** آخر لحظة تبقى فيها الخدمة عاملة. */
  readonly serviceUntil: Date | null;
}

/** نتيجة استئناف اشتراك أُلغي قبل انتهاء دورته. */
export interface ResumeOutcome {
  readonly ok: boolean;
  readonly error: string | null;
  readonly subscriptionId: string | null;
  /** true إن لم يكن مُلغى أصلاً. */
  readonly alreadyActive: boolean;
  readonly status: SubscriptionStatus | null;
}

/** عرض سعر الترقية — كل أرقامه من القاعدة، لا من هذه الطبقة. */
export interface UpgradeQuote {
  readonly ok: boolean;
  /** NO_LIVE_SUBSCRIPTION | ALREADY_ON_PLAN | PLAN_NOT_AN_UPGRADE | UPGRADE_PRICE_NOT_HIGHER. */
  readonly error: string | null;
  readonly subscriptionId: string | null;
  readonly cityId: CityId | null;
  readonly currentPlan: SubscriptionPlan | null;
  readonly newPlan: SubscriptionPlan | null;
  /** الفرق المستحقّ بالعملة الأساسية (لا هللات). صفرٌ داخل التجربة المجّانية. */
  readonly amountDue: number;
  /** false داخل التجربة المجّانية: لا شيء مدفوع فيها فلا فرق يُطالَب به. */
  readonly paymentRequired: boolean;
  readonly currency: string | null;
  readonly periodEnd: Date | null;
  readonly status: SubscriptionStatus | null;
}

/** نتيجة تطبيق الترقية على الاشتراك. */
export interface UpgradeApplied {
  readonly ok: boolean;
  readonly error: string | null;
  readonly subscriptionId: string | null;
  /** true إن كانت الخطّة مطبّقة سلفاً — ويبهوك مكرَّر لا يرقّي مرّتين. */
  readonly alreadyOnPlan: boolean;
  readonly plan: SubscriptionPlan | null;
  readonly periodEnd: Date | null;
}

/**
 * منفذ تغييرات الاشتراك الذرّية — كل دالّة منها تقفل صفّ الاشتراك بـ
 * `for update` داخل القاعدة. لا منطق تزامن في طبقة التطبيق.
 */
export interface SubscriptionChangeRpcPort {
  /** يقابل cancel_subscription(uuid, text). */
  requestCancellation(
    driverId: DriverId,
    reason: string | null,
  ): Promise<Result<CancellationOutcome, PortFailureError>>;

  /** يقابل resume_subscription(uuid). */
  resume(driverId: DriverId): Promise<Result<ResumeOutcome, PortFailureError>>;

  /** يقابل plan_upgrade_quote(uuid, subscription_plan) — قراءة فقط. */
  quoteUpgrade(
    driverId: DriverId,
    newPlan: SubscriptionPlan,
  ): Promise<Result<UpgradeQuote, PortFailureError>>;

  /**
   * يقابل upgrade_plan(uuid, subscription_plan, uuid).
   * لا يُستدعى مباشرةً حين يكون الدفع مطلوباً: في تلك الحالة تستدعيه
   * `confirm_payment` داخل القاعدة بعد نجاح الدفع، في المعاملة نفسها.
   */
  applyUpgrade(
    driverId: DriverId,
    newPlan: SubscriptionPlan,
    transactionId: string | null,
  ): Promise<Result<UpgradeApplied, PortFailureError>>;
}
