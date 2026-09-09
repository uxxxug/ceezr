/**
 * الغرض: تقديرُ الضغطِ العكسيِّ (backpressure) لطابورٍ صامدٍ واحدٍ — دالّةٌ نقيّةٌ
 *    تأخذُ حِمْلاً مقروءاً وحدوداً مُعلَنةً وتُعيدُ حكماً: أمُشبَعٌ الطابورُ؟ وبأيِّ
 *    بُعدٍ أُشبِعَ؟ وأيُقبَلُ مُنتِجٌ آخرُ أم يُؤجَّل؟ البند `F6-06`.
 * الحالة: منفّذ فعلياً — 2026-09-09.
 * ينتمي إلى: application/scheduling
 * يُستخدم من: `packages/infrastructure/db/queue-backpressure.ts`،
 *    `apps/gateway/src/background/telegram-update-drainer.ts`،
 *    `packages/application/notification/deliver-notification.ts`
 *
 * ## لماذا دالّةٌ نقيّةٌ في طبقةِ التطبيقِ لا في القاعدةِ وحدَها
 *
 * الإنفاذُ الفعليُّ للحدَّينِ الأخطرِ — حدِّ المُنتِجِ وتزامنِ المُستهلِكِ — **في
 * القاعدةِ** لا ههنا، لأنَّ أكثرَ من نسخةٍ تُنتِجُ وتستهلكُ، وحدٌّ في ذاكرةِ
 * عمليةٍ واحدةٍ يُضرَبُ في عددِ النسخِ فيصيرُ لا حدّاً. لكنَّ **الحكمَ** على
 * الأرقامِ — أيُّ بُعدٍ خُرِقَ ومتى — منطقٌ يُقرأُ ويُختبَرُ بلا قاعدةٍ ولا شبكةٍ،
 * فيُفرَدُ ههنا: القاعدةُ تُنفِّذُ، وهذه تُفسِّرُ، والاثنانِ يقرآنِ الأرقامَ نفسَها.
 *
 * ## الأبعادُ الستّةُ — ونصُّ البندِ حرفاً
 *
 * نصُّ `F6-06`: «سعة، عمر أقدم حدث، حد إعادة المحاولة، حد DLQ، حد المنتج، تزامن
 * المستهلك». وهي ستّةٌ لا واحدٌ لأنَّ الطابورَ يمرضُ بستِّ عللٍ متمايزةٍ:
 *
 * ١) **السعةُ** (`depthLimit`): عددُ الصفوفِ غيرِ المنتهيةِ. عمقٌ ينمو يعني أنَّ
 *    الإنتاجَ أسرعُ من الاستهلاكِ — والعمقُ وحدَه لا يكفي دليلاً، فطابورٌ عميقٌ
 *    يُستهلَكُ في ثوانٍ سليمٌ.
 * ٢) **عمرُ أقدمِ حدثٍ** (`oldestAgeLimitSeconds`): وهوَ الدليلُ الذي يكملُ
 *    العمقَ — طابورٌ عمقُه عشرةٌ وأقدمُ صفٍّ فيه عمرُه ساعةٌ **معطوبٌ** ولو كان
 *    ضحلاً: ثمَّةَ صفٌّ لا يُلتقَطُ أبداً. ولا يُقاسُ العمرُ من `created_at`
 *    مطلقاً بل من استحقاقِ الالتقاطِ، فصفٌّ في فترةِ احتياطٍ بينَ محاولتَينِ
 *    ليسَ عالقاً — هوَ ينتظرُ موعدَه، وحسبانُه عالقاً إنذارٌ كاذبٌ دائمٌ.
 * ٣) **حدُّ إعادةِ المحاولةِ** (`retryLimit`): سقفُ محاولاتِ الصفِّ الواحدِ قبلَ
 *    الموتِ. مُنفَّذٌ سلفاً (`CAP-002` للصادرِ، `ADR 0057` للوارِدِ) — ويُقرأُ ههنا
 *    **لا ليُنفَّذَ مرّةً ثانيةً** بل ليُعرَضَ في الحكمِ الواحدِ: حدٌّ لا يُقرأُ في
 *    لوحةٍ واحدةٍ مع أخواتِه حدٌّ يُنسى.
 * ٤) **حدُّ طابورِ الموتى** (`deadLimit`): الموتى ليسوا حِمْلاً — لا يُلتقَطونَ ولا
 *    يُستهلِكونَ شوطاً. فلماذا حدٌّ؟ لأنَّ ارتفاعَهم **علّةٌ لا حِمْلٌ**: مئةُ صفٍّ
 *    ماتت في ساعةٍ تعني عطباً في المُرسِلِ أو في المستقبِلينَ، وهوَ إنذارٌ يجبُ أن
 *    يُقرأَ قبلَ أن يُشتكى. ولذا يُحسَبُ في **نافذةٍ زمنيّةٍ** لا مطلقاً: عدٌّ
 *    مطلقٌ يتجاوزُ الحدَّ يوماً ثمَّ يبقى متجاوزاً إلى الأبدِ فيصيرُ صمتاً.
 * ٥) **حدُّ المُنتِجِ** (`producerLimit`): سقفُ ما ينتظرُ **لمُنتِجٍ واحدٍ**. وهوَ
 *    غيرُ السعةِ عن قصدٍ: السعةُ تحمي الطابورَ من الانفجارِ، وحدُّ المُنتِجِ يحمي
 *    **بقيّةَ المُنتِجينَ** من واحدٍ يستولي على السعةِ كلِّها. وبلاه تكونُ حملةُ
 *    بثٍّ من ألفِ مستقبِلٍ قد ملأت الطابورَ فتأخّرَ عرضُ رحلةٍ خلفَها — وهذا
 *    بالضبطِ ما يمنعُه القسمُ ١٥ من الخارطةِ.
 * ٦) **تزامنُ المُستهلِكِ** (`consumerConcurrency`): سقفُ ما يُحجَزُ في وقتٍ واحدٍ.
 *    يحمي **الاعتمادياتِ** لا الطابورَ: عشرونَ عاملاً يحجزونَ عشرينَ صفّاً معاً
 *    يفتحونَ عشرينَ نداءً إلى تيليجرام، فيُستنفَدُ دلوُ الحدِّ (`TG-001`) ويُحجَبُ
 *    البوتُ. والسقفُ يُنفَّذُ في القاعدةِ لأنَّ العُمّالَ أكثرُ من عملية.
 *
 * ## ما لا تفعلُه هذه الوحدةُ عن قصدٍ
 *
 * - **لا تُرتِّبُ أولويّةً.** أنَّ عرضَ الرحلةِ أحقُّ بالشوطِ من البثِّ هوَ `F6-07`
 *   (القسمُ ١٥). ما ههنا حدودٌ وحكمٌ عليها، لا طابورُ أولويّةٍ ولا تقديمُ صفٍّ على صفٍّ.
 * - **لا تُسقِطُ صفّاً أبداً.** «التأجيلُ» تأجيلٌ حرفاً: الصفُّ يُودَعُ ويُؤخَّرُ
 *   موعدُه. وإسقاطُ إشعارٍ صامتاً هوَ العطبُ الذي حُذِّرَ منه في `F6-05` بعينِه.
 * - **لا تقرأُ إعداداً ولا قاعدةً.** الحدودُ تُمرَّرُ إليها؛ ومن أينَ تُقرأُ لكلِّ
 *   طابورٍ مُعلَنٌ في `packages/shared/config/queue-backpressure.ts`.
 */

