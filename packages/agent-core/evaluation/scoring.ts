/**
 * الغرض: حساب المقاييس الخام من التجارب والنتائج — أرقامٌ لا أحكام.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/evaluation
 * يُتوقع أن يستخدمه لاحقاً: evaluator.ts، regressionChecks.ts
 * ملاحظات مستقبلية: يُضاف لاحقاً تقسيم المقاييس على التصنيف والمدينة والفترة —
 *   المتوسّط العام يُخفي أن الطبقة ممتازة في تصنيف وكارثية في آخر.
 *
 * ═══ لماذا `null` لا صفر عند غياب البيانات ═══
 *
 * «نسبة قبول 0%» و«لا توجد نتيجة واحدة بعد» جملتان مختلفتان تماماً، وإرجاع صفر
 * عن الثانية يجعل لوحةً تعرض فشلاً ذريعاً بينما لم يُقاس شيء. الصفر رقمٌ يُتّخذ
 * عليه قرار، و`null` سؤالٌ يُطلب جوابه.
 */

import type { EvaluationSummary, ExperienceRecord, OutcomeRecord } from "../schemas.ts";

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

export function summarize(
  experiences: readonly ExperienceRecord[],
  outcomes: readonly OutcomeRecord[],
): EvaluationSummary {
  const byTrace = new Map<string, OutcomeRecord>();
  for (const outcome of outcomes) byTrace.set(outcome.traceId, outcome); // الأحدث يغلب

  const suggested = experiences.filter((entry) => entry.status === "suggested");
  const matched = suggested
    .map((entry) => byTrace.get(entry.traceId))
    .filter((outcome): outcome is OutcomeRecord => outcome !== undefined);

  const accepted = matched.filter((outcome) => outcome.verdict === "accepted").length;
  const rejected = matched.filter((outcome) => outcome.verdict === "rejected").length;
  const ignored = matched.filter((outcome) => outcome.verdict === "ignored").length;

  const acceptanceRate =
    matched.length === 0 ? null : Number((accepted / matched.length).toFixed(4));
  const averageConfidence = mean(suggested.map((entry) => entry.confidence));

  return {
    total: experiences.length,
    suggested: suggested.length,
    withOutcome: matched.length,
    accepted,
    rejected,
    ignored,
    acceptanceRate,
    averageConfidence,
    // فجوة المعايرة: موجبٌ = الطبقة أوثق بنفسها ممّا تستحق. هذا المقياس **أهمّ
    // من نسبة القبول وحدها**: طبقةٌ تقبل 60% وتعلن ثقة 0.62 معايَرة، وأخرى تقبل
    // 60% وتعلن 0.95 خطِرة — لأن من يقرأ ثقتها العالية يتوقّف عن التحقّق.
    calibrationGap:
      acceptanceRate === null || averageConfidence === null
        ? null
        : Number((averageConfidence - acceptanceRate).toFixed(4)),
  };
}

/** نسبة القبول داخل تصنيف واحد — يكشف ما يُخفيه المتوسّط العام. */
export function acceptanceByClassification(
  experiences: readonly ExperienceRecord[],
  outcomes: readonly OutcomeRecord[],
): Readonly<Record<string, { total: number; accepted: number; rate: number | null }>> {
  const byTrace = new Map<string, OutcomeRecord>();
  for (const outcome of outcomes) byTrace.set(outcome.traceId, outcome);

  const buckets: Record<string, { total: number; accepted: number; rate: number | null }> = {};
  for (const entry of experiences) {
    if (entry.status !== "suggested" || entry.classification === null) continue;
    const outcome = byTrace.get(entry.traceId);
    if (outcome === undefined) continue;
    const bucket = buckets[entry.classification] ?? { total: 0, accepted: 0, rate: null };
    bucket.total += 1;
    if (outcome.verdict === "accepted") bucket.accepted += 1;
    bucket.rate = Number((bucket.accepted / bucket.total).toFixed(4));
    buckets[entry.classification] = bucket;
  }
  return buckets;
}
