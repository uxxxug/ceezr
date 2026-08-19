/** يدير شوط outbox لإشعارات دورة حياة الاشتراك في مدينة؛ القفل الموزّع يطبقه runner على اسم المهمة. */

import type { PortFailureError } from "../../../../packages/application/ports/index.ts";
import {
  type DeliverNoticesDeps,
  type DeliverNoticesOutcome,
  deliverSubscriptionNotices as run,
} from "../../../../packages/application/subscription/deliver-notices.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";

export function deliverSubscriptionNotices(
  cityId: string,
  deps: DeliverNoticesDeps,
): Promise<Result<DeliverNoticesOutcome, PortFailureError>> {
  return run(cityId, deps);
}
