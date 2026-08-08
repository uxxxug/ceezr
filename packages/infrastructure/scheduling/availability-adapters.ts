/**
 * الغرض: منفذ إطفاء التوفّر البائت على القاعدة الحقيقية عبر الدالّة الذرّية
 *   deactivate_stale_availability.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة 2.6 الخطوة 02.
 * ينتمي إلى: infrastructure/scheduling
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/jobs/cleanup-stale-sessions.ts
 * ملاحظات مستقبلية: عند وجود نبضة موقع دورية يتغيّر شرط البياتة في القاعدة لا هنا.
 */

import type { StaleAvailabilityRpcPort } from "../../application/scheduling/deactivate-stale-availability.ts";
import type { CityId } from "../../shared/kernel/index.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

export function createStaleAvailabilityRpc(sql: Sql): StaleAvailabilityRpcPort {
  return {
    deactivate: (cityId: CityId, staleMinutes: number) =>
      guard("rpc.deactivate_stale_availability", async (): Promise<number> => {
        const rows = await sql<{ result: unknown }[]>`
          select deactivate_stale_availability(
            ${cityId}::uuid,
            ${staleMinutes}::integer
          ) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) throw new Error("ردّ deactivate_stale_availability غير مفهوم");
        if (!envelope.ok) throw new Error(envelope.error ?? "UNKNOWN");
        const payload = envelope as { deactivated?: unknown };
        return Number(payload.deactivated ?? 0);
      }),
  };
}
