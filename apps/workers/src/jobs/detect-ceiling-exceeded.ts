/**
 * الغرضُ: `F12-20` — مهمّةٌ دوريّةٌ **تكشفُ الطلباتِ `in_progress` التي تجاوزَتْ
 *   سقفَ `tracking_link_max_lifetime_minutes` وتُصعِّدُها سطراً مُهيكَلاً**، ولا
 *   تُغيِّرُ حالةَ طلبٍ ولا تُلغي ولا تُحذفُ بياناتٍ.
 * الحالة: منفَّذٌ فعليّاً — 2026-09-30. البندُ `F12-20`.
 * ينتمي إلى: apps/workers/src/jobs
 * يُستخدم من: `apps/workers/src/container.ts` (كلَّ ٥ دقائقَ لكلِّ مدينةٍ).
 * الحاكم: docs/adr/0216-ceiling-exceeded-detector.md
 *
 * ## ولِمَ تصعيدٌ لا إلغاءٌ
 *
 * الرحلةُ التي تتجاوزُ السقفَ ليستْ بالضرورةِ عالقةً — قد تكونُ رحلةً طويلةً
 * صادقةً. فالإلغاءُ الآليُّ يُلغي رحلةَ إنسانٍ قد تكونُ جاريةً بحقٍّ. والكشفُ
 * يضعُها أمامَ عينِ المُشغِّلِ ليقررَ.
 */

import type { PortFailureError } from "../../../../packages/application/ports/index.ts";
import type {
  CeilingExceededOrderRow,
  CeilingExceededOrderRpcPort,
} from "../../../../packages/application/tracking/ceiling-exceeded-ports.ts";
import type { CityId } from "../../../../packages/shared/kernel/index.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";

export const CEILING_EXCEEDED_BATCH = 100;

export interface DetectCeilingExceededDependencies {
  readonly detector: CeilingExceededOrderRpcPort;
  readonly escalate: (fields: Record<string, unknown>) => void;
}

export interface DetectCeilingExceededReport {
  readonly cityId: CityId;
  readonly exceeded: number;
  readonly worstElapsedMinutes: number | null;
}

export async function detectCeilingExceededOrders(
  cityId: CityId,
  deps: DetectCeilingExceededDependencies,
): Promise<Result<DetectCeilingExceededReport, PortFailureError>> {
  const result = await deps.detector.listCeilingExceeded(cityId, CEILING_EXCEEDED_BATCH);
  if (!result.ok) return result;

  const rows: readonly CeilingExceededOrderRow[] = result.value;
  for (const row of rows) {
    deps.escalate({
      city_id: cityId,
      order_id: row.orderId,
      order_status: row.status,
      started_at: row.startedAt,
      elapsed_minutes: row.elapsedMinutes,
      ceiling_minutes: row.ceilingMinutes,
      ceiling_source: row.ceilingSource,
    });
  }

  const worst = rows.length > 0 ? (rows[0]?.elapsedMinutes ?? null) : null;

  return { ok: true, value: { cityId, exceeded: rows.length, worstElapsedMinutes: worst } };
}
