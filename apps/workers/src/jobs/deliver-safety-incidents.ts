/** يدير شوط outbox لحوادث SOS؛ القفل الموزع يطبقه runner على اسم المهمة المسجل. */

import type { PortFailureError } from "../../../../packages/application/ports/index.ts";
import {
  type DeliverSafetyIncidentDeps,
  deliverSafetyIncidentBatch,
} from "../../../../packages/application/safety/deliver-safety-incident.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";

export function deliverSafetyIncidents(
  deps: DeliverSafetyIncidentDeps,
): Promise<Result<{ claimed: number; delivered: number }, PortFailureError>> {
  return deliverSafetyIncidentBatch(deps);
}
