/**
 * الغرض: شرطُ صحّةِ النسخةِ الواحدةِ (`R-17`) منفَّذاً في الشيفرةِ لا في تعليقٍ —
 *    الشطرُ التنفيذيُّ المحسومُ من [ADR 0050](../../../docs/adr/0050-single-instance-is-a-correctness-invariant-not-a-comment.md)
 *    **بعدَ تصحيحِ إشارتِه** بـ[ADR 0051](../../../docs/adr/0051-process-topology-is-declared-not-inferred-from-session-store.md).
 * الحالة: منفّذ فعلياً — إلزامُ إقلاعٍ يُفشِل التشغيلَ عندَ تنافرِ الطوبولوجيا مع آليةِ التوزيع.
 * ينتمي إلى: shared/config
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/index.ts — وكلُّ نقطةِ تشغيلٍ تُركِّب
 *    ناقلَ الأحداثِ داخلَ العمليةِ (`packages/infrastructure/tracking/event-bus.ts`).
 * ملاحظات مستقبلية: يومَ تُقرَّر آليةُ توزيعٍ تعبر حدودَ العمليةِ بـADR ناسخٍ لـADR 0050
 *    §٨ تُضاف قيمتُها إلى `EVENT_DISTRIBUTION_MECHANISMS` ويُبدَّل الثابتُ المُقرَّر —
 *    ولا يُضاف تجاوزٌ بمتغيّرِ بيئةٍ إلى هذا الملفّ أبداً.
 *
 * ## لماذا شرطُ صحّةٍ لا تفضيلُ سعة
 *
 * ناقلُ الأحداثِ القائمُ **داخلَ العمليةِ**: خريطةُ اشتراكاتٍ في ذاكرةِ عمليةٍ واحدةٍ،
 * لا تعبر حدودَها. فمشتركٌ على النسخةِ (أ) لا يرى حدثاً نُشِر في النسخةِ (ب) —
 * وهو **تدهورُ حيويّةٍ لا فقدُ صحّةٍ** لأنّ الموقعَ القانونيَّ في القاعدةِ واللقطةُ
 * المرجعيةُ تُصحّح. والعيبُ المُشتكى منه في نصِّ `R-17` ليس النقصَ بل **صمتَه**:
 * «رفعُ عددِ النسخِ يكسرُ السلوكَ صامتاً بلا خطأٍ ولا تنبيهٍ». فالواجبُ أن يصير
 * الكسرُ صاخباً: **رفضُ إقلاعٍ صريحٌ لا تراجعٌ صامتٌ**.
 *
 * ## الإشارةُ الصحيحةُ — ولماذا لم تعد `SESSION_STORE`
 *
 * الصيغةُ الأولى من هذا الملفِّ قرأت `SESSION_STORE=redis` **إعلانَ طوبولوجيا متعدّدةِ
 * العملياتِ** (`ADR 0050` §٣-ب)، وهو **استدلالٌ معكوسٌ**. فالعلاقةُ التي يُثبِتها
 * `ADR 0011` هي:
 *
 * ```
 * multi-process  ⇒  redis
 * ```
 *
 * ولازمُها الصحيحُ نقيضُها العكسيُّ وحدَه: `memory ⇒ عمليةٌ واحدةٌ`. أمّا
 * `redis ⇒ multi-process` فعكسُ اللازمِ لا يلزم. فـRedis **شرطٌ لازمٌ لتعدُّدِ
 * العملياتِ لا دليلٌ عليه**، ونسخةٌ واحدةٌ بجلساتٍ في Redis حالةٌ مشروعةٌ — بل هي
 * الخطوةُ الأولى في مسارِ الانتقالِ المكتوبِ في `docs/render-deployment-vars.md` §٣،
 * وقد كان الحكمُ القديمُ **يُحرِّمها ويمنع الإقلاعَ عليها**.
 *
 * فصار المحورُ **مُعلَناً**: `PROCESS_TOPOLOGY` ∈ `{single-process, multi-process}`
 * (`ADR 0051` §٢-ب)، وهو الوحيدُ الذي يُقرَأ للطوبولوجيا. و`sessionStore` يبقى في
 * المُدخلِ **لا ليدلَّ على الطوبولوجيا** بل لإنفاذِ اللازمِ نفسِه في اتّجاهِه الصحيحِ:
 * `multi-process` بلا `redis` خرقٌ لـ`ADR 0011`.
 *
 * وأمّا حرفُ `numInstances` فيُحرَسُ حيثُ يوجد: في ملفِّ النشرِ، بحاجزِ
 * `scripts/check-instance-invariant.ts` في سلسلةِ `bun run ci` — ولا تُحلَّل YAML
 * في شيفرةِ الإنتاجِ وقتَ التشغيل.
 *
 * ## ما لا يفعله هذا الملفُّ عن قصد
 *
 * لا يُنشئ آليةَ توزيعٍ، ولا يمسّ `TrackingEvent`، ولا يمسّ دلالاتِ جلساتِ Redis،
 * ولا يمسّ اختيارَ حدِّ المعدَّلِ (دَينُ `SCL-003` — `ADR 0051` §٥)، ولا يزعم أنّ
 * `R-17` أُغلِق بشقَّيه: شقُّ **القدرةِ** (التوزيعُ بين النسخِ) مؤجَّلٌ بـADR 0050 §٣-د،
 * وكشفُ الفجوةِ غيرُ منفَّذٍ (لا `version` ولا `sequence` في الحدث).
 */

