/**
 * الغرض: إلغاء اشتراك السائق بطلبه، واستئنافه قبل انتهاء الدورة.
 * الحالة: منفّذ فعلياً — الأمر الثاني، وفق قرار المالك المؤرّخ 2026-08-12.
 *   (كان هذا الملف «هيكل فقط»؛ نصّه القديم كان `export {}` وترويسةً تقول
 *   «لا تُضِف منطقاً هنا قبل أمر تفعيل صريح» — وقد صدر الأمر.)
 * ينتمي إلى: application/subscription
 * يستخدمه: apps/gateway (حوار السائق)، apps/admin-dashboard لاحقاً.
 *
 * القرار التصميميّ ومسوّغه: الإلغاء «لا تُجدَّد» لا «اقطع الآن». لا توجد في هذا
 *   الأمر أي بنية استرداد (المحافظ والفواتير والاسترداد مؤجَّلة صراحةً في
 *   docs/MASTER_DIRECTIVE.md:95)، فقطع الخدمة لحظةَ الطلب عن سائقٍ دفع دورته
 *   كاملةً سلبٌ لما دفع ثمنه بلا وسيلة ردّ. لذلك تبقى الخدمة إلى نهاية الدورة
 *   ثم تُغلق بحالة `cancelled` — لا `expired` — كي يبقى الفرق بين «انتهى»
 *   و«أُلغي» مقروءاً في البيانات.
 *
 * الترويسة القديمة ذكرت «عبر RPC ذرّي renew_subscription» وهو خطأ في التوثيق:
 *   `renew_subscription` غير موجودة في القاعدة أصلاً، والإلغاء لا علاقة له بها.
 *   الدالّة الفعلية: `cancel_subscription(uuid, text)`.
 */

import type { SubscriptionStatus } from "../../domain/subscription/entity.ts";
import type { DriverId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { SubscriptionChangeRpcPort } from "./ports.ts";

export interface CancelSubscriptionInput {
  readonly driverId: DriverId;
  /** سبب الإلغاء كما ذكره السائق. اختياريّ: لا يُخترع سببٌ لم يُقَل. */
  readonly reason?: string | null;
}

export interface CancelSubscriptionDeps {
  readonly changes: SubscriptionChangeRpcPort;
}

export interface CancelSubscriptionOutcome {
  readonly subscriptionId: string;
  /** آخر لحظة تبقى فيها الخدمة عاملة — يُبلَّغ بها السائق نصّاً. */
  readonly serviceUntil: Date | null;
  readonly status: SubscriptionStatus | null;
  /** true إن كان الإلغاء مطلوباً سابقاً؛ الطلب المكرَّر ليس خطأً. */
  readonly alreadyCancelled: boolean;
}

export class CancelSubscriptionError {
  readonly code = "CANCEL_SUBSCRIPTION_FAILURE" as const;
  constructor(
    /** رمز الرفض من القاعدة أو عطل المنفذ: NO_LIVE_SUBSCRIPTION، DRIVER_NOT_FOUND. */
    readonly detail: string,
  ) {}
}

/**
 * يطلب إلغاء الاشتراك السارِي. الذرّية والإيدمبوتنسي من القاعدة:
 * `cancel_subscription` تقفل صفّ الاشتراك بـ`for update`، فطلبان متزامنان
 * يُسجَّل أحدهما فقط ويُعاد للثاني `alreadyCancelled=true`.
 */
export async function cancelSubscription(
  input: CancelSubscriptionInput,
  deps: CancelSubscriptionDeps,
): Promise<Result<CancelSubscriptionOutcome, CancelSubscriptionError>> {
  const result = await deps.changes.requestCancellation(input.driverId, input.reason ?? null);
  if (!result.ok) {
    return err(new CancelSubscriptionError(result.error.detail));
  }
  const outcome = result.value;
  if (!outcome.ok) {
    return err(new CancelSubscriptionError(outcome.error ?? "UNKNOWN"));
  }
  if (outcome.subscriptionId === null) {
    // نجاحٌ بلا معرّف اشتراك تناقضٌ في الغلاف — يُعلَن لا يُبتلع.
    return err(new CancelSubscriptionError("CANCELLED_WITHOUT_SUBSCRIPTION_ID"));
  }
  return ok({
    subscriptionId: outcome.subscriptionId,
    serviceUntil: outcome.serviceUntil,
    status: outcome.status,
    alreadyCancelled: outcome.alreadyCancelled,
  });
}

export interface ResumeSubscriptionOutcome {
  readonly subscriptionId: string;
  readonly status: SubscriptionStatus | null;
  /** true إن لم يكن الاشتراك مُلغى أصلاً. */
  readonly alreadyActive: boolean;
}

/**
 * يستأنف اشتراكاً طُلب إلغاؤه ولم تنتهِ دورته بعد. وجودها ليس ترفاً: بلا
 * استئناف يصير الإلغاء طريقاً أحادياً يدفع السائق للدفع من جديد لو تراجع
 * بعد دقيقة، وهو ما لا يُبرّره أي قرار تجاري.
 */
export async function resumeSubscription(
  input: { readonly driverId: DriverId },
  deps: CancelSubscriptionDeps,
): Promise<Result<ResumeSubscriptionOutcome, CancelSubscriptionError>> {
  const result = await deps.changes.resume(input.driverId);
  if (!result.ok) {
    return err(new CancelSubscriptionError(result.error.detail));
  }
  const outcome = result.value;
  if (!outcome.ok) {
    return err(new CancelSubscriptionError(outcome.error ?? "UNKNOWN"));
  }
  if (outcome.subscriptionId === null) {
    return err(new CancelSubscriptionError("RESUMED_WITHOUT_SUBSCRIPTION_ID"));
  }
  return ok({
    subscriptionId: outcome.subscriptionId,
    status: outcome.status,
    alreadyActive: outcome.alreadyActive,
  });
}
