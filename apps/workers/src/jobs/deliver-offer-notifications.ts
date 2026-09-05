/** يدير شوط outbox لإشعارات العروض؛ القفل الموزع يطبقه runner على اسم المهمة المسجل. */

import type { PortFailureError } from "../../../../packages/application/ports/index.ts";
import {
  type OfferDeliveryDeps,
  deliverOfferNotificationBatch,
  type OfferBatchOutcome,
} from "../../../../packages/application/dispatch/deliver-offer-notification.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";

export function deliverOfferNotifications(
  deps: OfferDeliveryDeps,
): Promise<Result<OfferBatchOutcome, PortFailureError>> {
  return deliverOfferNotificationBatch(deps);
}
