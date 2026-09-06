/**
 * يدير شوط صندوقِ الصادرِ الموحَّدِ لكلِّ أنواعِ الإشعاراتِ؛ القفل الموزع يطبقه
 * runner على اسم المهمة المسجل، فلا يجري شوطانِ في وقتٍ واحدٍ (BUG-004).
 */

import {
  type DeliveryBatchOutcome,
  deliverNotificationBatch,
  type NotificationDeliveryDeps,
} from "../../../../packages/application/notification/deliver-notification.ts";
import type { PortFailureError } from "../../../../packages/application/ports/index.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";

export function deliverNotifications(
  deps: NotificationDeliveryDeps,
): Promise<Result<DeliveryBatchOutcome, PortFailureError>> {
  return deliverNotificationBatch(deps);
}
