/**
 * الغرض: **دورةُ حياةِ مهمّةِ التنفيذِ** الواردةِ من CORE: بابُ الاستهلاكِ (صندوقُ
 *    الواردِ)، والانتقالاتُ الأربعةُ (قبولٌ، رفضٌ، إتمامٌ، فشلٌ) والإلغاءُ، ودورةُ
 *    تسليمِ صندوقِ الصادرِ. البند `W-5`.
 * الحالة: منفّذ فعلياً — 2026-09-11 · التسليمُ الشبكيُّ محجوزٌ بـ`DEP-CORE-001`.
 * ينتمي إلى: application/wasla
 * يُستخدم من: `packages/infrastructure/wasla/operational-job-repository.ts`
 *    (تنفيذُ البابِ) والاختباراتُ التكامليّةُ.
 * ملاحظات مستقبلية: عندَ رفعِ `DEP-CORE-001` يُضافُ ناقلٌ يُنفِّذُ `MoveEventShipper`
 *    ويُوصَلُ في `apps/workers`؛ **ولا يُغيَّرُ شيءٌ ههنا**: البابُ مُعلَنٌ الآنَ
 *    وناقصُه المُنفِّذُ لا التصميمُ.
 *
 * ## لماذا لا يُصدَّقُ حدثٌ صادرٌ بلا تدقيقٍ
 *
 * القاعدةُ تبني الحمولةَ، والتدقيقُ ههنا **قبلَ التسليمِ لا بعدَه**: كلُّ مغلَّفٍ
 * مسحوبٍ من الصادرِ يُقابَلُ بعقودِ CORE، فإن خالفَ **لم يُسلَّمْ** وقُيِّدَ عطلاً
 * قابلاً للإعادةِ. ولو سُلِّمَ المخالفُ لَكانَ CORE هوَ من يكتشفُ خللَنا، وذاكَ
 * نقلٌ للمشكلةِ إلى مستودعٍ آخرَ لا إصلاحٌ لها.
 *
 * ## ولماذا لا حراسةَ حالةٍ ههنا
 *
 * الحراسةُ في القاعدةِ: قفلُ الصفِّ وفحصُ الحالةِ وإيداعُ الحدثِ في معاملةٍ
 * واحدةٍ. ولو فُحِصَت الحالةُ ههنا ثمَّ نُوديَت الدالّةُ لَكانَ بينَهما نافذةٌ
 * يُنفَّذُ فيها انتقالٌ آخرُ. فهذه الطبقةُ **تُترجِمُ وتُدقِّقُ وتُبلِّغُ**، ولا
 * تُقرِّرُ جوازَ انتقالٍ.
 */

