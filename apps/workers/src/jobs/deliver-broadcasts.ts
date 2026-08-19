/** يدير شوط outbox للبثّ الجماعي في مدينة؛ القفل الموزّع يطبقه runner على اسم المهمة. */

import {
  type BroadcastBatchOutcome,
  type DeliverBroadcastDeps,
  deliverBroadcastBatch,
} from "../../../../packages/application/broadcast/deliver-broadcast.ts";
import type { PortFailureError } from "../../../../packages/application/ports/index.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";

export function deliverBroadcasts(
  cityId: string,
  deps: DeliverBroadcastDeps,
): Promise<Result<BroadcastBatchOutcome, PortFailureError>> {
  return deliverBroadcastBatch(cityId, deps);
}
