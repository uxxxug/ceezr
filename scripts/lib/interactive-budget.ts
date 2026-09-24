/**
 * الغرض: حَكَمٌ نقيٌّ لصفِّ القسمِ 9.9 الخامسِ — «وقتُ التفاعلِ بعدَ فتحِ تيليجرام» —
 *   يَقيسُ الزمنَ من بدءِ التنزيلِ إلى ظهورِ علامةِ `waslah-interactive` في المتصفّحِ.
 *   والقياسُ نفسُه في `scripts/measure-tti.ts`؛ وهذهِ الوحدةُ تحكمُ على حقائقَ
 *   مصنوعةٍ أو مقيسةٍ سواءً، فتُختبَرُ سوالبُها بلا متصفّحٍ (`ح-7`).
 * الحالة: منفّذ فعلياً — `F1-09` (الصفُّ ٥ · `D-26`).
 * ينتمي إلى: scripts/lib
 * يُتوقع أن يستخدمه لاحقاً: scripts/measure-tti.ts · tests/unit
 *
 * **ولماذا وحدةٌ منفصلةٌ لا امتدادٌ لـ`first-paint-budget.ts`**: لأنَّ الصفَّينِ ٣ و٤
 * (`FCP`/`LCP`) يَقيسانِ الرسمَ وحدَه — قبلَ التبادلِ وقبلَ قراءةِ الدورِ — والصفُّ ٥
 * يَقيسُ المسارَ كاملًا: تنزيلٌ ← تنفيذٌ ← تبادلُ `initData` ← `GET /v1/me` ←
 * تحميلُ السطحِ ← أوّلُ تفاعلٍ. والخلطُ يُسقِطُ التمييزَ في التعليقاتِ والاختباراتِ.
 *
 * **والحدُّ (٢٫٠ ثانيةٍ) كالعقدِ بحرفِه**: من نصِّ القسمِ 9.9. وكما في الصفَّينِ ٣ و٤،
 * فالعقدُ متناقضٌ داخليًّا مع «Slow 3G» (ذهابٌ وإيابٌ ٢ ثانيةٍ) — فالخرقُ مُعلَنٌ
 * بقرارِه `DEC-19` وبسقفٍ مقيسٍ.
 */

/** حدُّ القسمِ 9.9 الصفِّ ٥ بحرفِه. */
export const INTERACTIVE_BUDGET_MS = 2_000;

export type InteractiveMetric = "tti";

/** خرقٌ مُعلَنٌ باسمِ قرارِه وبسقفٍ مقيسٍ — كأختِهِ في `first-paint-budget.ts`. */
export interface DeclaredTtiBreach {
  readonly metric: InteractiveMetric;
  readonly ceilingMs: number;
  readonly decision: string;
  readonly reason: string;
}

/**
 * الخرقُ المقيسُ على `SLOW_3G`. والسقفُ = الوسيطُ المقيسُ محلّيًّا مضروبًا في ١٫٢٥
 * — هامشُ تذبذبِ مُنفِّذٍ مشتركٍ لا هامشُ تحسينٍ. ويُعادُ قياسُه على CI ويُكتَبُ في
 * الدليل. ويُحدَّثُ بعدَ أوّلِ قياسٍ على CI.
 */
export const DECLARED_TTI_BREACHES: readonly DeclaredTtiBreach[] = [
  {
    metric: "tti",
    ceilingMs: 12_000,
    decision: "DEC-19",
    reason:
      "الصفُّ ٥ يَشملُ مسارَ الإقلاعِ كاملَه: تنزيلُ الحملِ الأوّلِ (~154 KB) + تبادلُ initData + GET /v1/me + تحميلُ السطحِ. وزمنُ الذهابِ والإيابِ (٢ ثانيةٍ) وحدَه يُكلِّفُ نصفَ الحدِّ، فالخرقُ حتميٌّ على Slow 3G.",
  },
];

export interface InteractiveRun {
  /** زمنُ التفاعلِ من بدءِ التنزيلِ (ms) — `null` إن لم تظهر العلامةُ. */
  readonly ttiMs: number | null;
  /** زمنُ أوّلِ رسمٍ (`FCP`) — للسياقِ لا للحكمِ. */
  readonly fcpMs: number | null;
  /** عُقَدُ `#root` بعدَ الاستقرارِ — صفرٌ يعني شاشةً بيضاءَ. */
  readonly rootChildCount: number;
  /** طلباتٌ من الأصلِ نفسِه أخفقَت. */
  readonly failedSameOriginRequests: readonly string[];
  /** استثناءاتٌ غيرُ ممسوكةٍ في الصفحةِ. */
  readonly uncaughtExceptions: readonly string[];
  /** علامةُ `waslah-interactive` ظهرَت. */
  readonly interactiveMarked: boolean;
}

export interface InteractiveProblem {
  readonly rule:
    | "NO_PAINT"
    | "EMPTY_ROOT"
    | "FAILED_REQUEST"
    | "UNCAUGHT_EXCEPTION"
    | "NO_INTERACTIVE"
    | "UNDECLARED_BREACH"
    | "BREACH_REGRESSED"
    | "DEAD_DECLARATION"
    | "UNKNOWN_DECISION"
    | "NO_RUNS";
  readonly detail: string;
}

