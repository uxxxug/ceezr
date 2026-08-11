/**
 * الغرض: مهمة دورية تكنس الطلبات التي بقيت تبحث بلا أي عرض، فتُصعّدها إلى قروب
 *   الإسناد وتُخبر صاحبها. الغطاء الذي كان مفقوداً: expire-offers لا تجد عرضاً
 *   لتُنهيه، وrotate-negotiations لا تجد دورةً لتُدوّرها، فيسقط الطلب بينهما.
 * الحالة: منفّذ ومُختبَر على قاعدة حقيقية.
 * ينتمي إلى: apps/workers/src/jobs
 * يستخدمه: apps/workers/src/container.ts
 * ملاحظات مستقبلية: تعدّد النسخ آمن — التصعيد يمرّ بصفّ مقفول في القاعدة.
 */

import {
  type SweepUnmatchedDependencies,
  type SweepUnmatchedReport,
  sweepUnmatchedOrders,
} from "../../../../packages/application/dispatch/sweep-unmatched-orders.ts";
import type { PortFailureError } from "../../../../packages/application/ports/index.ts";
import type { CityId } from "../../../../packages/shared/kernel/index.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";

export type SweepUnmatchedDeps = SweepUnmatchedDependencies;
export type { SweepUnmatchedReport };

export function runSweepUnmatchedOrders(
  cityId: CityId,
  deps: SweepUnmatchedDeps,
): Promise<Result<SweepUnmatchedReport, PortFailureError>> {
  return sweepUnmatchedOrders(cityId, deps);
}
