/**
 * الغرض: شوطُ صندوقِ الصادرِ الموحَّدِ (BUG-004): يلتقطُ صفًّا واحدًا بالرمزِ،
 *   يسلّمُه إلى معالجِ نوعِه، ثمّ يُعلنُ النتيجةَ — مُسلَّمًا بمعرّفِ رسالةٍ حقيقيٍّ،
 *   أو pending بموعدٍ جديدٍ إن فشلَ النشرُ، أو dead لا يُعادُ أبدًا إن كان الأثرُ
 *   لن يُقبلَ أبدًا. البنيةُ واحدةٌ لكلِّ الأنواعِ، والمعرفةُ بالنوعِ في معالجِه.
 * الحالة: منفّذ فعلياً — 2026-09-06.
 * ينتمي إلى: application/notification
 * يُستخدم من: apps/workers/src/jobs/deliver-notifications.ts
 * ملاحظات مستقبلية: كلُّ نوعٍ جديدٍ يُسجِّلُ معالجَه في الخريطةِ؛ ونوعٌ لا معالجَ
 *   له خطأٌ مُعلَنٌ لا صفٌّ مُهملٌ بصمتٍ.
 */
import type { CityId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import { PortFailureError } from "../ports/index.ts";

/** صفُّ صادرٍ مُلتقَطٌ: البنيةُ عامّةٌ، والمعرفةُ بالنوعِ في الحمولةِ ومعالجِها. */
export interface OutboxDelivery {
  readonly deliveryId: string;
  readonly kind: string;
  readonly cityId: CityId;
  readonly claimToken: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * مآلُ إعلانِ النتيجةِ كما تحكمُ به القاعدةُ لا كما يظنُّه المُستدعي: `delivered`
 * برسالةٍ لها معرّفٌ، أو `dead` لأنَّ المحاولاتِ استُنفدَت (CAP-002)، أو `retried`
 * بموعدٍ جديدٍ. و`null` حينَ رُفِضَ الإعلانُ أصلاً (رمزٌ لا يملكُ الصفَّ).
 */
export type FinishOutcome = "delivered" | "dead" | "retried";

export interface FinishResult {
  readonly ok: boolean;
  readonly outcome: FinishOutcome | null;
}

export interface NotificationOutboxPort {
  claim(): Promise<Result<{ delivery: OutboxDelivery | null }, PortFailureError>>;
  finish(input: {
    deliveryId: string;
    claimToken: string;
    messageId: string | null;
    /** آخرُ خطأٍ من المُرسِلِ — يُحفظُ في الصفِّ ليُعرفَ سببُ موتِه لا أن يُخمَّنَ. */
    error: string | null;
  }): Promise<Result<FinishResult, PortFailureError>>;
  abandon(input: {
    deliveryId: string;
    claimToken: string;
    /** سببُ التخلّي الصريحُ — يُحفظُ في `dead_reason`. */
    reason: string | null;
  }): Promise<Result<boolean, PortFailureError>>;
}

/**
 * حكمُ المعالجِ على الصفِّ: إمّا تخلٍّ نهائيٌّ (أثرٌ لن يُقبلَ أبدًا)، وإمّا نشرٌ
 * نجحَ بمعرّفِ رسالةٍ، وإمّا فشلٌ بسببٍ مُعلَنٍ يعودُ به الصفُّ pending.
 */
export interface HandlerOutcome {
  readonly abandon: boolean;
  readonly messageId: string | null;
  readonly failure: string | null;
}

export type NotificationHandler = (
  delivery: OutboxDelivery,
) => Promise<Result<HandlerOutcome, PortFailureError>>;

export interface NotificationDeliveryDeps {
  readonly outbox: NotificationOutboxPort;
  readonly handlers: Readonly<Record<string, NotificationHandler>>;
}

export interface DeliveryAttemptOutcome {
  readonly found: boolean;
  readonly kind: string | null;
  readonly delivered: boolean;
  readonly abandoned: boolean;
  /** ماتَ الصفُّ باستنفادِ المحاولاتِ في `finish` — لا بتخلٍّ صريحٍ (CAP-002). */
  readonly died: boolean;
  readonly maxAttempts: number | null;
  /**
   * سببُ فشلِ النشرِ إن فشلَ. والصفُّ يعودُ `pending` بموعدٍ جديدٍ **ما لم تُستنفدِ
   * المحاولاتُ** — فحينَها يموتُ بـ`MAX_ATTEMPTS` ولا يُعادُ أبداً (CAP-002).
   */
  readonly failure: string | null;
}

export async function deliverNotification(
  deps: NotificationDeliveryDeps,
): Promise<Result<DeliveryAttemptOutcome, PortFailureError>> {
  const claimed = await deps.outbox.claim();
  if (!claimed.ok) return claimed;
  const delivery = claimed.value.delivery;
  if (delivery === null) {
    return ok({
      found: false,
      kind: null,
      delivered: false,
      abandoned: false,
      died: false,
      maxAttempts: null,
      failure: null,
    });
  }
  const handler = deps.handlers[delivery.kind];
  if (handler === undefined) {
    // نوعٌ في القاعدةِ بلا معالجٍ في الكودِ: تعارضُ هجرةٍ ونشرٍ. يُعلَنُ خطأً —
    // ولا يُتخلّى عن الصفِّ ولا يُسلَّمُ كذبًا، فالصفُّ يعودُ بمهلةِ الحجزِ سليمًا.
    return err(new PortFailureError("outbox.handler", `لا معالجَ لنوعِ الإشعارِ «${delivery.kind}»`));
  }
  const handled = await handler(delivery);
  if (!handled.ok) return handled;
  if (handled.value.abandon) {
    const abandoned = await deps.outbox.abandon({
      deliveryId: delivery.deliveryId,
      claimToken: delivery.claimToken,
      reason: handled.value.failure,
    });
    if (!abandoned.ok) return abandoned;
    return ok({
      found: true,
      kind: delivery.kind,
      delivered: false,
      abandoned: true,
      died: false,
      maxAttempts: delivery.maxAttempts,
      failure: null,
    });
  }
  const finished = await deps.outbox.finish({
    deliveryId: delivery.deliveryId,
    claimToken: delivery.claimToken,
    messageId: handled.value.messageId,
    error: handled.value.failure,
  });
  // فشل `finish` وحده يُرجَع خطأً: الصفّ عالقٌ في `sending` بلا موعد. أمّا فشلُ
  // النشرِ فقد أُعيد الصفّ به إلى `pending` سليمًا بموعدٍ جديد.
  if (!finished.ok) return finished;
  // «سُلّمت» تعني أنّ رسالةً وصلت فعلاً ولها معرّف. لا يجوز أن يُعلن التسليم
  // إلا بمعرّف رسالة حقيقيّ — والقاعدةُ لا تُعلنُ delivered بغيرِه.
  return ok({
    found: true,
    kind: delivery.kind,
    delivered: handled.value.messageId !== null && finished.value.ok,
    abandoned: false,
    died: finished.value.outcome === "dead",
    maxAttempts: delivery.maxAttempts,
    failure: handled.value.failure,
  });
}

export interface DeliveryBatchOutcome {
  readonly claimed: number;
  readonly delivered: number;
  readonly failed: number;
  readonly abandoned: number;
  /** ماتت باستنفادِ المحاولاتِ — تُعدُّ منفصلةً عن التخلّي الصريحِ (CAP-002). */
  readonly died: number;
}

/**
 * شوطٌ محدودٌ بإعدادِ المدينةِ الذي أرجعه claim الذرّي. ولعمرِ الصفِّ حدٌّ منذُ
 * CAP-002: فشلُ النشرِ يُعيدُه pending بتراجعٍ أُسّيٍّ **حتى `max_attempts`**، ثمّ
 * يموتُ بـ`MAX_ATTEMPTS`. والصفوفُ التي لن تُقبلَ أبدًا يُتخلّى عنها فوراً (dead)
 * فلا تُستهلِكُ الشوطَ ولا تُعادُ أبدًا (BUG-004).
 */
export async function deliverNotificationBatch(
  deps: NotificationDeliveryDeps,
): Promise<Result<DeliveryBatchOutcome, PortFailureError>> {
  let claimed = 0;
  let delivered = 0;
  let failed = 0;
  let abandoned = 0;
  let died = 0;
  let limit = 1;
  while (claimed < limit) {
    const attempt = await deliverNotification(deps);
    if (!attempt.ok) return attempt;
    if (!attempt.value.found) break;
    claimed += 1;
    if (attempt.value.maxAttempts !== null) limit = attempt.value.maxAttempts;
    if (attempt.value.delivered) delivered += 1;
    if (attempt.value.abandoned) abandoned += 1;
    if (attempt.value.died) died += 1;
    // فشلُ نشرٍ واحد لا يُسقطُ الشوط: مجموعةُ مدينةٍ معطوبة كانت تمنعُ تسليمَ
    // إشعاراتِ المدنِ الأخرى في نفسِ الدورة. يُعدّ ويُبلَّغ، ويستمرّ الشوط.
    if (attempt.value.failure !== null) failed += 1;
  }
  return ok({ claimed, delivered, failed, abandoned, died });
}
