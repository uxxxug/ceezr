/**
 * الغرض: مهمّةٌ دوريّةٌ تُعيدُ بناءَ لقطةِ مقاييسِ الإدارةِ لكلِّ المدنِ — الحِملُ
 *   يُنقَلُ من **كلِّ فتحةِ صفحةٍ** إلى **شوطٍ في الدورةِ** (`F7-08` · `CAP-011`).
 * الحالة: منفَّذٌ فعليّاً — البند `F7-08`.
 * ينتمي إلى: apps/workers/src/jobs
 * يُستخدم من: apps/workers/src/container.ts
 * يحرسُه: tests/integration/admin-metric-snapshots.test.ts
 * الحاكم: docs/adr/0128-an-aggregate-without-its-age-is-a-lie.md
 *
 * ## لِمَ **مهمّةٌ عامّةٌ** لا مدنيّةٌ
 *
 * لأنَّ الشوطَ جملةٌ واحدةٌ تشملُ كلَّ المدنِ في لقطةٍ واحدةٍ. ولو صارَ مهمّةً
 * لكلِّ مدينةٍ لَكانَت لقطاتُ المدنِ في أزمنةٍ متفرّقةٍ، فمجموعُ المنصّةِ يُجمَعُ
 * من صفٍّ عمرُه ثانيتانِ وصفٍّ عمرُه دقيقةٌ — **مجموعٌ لم يقعْ في لحظةٍ قطُّ**.
 *
 * ## وليست في `CRITICAL_GLOBAL_JOBS`
 *
 * إدراجُها حرجةً يجعلُ `/ready` يُرجِعُ `503` — أي يُخرِجُ **البوابةَ التي تخدمُ
 * الركّابَ والسائقينَ** من الخدمةِ — لتأخُّرِ لوحةِ مُشغِّلٍ. وذاكَ عطبٌ أكبرُ من
 * الذي يُعالِجُه البندُ. وتأخُّرُ اللقطةِ **مرئيٌّ في مكانِه**: العُمرُ يُنشَرُ معَ
 * كلِّ رقمٍ ويُوسَمُ متقادِماً عندَ العتبةِ، فلا يستترُ صمتاً.
 *
 * ## وما لا تفعلُه هذه المهمّةُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تُشغَّلُ عندَ الإقلاعِ** (`runOnStart`): إقلاعُ عاملٍ يقعُ عندَ كلِّ
 *      نشرٍ ومعَ كلِّ نسخةٍ، وشوطٌ ثقيلٌ عندَ الإقلاعِ يجتمعُ معَ نشرٍ متزامنٍ
 *      فيُضاعِفُ الحِملَ في أسوأِ لحظةٍ. والدورةُ تأتي بعدَ ثوانٍ.
 *   ــ **لا تحملُ عدَّاداً في عائدِها**: عائدُها عددُ المدنِ وزمنُ القياسِ، فلا
 *      نسخةَ ثانيةَ من أرقامِ اللوحةِ في السجلِّ.
 *   ــ **لا تسقطُ صامتةً**: فشلٌ يُرمى فيُسجِّلُه المُشغِّلُ ويُحسَبُ في مقاييسِ
 *      المهامِّ — وشوطٌ يُرجِعُ صفرَ مدنٍ يُقرأُ في السطرِ نفسِه.
 */

import type {
  MetricSnapshotRefreshOutcome,
  MetricSnapshotRefreshPort,
  MetricSnapshotStoreError,
} from "../../../../packages/application/admin/metric-snapshot-ports.ts";
import { refreshMetricSnapshots } from "../../../../packages/application/admin/refresh-metric-snapshots.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";

export interface RefreshAdminMetricsDependencies {
  readonly port: MetricSnapshotRefreshPort;
}

export interface RefreshAdminMetricsInput {
  readonly windowHours: number;
}

export async function refreshAdminMetrics(
  deps: RefreshAdminMetricsDependencies,
  input: RefreshAdminMetricsInput,
): Promise<Result<MetricSnapshotRefreshOutcome, MetricSnapshotStoreError>> {
  return refreshMetricSnapshots({ port: deps.port }, { windowHours: input.windowHours });
}