import type { ProcessTopologyName, SessionStoreName } from "./index.ts";

/**
 * آلياتُ توزيعِ الأحداثِ المعروفةُ للنظام. قائمةٌ مغلقةٌ بمُدخلٍ واحدٍ اليومَ: لا
 * محوِّلَ اختِير (`ADR 0050` §٣-د). وإضافةُ قيمةٍ ههنا قرارٌ معماريٌّ يوجب ADR ناسخاً.
 */
export const EVENT_DISTRIBUTION_MECHANISMS = ["in-process"] as const;

export type EventDistributionMechanism = (typeof EVENT_DISTRIBUTION_MECHANISMS)[number];

/**
 * الآليةُ المُقرَّرةُ. **ثابتٌ في الشيفرةِ لا متغيّرُ بيئةٍ**: من جعله متغيّراً جعل
 * شرطَ الصحّةِ قابلاً للإطفاءِ بنقرةٍ في لوحةِ تحكّم، وهذا عينُ ما يُعالجه `R-17`.
 */
export const DECIDED_EVENT_DISTRIBUTION: EventDistributionMechanism = "in-process";

/**
 * هل تعبر الآليةُ حدودَ العمليةِ؟ سؤالٌ في موضعٍ واحدٍ كي لا يتكرّر الحكمُ: يومَ
 * تُضاف آليةٌ عابرةٌ إلى القائمةِ يُعدَّل هذا وحدَه.
 */
export function distributionCrossesProcessBoundary(
  distribution: EventDistributionMechanism,
): boolean {
  return distribution !== "in-process";
}

/**
 * سببُ الخرقِ — رمزٌ ثابتٌ يُميَّز به الخرقُ بلا مطابقةِ نصٍّ عربيٍّ.
 *
 * - `MULTI_PROCESS_WITHOUT_DISTRIBUTION`: طوبولوجيا متعدّدةٌ مع آليةٍ لا تعبر العمليةَ.
 * - `MULTI_PROCESS_WITHOUT_SHARED_SESSION_STORE`: طوبولوجيا متعدّدةٌ مع جلساتٍ في الذاكرةِ
 *   — خرقُ `multi-process ⇒ redis` (`ADR 0011`).
 */
export const SINGLE_INSTANCE_VIOLATION_REASONS = [
  "MULTI_PROCESS_WITHOUT_DISTRIBUTION",
  "MULTI_PROCESS_WITHOUT_SHARED_SESSION_STORE",
] as const;

export type SingleInstanceViolationReason = (typeof SINGLE_INSTANCE_VIOLATION_REASONS)[number];

/**
 * مُدخلُ الحكمِ: ثلاثةُ حقولٍ لا يحملُ أحدُها سرّاً — لا رمزَ بوتٍ ولا رابطَ قاعدةٍ
 * ولا مفتاحَ Redis. وهذا **قيدُ نوعٍ لا اتفاقٌ**: رسالةُ الخرقِ لا تستطيع كشفَ سرٍّ
 * لأنّ الدالّةَ لا تستقبل سرّاً أصلاً (`scripts/check-secret-logging.ts`).
 */
export interface EventTopologyInput {
  /**
   * `PROCESS_TOPOLOGY` — **المصدرُ الوحيدُ** للطوبولوجيا (ADR 0051 §٢-ب).
   * ولا يُستنتَج من `sessionStore` ولا من أيِّ إشارةٍ بديلةٍ.
   */
  readonly topology: ProcessTopologyName;
  /**
   * `SESSION_STORE` — **مكانُ تخزينِ حالةِ الجلسةِ وحدَه** (ADR 0011 · ADR 0051 §٢-أ).
   * يُقرَأ ههنا لإنفاذِ `multi-process ⇒ redis` في اتّجاهِه الصحيحِ فقط، **ولا يُقرَأ
   * دليلاً على الطوبولوجيا**.
   */
  readonly sessionStore: SessionStoreName;
  /** آليةُ التوزيعِ المُقرَّرةُ — تُمرَّر لا تُقرَأ من البيئةِ. */
  readonly distribution: EventDistributionMechanism;
}

