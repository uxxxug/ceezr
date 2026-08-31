/**
 * الغرض: شرطُ صحّةِ النسخةِ الواحدةِ (`R-17`) منفَّذاً في الشيفرةِ لا في تعليقٍ —
 *    الشطرُ التنفيذيُّ المحسومُ من [ADR 0050](../../../docs/adr/0050-single-instance-is-a-correctness-invariant-not-a-comment.md).
 * الحالة: منفّذ فعلياً — إلزامُ إقلاعٍ يُفشِل التشغيلَ عندَ تنافرِ الطوبولوجيا مع طبقةِ الناقل.
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
 * ## أيُّ إشارةٍ تُقرَأ — ولماذا لا متغيّرَ بيئةٍ جديد
 *
 * العمليةُ لا تعرف `numInstances` (لا تُصدِّره Render إليها)، فلا تُقرَأ إلّا
 * **الإشارةُ القائمةُ في الشيفرةِ**: `SESSION_STORE` بنصِّ `ADR 0011` وبنصِّ التعليقِ
 * القائمِ في `apps/gateway/src/index.ts`: «يُربَط بنفسِ مفتاحِ `SESSION_STORE` لأنّ
 * كليهما يجيب سؤالاً واحداً: **هل نحن أكثرُ من عملية؟**». فـ`redis` في هذا المستودعِ
 * هي **إعلانُ طوبولوجيا متعدّدةِ العملياتِ**، و`memory` إعلانُ عمليةٍ واحدةٍ («صالحٌ
 * لنسخةٍ واحدةٍ فقط» بنصِّ `render.yaml`).
 *
 * والحكمُ: طوبولوجيا متعدّدةٌ **مُعلَنةٌ** مع آليةِ توزيعٍ **لا تعبر العمليةَ** حالةٌ
 * غيرُ متّسقةٍ لا تُشغَّل. وليس المقصودُ أنّ `redis` عيبٌ في ذاتِه، بل أنّ اتّساقَها
 * غيرُ قابلٍ للإثباتِ من داخلِ العمليةِ — و`R-17` يوجب رفضَ ما لا يُثبَت اتّساقُه
 * بدلاً من تشغيلِه صامتاً.
 *
 * وأمّا حرفُ `numInstances` نفسُه فيُحرَسُ حيثُ يوجد: في ملفِّ النشرِ، بحاجزِ
 * `scripts/check-instance-invariant.ts` في سلسلةِ `bun run ci` — ولا تُحلَّل YAML
 * في شيفرةِ الإنتاجِ وقتَ التشغيل.
 *
 * ## ما لا يفعله هذا الملفُّ عن قصد
 *
 * لا يُنشئ آليةَ توزيعٍ، ولا يمسّ `TrackingEvent`، ولا يزعم أنّ `R-17` أُغلِق
 * بشقَّيه: شقُّ **القدرةِ** (التوزيعُ بين النسخِ) مؤجَّلٌ بـADR 0050 §٣-د، وكشفُ
 * الفجوةِ غيرُ منفَّذٍ (لا `version` ولا `sequence` في الحدث).
 */

import type { SessionStoreName } from "./index.ts";

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
 * مُدخلُ الحكمِ: حقلانِ لا يحملُ أحدُهما سرّاً — لا رمزَ بوتٍ ولا رابطَ قاعدةٍ ولا
 * مفتاحَ Redis. وهذا **قيدُ نوعٍ لا اتفاقٌ**: رسالةُ الخرقِ لا تستطيع كشفَ سرٍّ
 * لأنّ الدالّةَ لا تستقبل سرّاً أصلاً (`scripts/check-secret-logging.ts`).
 */
export interface EventTopologyInput {
  /** `SESSION_STORE` — إعلانُ الطوبولوجيا القائمُ في الشيفرة (ADR 0011). */
  readonly sessionStore: SessionStoreName;
  /** آليةُ التوزيعِ المُقرَّرةُ — تُمرَّر لا تُقرَأ من البيئةِ. */
  readonly distribution: EventDistributionMechanism;
}

/**
 * خرقُ شرطِ النسخةِ الواحدةِ. `name` و`code` ثابتانِ كي يُميَّز الخرقُ في السجلِّ
 * بلا مطابقةِ نصٍّ عربيٍّ.
 */
export class SingleInstanceInvariantError extends Error {
  readonly code = "SINGLE_INSTANCE_INVARIANT" as const;
  constructor(
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
 */
export function singleInstanceInvariantViolation(
  input: EventTopologyInput,
): SingleInstanceInvariantError | null {
  if (input.distribution !== "in-process") return null;
  if (input.sessionStore !== "redis") return null;

  return new SingleInstanceInvariantError(
    input.sessionStore,
    input.distribution,
    [
      "خرقُ شرطِ صحّةِ النسخةِ الواحدةِ (R-17 · ADR 0050):",
      "آليةُ توزيعِ الأحداثِ المُقرَّرةُ «in-process» ولا تعبر حدودَ العمليةِ،",
      "والإعدادُ يُعلِن طوبولوجيا متعدّدةَ العملياتِ بـSESSION_STORE=redis (ADR 0011).",
      "فمشتركٌ على نسخةٍ لا يرى حدثاً نُشِر في أخرى، والتدهورُ صامتٌ — فيُرفَض الإقلاعُ بدلاً منه.",
      "الإصلاحُ: إمّا SESSION_STORE=memory مع numInstances: 1 كما يُعلِنه render.yaml،",
      "وإمّا آليةُ توزيعٍ تُقرَّر بـADR ناسخٍ لـADR 0050 §٨. ولا تجاوزَ بمتغيّرِ بيئةٍ.",
    ].join(" "),
  );
}

/**
 * الوجهُ الرامي — يُنادى من نقطةِ التشغيلِ. الرمي لا الإرجاعُ عن قصدٍ: مَن أهمل
 * قيمةً مُرجَعةً أهملَ شرطَ صحّةٍ، والرميُ لا يُهمَل.
 */
export function assertSingleInstanceInvariant(input: EventTopologyInput): void {
  const violation = singleInstanceInvariantViolation(input);
  if (violation !== null) throw violation;
}
