/**
 * الغرض: مهمّة دوريّة تسأل خادم مزوّد الدفع عن الدفعات المعلّقة وتحسمها — المسار
 *   الثاني لحسم الدفع حين يضيع الويبهوك.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/workers/src/jobs
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/container.ts (لكل مدينة مفعّلة)
 * ملاحظات مستقبلية: عند إضافة التجديد التلقائي تبقى هذه المهمّة مستقلّة عنه —
 *   المراجعة تحسم ما بدأ، والتجديد يبدأ ما لم يبدأ.
 *
 * لماذا مهمّة لا استدعاءٌ عند الطلب؟ لأنّ الحالة التي تُصلحها لا يُبلّغ عنها أحد:
 * السائق يظنّ أنّه دفع، والنظام يظنّ أنّه لم يدفع، ولا طرف ثالث يسأل. فالسؤال
 * الدوريّ هو الجهة الوحيدة التي تنتبه.
 */

import {
  type ReconcilePendingPaymentsDeps,
  type ReconcilePendingPaymentsError,
  type ReconcilePendingPaymentsOutcome,
  reconcilePendingPayments,
} from "../../../../packages/application/financial/index.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";

export interface ReconcilePendingPaymentsJobInput {
  readonly cityId: string;
  readonly olderThanSeconds: number;
  readonly maxAgeSeconds: number;
  readonly limit: number;
}

export async function runReconcilePendingPayments(
  input: ReconcilePendingPaymentsJobInput,
  deps: ReconcilePendingPaymentsDeps,
): Promise<Result<ReconcilePendingPaymentsOutcome, ReconcilePendingPaymentsError>> {
  return reconcilePendingPayments(
    {
      cityId: input.cityId,
      olderThanSeconds: input.olderThanSeconds,
      maxAgeSeconds: input.maxAgeSeconds,
      limit: input.limit,
    },
    deps,
  );
}
