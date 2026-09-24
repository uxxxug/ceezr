/**
 * الغرض: حَكَمٌ نقيٌّ لصفوفِ القسمِ 9.9 التي **لا تُقاسُ إلّا بمتصفّحٍ** — أوّلُ رسمٍ
 *   (`FCP`) وأكبرُ رسمٍ (`LCP`) — ومعَها **شرطُ الحياةِ** الذي يسبقُها: أنَّ التطبيقَ
 *   يرسمُ شيئاً أصلاً. والقياسُ نفسُه في `scripts/measure-first-paint.ts`؛ وهذهِ الوحدةُ
 *   تحكمُ على حقائقَ مصنوعةٍ أو مقيسةٍ سواءً، فتُختبَرُ سوالبُها بلا متصفّحٍ (`ح-7`).
 * الحالة: منفّذ فعلياً — `D-25` · `F1-09` (الصفّانِ 3 و4؛ والصفُّ 5 **غيرُ مقيسٍ**).
 * ينتمي إلى: scripts/lib
 * يُتوقع أن يستخدمه لاحقاً: scripts/measure-first-paint.ts · tests/unit
 *
 * لماذا شرطُ الحياةِ قبلَ الأرقامِ (`D-25`): قِيسَ مُخرَجُ `main`@`571c891` بمتصفّحٍ
 * بلا رأسٍ فكانَ `#root` فارغاً وثلاثةُ طلباتٍ `404` — **شاشةٌ بيضاءُ** والبناءُ وكلُّ
 * حاجزٍ أخضرُ. فرقمُ `FCP` لا معنى له قبلَ أن يُثبَتَ أنَّ ثمَّةَ رسماً؛ وغيابُ الرسمِ
 * ليسَ «رقماً كبيراً» بل عطبٌ يُسقِطُ البناءَ بلا إقرارٍ ولا سجلٍّ يُعفي منه.
 *
 * لماذا سجلُّ خروقٍ مُعلَنةٍ لا بوّابةٌ حمراءُ دائمةٌ (`DEC-19`): الشبكةُ الحاكمةُ
 * «3G بطيء» بتعريفِها المعياريِّ في Chromium (زمنُ ذهابٍ وإيابٍ 2000 ms) تجعلُ
 * `FCP ≤ 1.8s` **مستحيلاً فيزيائيّاً** لأيِّ موقعٍ — المستندُ وحدَه يحتاجُ ذهاباً وإياباً
 * — وسقفُ الحملِ الأوّلِ في الجدولِ نفسِه (180 KB) يحتاجُ 3.6 ثانيةً على 50 KB/s. فالعقدُ
 * **متناقضٌ داخليّاً** بالقياسِ، وحسمُه قرارٌ لا شيفرةٌ. ولذلكَ: الخرقُ **يُعلَنُ باسمِ
 * قرارِه وبسقفٍ مقيسٍ**، ويُسقِطُ البناءَ متى (أ) ظهرَ خرقٌ غيرُ مُعلَنٍ، أو (ب) تجاوزَ
 * القياسُ سقفَ الخرقِ المُعلَنِ (انحدارٌ)، أو (ج) زالَ الخرقُ وبقيَ إعلانُه (إعفاءٌ ميّتٌ).
 * ولا يُقرأُ مرورُ هذا الحَكَمِ استيفاءً للصفَّينِ — `F1-09` يبقى `[~]`.
 */

/** ملفُّ شبكةٍ مُسمّىً بمصدرِه — لا أرقامٌ مختارةٌ تُوافِقُ النتيجةَ. */
export interface NetworkProfile {
  readonly id: string;
  /** المصدرُ الذي أُخِذَت منه الأرقامُ حرفاً. */
  readonly source: string;
  /** زمنُ الذهابِ والإيابِ المُضافُ لكلِّ طلبٍ (ms) — `Network.emulateNetworkConditions.latency`. */
  readonly latencyMs: number;
  /** بايتٌ في الثانيةِ. */
  readonly downloadBytesPerSecond: number;
  readonly uploadBytesPerSecond: number;
  /** مُعامِلُ إبطاءِ المعالجِ (`Emulation.setCPUThrottlingRate`). */
  readonly cpuSlowdown: number;
}

/**
 * «3G بطيء» بتعريفِ Chromium نفسِه: `Slow3GConditions` في
 * `front_end/core/sdk/NetworkManager.ts` = تنزيلٌ ورفعٌ `500 * 1000 / 8 * .8` بايتاً في
 * الثانيةِ وزمنُ `400 * 5` ms. والمعالجُ ×4 هوَ إبطاءُ الجوّالِ الافتراضيُّ في Lighthouse
 * — والجدولُ لا يُسمّي جهازاً، فالرقمُ **مُعلَنٌ افتراضاً** في `ADR 0183` لا مُشتقٌّ.
 */
export const SLOW_3G: NetworkProfile = {
  id: "chromium-slow-3g",
  source: "Chromium DevTools `Slow3GConditions` (NetworkManager.ts) · CPU ×4 (Lighthouse mobile)",
  latencyMs: 400 * 5,
  downloadBytesPerSecond: ((500 * 1000) / 8) * 0.8,
  uploadBytesPerSecond: ((500 * 1000) / 8) * 0.8,
  cpuSlowdown: 4,
};

