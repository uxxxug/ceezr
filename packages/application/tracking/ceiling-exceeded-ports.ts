/**
 * الغرضُ: `F12-20` — عقدُ قراءةِ الطلباتِ `in_progress` التي تجاوزَتْ سقفَ
 *   `tracking_link_max_lifetime_minutes`. **قراءةٌ محضةٌ بلا إصلاحٍ**.
 * ينتمي إلى: packages/application/tracking
 * يُستخدم من: `apps/workers/src/jobs/detect-ceiling-exceeded.ts` ·
 *   `packages/infrastructure/tracking/ceiling-exceeded-adapters.ts`.
 * الحاكم: docs/adr/0216-ceiling-exceeded-detector.md
 */
import type { CityId, OrderId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

/** مصدرُ السقفِ — الإعدادُ أو الافتراضيُّ، يُنشَرُ كي لا يُقرأَ الرقمُ بلا نسبٍ. */
export const CEILING_SOURCES = ["SETTING", "FALLBACK_DEFAULT"] as const;
export type CeilingSource = (typeof CEILING_SOURCES)[number];

export function isKnownCeilingSource(value: string): value is CeilingSource {
  return (CEILING_SOURCES as readonly string[]).includes(value);
}

/** صفُّ طلبٍ تجاوزَ السقفَ كما تقرؤُه `detect_ceiling_exceeded_orders`. */
export interface CeilingExceededOrderRow {
  readonly orderId: OrderId;
  readonly status: string;
  readonly startedAt: string;
  /** الدقائقُ منذُ بدءِ الرحلةِ. */
  readonly elapsedMinutes: number;
  /** السقفُ بالمدينةِ بالدقائقِ. */
  readonly ceilingMinutes: number;
  readonly ceilingSource: CeilingSource | string;
}

export interface CeilingExceededOrderRpcPort {
  /** يُحصي طلباتَ مدينةٍ في in_progress تجاوزَتْ السقفَ. لا يُغيِّرُ شيئاً. */
  readonly listCeilingExceeded: (
    cityId: CityId,
    limit: number,
  ) => Promise<Result<readonly CeilingExceededOrderRow[], PortFailureError>>;
}