import { type ValidationIssue, validateEnvelope } from "../../domain/wasla/event-envelope.ts";
import {
  CONSUMED_CORE_EVENT_TYPES,
  type ConsumedCoreEventType,
  type OperationalJobState,
} from "../../domain/wasla/operational-job.ts";
import { err, isErr, ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

/** مغلَّفُ حدثٍ كما يُنقَلُ على الحدودِ — كائنٌ حرٌّ يُدقَّقُ ولا يُفترَضُ. */
export type EventEnvelope = Record<string, unknown>;

/** حصيلةُ إيداعٍ في صندوقِ الواردِ. */
export interface IngestOutcome {
  readonly eventId: string;
  /** حدثٌ رُئيَ قبلاً — التسليمُ مرّةً على الأقلِّ، فالتكرارُ متوقَّعٌ لا شاذٌّ. */
  readonly duplicate: boolean;
}

/** حصيلةُ تطبيقِ حدثٍ واردٍ على المهمّةِ. */
export interface ApplyOutcome {
  readonly jobId: string | null;
  readonly state: OperationalJobState | null;
  /** هل غيَّرَ التطبيقُ شيئاً فعلاً؟ */
  readonly changed: boolean;
  /** سببُ عدمِ التغييرِ إن لم يُغيِّرْ — `null` إن غيَّرَ. */
  readonly note: string | null;
}

/** حصيلةُ انتقالٍ. */
export interface TransitionOutcome {
  readonly jobId: string;
  readonly state: OperationalJobState;
  readonly duplicate: boolean;
}

/** صفٌّ مسحوبٌ من صندوقِ الصادرِ، مغلَّفُه مُجمَّعٌ من أعمدتِه. */
export interface ClaimedMoveEvent {
  readonly rowId: string;
  readonly claimToken: string;
  readonly attempts: number;
  readonly envelope: EventEnvelope;
}

/** أخطاءُ هذه الطبقةِ — مُصنَّفةٌ لتُقرأَ في سجلٍّ بلا تحليلِ نصٍّ. */
export type LifecycleFailure =
  | { readonly kind: "port"; readonly error: PortFailureError }
  | { readonly kind: "contract"; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "unsupported_event_type"; readonly eventType: string }
  | { readonly kind: "rejected"; readonly code: string; readonly detail: string | null };

/** البابُ إلى القاعدةِ — كلُّ دالّةٍ نداءٌ واحدٌ لدالّةٍ ذرّيّةٍ هناكَ. */
export interface FulfillmentLifecycleStore {
  ingestCoreEvent(envelope: EventEnvelope): Promise<Result<IngestOutcome, PortFailureError>>;
  applyFulfillmentCreated(eventId: string): Promise<Result<ApplyOutcome, PortFailureError>>;
  applyFulfillmentCancelled(eventId: string): Promise<Result<ApplyOutcome, PortFailureError>>;
  accept(
    fulfillmentId: string,
    correlationId: string,
    causationId: string | null,
  ): Promise<Result<TransitionOutcome, PortFailureError>>;
  reject(
    fulfillmentId: string,
    reason: string,
    correlationId: string,
    causationId: string | null,
  ): Promise<Result<TransitionOutcome, PortFailureError>>;
  close(
    fulfillmentId: string,
    outcome: "completed" | "failed",
    correlationId: string,
    failureReason: string | null,
    causationId: string | null,
  ): Promise<Result<TransitionOutcome, PortFailureError>>;
  claimNextEvent(
    staleAfterSeconds?: number,
  ): Promise<Result<ClaimedMoveEvent | null, PortFailureError>>;
  finishDelivery(claimToken: string): Promise<Result<boolean, PortFailureError>>;
  abandonDelivery(
    claimToken: string,
    error: string,
  ): Promise<Result<{ readonly dead: boolean; readonly attempts: number }, PortFailureError>>;
}

/**
 * ناقلُ الأحداثِ إلى CORE — **لا مُنفِّذَ له اليومَ** (`DEP-CORE-001`: لا بابَ
 * شبكيّاً في CORE لأحداثِ `move.job.*`). والبابُ مُعلَنٌ ليُقرأَ النقصُ في
 * الشيفرةِ لا في التقاريرِ.
 */
export interface MoveEventShipper {
  ship(envelope: EventEnvelope): Promise<Result<void, PortFailureError>>;
}

const CONSUMED: readonly string[] = CONSUMED_CORE_EVENT_TYPES;

function portFailure(error: PortFailureError): LifecycleFailure {
  return { kind: "port", error };
}

export interface FulfillmentLifecycle {
  /**
   * استهلاكُ حدثٍ من CORE: تدقيقُ العقدِ، ثمَّ الإيداعُ، ثمَّ التطبيقُ. والتدقيقُ
   * **قبلَ** الإيداعِ: صندوقُ الواردِ سجلٌّ لما استُهلِكَ، لا مقبرةٌ لما رُفِضَ.
   */
  consume(envelope: EventEnvelope): Promise<Result<ApplyOutcome, LifecycleFailure>>;
  accept(
    fulfillmentId: string,
    correlationId: string,
    causationId?: string | null,
  ): Promise<Result<TransitionOutcome, LifecycleFailure>>;
  reject(
    fulfillmentId: string,
    reason: string,
    correlationId: string,
    causationId?: string | null,
  ): Promise<Result<TransitionOutcome, LifecycleFailure>>;
  complete(
    fulfillmentId: string,
    correlationId: string,
    causationId?: string | null,
  ): Promise<Result<TransitionOutcome, LifecycleFailure>>;
  fail(
    fulfillmentId: string,
    reason: string,
    correlationId: string,
    causationId?: string | null,
  ): Promise<Result<TransitionOutcome, LifecycleFailure>>;
  /**
   * دورةُ تسليمٍ واحدةٌ: تسحبُ صفّاً، تُدقِّقُ مغلَّفَه، تُسلِّمُه بالناقلِ، ثمَّ
   * تُنهي أو تتخلّى. و`null` تعني «لا شيءَ مستحقٌّ الآنَ» لا «تمَّ».
   */
  deliverOnce(shipper: MoveEventShipper): Promise<Result<DeliveryReport | null, LifecycleFailure>>;
}

export interface DeliveryReport {
  readonly eventId: string;
  readonly eventType: string;
  readonly attempts: number;
  readonly verdict: "delivered" | "retry" | "dead" | "contract_rejected";
}

export function createFulfillmentLifecycle(store: FulfillmentLifecycleStore): FulfillmentLifecycle {
  async function applyFor(
    eventType: ConsumedCoreEventType,
    eventId: string,
  ): Promise<Result<ApplyOutcome, LifecycleFailure>> {
    const applied =
      eventType === "core.fulfillment.created"
        ? await store.applyFulfillmentCreated(eventId)
        : await store.applyFulfillmentCancelled(eventId);
    return isErr(applied) ? err(portFailure(applied.error)) : ok(applied.value);
  }

  return {
    consume: async (envelope) => {
      const issues = validateEnvelope(envelope);
      if (issues.length > 0) return err({ kind: "contract", issues });

      const eventType = envelope.event_type as string;
      if (!CONSUMED.includes(eventType)) {
        return err({ kind: "unsupported_event_type", eventType });
      }

      const ingested = await store.ingestCoreEvent(envelope);
      if (isErr(ingested)) return err(portFailure(ingested.error));

      /**
       * التطبيقُ يُنادى للمكرَّرِ أيضاً: الإيداعُ والتطبيقُ صفقتانِ منفصلتانِ،
       * فقد يسقطُ العاملُ بينَهما. والتطبيقُ لا أثرَ ثانياً له (`applied_at`
       * محروسٌ)، فإعادتُه استئنافٌ لا تكرارٌ.
       */
      return applyFor(eventType as ConsumedCoreEventType, ingested.value.eventId);
    },

    accept: async (fulfillmentId, correlationId, causationId = null) => {
      const result = await store.accept(fulfillmentId, correlationId, causationId);
      return isErr(result) ? err(portFailure(result.error)) : ok(result.value);
    },

    reject: async (fulfillmentId, reason, correlationId, causationId = null) => {
      const result = await store.reject(fulfillmentId, reason, correlationId, causationId);
      return isErr(result) ? err(portFailure(result.error)) : ok(result.value);
    },

    complete: async (fulfillmentId, correlationId, causationId = null) => {
      const result = await store.close(
        fulfillmentId,
        "completed",
        correlationId,
        null,
        causationId,
      );
      return isErr(result) ? err(portFailure(result.error)) : ok(result.value);
    },

    fail: async (fulfillmentId, reason, correlationId, causationId = null) => {
      const result = await store.close(fulfillmentId, "failed", correlationId, reason, causationId);
      return isErr(result) ? err(portFailure(result.error)) : ok(result.value);
    },

    deliverOnce: async (shipper) => {
      const claimed = await store.claimNextEvent();
      if (isErr(claimed)) return err(portFailure(claimed.error));
      const row = claimed.value;
      if (row === null) return ok(null);

      const eventId = String(row.envelope.event_id);
      const eventType = String(row.envelope.event_type);

      const issues = validateEnvelope(row.envelope);
      if (issues.length > 0) {
        /**
         * مغلَّفٌ مخالفٌ **لا يُسلَّمُ ولا يُنسى**: يُتخلّى عنه بعطلٍ منصوصٍ،
         * فيُعادُ بتراجعٍ حتّى ينفدَ العددُ فيموتَ صفّاً ميّتاً ظاهراً في
         * الجدولِ. ولا يُحذَفُ ههنا: الحذفُ يمحو الدليلَ.
         */
        const detail = issues.map((issue) => `${issue.path}: ${issue.problem}`).join(" · ");
        const abandoned = await store.abandonDelivery(row.claimToken, `CONTRACT: ${detail}`);
        if (isErr(abandoned)) return err(portFailure(abandoned.error));
        return ok({ eventId, eventType, attempts: row.attempts, verdict: "contract_rejected" });
      }

      const shipped = await shipper.ship(row.envelope);
      if (isErr(shipped)) {
        const abandoned = await store.abandonDelivery(row.claimToken, shipped.error.detail);
        if (isErr(abandoned)) return err(portFailure(abandoned.error));
        return ok({
          eventId,
          eventType,
          attempts: row.attempts,
          verdict: abandoned.value.dead ? "dead" : "retry",
        });
      }

      const finished = await store.finishDelivery(row.claimToken);
      if (isErr(finished)) return err(portFailure(finished.error));
      if (!finished.value) {
        return err({
          kind: "rejected",
          code: "CLAIM_LOST",
          detail: `الحجزُ ${row.claimToken} لم يُغلَقْ — سُلِّمَ الحدثُ ${eventId} ولا إثباتَ لإغلاقِه`,
        });
      }
      return ok({ eventId, eventType, attempts: row.attempts, verdict: "delivered" });
    },
  };
}
