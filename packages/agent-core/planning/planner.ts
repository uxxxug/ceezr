/**
 * الغرض: ترتيب خطوات معالجة الحدث قبل تنفيذها — خطّة صريحة تُقرأ وتُسجَّل.
 * الحالة: منفّذ فعلياً بخطّة ثابتة الخطوات — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/planning
 * يُتوقع أن يستخدمه لاحقاً: agents/supportTicketAgent.ts
 * ملاحظات مستقبلية: عند أدوات حقيقية ووكلاء متعدّدين يصير التخطيط ديناميكياً:
 *   خطوات مشروطة، وتفرّع، وإعادة تخطيط عند فشل خطوة. **العقد `Plan` هو نفسه** —
 *   قائمة خطوات لكلٍّ منها غرض ومُخرَج متوقَّع.
 *
 * ═══ لماذا خطّة ثابتة الخطوات ليست تجريداً فارغاً ═══
 *
 * لأنها تُنتج **أثراً مقروءاً** لكل قرار: حين يُسأل «لماذا اقترح هذا؟» يكون
 * الجواب سلسلة خطوات مسجَّلة لا استنتاجاً بعد الوقوع. وهذا هو ما يجعل القرار
 * قابلاً للمراجعة أصلاً. الخطّة الثابتة اليوم — بلا تفرّع ولا شرط — لأن التخطيط
 * الديناميكي بلا أدوات تخطيطٌ لا يُغيّر شيئاً، وبناؤه الآن تعقيدٌ يُشترى بلا حاجة.
 */

import type { EventPayload } from "../schemas.ts";
import type { TaskAnalysis } from "./taskAnalyzer.ts";

export type PlanStepId =
  | "analyze_task"
  | "match_keywords"
  | "search_knowledge"
  | "detect_missing_data"
  | "compose_suggestion";

export interface PlanStep {
  readonly id: PlanStepId;
  readonly purpose: string;
  /** هل تُنفَّذ هذه الخطوة في هذا الحدث؟ */
  readonly enabled: boolean;
  readonly skipReason: string | null;
}

export interface Plan {
  readonly steps: readonly PlanStep[];
  readonly rationale: string;
}

function step(
  id: PlanStepId,
  purpose: string,
  enabled = true,
  skipReason: string | null = null,
): PlanStep {
  return { id, purpose, enabled, skipReason };
}

/**
 * يبني الخطّة. **النصّ غير القابل للتحليل يُقصّر الخطّة** بدل أن يمرّ في كل
 * خطوة ليخرج فارغاً من آخرها: بحثٌ عن معرفةٍ لنصّ من كلمة واحدة يُنتج مطابقةً
 * عشوائيةً تُقرأ كأنها استنتاج.
 */
export function buildPlan(event: EventPayload, analysis: TaskAnalysis): Plan {
  if (!analysis.analyzable) {
    const reason = analysis.rationale;
    return {
      steps: [
        step("analyze_task", "قراءة النيّة وتوكِنات النصّ"),
        step("match_keywords", "مطابقة الذاكرة الطويلة", false, reason),
        step("search_knowledge", "البحث في قاعدة المعرفة", false, reason),
        step("detect_missing_data", "تحديد ما ينقص", true),
        step("compose_suggestion", "تركيب الاقتراح", false, reason),
      ],
      rationale: `خطّة مختصرة: ${reason}`,
    };
  }

  return {
    steps: [
      step("analyze_task", "قراءة النيّة وتوكِنات النصّ"),
      step("match_keywords", "مطابقة كلمات الذاكرة الطويلة لتصنيف أوّلي"),
      step("search_knowledge", "البحث عن مستند معرفة داخل التصنيف"),
      step("detect_missing_data", "تحديد ما ينقص وخصمه من الثقة"),
      step("compose_suggestion", "تركيب نصّ مقترح يقرؤه إنسان"),
    ],
    rationale: `خطّة كاملة لنيّة «${analysis.intent}» على حدث ${event.eventType}`,
  };
}

/** يُسأل قبل كل خطوة. `false` = تُتخطّى ويُسجَّل سببها. */
export function isStepEnabled(plan: Plan, id: PlanStepId): boolean {
  return plan.steps.find((entry) => entry.id === id)?.enabled ?? false;
}
