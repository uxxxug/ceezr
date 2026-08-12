/** يسلّم outbox واحداً؛ فشل تلغرام يعيده pending ولا يحذف incident. */
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import type { SafetyCardPublisher, SafetyDeliveryPort } from "./ports.ts";

export interface DeliverSafetyIncidentDeps {
  readonly deliveries: SafetyDeliveryPort;
  readonly publisher: SafetyCardPublisher;
}
export async function deliverSafetyIncident(
  _input: Record<string, never>,
  deps: DeliverSafetyIncidentDeps,
): Promise<
  Result<{ found: boolean; delivered: boolean; maxAttempts: number | null }, PortFailureError>
> {
  const claimed = await deps.deliveries.claim();
  if (!claimed.ok) return claimed;
  if (claimed.value === null) return ok({ found: false, delivered: false, maxAttempts: null });
  const sent = await deps.publisher.publish(claimed.value);
  const finished = await deps.deliveries.finish({
    deliveryId: claimed.value.deliveryId,
    claimToken: claimed.value.claimToken,
    messageId: sent.ok ? sent.value : null,
  });
  if (!finished.ok) return finished;
  if (!sent.ok) return err(sent.error);
  return ok({ found: true, delivered: finished.value, maxAttempts: claimed.value.maxAttempts });
}

/**
 * شوط outbox محدود بإعداد المدينة الذي أرجعه claim الذرّي. لا يضع حدّاً لعمر
 * الحادث أو لعدد إعادة محاولاته: فشل تيليجرام يعيده `pending` بموعد جديد، ولا
 * يجوز إسقاط نداء استغاثة بعد رقم اعتباطي من المحاولات.
 */
export async function deliverSafetyIncidentBatch(
  deps: DeliverSafetyIncidentDeps,
): Promise<Result<{ claimed: number; delivered: number }, PortFailureError>> {
  let claimed = 0;
  let delivered = 0;
  let limit = 1;
  while (claimed < limit) {
    const attempt = await deliverSafetyIncident({}, deps);
    if (!attempt.ok) return attempt;
    if (!attempt.value.found) break;
    claimed += 1;
    if (attempt.value.maxAttempts !== null) limit = attempt.value.maxAttempts;
    if (attempt.value.delivered) delivered += 1;
  }
  return ok({ claimed, delivered });
}