/** حدودُ القسمِ 9.9 بحرفِها — «FCP على 3G بطيء ≤ 1.8s» و«LCP ≤ 2.5s». لا تُخفَّف هنا. */
export const FIRST_PAINT_BUDGET = {
  fcpMs: 1800,
  lcpMs: 2500,
} as const;

export type PaintMetric = "fcp" | "lcp";

/** حقائقُ تشغيلٍ واحدٍ بمتصفّحٍ — مقيسةٌ أو مصنوعةٌ في اختبارٍ. */
export interface PaintRun {
  /** لحظةُ أوّلِ رسمٍ من `PerformanceObserver('paint')` — `null` إن لم يُرسَمْ شيءٌ. */
  readonly fcpMs: number | null;
  /** آخرُ مُدخَلِ `largest-contentful-paint` — `null` إن لم يُسجَّلْ. */
  readonly lcpMs: number | null;
  /** عددُ عُقَدِ `#root` بعدَ الاستقرارِ — صفرٌ يعني شاشةً بيضاءَ. */
  readonly rootChildCount: number;
  /** طلباتٌ من الأصلِ نفسِه أخفقَت (`>= 400` أو `loadingFailed`). */
  readonly failedSameOriginRequests: readonly string[];
  /** طلباتُ وحداتٍ جاءَت بنوعِ محتوىً غيرِ `javascript` (إعادةُ كتابةِ Render إلى HTML). */
  readonly nonScriptModuleResponses: readonly string[];
  /** استثناءاتٌ غيرُ ممسوكةٍ في الصفحةِ. */
  readonly uncaughtExceptions: readonly string[];
}

/** خرقٌ مُعلَنٌ باسمِ قرارِه وبسقفٍ مقيسٍ. */
export interface DeclaredBreach {
  readonly profileId: string;
  readonly metric: PaintMetric;
  /** السقفُ: أعلى قيمةٍ مقبولةٍ قبلَ أن يُعَدَّ القياسُ انحداراً (ms). */
  readonly ceilingMs: number;
  /** معرِّفُ القرارِ الذي يحسمُ الخرقَ — يجبُ أن يكونَ مُعلَناً في الخارطةِ. */
  readonly decision: string;
  readonly reason: string;
}

/**
 * الخرقانِ المقيسانِ على `SLOW_3G` في `docs/evidence/architecture/F1-09-20260924.md`.
 * والسقفُ = الوسيطُ المقيسُ محلّيّاً (7320 ms · ثلاثةُ تشغيلاتٍ بين 7304 و7332) مضروباً في
 * 1.25 ومُقرَّباً إلى 9200 — هامشُ تذبذبِ مُنفِّذٍ مشتركٍ **لا هامشُ تحسينٍ**: القيدُ
 * الشبكيُّ يحكمُ الزمنَ فالتذبذبُ المقيسُ 28 ms. ويُعادُ قياسُه على CI ويُكتَبُ في الدليلِ.
 */
export const DECLARED_BREACHES: readonly DeclaredBreach[] = [
  {
    profileId: SLOW_3G.id,
    metric: "fcp",
    ceilingMs: 9_200,
    decision: "DEC-19",
    reason:
      "لا رسمَ قبلَ تنزيلِ الحملِ الأوّلِ وتنفيذِه (≈154 KB بعدَ الضغطِ على 50 KB/s)، وزمنُ الذهابِ والإيابِ 2000 ms وحدَه يتجاوزُ الحدَّ",
  },
  {
    profileId: SLOW_3G.id,
    metric: "lcp",
    ceilingMs: 9_200,
    decision: "DEC-19",
    reason: "أكبرُ رسمٍ هوَ أوّلُه في شاشةِ اليومِ — فالسببُ عينُه",
  },
];

export interface FirstPaintProblem {
  readonly rule:
    | "NO_PAINT"
    | "EMPTY_ROOT"
    | "FAILED_REQUEST"
    | "MODULE_NOT_SCRIPT"
    | "UNCAUGHT_EXCEPTION"
    | "UNDECLARED_BREACH"
    | "BREACH_REGRESSED"
    | "DEAD_DECLARATION"
    | "UNKNOWN_DECISION"
    | "NO_RUNS";
  readonly detail: string;
}

