/**
 * الغرضُ: `F12-20` — مُهايئُ `detect_ceiling_exceeded_orders`. **بلا منطقٍ ولا حسابٍ**:
 *   الحكمُ كلُّه في القاعدةِ، وههنا نداءٌ وترجمةُ صفوفٍ.
 * ينتمي إلى: packages/infrastructure/tracking
 * يُستخدم من: `apps/workers/src/container.ts`.
 * الحاكم: docs/adr/0216-ceiling-exceeded-detector.md
 */

import { PortFailureError } from "../../application/ports/index.ts";
import type {
  CeilingExceededOrderRow,
  CeilingExceededOrderRpcPort,
} from "../../application/tracking/ceiling-exceeded-ports.ts";
import type { CityId, OrderId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import { guard, type Sql } from "../db/client.ts";

interface RawRow {
  readonly order_id: string;
  readonly status: string;
  readonly started_at: string | Date;
  readonly elapsed_minutes: number | string;
  readonly ceiling_minutes: number | string;
  readonly ceiling_source: string;
}

function toInt(value: number | string): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function createCeilingExceededAdapter(sql: Sql): CeilingExceededOrderRpcPort {
  return {
    async listCeilingExceeded(
      cityId: CityId,
      limit: number,
    ): Promise<Result<readonly CeilingExceededOrderRow[], PortFailureError>> {
      const result = await guard("ceilingExceeded.listCeilingExceeded", async () => {
        return await sql<RawRow[]>`
          select order_id, status, started_at, elapsed_minutes, ceiling_minutes, ceiling_source
            from detect_ceiling_exceeded_orders(${cityId}::uuid, ${limit}::integer)
        `;
      });
      if (!result.ok) return err(result.error);

      const rows: CeilingExceededOrderRow[] = [];
      for (const raw of result.value) {
        const elapsed = toInt(raw.elapsed_minutes);
        const ceiling = toInt(raw.ceiling_minutes);
        if (elapsed === null || ceiling === null) {
          return err(
            new PortFailureError(
              "ceilingExceeded.listCeilingExceeded",
              `صفٌّ غيرُ مفهومٍ من detect_ceiling_exceeded_orders للطلبِ ${raw.order_id}`,
            ),
          );
        }
        rows.push({
          orderId: raw.order_id as OrderId,
          status: raw.status,
          startedAt: raw.started_at instanceof Date ? raw.started_at.toISOString() : raw.started_at,
          elapsedMinutes: elapsed,
          ceilingMinutes: ceiling,
          ceilingSource: raw.ceiling_source,
        });
      }
      return ok(rows);
    },
  };
}
