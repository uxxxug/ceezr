/**
 * الغرض: محوّلُ **الاستمرارِ المجمَّعِ** لمواقعِ السائقينَ: يُمرِّرُ الدفعةَ كلَّها
 *    إلى الدالّةِ الذرّيّةِ `persist_driver_location_batch` بنداءٍ واحدٍ، ويقرأُ
 *    حصيلتَها بأصنافِها الثلاثةِ. البند `F4-02` والعائقُ `CAP-009`.
 * الحالة: منفّذ فعلياً — 2026-09-09 · البند `F4-02`.
 * ينتمي إلى: infrastructure/geo
 * يُستخدم من: `apps/workers/src/container.ts` (مهمّةُ الإفراغِ الدوريّةُ)
 * ملاحظات مستقبلية: جدولُ تاريخِ المواقعِ المقسَّمُ **تَمَّ** في `F7-03` كما وُعِدَ
 *    ههنا حرفاً: الإلحاقُ داخلَ الدالّةِ نفسِها (ADR-0074)، ولم يُضَفْ ههنا نداءٌ
 *    ثانٍ. وما زِيدَ في هذا الملفِّ قراءةُ عددِ المُلحَقِ لا كتابتُه.
 *
 * ## لماذا لا حلقةَ ههنا
 *
 * القاعدةُ ٠.٥: الذرّيّةُ في الدالّةِ. والدفعةُ تُرسَلُ `jsonb` واحداً فتقعُ
 * التنقيةُ (أحدثُ إصلاحةٍ لكلِّ سائقٍ) وحراسةُ التسلسلِ (`الأقدمُ لا يُزيحُ
 * الأحدثَ`) والعدُّ في معاملةٍ واحدةٍ. ولو كانَ ههنا `for` يُنادي صفّاً صفّاً
 * لكانَ البندُ قد نقلَ الحملَ من مكانٍ إلى مكانٍ لا رفعَه.
 */

import type {
  DriverLocationBatchPersistence,
  DriverLocationBatchReport,
  HotLocationFix,
} from "../../application/geo/driver-location-hot-state.ts";
import type { PortFailureError } from "../../application/ports/index.ts";
import { DRIVER_LOCATION_BATCH_RPC } from "../../shared/config/driver-location-hot-state.ts";
import type { CityId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

/** اسمُ المنفذِ في رسائلِ العطلِ — يُقرأُ في السجلِّ فيُعرَفُ البابُ. */
const PORT = `drivers.${DRIVER_LOCATION_BATCH_RPC}`;

/** عددٌ من المغلَّفِ أو صفرٌ — حقلٌ ناقصٌ يُقرأُ صفراً لا `NaN`. */
function countOf(raw: Record<string, unknown>, key: string): number {
  const value = raw[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

export function createDriverLocationBatchPersistence(sql: Sql): DriverLocationBatchPersistence {
  return {
    persistBatch: (
      cityId: CityId,
      fixes: readonly HotLocationFix[],
    ): Promise<Result<DriverLocationBatchReport, PortFailureError>> =>
      guard(PORT, async () => {
        if (fixes.length === 0) return { applied: 0, stale: 0, missing: 0, appended: 0 };

        /**
         * الأسماءُ بصيغةِ القاعدةِ (`driver_id`) لا بصيغةِ الشيفرةِ: الدالّةُ
         * تُفكِّكُ الدفعةَ بـ`jsonb_to_recordset` بأسماءِ حقولٍ حرفيّةٍ، فاختلافُ
         * حرفٍ يُقرأُ `null` صامتاً — والصمتُ ههنا موقعٌ لم يُكتَبْ.
         */
        const batch = fixes.map((fix) => ({
          driver_id: fix.driverId,
          latitude: fix.latitude,
          longitude: fix.longitude,
          recorded_at_ms: fix.recordedAtMs,
          /**
           * `F4-05`: لحظةُ القبولِ تُمرَّرُ ولا تُختَرَعُ في الدالّةِ. و`null` يُمرَّرُ
           * `null` صريحاً لا يُحذَفُ الحقلُ: الدالّةُ تُفكَّكُ بأسماءٍ حرفيّةٍ،
           * وحقلٌ غائبٌ وحقلٌ `null` يُقرأانِ سواءً هناكَ — والتصريحُ أوضحُ
           * لمن يقرأُ الدفعةَ في سجلٍّ.
           */
          observed_at_ms: fix.observedAtMs,
          accuracy_m: fix.accuracyMeters,
          verdict: fix.verdict,
        }));

        const rows = await sql<{ result: unknown }[]>`
          select persist_driver_location_batch(
                   ${cityId}::uuid,
                   ${sql.json(batch as never)}::jsonb
                 ) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) throw new Error("ردُّ persist_driver_location_batch غيرُ مفهومٍ");
        if (!envelope.ok) {
          throw new Error(envelope.error ?? "persist_driver_location_batch أرجعَ فشلاً بلا سببٍ");
        }
        const raw = envelope as unknown as Record<string, unknown>;
        return {
          applied: countOf(raw, "applied"),
          stale: countOf(raw, "stale"),
          missing: countOf(raw, "missing"),
          appended: countOf(raw, "appended"),
        };
      }),
  };
}
