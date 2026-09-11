/**
 * الغرض: آلةُ حالاتِ **المهمّةِ التشغيليّةِ** خالصةً: الحالاتُ الخمسُ،
 *    والانتقالاتُ المسموحةُ، والحدثُ الصادرُ عن كلِّ انتقالٍ. البند `W-4`/`W-5`.
 * الحالة: منفّذ فعلياً — 2026-09-11.
 * ينتمي إلى: domain/wasla
 * يُستخدم من: `packages/application/wasla/fulfillment-lifecycle.ts` و
 *    `scripts/check-core-contract-parity.ts` و`tests/unit/operational-job-state-machine.test.ts`.
 * ملاحظات مستقبلية: لا يُضافُ هنا انتقالٌ بلا دالّةٍ في القاعدةِ تُنفِّذُه — هذا
 *    الملفُّ **صدىً للقاعدةِ لا مصدرَ حقيقةٍ ثانياً**، والحاجزُ يُطابِقُ بينَهما.
 *
 * ## لماذا آلةُ حالاتٍ في الشيفرةِ والإنفاذُ في القاعدةِ
 *
 * الإنفاذُ الحقيقيُّ في دوالِّ الهجرةِ `20260911100100`: هي التي تقفلُ الصفَّ
 * وتفحصُ الحالةَ وتكتبُ الحدثَ في معاملةٍ واحدةٍ. **ولا يُنفَّذُ انتقالٌ من
 * ههنا.** ووجودُ الآلةِ في الشيفرةِ لغرضَينِ لا ثالثَ لهما:
 *   ١) أن يُقرأَ العقدُ في مكانٍ واحدٍ صريحٍ بلا فتحِ SQL.
 *   ٢) أن يُطابِقَه حاجزٌ آليٌّ بالقاعدةِ وبعقودِ CORE، فتقادُمُ أحدِهما **يُخفِقُ
 *      في CI** ولا يُكتشَفُ في الإنتاجِ.
 *
 * ومَن أرادَ التحقّقَ قبلَ النداءِ فليستعملْ `canTransition`؛ **لكنَّ سماحَها
 * ليسَ إذناً**: القاعدةُ قد تردُّ `ILLEGAL_TRANSITION` لأنَّ الحالةَ تغيَّرت بينَ
 * القراءةِ والنداءِ، وذاكَ هوَ الحكمُ.
 */

/** حالاتُ المهمّةِ — مطابقةٌ حرفاً لقيدِ `operational_jobs.state`. */
export const OPERATIONAL_JOB_STATES = [
  "coordinating",
  "assigned",
  "completed",
  "failed",
  "cancelled",
] as const;

export type OperationalJobState = (typeof OPERATIONAL_JOB_STATES)[number];

/** الحالاتُ النهائيّةُ: لا خروجَ منها ألبتّةَ. */
export const TERMINAL_STATES: readonly OperationalJobState[] = ["completed", "failed", "cancelled"];

/**
 * مرحلةُ الفشلِ: **مُخزَّنةٌ لا مُستنتَجةٌ**، لأنَّ الحدثَ الصادرَ يختلفُ بها —
 * `rejected` يُنشرُ `move.job.rejected` (بلا `job_id`)، و`execution` يُنشرُ
 * `move.job.completed` بـ`outcome: "failed"` (وفيه `job_id`).
 */
export type FailureStage = "rejected" | "execution";

/** أسماءُ الانتقالاتِ — واحدٌ لكلِّ دالّةٍ في القاعدةِ. */
export const JOB_TRANSITIONS = ["accept", "reject", "complete", "fail", "cancel"] as const;
export type JobTransition = (typeof JOB_TRANSITIONS)[number];

export interface TransitionSpec {
  /** الحالاتُ التي يجوزُ الانتقالُ منها. */
  readonly from: readonly OperationalJobState[];
  /** الحالةُ بعدَه. */
  readonly to: OperationalJobState;
  /** مرحلةُ الفشلِ المكتوبةُ، إن كانَ المقصدُ `failed`. */
  readonly failureStage: FailureStage | null;
  /** نوعُ الحدثِ المُودَعِ في صندوقِ الصادرِ، أو `null` إن لا حدثَ. */
  readonly emits: MoveEventType | null;
  /** اسمُ الدالّةِ في القاعدةِ التي تُنفِّذُ الانتقالَ — يُطابِقُه الحاجزُ. */
  readonly rpc: string;
}

