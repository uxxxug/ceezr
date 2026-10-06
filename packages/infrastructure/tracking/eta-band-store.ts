/**
 * الغرض: مُنفِّذُ `EtaBandStore` على PostgreSQL (ADR 0243) — نداءٌ واحدٌ لـ`record_eta_and_read_band`
 *   يحفظُ أوّلَ تقديرٍ للساقِ ويُعيدُ إحصاءَ الخطأِ المرصودِ في مدينةِ الطلب.
 * الحالة: منفّذ فعلياً — إغلاقُ فجوةِ UI-8 [C] الثانية.
 * ينتمي إلى: packages/infrastructure/tracking
 *
 * ردٌّ لا يُفهَمُ شكلُه عطلٌ (`PortFailureError`) لا إحصاءٌ صفريّ: صفرُ عيّناتٍ مختلَقٌ يُقرأُ
 * «لم نرصد بعد» وهو «لم نستطع القراءة».
 */

import { PortFailureError } from "../../application/ports/index.ts";
import type { EtaBandStore } from "../../application/tracking/eta-band-ports.ts";
import type { EtaErrorStats } from "../../domain/eta/band.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

const PORT = "etaBands.recordAndRead";

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** غلافُ القاعدةِ ⇒ إحصاء، أو `null` متى خالفَ الشكل. */
export function readEtaBandEnvelope(value: unknown): EtaErrorStats | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.ok !== true) return null;
  const samples = readNumber(raw.samples);
  if (samples === null || !Number.isInteger(samples) || samples < 0) return null;
  return {
    samples,
    lowRatio: raw.low_ratio === null ? null : readNumber(raw.low_ratio),
    highRatio: raw.high_ratio === null ? null : readNumber(raw.high_ratio),
  };
}

export function createEtaBandStore(sql: Sql): EtaBandStore {
  return {
    async recordAndRead(input): Promise<Result<EtaErrorStats, PortFailureError>> {
      const predicted = Math.max(1, Math.round(input.predictedSeconds));
      let value: unknown;
      try {
        const rows = await sql<{ result: unknown }[]>`
          select record_eta_and_read_band(${input.orderId}::uuid, ${input.leg}, ${predicted}::integer) as result
        `;
        value = rows[0]?.result ?? null;
      } catch (error) {
        return err(
          new PortFailureError(PORT, error instanceof Error ? error.message : String(error)),
        );
      }
      const stats = readEtaBandEnvelope(value);
      if (stats === null)
        return err(new PortFailureError(PORT, "ردٌّ غير مفهوم من record_eta_and_read_band"));
      return ok(stats);
    },
  };
}
