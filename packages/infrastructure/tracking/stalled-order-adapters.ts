/**
 * الغرضُ: `F12-04` — مُهايئُ `detect_stalled_orders`. **بلا منطقٍ ولا حسابٍ**:
 *   الحكمُ كلُّه في `order_stall_state` في القاعدةِ، وههنا نداءٌ وترجمةُ صفوفٍ.
 * ينتمي إلى: packages/infrastructure/tracking
 * يُستخدم من: `apps/workers/src/container.ts`.
 *
 * ولا تُحسَبُ العتبةُ ههنا ولا تُقرأُ من إعدادٍ: موضعانِ للعتبةِ يتباعدانِ،
 * والقاعدةُ تُخرِجُها في الصفِّ (`threshold_minutes`) فتُقرأُ ولا تُستنتَجُ.
 */

import { PortFailureError } from "../../application/ports/index.ts";
import type {
  StalledOrderRow,
  StalledOrderRpcPort,
} from "../../application/tracking/stalled-order-ports.ts";
import type { CityId, OrderId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import { guard, type Sql } from "../db/client.ts";

interface RawRow {
  readonly order_id: string;
  readonly status: string;
  readonly idle_seconds: number | string;
  readonly threshold_minutes: number | string;
  readonly signal_source: string;
  readonly last_signal_at: string | Date;
}

function toInt(value: number | string): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function createStalledOrderAdapter(sql: Sql): StalledOrderRpcPort {
  return {
    async listStalled(
      cityId: CityId,
      limit: number,
    ): Promise<Result<readonly StalledOrderRow[], PortFailureError>> {
      const result = await guard("stalledOrders.listStalled", async () => {
        return await sql<RawRow[]>`
          select order_id, status, idle_seconds, threshold_minutes, signal_source, last_signal_at
            from detect_stalled_orders(${cityId}::uuid, ${limit}::integer)
        `;
      });
      if (!result.ok) return err(result.error);

      const rows: StalledOrderRow[] = [];
      for (const raw of result.value) {
        const idle = toInt(raw.idle_seconds);
        const threshold = toInt(raw.threshold_minutes);
        if (idle === null || threshold === null) {
          // رقمٌ لا يُقرأُ **عطبٌ يُعلَنُ** لا صفٌّ يُطرَحُ صامتاً: صفٌّ مطروحٌ
          // بصمتٍ يعني طلباً عالقاً لا يراهُ المُشغِّلُ أبداً.
          return err(
            new PortFailureError(
              "stalledOrders.listStalled",
              `صفٌّ غيرُ مفهومٍ من detect_stalled_orders للطلبِ ${raw.order_id}`,
            ),
          );
        }
        rows.push({
          orderId: raw.order_id as OrderId,
          status: raw.status,
          idleSeconds: idle,
          thresholdMinutes: threshold,
          signalSource: raw.signal_source,
          lastSignalAt:
            raw.last_signal_at instanceof Date
              ? raw.last_signal_at.toISOString()
              : raw.last_signal_at,
        });
      }
      return ok(rows);
    },
  };
}
