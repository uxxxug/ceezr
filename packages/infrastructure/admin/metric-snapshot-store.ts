/**
 * الغرض: محوّلُ منفذِ تحديثِ لقطةِ مقاييسِ الإدارةِ فوقَ
 *   `refresh_admin_metric_snapshots` — **ترجمةٌ لا منطقٌ**: لا عدَّادَ يُحسَبُ
 *   ههنا ولا زمنَ يُكتَبُ بساعةِ العمليّةِ (`F7-08` · `CAP-011`).
 * الحالة: منفَّذٌ فعليّاً — البند `F7-08`.
 * ينتمي إلى: packages/infrastructure/admin
 * يُستخدم من: `apps/workers/src/container.ts`
 * يحرسُه: tests/integration/admin-metric-snapshots.test.ts ·
 *   scripts/check-admin-metric-snapshot-contract.ts
 * الحاكم: docs/adr/0128-an-aggregate-without-its-age-is-a-lie.md
 *
 * ## لِمَ يُميِّزُ الرفضَ عن العطبِ
 *
 * `INVALID_WINDOW_HOURS` **طلبٌ مُشوَّهٌ** من المُنادي، و«تعذّرَ الاتّصالُ» عطبُ
 * قاعدةٍ. ولو خُلِطا لَقُرِئَ إعدادُ تواتُرٍ مكسورٌ في العاملِ عطبَ قاعدةٍ،
 * فطُلِبَ من مُشغِّلٍ أن يفحصَ PostgreSQL بينما العطبُ في سطرٍ عندَه.
 *
 * ## ولِمَ يُشتَرَطُ `computed_at` في الجوابِ
 *
 * لأنَّه **الرقمُ الوحيدُ الذي لا يُشتَقُّ من غيرِه**: عددُ المدنِ يُعَدُّ من
 * الجدولِ، أمّا زمنُ القياسِ فلا مصدرَ لهُ إلّا الشوطُ نفسُه. فجوابٌ بلا
 * `computed_at` **جوابٌ لا يُثبِتُ أنَّ قياساً وقعَ**، ويُردُّ `MALFORMED_RESULT`
 * ولا يُسَدُّ فراغُه بـ`new Date()` — إذ ذاكَ يُحوِّلُ عطباً صامتاً إلى «حديثٍ».
 *
 * ## وما لا يفعلُه هذا المحوّلُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يكتبُ عموداً بيدِه**: لا `insert` ولا `update` على الجدولِ — نداءُ
 *      الدالّةِ وحدَه (القاعدة 0.5)، فيستحيلُ أن يُلقِنَ كاتبٌ اللوحةَ رقماً.
 *   ــ **لا يقرأُ صفّاً**: القراءةُ في البوابةِ حيثُ الطلبُ، لا ههنا.
 *   ــ **لا يُعيدُ المحاولةَ ولا يُخفي فشلاً**: يُرجِعُ `Result` ويصمتُ عن الرأيِ.
 */

import type {
  MetricSnapshotRefreshOutcome,
  MetricSnapshotRefreshPort,
  MetricSnapshotStoreError,
} from "../../application/admin/metric-snapshot-ports.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import { readEnvelope, type Sql } from "../db/client.ts";

/** بادئةُ الرفضِ التي تُثيرُها الدالّةُ. نصٌّ واحدٌ في الطرفَينِ لا نصّانِ. */
const INVALID_WINDOW_PREFIX = "INVALID_WINDOW_HOURS";

function classify(cause: unknown): MetricSnapshotStoreError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  if (detail.includes(INVALID_WINDOW_PREFIX)) {
    return { rejection: "INVALID_WINDOW_HOURS", detail };
  }
  return { reason: "STORE_ERROR", detail };
}

export function createMetricSnapshotRefreshPort(sql: Sql): MetricSnapshotRefreshPort {
  return {
    refresh: async (
      windowHours: number,
    ): Promise<Result<MetricSnapshotRefreshOutcome, MetricSnapshotStoreError>> => {
      let rows: { result: unknown }[];
      try {
        rows = await sql<{ result: unknown }[]>`
          select refresh_admin_metric_snapshots(${windowHours}::integer) as result
        `;
      } catch (cause) {
        return err(classify(cause));
      }

      const envelope = readEnvelope(rows[0]?.result);
      if (envelope === null || envelope.ok !== true) {
        return err({
          reason: "MALFORMED_RESULT",
          detail: `جوابٌ غيرُ مفهومٍ من refresh_admin_metric_snapshots: ${JSON.stringify(rows[0]?.result ?? null)}`,
        });
      }

      const computedAt = envelope.computed_at;
      const citiesWritten = envelope.cities_written;
      if (typeof computedAt !== "string" || typeof citiesWritten !== "number") {
        return err({
          reason: "MALFORMED_RESULT",
          detail: "جوابٌ بلا computed_at أو cities_written — لا يُثبِتُ أنَّ قياساً وقعَ",
        });
      }

      return ok({
        windowHours,
        computedAt,
        citiesWritten,
      });
    },
  };
}
