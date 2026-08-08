/**
 * الغرض: كشف التراجع — أن يصير أداء الطبقة اليوم أسوأ ممّا كان، أو أن يتغيّر
 *   سلوكها على مُدخَل معروف بلا قصد.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/evaluation
 * يُتوقع أن يستخدمه لاحقاً: اختبارات الوحدة، ومراجعة ما قبل الاعتماد
 * ملاحظات مستقبلية: تُبنى لاحقاً مجموعة ذهبية (golden set) من تذاكر حقيقية
 *   مصنَّفة يدوياً، فتصير هذه الفحوص مقارنةً بمرجعٍ بشري لا بحالةٍ سابقة.
 *
 * ═══ لماذا يُفحص التراجع عند كل اعتماد مرشَّح ═══
 *
 * لأن هذا هو الخطر الحقيقي في أي نظام يتعلّم: كلمةٌ تُعتمَد لتحسّن حالةً واحدة
 * فتُفسد عشراً كانت تعمل. الموافقة البشرية على المرشَّح **لا تكفي** — المراجع
 * يرى الكلمة ولا يرى أثرها على ما سبق. هذه الفحوص هي التي تُريه الأثر.
 */

import type { EvaluationSummary } from "../schemas.ts";

export interface RegressionFinding {
  readonly metric: string;
  readonly before: number | null;
  readonly after: number | null;
  readonly regressed: boolean;
  readonly detail: string;
}

export interface RegressionReport {
  readonly regressed: boolean;
  readonly findings: readonly RegressionFinding[];
}

/** تراجعٌ أصغر من هذا ضجيج إحصائي على عيّنات صغيرة لا إشارة. */
const ACCEPTANCE_TOLERANCE = 0.05;
const CALIBRATION_TOLERANCE = 0.05;

function compare(
  metric: string,
  before: number | null,
  after: number | null,
  tolerance: number,
  higherIsBetter: boolean,
): RegressionFinding {
  if (before === null || after === null) {
    return {
      metric,
      before,
      after,
      regressed: false,
      detail: "لا مقارنة ممكنة — أحد الطرفين بلا بيانات",
    };
  }
  const delta = Number((after - before).toFixed(4));
  const worsened = higherIsBetter ? delta < -tolerance : delta > tolerance;
  return {
    metric,
    before,
    after,
    regressed: worsened,
    detail: worsened ? `تراجع بمقدار ${Math.abs(delta)}` : `تغيّر ${delta} ضمن الاحتمال`,
  };
}

export function checkRegression(
  before: EvaluationSummary,
  after: EvaluationSummary,
): RegressionReport {
  const findings = [
    compare(
      "acceptanceRate",
      before.acceptanceRate,
      after.acceptanceRate,
      ACCEPTANCE_TOLERANCE,
      true,
    ),
    // فجوة المعايرة: الأقلّ أفضل، ولذلك `higherIsBetter = false`.
    compare(
      "calibrationGap",
      before.calibrationGap,
      after.calibrationGap,
      CALIBRATION_TOLERANCE,
      false,
    ),
  ];
  return { regressed: findings.some((finding) => finding.regressed), findings };
}

/**
 * فحص ثبات السلوك: نفس المُدخَل يجب أن يُنتج نفس التصنيف. **حتمية المطابقة
 * النصّية هي ما يجعل هذا الفحص ممكناً أصلاً** — ويوم يُوصَل نموذج توليدي يفقد
 * هذا الفحص معناه بصيغته هذه، وهذا سببٌ إضافي لعدم استعجال وصله.
 */
export function checkDeterminism(runs: readonly (string | null)[]): {
  readonly stable: boolean;
  readonly detail: string;
} {
  const distinct = new Set(runs.map((value) => value ?? "∅"));
  return distinct.size <= 1
    ? { stable: true, detail: `ثابت عبر ${runs.length} تشغيلة` }
    : { stable: false, detail: `اختلف الناتج: ${[...distinct].join(" / ")}` };
}
