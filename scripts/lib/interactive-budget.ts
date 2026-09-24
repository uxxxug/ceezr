/**
 * الغرض: حَكَمٌ نقيٌّ لـ«زمنِ بلوغِ سطحِ الراكبِ المرسومِ» على ملفِّ Chromium «3G» —
 *   **حارسُ انحدارٍ لا حاجزُ إغلاقٍ** (قرارُ المالكِ `DEC-19` · 2026-09-24 · `ADR 0185`).
 *   والحاجزُ الإلزاميُّ للصفوفِ 3–5 على ملفِّ «Slow 4G» في `rider-surface-budget.ts`.
 * الحالة: منفّذ فعلياً — `F1-09` (الصفُّ ٥ · `D-26`)، ومُعادُ التسميةِ والدورِ بـ`DEC-19`.
 * ينتمي إلى: scripts/lib
 * يُتوقع أن يستخدمه لاحقاً: scripts/measure-tti.ts · scripts/lib/rider-surface-budget.ts · tests/unit
 *
 * **المقياسُ** (لا «وقتُ تفاعلٍ»): `startTime` لعلامةِ `waslah-surface-rendered` مقيسةً من
 * `performance.timeOrigin` لمستندِ التطبيقِ المصغَّرِ — تُوضَعُ في استدعاءِ
 * `requestAnimationFrame` الثاني بعدَ إيداعِ السطحِ المنتجِ (`RoleRouter.tsx`)، فهيَ حدٌّ
 * أعلى لرسمِ أوّلِ إطارٍ للسطحِ. ولا يدخلُ فيه ما قبلَ بدءِ التنقّلِ إلى المستندِ (فتحُ
 * تيليجرام وتجهيزُ نافذتِه). **وكانَ حتى `DEC-19`** زمنَ علامةِ `waslah-interactive` باسمِ
 * «TTI» (`ح-8` — التاريخُ في `ADR 0184`)؛ وتلكَ العلامةُ باقيةٌ شرطَ حياةٍ باسمِها التاريخيِّ
 * وتعني «بلوغَ حالةِ السطحِ» لا التفاعلَ.
 *
 * **ولماذا يبقى الحدُّ (٢٫٠ ثانيةٍ) في هذا الحارسِ**: لأنَّ الخرقَ على «3G» مُعلَنٌ بقرارِه
 * وبسقفٍ مقيسٍ (18,000 ms) يُسقِطُ البناءَ عندَ الانحدارِ الكبيرِ. **ولا يُدَّعى أنَّ الحدَّ
 * قابلٌ للتحقيقِ على هذا الملفِّ**: كلُّ طلبٍ يُضافُ إليه تأخيرٌ مُحاكىً 2000 ms (يمثِّلُ في
 * Chromium شبكةً زمنُ رحلتِها 400 ms × 5)، والمسارُ خمسةُ انتظاراتٍ متتاليةٍ قبلَ السطحِ.
 */

/** حدُّ القسمِ 9.9 الصفِّ ٥ بحرفِه — لا يُخفَّضُ (`DEC-19`). */
export const SURFACE_RENDERED_BUDGET_MS = 2_000;

export type InteractiveMetric = "surface-rendered";

/** خرقٌ مُعلَنٌ باسمِ قرارِه وبسقفٍ مقيسٍ — كأختِهِ في `first-paint-budget.ts`. */
export interface DeclaredSurfaceRenderedBreach {
  readonly metric: InteractiveMetric;
  readonly ceilingMs: number;
  readonly decision: string;
  readonly reason: string;
}

/**
 * الخرقُ المقيسُ على `SLOW_3G`. والسقفُ = الوسيطُ المقيسُ على CI مضروبًا في ١٫٢٥
 * — هامشُ تذبذبِ مُنفِّذٍ مشتركٍ لا هامشُ تحسينٍ. ويُعادُ قياسُه على CI ويُكتَبُ في
 * الدليل. ويُحدَّثُ بعدَ كلِّ قياسٍ صادقٍ على CI.
 */
