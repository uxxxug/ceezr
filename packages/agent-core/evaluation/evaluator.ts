/**
 * الغرض: تحويل المقاييس الخام إلى حكمٍ مقروء عن حال الطبقة — هل هي نافعة، وهل
 *   يجوز الاستمرار بها كما هي.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/evaluation
 * يُتوقع أن يستخدمه لاحقاً: gateway.evaluate()، وتقارير المراجعة
 * ملاحظات مستقبلية: تُربط العتبات أدناه بضبط تلقائي للعتبة في `confidencePolicy`
 *   **بعد موافقة بشرية لا قبلها** — ضبطٌ آلي للعتبة على بيانات قليلة يُذبذب
 *   السلوك بلا سبب مفهوم.
 */

import type { EvaluationSummary, ExperienceRecord, OutcomeRecord } from "../schemas.ts";
import { summarize } from "./scoring.ts";

export type HealthVerdict = "insufficient_data" | "healthy" | "needs_attention" | "harmful";

export interface EvaluationReport {
  readonly summary: EvaluationSummary;
  readonly verdict: HealthVerdict;
  readonly findings: readonly string[];
}

/** أقلّ عدد نتائج قبل إصدار أي حكم. ما دونه لا يُقاس بل يُنتظر. */
export const MIN_OUTCOMES_FOR_VERDICT = 10;
/** نسبة قبول تحتها تُعدّ الطبقة ضارّة أكثر منها نافعة. */
const HARMFUL_ACCEPTANCE = 0.25;
const HEALTHY_ACCEPTANCE = 0.6;
/** فجوة معايرة فوقها تُعدّ الطبقة مُفرطة الثقة بنفسها. */
const OVERCONFIDENCE_GAP = 0.2;

export function evaluate(
  experiences: readonly ExperienceRecord[],
  outcomes: readonly OutcomeRecord[],
): EvaluationReport {
  const summary = summarize(experiences, outcomes);
  const findings: string[] = [];

  if (summary.withOutcome < MIN_OUTCOMES_FOR_VERDICT) {
    findings.push(
      `${summary.withOutcome} نتيجة مسجَّلة فقط — الحدّ الأدنى للحكم ${MIN_OUTCOMES_FOR_VERDICT}`,
    );
    return { summary, verdict: "insufficient_data", findings };
  }

  const rate = summary.acceptanceRate ?? 0;
  const gap = summary.calibrationGap;

  if (gap !== null && gap > OVERCONFIDENCE_GAP) {
    findings.push(`ثقة مُفرطة: فجوة معايرة ${gap} — تُخفَّض العتبة أو تُراجَع أوزان الكلمات`);
  }
  if (summary.ignored > summary.accepted + summary.rejected) {
    // التجاهل الغالب مشكلة عرضٍ لا مشكلة دقّة: اقتراحٌ لا يُقرأ لا يُصلحه تحسين
    // التصنيف. ذكرها صراحةً يمنع أن يُصرف الجهد في المكان الخطأ.
    findings.push("أغلب الاقتراحات تُتجاهَل ولا تُقرأ — مشكلة عرض لا مشكلة دقّة");
  }

  if (rate < HARMFUL_ACCEPTANCE) {
    findings.push(`نسبة قبول ${rate} — الطبقة تُضيف عبئاً على فريق الدعم أكثر ممّا تُعين`);
    return { summary, verdict: "harmful", findings };
  }
  if (rate < HEALTHY_ACCEPTANCE) {
    findings.push(`نسبة قبول ${rate} دون ${HEALTHY_ACCEPTANCE} — نافعة جزئياً وتحتاج ضبطاً`);
    return { summary, verdict: "needs_attention", findings };
  }

  findings.push(`نسبة قبول ${rate} — ضمن المدى الصحّي`);
  return { summary, verdict: findings.length > 1 ? "needs_attention" : "healthy", findings };
}