/** أنواعُ أحداثِ MOVE — مطابقةٌ لأسماءِ ملفّاتِ العقودِ في `docs/contracts/core/`. */
export const MOVE_EVENT_TYPES = [
  "move.job.accepted",
  "move.job.rejected",
  "move.job.completed",
] as const;
export type MoveEventType = (typeof MOVE_EVENT_TYPES)[number];

/** أنواعُ أحداثِ CORE التي يستهلكُها MOVE — لا أكثرَ، ولا يُوسَّعُ بلا مُنادٍ. */
export const CONSUMED_CORE_EVENT_TYPES = [
  "core.fulfillment.created",
  "core.fulfillment.cancelled",
] as const;
export type ConsumedCoreEventType = (typeof CONSUMED_CORE_EVENT_TYPES)[number];

/**
 * جدولُ الانتقالاتِ — **مغلقٌ**. وما ليسَ فيه ممنوعٌ، لا «غيرُ مذكورٍ».
 *
 * `cancel` لا يُصدِرُ حدثاً: CORE هوَ من ألغى، وإبلاغُه بإلغائِه ضجيجٌ لا عقدٌ،
 * ولا حدثَ إلغاءٍ من MOVE في عقودِ CORE أصلاً.
 */
export const TRANSITIONS: Readonly<Record<JobTransition, TransitionSpec>> = {
  accept: {
    from: ["coordinating"],
    to: "assigned",
    failureStage: null,
    emits: "move.job.accepted",
    rpc: "accept_operational_job",
  },
  reject: {
    from: ["coordinating"],
    to: "failed",
    failureStage: "rejected",
    emits: "move.job.rejected",
    rpc: "reject_operational_job",
  },
  complete: {
    from: ["assigned"],
    to: "completed",
    failureStage: null,
    emits: "move.job.completed",
    rpc: "close_operational_job",
  },
  fail: {
    from: ["assigned"],
    to: "failed",
    failureStage: "execution",
    emits: "move.job.completed",
    rpc: "close_operational_job",
  },
  cancel: {
    from: ["coordinating", "assigned"],
    to: "cancelled",
    failureStage: null,
    emits: null,
    rpc: "apply_core_fulfillment_cancelled",
  },
};

/** هل الحالةُ نهائيّةٌ؟ */
export function isTerminal(state: OperationalJobState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** هل يجوزُ هذا الانتقالُ من هذه الحالةِ؟ */
export function canTransition(from: OperationalJobState, transition: JobTransition): boolean {
  return TRANSITIONS[transition].from.includes(from);
}

/**
 * الحالةُ بعدَ انتقالٍ مسموحٍ، و`null` إن كانَ ممنوعاً. **ولا تُصحَّحُ نيّةُ
 * المُنادي**: الممنوعُ يُرَدُّ ولا يُقرَّبُ إلى أقربِ مسموحٍ.
 */
export function nextState(
  from: OperationalJobState,
  transition: JobTransition,
): OperationalJobState | null {
  return canTransition(from, transition) ? TRANSITIONS[transition].to : null;
}

/**
 * النتيجةُ (`outcome`) المُبلَّغةُ إلى CORE لحالةٍ نهائيّةٍ، و`null` لما لا
 * يُبلَّغُ بنتيجةٍ. **الملغى `null`**: لا حدثَ له فلا نتيجةَ.
 */
export function outcomeFor(state: OperationalJobState): "completed" | "failed" | null {
  if (state === "completed") return "completed";
  if (state === "failed") return "failed";
  return null;
}

/**
 * مفتاحُ منعِ التكرارِ لحدثٍ صادرٍ — **يُبنى بالصيغةِ نفسِها في القاعدةِ**
 * (`'move.job.accepted:' || fulfillment_id`)، والحاجزُ يُطابِقُ الصيغتَينِ.
 * ولو انفرطَت المطابقةُ لَأُودِعَ الحدثُ مرّتَينِ عندَ إعادةِ محاولةٍ.
 */
export function outboxDedupKey(eventType: MoveEventType, fulfillmentId: string): string {
  return `${eventType}:${fulfillmentId}`;
}