/**
 * خرقُ شرطِ النسخةِ الواحدةِ. `name` و`code` ثابتانِ كي يُميَّز الخرقُ في السجلِّ
 * بلا مطابقةِ نصٍّ عربيٍّ، و`reason` يُفصِّل أيَّ القاعدتَين انكسرت.
 */
export class SingleInstanceInvariantError extends Error {
  readonly code = "SINGLE_INSTANCE_INVARIANT" as const;
  constructor(
    readonly reason: SingleInstanceViolationReason,
    readonly topology: ProcessTopologyName,
    readonly sessionStore: SessionStoreName,
    readonly distribution: EventDistributionMechanism,
    message: string,
  ) {
    super(message);
    this.name = "SingleInstanceInvariantError";
  }
}

/**
 * الحكمُ نقيّاً: يُعيد الخرقَ أو `null`. لا يقرأ بيئةً ولا يكتب سجلّاً ولا يُنهي
 * عمليةً — كي يُختبَر بلا تشغيلِ خادمٍ، وكي يبقى موضعُ القرارِ واحداً.
 *
 * جدولُ الحكمِ كاملاً (`ADR 0051` §٢-ج):
 *
 * | الطوبولوجيا | الجلسات | التوزيع | الحكم |
 * | --- | --- | --- | --- |
 * | `single-process` | `memory` | `in-process` | يسمح |
 * | `single-process` | `redis` | `in-process` | **يسمح** — مكانُ الجلساتِ لا يخلق عمليةً ثانيةً |
 * | `multi-process` | `redis` | `in-process` | يرفض — التوزيعُ غيرُ منفَّذٍ |
 * | `multi-process` | `memory` | `in-process` | يرفض — خرقانِ معاً |
 */
export function singleInstanceInvariantViolation(
  input: EventTopologyInput,
): SingleInstanceInvariantError | null {
  // عمليةٌ واحدةٌ: لا حدثَ يعبر حدّاً أصلاً، فأيُّ مخزنِ جلساتٍ متّسقٌ.
  if (input.topology === "single-process") return null;

  // من ههنا: الطوبولوجيا `multi-process` مُعلَنةً.
  if (!distributionCrossesProcessBoundary(input.distribution)) {
    return new SingleInstanceInvariantError(
      "MULTI_PROCESS_WITHOUT_DISTRIBUTION",
      input.topology,
      input.sessionStore,
      input.distribution,
      [
        "خرقُ شرطِ صحّةِ النسخةِ الواحدةِ (R-17 · ADR 0050 · ADR 0051):",
        "الإعدادُ يُعلِن PROCESS_TOPOLOGY=multi-process،",
        "وآليةُ توزيعِ الأحداثِ المُقرَّرةُ «in-process» لا تعبر حدودَ العمليةِ.",
        "فمشتركٌ على نسخةٍ لا يرى حدثاً نُشِر في أخرى، والتدهورُ صامتٌ — فيُرفَض الإقلاعُ بدلاً منه.",
        "الإصلاحُ: إمّا PROCESS_TOPOLOGY=single-process مع numInstances: 1 كما يُعلِنه render.yaml،",
        "وإمّا آليةُ توزيعٍ تُقرَّر بـADR ناسخٍ لـADR 0050 §٨. ولا تجاوزَ بمتغيّرِ بيئةٍ.",
      ].join(" "),
    );
  }

  // آليةٌ عابرةٌ للعمليةِ (لا وجودَ لها اليومَ): يبقى إلزامُ `multi-process ⇒ redis`.
  if (input.sessionStore !== "redis") {
    return new SingleInstanceInvariantError(
      "MULTI_PROCESS_WITHOUT_SHARED_SESSION_STORE",
      input.topology,
      input.sessionStore,
      input.distribution,
      [
        "خرقُ شرطِ صحّةِ النسخةِ الواحدةِ (R-17 · ADR 0011 · ADR 0051):",
        "الإعدادُ يُعلِن PROCESS_TOPOLOGY=multi-process وجلساتُ الحوارِ في ذاكرةِ العمليةِ.",
        "فكلُّ نسخةٍ تحفظ حوارَها وحدَها، والمستخدمُ يُعادُ سؤالُه كلَّما تبدّلت النسخةُ.",
        "الإصلاحُ: SESSION_STORE=redis قبلَ تعدُّدِ العملياتِ (ADR 0011). ولا تجاوزَ بمتغيّرِ بيئةٍ.",
      ].join(" "),
    );
  }

  return null;
}

/**
 * الوجهُ الرامي — يُنادى من نقطةِ التشغيلِ. الرمي لا الإرجاعُ عن قصدٍ: مَن أهمل
 * قيمةً مُرجَعةً أهملَ شرطَ صحّةٍ، والرميُ لا يُهمَل.
 */
export function assertSingleInstanceInvariant(input: EventTopologyInput): void {
  const violation = singleInstanceInvariantViolation(input);
  if (violation !== null) throw violation;
}
