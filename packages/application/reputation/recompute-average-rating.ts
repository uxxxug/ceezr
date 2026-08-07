/**
 * الغرض: إعادة حساب المتوسطات من المصدر — تصحيح أي انحراف عن التحديث الفوري.
 * الحالة: منفّذ فعلياً — المرحلة 2.5.
 * ينتمي إلى: application/reputation
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/jobs/recompute-ratings.ts
 * ملاحظات مستقبلية: عند تضخّم البيانات تُقسَّم الدالّة في القاعدة على دفعات، والتوقيع باقٍ.
 */

import type { Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

export interface RecomputeOutcome {
  readonly driversUpdated: number;
  readonly ridersUpdated: number;
}

export interface RatingRecomputePort {
  recompute(): Promise<Result<RecomputeOutcome, PortFailureError>>;
}

/**
 * تعيد عدد الصفوف التي تغيّرت فعلاً. صفرٌ ليس فشلاً بل الحالة السليمة:
 * التحديث الفوري عند التقييم يسبقها، فلا تجد ما تصحّحه إلا عند انحراف حقيقي.
 */
export async function recomputeAverageRatings(deps: {
  readonly recompute: RatingRecomputePort;
}): Promise<Result<RecomputeOutcome, PortFailureError>> {
  return deps.recompute.recompute();
}