/** الوسيطُ — لا المتوسّطُ: تشغيلٌ شاذٌّ واحدٌ لا يُحرِّكُ الحكمَ. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of nothing");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** شرطُ الحياةِ: يُطبَّقُ على **كلِّ** تشغيلٍ — ولا سجلَّ يُعفي منه. */
export function livenessProblems(run: PaintRun, label: string): FirstPaintProblem[] {
  const problems: FirstPaintProblem[] = [];
  if (run.fcpMs === null) {
    problems.push({
      rule: "NO_PAINT",
      detail: `${label}: لم يُرسَمْ شيءٌ ألبتّةَ (لا \`first-contentful-paint\`)`,
    });
  }
  if (run.rootChildCount === 0) {
    problems.push({ rule: "EMPTY_ROOT", detail: `${label}: \`#root\` فارغٌ — شاشةٌ بيضاءُ` });
  }
  for (const url of run.failedSameOriginRequests) {
    problems.push({ rule: "FAILED_REQUEST", detail: `${label}: طلبٌ أخفقَ من الأصلِ نفسِه: ${url}` });
  }
  for (const url of run.nonScriptModuleResponses) {
    problems.push({
      rule: "MODULE_NOT_SCRIPT",
      detail: `${label}: وحدةٌ جاءَت بغيرِ نوعِ \`javascript\` (مسارٌ أُعيدَت كتابتُه إلى المستندِ؟): ${url}`,
    });
  }
  for (const text of run.uncaughtExceptions) {
    problems.push({ rule: "UNCAUGHT_EXCEPTION", detail: `${label}: استثناءٌ غيرُ ممسوكٍ: ${text}` });
  }
  return problems;
}

export interface FirstPaintInput {
  /** تشغيلٌ بلا تقييدٍ — لشرطِ الحياةِ وحدَه. */
  readonly unthrottled: PaintRun;
  readonly profile: NetworkProfile;
  /** تشغيلاتٌ مقيَّدةٌ بالملفِّ — يُحكَمُ على وسيطِها. */
  readonly throttled: readonly PaintRun[];
  readonly declared: readonly DeclaredBreach[];
  /** القراراتُ المُعلَنةُ في الخارطةِ (`DEC-*`) — يُمرَّرُ من قارئِ الوثيقةِ. */
  readonly knownDecisions: ReadonlySet<string>;
}

export interface FirstPaintVerdict {
  readonly problems: readonly FirstPaintProblem[];
  readonly medians: Readonly<Record<PaintMetric, number | null>>;
}

export function evaluateFirstPaint(input: FirstPaintInput): FirstPaintVerdict {
  const problems: FirstPaintProblem[] = [];
  problems.push(...livenessProblems(input.unthrottled, "بلا تقييدٍ"));
  input.throttled.forEach((run, i) => {
    problems.push(...livenessProblems(run, `${input.profile.id} #${i + 1}`));
  });

  if (input.throttled.length === 0) {
    problems.push({ rule: "NO_RUNS", detail: "لا تشغيلَ مقيَّداً — لا حكمَ على رقمٍ لم يُقَسْ" });
    return { problems, medians: { fcp: null, lcp: null } };
  }

  const pick = (metric: PaintMetric): number | null => {
    const values = input.throttled
      .map((r) => (metric === "fcp" ? r.fcpMs : r.lcpMs))
      .filter((v): v is number => v !== null);
    return values.length === input.throttled.length ? median(values) : null;
  };
  const medians = { fcp: pick("fcp"), lcp: pick("lcp") } as const;

  for (const breach of input.declared) {
    if (!input.knownDecisions.has(breach.decision)) {
      problems.push({
        rule: "UNKNOWN_DECISION",
        detail: `خرقٌ مُعلَنٌ يُحيلُ إلى قرارٍ غيرِ مُعلَنٍ في الخارطةِ: ${breach.decision}`,
      });
    }
  }

  for (const metric of ["fcp", "lcp"] as const) {
    const value = medians[metric];
    if (value === null) continue; // غيابُ الرسمِ حُكِمَ عليهِ في شرطِ الحياةِ.
    const budget = metric === "fcp" ? FIRST_PAINT_BUDGET.fcpMs : FIRST_PAINT_BUDGET.lcpMs;
    const declared = input.declared.find(
      (d) => d.profileId === input.profile.id && d.metric === metric,
    );
    const over = value > budget;
    if (over && declared === undefined) {
      problems.push({
        rule: "UNDECLARED_BREACH",
        detail: `${metric.toUpperCase()} = ${Math.round(value)} ms > ${budget} ms على ${input.profile.id} بلا إعلانٍ`,
      });
    } else if (over && declared !== undefined && value > declared.ceilingMs) {
      problems.push({
        rule: "BREACH_REGRESSED",
        detail: `${metric.toUpperCase()} = ${Math.round(value)} ms تجاوزَ سقفَ الخرقِ المُعلَنِ ${declared.ceilingMs} ms (${declared.decision})`,
      });
    } else if (!over && declared !== undefined) {
      problems.push({
        rule: "DEAD_DECLARATION",
        detail: `${metric.toUpperCase()} = ${Math.round(value)} ms ضمنَ الحدِّ ${budget} ms — أزِلْ إعلانَ الخرقِ (${declared.decision}) ولا تُبقِه ثقباً`,
      });
    }
  }

  return { problems, medians };
}

/** يستخرجُ معرِّفاتِ `DEC-NN` المُعلَنةَ صفوفاً في جدولِ القراراتِ من نصِّ الخارطةِ. */
export function declaredDecisionIds(roadmapText: string): Set<string> {
  const ids = new Set<string>();
  for (const match of roadmapText.matchAll(/^\| (DEC-\d+) \|/gm)) {
    if (match[1] !== undefined) ids.add(match[1]);
  }
  return ids;
}