/** الأبعادُ الستّةُ بأسمائِها — تُقرأُ في الحُكمِ وفي الحاجزِ بلفظٍ واحدٍ. */
export const BACKPRESSURE_DIMENSIONS = [
  "capacity",
  "oldest_age",
  "retry",
  "dead_letter",
  "producer",
  "consumer_concurrency",
] as const;

export type BackpressureDimension = (typeof BACKPRESSURE_DIMENSIONS)[number];

/**
 * سببُ الإشباعِ. ثلاثةٌ فقط تُشبِعُ الطابورَ: العمقُ والعمرُ والموتى. أمّا
 * `retry` و`producer` و`consumer_concurrency` فحدودٌ **تُنفَّذُ على صفٍّ أو على
 * حاجزٍ**، لا أوصافٌ لحالةِ الطابورِ كلِّه — فلا تُخلَطُ بها.
 */
export const SATURATION_REASONS = ["DEPTH", "OLDEST_AGE", "DEAD_LETTER"] as const;
export type SaturationReason = (typeof SATURATION_REASONS)[number];

/** الحِمْلُ المقروءُ من الطابورِ نفسِه — لا عدّادٌ موازٍ يُصدَّقُ. */
export interface QueueLoad {
  /** الصفوفُ غيرُ المنتهيةِ (منتظرةٌ أو محجوزةٌ). */
  readonly depth: number;
  /**
   * عمرُ أقدمِ صفٍّ **مستحقٍّ** للالتقاطِ، ثوانيَ. صفرٌ إن لم يكن مستحقٌّ —
   * وصفرٌ حالةٌ سويّةٌ لا مجهولةٌ.
   */
  readonly oldestDueAgeSeconds: number;
  /** الموتى في النافذةِ المُعلَنةِ — لا الموتى منذُ نشأةِ النظامِ. */
  readonly deadInWindow: number;
  /** المحجوزُ الآن — يُقابَلُ بتزامنِ المُستهلِكِ. */
  readonly claimed: number;
}