export const DECLARED_SURFACE_RENDERED_BREACHES: readonly DeclaredSurfaceRenderedBreach[] = [
  {
    metric: "surface-rendered",
    ceilingMs: 18_000,
    decision: "DEC-19",
    reason:
      "حارسُ انحدارٍ على «3G» لا حاجزُ إغلاقٍ (DEC-19 · 2026-09-24). المسارُ: تنزيلُ الحملِ الأوّلِ (163,374 بايتاً) ← تبادلُ initData ← GET /v1/me ← حزمةُ السطحِ — خمسةُ انتظاراتٍ متتاليةٍ يُضافُ إلى كلٍّ منها تأخيرٌ مُحاكىً 2000 ms، فالحدُّ غيرُ قابلٍ للتحقيقِ على هذا الملفِّ. السقفُ 18,000 ms = الوسيطُ المقيسُ على CI (14,150 ms · run 35962104791) × 1.25",
  },
];

export interface InteractiveRun {
  /** زمنُ أوّلِ رسمٍ (`FCP`) من `performance.timeOrigin` — للسياقِ في هذا الحارسِ. */
  readonly fcpMs: number | null;
  /** عُقَدُ `#root` بعدَ الاستقرارِ — صفرٌ يعني شاشةً بيضاءَ. */
  readonly rootChildCount: number;
  /** طلباتٌ من الأصلِ نفسِه أخفقَت. */
  readonly failedSameOriginRequests: readonly string[];
  /** استثناءاتٌ غيرُ ممسوكةٍ في الصفحةِ. */
  readonly uncaughtExceptions: readonly string[];
  /** لحظةُ `waslah-surface-rendered` من `performance.timeOrigin` (ms) — `null` إن لم تظهر. */
  readonly surfaceRenderedMs: number | null;
  /** علامةُ `waslah-interactive` ظهرَت (اسمٌ تاريخيٌّ: «بلوغُ حالةِ السطحِ»). */
  readonly interactiveMarked: boolean;
  /**
   * **السطحُ المنتجُ** الذي وصلَ إليه الموجّهُ — `rider`/`driver`/`admin`، أو
   * `null` إن وصلَ إلى شاشةٍ نظاميّةٍ (`unregistered`/`blocked`/…) أو لم يُحلَّ
   * بعدُ. وغيابُ السطحِ مع علامةٍ تفاعليّةٍ كانَ مسارَ إيجابٍ كاذبٍ قبلَ التصحيح.
   */
  readonly surface: "rider" | "driver" | "admin" | null;
}

