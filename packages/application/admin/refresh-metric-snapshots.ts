/**
 * الغرض: حالةُ استخدامِ **تحديثِ لقطةِ مقاييسِ الإدارةِ** — شوطٌ واحدٌ يُعيدُ بناءَ
 *   صفوفِ كلِّ المدنِ لنافذةٍ واحدةٍ، ويُرجِعُ زمنَ القياسِ كما قالَته القاعدةُ
 *   (`F7-08` · `CAP-011`).
 * الحالة: منفَّذٌ فعليّاً — البند `F7-08`.
 * ينتمي إلى: packages/application/admin
 * يُستخدم من: `apps/workers/src/jobs/refresh-admin-metrics.ts`
 * يحرسُه: tests/unit/refresh-metric-snapshots.test.ts ·
 *   tests/integration/admin-metric-snapshots.test.ts
 * الحاكم: docs/adr/0128-an-aggregate-without-its-age-is-a-lie.md
 *
 * ## لِمَ النافذةُ تُفحَصُ ههنا **ولا تُلغي** فحصَ القاعدةِ
 *
 * القاعدةُ ترفضُ نافذةً غيرَ موجَبةٍ (`INVALID_WINDOW_HOURS`) — وهوَ الحاجزُ
 * الحقيقيُّ لمن ينادي الدالّةَ من غيرِ هذا الطريقِ. والفحصُ ههنا يجعلُ السجلَّ
 * صادقاً: شوطٌ يسقطُ برفضٍ من القاعدةِ يُقرأُ عطبَ قاعدةٍ، وهوَ في الحقيقةِ
 * **إعدادُ تواتُرٍ مكسورٌ في العاملِ**. وقصرٌ في مكانٍ واحدٍ يجعلُ الأمانَ تابعاً
 * لطريقِ النداءِ.
 *
 * ## ولِمَ لا يُرجِعُ أرقاماً
 *
 * لأنَّ العاملَ **كاتبٌ لا قارئٌ**: يُرجِعُ عددَ المدنِ التي كُتِبَ لها صفٌّ وزمنَ
 * القياسِ، وهما ما يُسجَّلُ في السجلِّ ويُقاسُ به الشوطُ. ولو أرجعَ العدَّاداتَ
 * لَصارَ في السجلِّ **نسخةٌ ثانيةٌ** من أرقامِ اللوحةِ تُقرأُ حقيقةً بجانبِ
 * الجدولِ، وتفترقُ عنه عندَ أوّلِ شوطٍ يسقطُ بعدَ الكتابةِ.
 *
 * ## وما لا تفعلُه هذه الحالةُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تقرأُ ساعةً**: زمنُ القياسِ **من القاعدةِ** وحدَها. ساعةُ العاملِ
 *      وساعةُ القاعدةِ ساعتانِ، ووسمُ التقادُمِ يُقارِنُ عمراً بعتبةٍ — فلو
 *      كُتِبَ الزمنُ بساعةِ العاملِ لَصارَ انحرافُ ثوانٍ تقادُماً وهميّاً أو
 *      حداثةً وهميّةً.
 *   ــ **لا تُعيدُ المحاولةَ**: شوطٌ يسقطُ يُسجَّلُ ويُتركُ للشوطِ التالي بعدَ
 *      دورةٍ. وإعادةٌ فوريّةٌ على قاعدةٍ مُثقَلةٍ **تُضاعِفُ الحِملَ الذي جاءَ
 *      البندُ يُخفِّفُه**.
 *   ــ **لا تُقسِّمُ على مدنٍ**: الشوطُ يشملُ كلَّ المدنِ في جملةٍ واحدةٍ، فلا
 *      يُجمَعُ صفُّ مدينةٍ حديثٌ بصفِّ أخرى قديمٍ في مجموعٍ واحدٍ.
 *   ــ **لا تتخطّى بصمتٍ**: لا حالَ تُرجِعُ فيها نجاحاً بلا كتابةٍ — صفرُ مدنٍ
 *      مكتوبةٍ يُرجَعُ رقماً ظاهراً في السجلِّ ليُقرَأَ سؤالاً لا نجاحاً.
 */

import { ADMIN_METRIC_WINDOW_HOURS } from "../../domain/admin/metric-snapshot.ts";
import { err, type Result } from "../../shared/result/index.ts";
import type {
  MetricSnapshotRefreshOutcome,
  MetricSnapshotRefreshPort,
  MetricSnapshotStoreError,
} from "./metric-snapshot-ports.ts";

export interface RefreshMetricSnapshotsDeps {
  readonly port: MetricSnapshotRefreshPort;
}

export interface RefreshMetricSnapshotsInput {
  readonly windowHours: number;
}

export async function refreshMetricSnapshots(
  deps: RefreshMetricSnapshotsDeps,
  input: RefreshMetricSnapshotsInput = { windowHours: ADMIN_METRIC_WINDOW_HOURS },
): Promise<Result<MetricSnapshotRefreshOutcome, MetricSnapshotStoreError>> {
  const windowHours = input.windowHours;
  if (!Number.isInteger(windowHours) || windowHours <= 0) {
    return err({
      rejection: "INVALID_WINDOW_HOURS",
      detail: `نافذةٌ غيرُ صالحةٍ: ${String(windowHours)}`,
    });
  }
  return deps.port.refresh(windowHours);
}