/** الحدودُ الستّةُ كما تُقرأُ من موضعِها المُعلَنِ لكلِّ طابورٍ. */
export interface QueueLimits {
  readonly depthLimit: number;
  readonly oldestAgeLimitSeconds: number;
  readonly retryLimit: number;
  readonly deadLimit: number;
  readonly deadWindowSeconds: number;
  readonly producerLimit: number;
  readonly consumerConcurrency: number;
}

export interface BackpressureVerdict {
  readonly saturated: boolean;
  /** الأسبابُ مرتَّبةٌ كترتيبِ `SATURATION_REASONS` — فالحكمُ حتميٌّ يُقارَنُ في اختبارٍ. */
  readonly reasons: readonly SaturationReason[];
  /** أشُبِعَ سقفُ الحجزِ الآنَ؟ يُقرأُ منفصلاً: يمنعُ التقاطاً ولا يُشبِعُ طابوراً. */
  readonly consumerAtCapacity: boolean;
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * حدٌّ غيرُ موجبٍ (صفرٌ أو سالبٌ أو `NaN`) **لا يُعطَّلُ به الحدُّ**: هذا هوَ
 * الفرقُ بينَ حارسٍ وحارسٍ مُدَّعىً. لو قُرِئَ الصفرُ «بلا حدٍّ» لكانَ خطأُ إعدادٍ
 * واحدٌ — مفتاحٌ محذوفٌ، صفٌّ ناقصٌ، رقمٌ خُزِّنَ نصّاً — يُطفئُ الضغطَ العكسيَّ
 * كلَّه بصمتٍ، ويُقرأُ في اللوحةِ «لا إشباعَ» وهوَ عمىً. فالحدُّ المعطوبُ يُقرأُ
 * **مخروقاً** فيُرى ويُصحَّحُ، لا مفتوحاً فيُنسى. والميلُ نحوَ الإنذارِ لا نحوَ
 * الصمتِ — وهوَ الميلُ نفسُه الذي بُنيَ عليه دلوُ الصادرِ في `CAP-002` (يفشلُ
 * مغلقاً) وتصنيفُ `F6-05` (غيابُ سياسةٍ ⇒ حرجٌ).
 */
function breached(value: number, limit: number): boolean {
  if (!isPositive(limit)) return true;
  return Number.isFinite(value) && value >= limit;
}

export function evaluateQueueBackpressure(
  load: QueueLoad,
  limits: QueueLimits,
): BackpressureVerdict {
  const reasons: SaturationReason[] = [];
  if (breached(load.depth, limits.depthLimit)) reasons.push("DEPTH");
  if (breached(load.oldestDueAgeSeconds, limits.oldestAgeLimitSeconds)) reasons.push("OLDEST_AGE");
  if (breached(load.deadInWindow, limits.deadLimit)) reasons.push("DEAD_LETTER");
  return {
    saturated: reasons.length > 0,
    reasons,
    consumerAtCapacity: breached(load.claimed, limits.consumerConcurrency),
  };
}

/** قرارُ بابِ الإيداعِ: يُقبَلُ فوراً، أو يُودَعُ مؤجَّلاً — ولا ثالثَ. */
export type AdmissionDecision = "admit" | "defer";

export interface AdmissionInput {
  /**
   * أيَقبلُ هذا الصنفُ التأجيلَ؟ الحرجُ **لا يُؤجَّلُ أبداً** ولو أُشبِعَ الطابورُ:
   * تأجيلُ بلاغِ استغاثةٍ لأنَّ حملةَ بثٍّ ملأت الطابورَ **قتلٌ بالحسابِ**.
   */
  readonly deferrable: boolean;
  /** ما ينتظرُ لهذا المُنتِجِ وحدَه. */
  readonly producerPending: number;
  readonly load: QueueLoad;
  readonly limits: QueueLimits;
}

/**
 * التأجيلُ يقعُ لسببَينِ لا واحدٍ: إشباعُ الطابورِ كلِّه (فالتهدئةُ عامّةٌ)، أو
 * تجاوزُ هذا المُنتِجِ حدَّه وحدَه (فالتهدئةُ عليه دونَ غيرِه) — والثاني هوَ عينُ
 * «حدِّ المنتج» في نصِّ البندِ، ويعملُ **ولو كان الطابورُ فارغاً بقيّتُه**.
 */
export function decideAdmission(input: AdmissionInput): AdmissionDecision {
  if (!input.deferrable) return "admit";
  const verdict = evaluateQueueBackpressure(input.load, input.limits);
  if (verdict.saturated) return "defer";
  if (breached(input.producerPending, input.limits.producerLimit)) return "defer";
  return "admit";
}

/**
 * سقفُ صفوفِ الشوطِ الواحدِ. يُقرأُ من تزامنِ المُستهلِكِ لا من سقفِ المحاولاتِ —
 * وهذا **تصحيحُ عطبٍ قائمٍ** لا تحسينٌ: `deliverNotificationBatch` كانت تضبطُ
 * سقفَ الشوطِ من `notification_delivery_max_attempts`، وهوَ مفتاحُ **سقفِ محاولاتِ
 * الصفِّ الواحدِ** الذي تُنفِّذُه `finish_notification_delivery` لتُميتَ الصفَّ
 * (`CAP-002`). فمعنيانِ على مفتاحٍ واحدٍ: من رفعَ سقفَ المحاولاتِ ليَصمُدَ أمامَ
 * انقطاعٍ عارضٍ كان يُطيلُ الشوطَ من حيثُ لا يدري، ومن قصَّرَ الشوطَ كان يُميتُ
 * الصفوفَ أسرعَ. فالمعنيانِ يُفرَدانِ ههنا بمفتاحَينِ.
 */
export function runBatchLimit(limits: Pick<QueueLimits, "consumerConcurrency">): number {
  return isPositive(limits.consumerConcurrency) ? Math.trunc(limits.consumerConcurrency) : 1;
}