export interface InteractiveProblem {
  readonly rule:
    | "NO_PAINT"
    | "EMPTY_ROOT"
    | "FAILED_REQUEST"
    | "UNCAUGHT_EXCEPTION"
    | "NO_INTERACTIVE"
    | "NO_SURFACE"
    | "INTERACTIVE_WITHOUT_SURFACE"
    | "NO_SURFACE_RENDERED"
    | "RENDERED_BEFORE_PAINT"
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
  if (run.surface === null) {
    problems.push({
      rule: "NO_SURFACE",
      detail: `${label}: الموجّهُ لم يصلْ إلى سطحٍ منتجٍ (rider/driver/admin) — قد يكونُ على شاشةٍ نظاميّةٍ`,
    });
  }
  // `DEC-19`: المقياسُ المحكومُ يجبُ أن يُقاسَ — وغيابُه إخفاقٌ لا تخطٍّ.
  if (run.surface !== null && run.surfaceRenderedMs === null) {
    problems.push({
      rule: "NO_SURFACE_RENDERED",
      detail: `${label}: بلغَ الموجّهُ السطحَ ولم تظهر علامةُ waslah-surface-rendered — القياسُ لم يُجرَ`,
    });
  }
  // `DEC-19`: العلامةُ حدٌّ أعلى لرسمِ السطحِ، فسبقُها أوّلَ رسمٍ في الصفحةِ قياسٌ فاسدٌ.
  if (run.surfaceRenderedMs !== null && run.fcpMs !== null && run.surfaceRenderedMs < run.fcpMs) {
    problems.push({
      rule: "RENDERED_BEFORE_PAINT",
      detail: `${label}: علامةُ بلوغِ السطحِ المرسومِ (${Math.round(run.surfaceRenderedMs)} ms) قبلَ أوّلِ رسمٍ (${Math.round(run.fcpMs)} ms) — قياسٌ فاسدٌ`,
    });
  }
  // حارسٌ متقابلٌ: علامةٌ تفاعليّةٌ بلا سطحٍ = إيجابٌ كاذبٌ.
  if (run.interactiveMarked && run.surface === null) {
    problems.push({
      rule: "INTERACTIVE_WITHOUT_SURFACE",
      detail: `${label}: علامةُ تفاعلٍ ظهرَت بلا سطحٍ منتجٍ — مسارُ إيجابٍ كاذبٍ`,
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
  readonly declared: readonly DeclaredSurfaceRenderedBreach[];
  /** القراراتُ المُعلَنةُ في الخارطةِ (`DEC-*`). */
  readonly knownDecisions: ReadonlySet<string>;
}

export interface InteractiveVerdict {
  readonly problems: readonly InteractiveProblem[];
  readonly medianSurfaceRenderedMs: number | null;
}

export function evaluateInteractive(input: InteractiveVerdictInput): InteractiveVerdict {
  const problems: InteractiveProblem[] = [];
  problems.push(...interactiveLivenessProblems(input.unthrottled, "بلا تقييدٍ"));
  input.throttled.forEach((run, i) => {
    problems.push(...interactiveLivenessProblems(run, `${input.profileId} #${i + 1}`));
  });

  if (input.throttled.length === 0) {
    problems.push({ rule: "NO_RUNS", detail: "لا تشغيلَ مقيَّداً — لا حكمَ على رقمٍ لم يُقَسْ" });
    return { problems, medianSurfaceRenderedMs: null };
  }

  const renderedValues = input.throttled
    .map((r) => r.surfaceRenderedMs)
    .filter((v): v is number => v !== null);
  const medianSurfaceRenderedMs =
    renderedValues.length === input.throttled.length ? median(renderedValues) : null;

  for (const breach of input.declared) {
    if (!input.knownDecisions.has(breach.decision)) {
      problems.push({
        rule: "UNKNOWN_DECISION",
        detail: `خرقٌ مُعلَنٌ يُحيلُ إلى قرارٍ غيرِ مُعلَنٍ في الخارطةِ: ${breach.decision}`,
      });
    }
  }

  if (medianSurfaceRenderedMs !== null) {
    const declared = input.declared.find((d) => d.metric === "surface-rendered");
    const over = medianSurfaceRenderedMs > SURFACE_RENDERED_BUDGET_MS;
    if (over && declared === undefined) {
      problems.push({
        rule: "UNDECLARED_BREACH",
        detail: `زمنُ بلوغِ السطحِ المرسومِ = ${Math.round(medianSurfaceRenderedMs)} ms > ${SURFACE_RENDERED_BUDGET_MS} ms على ${input.profileId} بلا إعلانٍ`,
      });
    } else if (over && declared !== undefined && medianSurfaceRenderedMs > declared.ceilingMs) {
      problems.push({
        rule: "BREACH_REGRESSED",
        detail: `زمنُ بلوغِ السطحِ المرسومِ = ${Math.round(medianSurfaceRenderedMs)} ms تجاوزَ سقفَ الخرقِ المُعلَنِ ${declared.ceilingMs} ms (${declared.decision})`,
      });
    } else if (!over && declared !== undefined) {
      problems.push({
        rule: "DEAD_DECLARATION",
        detail: `زمنُ بلوغِ السطحِ المرسومِ = ${Math.round(medianSurfaceRenderedMs)} ms ضمنَ الحدِّ ${SURFACE_RENDERED_BUDGET_MS} ms — أزِلْ إعلانَ الخرقِ (${declared.decision})`,
      });
    }
  }

  return { problems, medianSurfaceRenderedMs };
}

/** يستخرجُ معرِّفاتِ `DEC-NN` المُعلَنةَ — يُعادُ استعمالُه من `first-paint-budget.ts`. */
export function declaredDecisionIds(roadmapText: string): Set<string> {
  const ids = new Set<string>();
  for (const match of roadmapText.matchAll(/^\| (DEC-\d+) \|/gm)) {
    if (match[1] !== undefined) ids.add(match[1]);
  }
  return ids;
}
