/**
 * الغرض: محوّلُ صيانةِ أقسامِ `driver_location_history` — نداءُ الدالّةِ
 *   `ensure_driver_location_partitions` وقراءةُ حصيلتِها. البند `F7-03`، `ADR-0074`.
 * الحالة: منفّذ فعلياً — 2026-09-10 · البند `F7-03`.
 * ينتمي إلى: infrastructure/geo
 * يُستخدم من: `apps/workers/src/container.ts` (مهمّةُ الصيانةِ اليوميّةُ).
 * ملاحظات مستقبلية: يومَ يُنفَّذُ `F7-06` يُضافُ منفذُ **استبقاءٍ** ثانٍ ولا يُمَسُّ
 *   هذا: الإنشاءُ والمحوُ بابانِ لا بابٌ واحدٌ.
 *
 * ## لماذا لا `DDL` في هذا الملفِّ
 *
 * لو صاغَ هذا المحوّلُ `create table … partition of …` بنفسِه لصارَ شكلُ القِسمِ
 * مكتوباً في مكانَينِ: ههنا وفي الهجرةِ. ثمَّ يُضافُ فهرسٌ في أحدِهما فتنقسمُ
 * الأقسامُ إلى جيلَينِ لا يُشبِهُ أحدُهما الآخرَ — وذاكَ عطلٌ لا يُرى إلّا في
 * استعلامٍ بطيءٍ بعدَ شهرٍ. فالشكلُ في الدالّةِ وحدَها، وهذا المحوّلُ يُناديها.
 */

import type {
  LocationPartitionMaintenance,
  LocationPartitionReport,
} from "../../application/geo/ensure-location-partitions.ts";
import type { PortFailureError } from "../../application/ports/index.ts";
import type { Result } from "../../shared/result/index.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

const PORT = "geo.ensureDriverLocationPartitions";

/** عددٌ من المغلَّفِ أو صفرٌ — حقلٌ ناقصٌ يُقرأُ صفراً لا `NaN`. */
function countOf(raw: Record<string, unknown>, key: string): number {
  const value = raw[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

/** أسماءُ الأقسامِ المُنشأةِ — ما ليسَ نصّاً يُطرَحُ ولا يُقرأُ `undefined`. */
function namesOf(raw: Record<string, unknown>): readonly string[] {
  const value = raw.created;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function createDriverLocationPartitionMaintenance(sql: Sql): LocationPartitionMaintenance {
  return {
    ensurePartitions: (
      daysAhead: number,
    ): Promise<Result<LocationPartitionReport, PortFailureError>> =>
      guard(PORT, async () => {
        const rows = await sql<{ result: unknown }[]>`
          select ensure_driver_location_partitions(${daysAhead}::integer) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) {
          throw new Error("ردُّ ensure_driver_location_partitions غيرُ مفهومٍ");
        }
        if (!envelope.ok) {
          throw new Error(envelope.error ?? "ensure_driver_location_partitions أرجعَ فشلاً بلا سببٍ");
        }
        const raw = envelope as unknown as Record<string, unknown>;
        return {
          created: namesOf(raw),
          existing: countOf(raw, "existing"),
          defaultRows: countOf(raw, "default_rows"),
        };
      }),
  };
}
