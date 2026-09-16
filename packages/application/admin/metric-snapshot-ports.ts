/**
 * الغرض: منفذُ تحديثِ لقطةِ مقاييسِ الإدارةِ — عقدٌ **بطريقةٍ واحدةٍ** تُنفِّذُ
 *   شوطاً ذرّيًّا في القاعدةِ ولا تقرأُ رقماً ولا تكتبُ عموداً بيدِها
 *   (`F7-08` · `CAP-011`).
 * الحالة: منفَّذٌ فعليّاً — البند `F7-08`.
 * ينتمي إلى: packages/application/admin
 * يُستخدم من: `packages/application/admin/refresh-metric-snapshots.ts` ·
 *   `packages/infrastructure/admin/metric-snapshot-store.ts`
 * يحرسُه: scripts/check-admin-metric-snapshot-contract.ts ·
 *   tests/integration/admin-metric-snapshots.test.ts
 * الحاكم: docs/adr/0128-an-aggregate-without-its-age-is-a-lie.md
 *
 * ## لِمَ طريقةٌ واحدةٌ **لا طريقةٌ لكلِّ عدَّادٍ**
 *
 * لأنَّ الشوطَ **جملةٌ واحدةٌ** في القاعدةِ (القاعدة 0.5): ستّةَ عشرَ عدَّاداً
 * تُقرأُ في لقطةِ MVCC واحدةٍ فتكونُ متّسقةً بعضُها مع بعضٍ. ولو كانَ في العقدِ
 * طريقةٌ لكلِّ عدَّادٍ لَصارَ الاتّساقُ **مسؤوليّةَ المُنادي**، ولَجازَ أن يُقرأَ
 * «طلبٌ يبحثُ» في لحظةٍ و«سائقٌ متاحٌ» في أخرى فيُعرَضَ حالٌ لم يقعْ قطُّ.
 *
 * ## ولِمَ **لا طريقةَ قراءةٍ** ههنا
 *
 * القراءةُ تقعُ في البوابةِ على القاعدةِ نفسِها (`apps/gateway/src/admin/queries.ts`)
 * في السياقِ الذي يخدمُ الطلبَ. وإضافةُ قراءةٍ إلى هذا العقدِ تُعطي **العاملَ**
 * سلطةَ قراءةِ لوحةِ الإدارةِ بلا حاجةٍ، وأوسعُ سلطةٍ في العقدِ تُقرأُ سلطةَ كلِّ
 * مُستعمِلِه.
 *
 * ## وما لا يقولُه هذا العقدُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقولُ عدَّاداً**: لا حقلَ لرقمٍ في الطلبِ ولا في الجوابِ — الأرقامُ
 *      تُحسَبُ في القاعدةِ من الجداولِ الأصليّةِ، فلا يُمكِنُ لكاتبٍ أن يُلقِنَ
 *      اللوحةَ رقماً من خارجِها.
 *   ــ **لا يقولُ مدينةً**: الشوطُ يشملُ **كلَّ** المدنِ في جملةٍ واحدةٍ، فلا
 *      يُمكِنُ أن تُحدَّثَ مدينةٌ وتُنسى أخرى فيُجمَعَ حاضرٌ بماضٍ.
 *   ــ **لا يقولُ حذفاً**: لا طريقةَ تُفرِغُ الجدولَ. الصفُّ يُستبدَلُ في موضعِه،
 *      والإفراغُ سلطةٌ لا حاجةَ لعاملٍ بها.
 */

import type { Result } from "../../shared/result/index.ts";

/**
 * رفضٌ **مُصنَّفٌ** من القاعدةِ. و`INVALID_WINDOW_HOURS` رفضٌ لا عطبٌ: نافذةٌ
 * صفرٌ أو سالبةٌ طلبٌ مُشوَّهٌ، والدالّةُ ترفضُه ولا تُصلِحُه بنافذةٍ مُخترَعةٍ.
 */
export type MetricSnapshotRejection = "INVALID_WINDOW_HOURS";

export interface MetricSnapshotFailure {
  readonly reason: "STORE_ERROR" | "MALFORMED_RESULT";
  readonly detail: string;
}

export interface MetricSnapshotRejectionDetail {
  readonly rejection: MetricSnapshotRejection;
  readonly detail: string;
}

export type MetricSnapshotStoreError = MetricSnapshotFailure | MetricSnapshotRejectionDetail;

export function isMetricSnapshotRejection(
  error: MetricSnapshotStoreError,
): error is MetricSnapshotRejectionDetail {
  return "rejection" in error;
}

/** حصيلةُ شوطٍ: زمنُ القياسِ وعددُ المدنِ التي كُتِبَ لها صفٌّ. */
export interface MetricSnapshotRefreshOutcome {
  readonly windowHours: number;
  /** زمنُ القياسِ كما قالَته القاعدةُ — **لا ساعةَ عاملٍ** تُكتَبُ ههنا. */
  readonly computedAt: string;
  readonly citiesWritten: number;
}

/** يُنفِّذُ شوطَ التحديثِ الذرّيَّ. تنفيذُه `refresh_admin_metric_snapshots`. */
export interface MetricSnapshotRefreshPort {
  refresh(
    windowHours: number,
  ): Promise<Result<MetricSnapshotRefreshOutcome, MetricSnapshotStoreError>>;
}
