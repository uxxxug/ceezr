/**
 * الغرض: مهمة دورية تعيد حساب متوسطات التقييم من جدول ratings — تصحيح لا حساب أوّلي.
 * الحالة: منفّذ فعلياً — المرحلة 2.5.
 * ينتمي إلى: apps/workers/src/jobs
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/index.ts (Cron كل ساعة)
 * ملاحظات مستقبلية: عند تضخّم البيانات تُقسَّم الدالّة في القاعدة على دفعات، والتوقيع باقٍ.
 */

import type { PortFailureError } from "../../../../packages/application/ports/index.ts";
import type {
  RatingRecomputePort,
  RecomputeOutcome,
} from "../../../../packages/application/reputation/index.ts";
import { recomputeAverageRatings } from "../../../../packages/application/reputation/index.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";

export interface RecomputeRatingsDependencies {
  readonly recompute: RatingRecomputePort;
}

/**
 * التقييم يُحدِّث المتوسط فوراً عند تسجيله، فهذه المهمة شبكة أمان لا مصدر حقيقة:
 * تلتقط الانحراف الناتج عن تعليم تقييم مُسيء أو عن تدخّل يدوي في القاعدة.
 * عائدها صفراً هو الحالة السليمة المتوقّعة، لا فشلاً صامتاً.
 */
export async function recomputeRatings(
  deps: RecomputeRatingsDependencies,
): Promise<Result<RecomputeOutcome, PortFailureError>> {
  return recomputeAverageRatings({ recompute: deps.recompute });
}