/** الوسيطُ — لا المتوسّطُ. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of nothing");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** شرطُ الحياةِ — يُطبَّقُ على كلِّ تشغيلٍ. */
export function interactiveLivenessProblems(
  run: InteractiveRun,
  label: string,
): InteractiveProblem[] {
  const problems: InteractiveProblem[] = [];
  if (run.fcpMs === null) {
    problems.push({
      rule: "NO_PAINT",
      detail: `${label}: لم يُرسَمْ شيءٌ ألبتّةَ (لا first-contentful-paint)`,
    });
  }
  if (run.rootChildCount === 0) {
    problems.push({ rule: "EMPTY_ROOT", detail: `${label}: #root فارغٌ — شاشةٌ بيضاءُ` });
  }
  for (const url of run.failedSameOriginRequests) {
    problems.push({ rule: "FAILED_REQUEST", detail: `${label}: طلبٌ أخفقَ من الأصلِ نفسِه: ${url}` });
  }
  for (const text of run.uncaughtExceptions) {
    problems.push({ rule: "UNCAUGHT_EXCEPTION", detail: `${label}: استثناءٌ غيرُ ممسوكٍ: ${text}` });
  }
  if (!run.interactiveMarked) {
    problems.push({
      rule: "NO_INTERACTIVE",
      detail: `${label}: لم تظهر علامةُ waslah-interactive — التطبيقُ لم يَصِرْ قابلاً للتفاعلِ`,
    });
  }
  return problems;
}

export interface InteractiveVerdictInput {
  /** تشغيلٌ بلا تقييدٍ — لشرطِ الحياةِ وحدَه. */
  readonly unthrottled: InteractiveRun;
  readonly profileId: string;
  /** تشغيلاتٌ مقيَّدةٌ — يُحكَمُ على وسيطِها. */
  readonly throttled: readonly InteractiveRun[];
  readonly declared: readonly DeclaredTtiBreach[];
  /** القراراتُ المُعلَنةُ في الخارطةِ (`DEC-*`). */
  readonly knownDecisions: ReadonlySet<string>;
}

export interface InteractiveVerdict {
  readonly problems: readonly InteractiveProblem[];
  readonly medianTtiMs: number | null;
}

export function evaluateInteractive(input: InteractiveVerdictInput): InteractiveVerdict {
  const problems: InteractiveProblem[] = [];
  problems.push(...interactiveLivenessProblems(input.unthrottled, "بلا تقييدٍ"));
  input.throttled.forEach((run, i) => {
    problems.push(...interactiveLivenessProblems(run, `${input.profileId} #${i + 1}`));
  });

  if (input.throttled.length === 0) {
    problems.push({ rule: "NO_RUNS", detail: "لا تشغيلَ مقيَّداً — لا حكمَ على رقمٍ لم يُقَسْ" });
    return { problems, medianTtiMs: null };
  }

  const ttiValues = input.throttled.map((r) => r.ttiMs).filter((v): v is number => v !== null);
  const medianTtiMs = ttiValues.length === input.throttled.length ? median(ttiValues) : null;

  for (const breach of input.declared) {
    if (!input.knownDecisions.has(breach.decision)) {
      problems.push({
        rule: "UNKNOWN_DECISION",
        detail: `خرقٌ مُعلَنٌ يُحيلُ إلى قرارٍ غيرِ مُعلَنٍ في الخارطةِ: ${breach.decision}`,
      });
    }
  }

  if (medianTtiMs !== null) {
    const declared = input.declared.find((d) => d.metric === "tti");
    const over = medianTtiMs > INTERACTIVE_BUDGET_MS;
    if (over && declared === undefined) {
      problems.push({
        rule: "UNDECLARED_BREACH",
        detail: `TTI = ${Math.round(medianTtiMs)} ms > ${INTERACTIVE_BUDGET_MS} ms على ${input.profileId} بلا إعلانٍ`,
      });
    } else if (over && declared !== undefined && medianTtiMs > declared.ceilingMs) {
      problems.push({
        rule: "BREACH_REGRESSED",
        detail: `TTI = ${Math.round(medianTtiMs)} ms تجاوزَ سقفَ الخرقِ المُعلَنِ ${declared.ceilingMs} ms (${declared.decision})`,
      });
    } else if (!over && declared !== undefined) {
      problems.push({
        rule: "DEAD_DECLARATION",
        detail: `TTI = ${Math.round(medianTtiMs)} ms ضمنَ الحدِّ ${INTERACTIVE_BUDGET_MS} ms — أزِلْ إعلانَ الخرقِ (${declared.decision})`,
      });
    }
  }

  return { problems, medianTtiMs };
}

/** يستخرجُ معرِّفاتِ `DEC-NN` المُعلَنةَ — يُعادُ استعمالُه من `first-paint-budget.ts`. */
export function declaredDecisionIds(roadmapText: string): Set<string> {
  const ids = new Set<string>();
  for (const match of roadmapText.matchAll(/^\| (DEC-\d+) \|/gm)) {
    if (match[1] !== undefined) ids.add(match[1]);
  }
  return ids;
}
