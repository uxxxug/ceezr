/** يسلّم outbox واحداً؛ فشل تلغرام يعيده pending ولا يحذف incident. */
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import type { SafetyCardPublisher, SafetyDeferral, SafetyDeliveryPort } from "./ports.ts";

export interface DeliverSafetyIncidentDeps {
  readonly deliveries: SafetyDeliveryPort;
  readonly publisher: SafetyCardPublisher;
}
export interface SafetyAttemptOutcome {
  readonly found: boolean;
  readonly delivered: boolean;
  readonly maxAttempts: number | null;
  readonly deferred: readonly SafetyDeferral[];
  /** سبب فشل النشر إن فشل. الصفّ يعود `pending` بموعدٍ جديد في كل الأحوال. */
  readonly failure: string | null;
}

export async function deliverSafetyIncident(
  _input: Record<string, never>,
  deps: DeliverSafetyIncidentDeps,
): Promise<Result<SafetyAttemptOutcome, PortFailureError>> {
  const claimed = await deps.deliveries.claim();
  if (!claimed.ok) return claimed;
  const { delivery, deferred } = claimed.value;
  if (delivery === null) {
    return ok({ found: false, delivered: false, maxAttempts: null, deferred, failure: null });
  }
  const sent = await deps.publisher.publish(delivery);
  const finished = await deps.deliveries.finish({
    deliveryId: delivery.deliveryId,
    claimToken: delivery.claimToken,
    messageId: sent.ok ? sent.value : null,
  });
  // فشل `finish` وحده يُرجَع خطأً: الصفّ عالقٌ في `sending` بلا موعد، وهذه حالةٌ
  // لا يجوز المضيّ فوقها. أمّا فشل النشر فقد أُعيد الصفّ به إلى `pending` سليماً.
  if (!finished.ok) return finished;
  // `sent.ok` شرطٌ مستقلّ عن جواب القاعدة عن قصد: «سُلّمت» تعني أنّ رسالةً
  // وصلت فعلاً ولها معرّف. لا يجوز أن يُعلن التسليم إلا بمعرّف رسالة حقيقيّ.
  return ok({
    found: true,
    delivered: sent.ok && finished.value,
    maxAttempts: delivery.maxAttempts,
    deferred,
    failure: sent.ok ? null : sent.error.detail,
  });
}

/**
 * شوط outbox محدود بإعداد المدينة الذي أرجعه claim الذرّي. لا يضع حدّاً لعمر
 * الحادث أو لعدد إعادة محاولاته: فشل تيليجرام يعيده `pending` بموعد جديد، ولا
 * يجوز إسقاط نداء استغاثة بعد رقم اعتباطي من المحاولات.
 */
export interface SafetyBatchOutcome {
  readonly claimed: number;
  readonly delivered: number;
  /** محاولاتٌ نُشرت ففشلت، وأُعيدت صفوفها `pending` بموعدٍ جديد. */
  readonly failed: number;
  readonly deferred: readonly SafetyDeferral[];
}

export async function deliverSafetyIncidentBatch(
  deps: DeliverSafetyIncidentDeps,
): Promise<Result<SafetyBatchOutcome, PortFailureError>> {
  let claimed = 0;
  let delivered = 0;
  let failed = 0;
  let limit = 1;
  // كل مطالبةٍ في الشوط تمرّ على نفس الصفوف المؤجَّلة فتُبلّغ عنها من جديد.
  // البلاغ مطلوب مرّةً لكل صفّ لا مرّةً لكل مطالبة: التكرار ضجيجٌ يُخفي غيره.
  const deferred = new Map<string, SafetyDeferral>();
  while (claimed < limit) {
    const attempt = await deliverSafetyIncident({}, deps);
    if (!attempt.ok) return attempt;
    for (const entry of attempt.value.deferred) deferred.set(entry.deliveryId, entry);
    if (!attempt.value.found) break;
    claimed += 1;
    if (attempt.value.maxAttempts !== null) limit = attempt.value.maxAttempts;
    if (attempt.value.delivered) delivered += 1;
    // فشل نشرٍ واحد لا يُسقط الشوط: مجموعةُ مدينةٍ معطوبة كانت تمنع تسليم
    // استغاثات المدن الأخرى في نفس الدورة. يُعدّ ويُبلَّغ، ويستمرّ الشوط.
    if (attempt.value.failure !== null) failed += 1;
  }
  return ok({ claimed, delivered, failed, deferred: [...deferred.values()] });
}
