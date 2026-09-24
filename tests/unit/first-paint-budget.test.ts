/**
 * حَكَمُ أوّلِ رسمٍ (`D-25` · `F1-09` · `ADR 0183`) — كلُّ قاعدةٍ بافتراقٍ مزروعٍ (`ح-7`).
 * والحقائقُ مصنوعةٌ: الحَكَمُ نقيٌّ ولا يحتاجُ متصفّحاً؛ والمتصفّحُ في الوظيفةِ المسمّاةِ.
 */

import { describe, expect, test } from "bun:test";
import {
  DECLARED_BREACHES,
  type DeclaredBreach,
  declaredDecisionIds,
  evaluateFirstPaint,
  FIRST_PAINT_BUDGET,
  type FirstPaintInput,
  livenessProblems,
  median,
  type PaintRun,
  SLOW_3G,
} from "../../scripts/lib/first-paint-budget.ts";

const alive = (fcpMs: number, lcpMs = fcpMs): PaintRun => ({
  fcpMs,
  lcpMs,
  rootChildCount: 1,
  failedSameOriginRequests: [],
  nonScriptModuleResponses: [],
  uncaughtExceptions: [],
});

const breach = (metric: "fcp" | "lcp", ceilingMs: number, decision = "DEC-19"): DeclaredBreach => ({
  profileId: SLOW_3G.id,
  metric,
  ceilingMs,
  decision,
  reason: "اختبار",
});

const input = (over: Partial<FirstPaintInput> = {}): FirstPaintInput => ({
  unthrottled: alive(100),
  profile: SLOW_3G,
  throttled: [alive(7300), alive(7320), alive(7330)],
  declared: [breach("fcp", 9200), breach("lcp", 9200)],
  knownDecisions: new Set(["DEC-19"]),
  ...over,
});

const rules = (i: FirstPaintInput) => evaluateFirstPaint(i).problems.map((p) => p.rule);

describe("الملفُّ الشبكيُّ والحدودُ منقولةٌ حرفاً", () => {
  test("«Slow 3G» بتعريفِ Chromium: 2000 ms و50000 بايتٍ في الثانيةِ", () => {
    expect(SLOW_3G.latencyMs).toBe(2000);
    expect(SLOW_3G.downloadBytesPerSecond).toBe(50_000);
    expect(SLOW_3G.uploadBytesPerSecond).toBe(50_000);
    expect(SLOW_3G.cpuSlowdown).toBe(4);
  });
  test("حدّا القسمِ 9.9 لا يُخفَّفانِ", () => {
    expect(FIRST_PAINT_BUDGET).toEqual({ fcpMs: 1800, lcpMs: 2500 });
  });
  test("كلُّ خرقٍ مُعلَنٍ يُحيلُ إلى DEC-19 وسقفُه فوقَ الحدِّ", () => {
    for (const d of DECLARED_BREACHES) {
      expect(d.decision).toBe("DEC-19");
      expect(d.ceilingMs).toBeGreaterThan(d.metric === "fcp" ? 1800 : 2500);
    }
  });
});

describe("شرطُ الحياةِ — لا سجلَّ يُعفي منه", () => {
  test("تشغيلٌ سليمٌ بلا مشكلاتٍ", () => {
    expect(livenessProblems(alive(100), "x")).toEqual([]);
  });
  test("لا رسمَ ⇒ NO_PAINT", () => {
    expect(livenessProblems({ ...alive(1), fcpMs: null }, "x").map((p) => p.rule)).toContain(
      "NO_PAINT",
    );
  });
  test("`#root` فارغٌ ⇒ EMPTY_ROOT (شاشةُ D-25 البيضاءُ)", () => {
    expect(livenessProblems({ ...alive(1), rootChildCount: 0 }, "x").map((p) => p.rule)).toEqual([
      "EMPTY_ROOT",
    ]);
  });
  test("طلبٌ أخفقَ ⇒ FAILED_REQUEST", () => {
    const run = { ...alive(1), failedSameOriginRequests: ["404 http://h/shell.js"] };
    expect(livenessProblems(run, "x").map((p) => p.rule)).toEqual(["FAILED_REQUEST"]);
  });
  test("وحدةٌ جاءَت HTML (إعادةُ كتابةِ Render) ⇒ MODULE_NOT_SCRIPT", () => {
    const run = { ...alive(1), nonScriptModuleResponses: ["text/html http://h/shell.js"] };
    expect(livenessProblems(run, "x").map((p) => p.rule)).toEqual(["MODULE_NOT_SCRIPT"]);
  });
  test("استثناءٌ غيرُ ممسوكٍ ⇒ UNCAUGHT_EXCEPTION", () => {
    const run = { ...alive(1), uncaughtExceptions: ["TypeError"] };
    expect(livenessProblems(run, "x").map((p) => p.rule)).toEqual(["UNCAUGHT_EXCEPTION"]);
  });
  test("شاشةٌ بيضاءُ في تشغيلٍ مقيَّدٍ واحدٍ تُسقِطُ الحكمَ وإن أُعلِنَ الخرقُ", () => {
    const i = input({
      throttled: [alive(7300), { ...alive(7300), rootChildCount: 0 }, alive(7300)],
    });
    expect(rules(i)).toContain("EMPTY_ROOT");
  });
});

describe("الخرقُ المُعلَنُ — يُحصَرُ ولا يُعفى", () => {
  test("خرقانِ مُعلَنانِ ضمنَ سقفَيهما ⇒ لا مشكلةَ", () => {
    expect(rules(input())).toEqual([]);
  });
  test("خرقٌ بلا إعلانٍ ⇒ UNDECLARED_BREACH", () => {
    expect(rules(input({ declared: [breach("lcp", 9200)] }))).toEqual(["UNDECLARED_BREACH"]);
  });
  test("إعلانٌ لملفٍّ آخرَ لا يُغطّي هذا الملفَّ", () => {
    const other = { ...breach("fcp", 9200), profileId: "another" };
    expect(rules(input({ declared: [other, breach("lcp", 9200)] }))).toContain("UNDECLARED_BREACH");
  });
  test("قياسٌ فوقَ السقفِ ⇒ BREACH_REGRESSED", () => {
    const i = input({ throttled: [alive(9300), alive(9400), alive(9500)] });
    expect(rules(i)).toEqual(["BREACH_REGRESSED", "BREACH_REGRESSED"]);
  });
  test("الخرقُ زالَ والإعلانُ باقٍ ⇒ DEAD_DECLARATION", () => {
    const i = input({ throttled: [alive(1500, 2000), alive(1600, 2100), alive(1700, 2200)] });
    expect(rules(i)).toEqual(["DEAD_DECLARATION", "DEAD_DECLARATION"]);
  });
  test("إعلانٌ يُحيلُ إلى قرارٍ غيرِ مُعلَنٍ ⇒ UNKNOWN_DECISION", () => {
    expect(rules(input({ knownDecisions: new Set() }))).toEqual([
      "UNKNOWN_DECISION",
      "UNKNOWN_DECISION",
    ]);
  });
  test("عندَ الحدِّ بالضبطِ ليسَ خرقاً — والإعلانُ حينَها ميّتٌ", () => {
    const i = input({ throttled: [alive(1800, 2500)], declared: [] });
    expect(rules(i)).toEqual([]);
  });
  test("لا تشغيلَ مقيَّداً ⇒ NO_RUNS لا أخضرُ", () => {
    expect(rules(input({ throttled: [] }))).toEqual(["NO_RUNS"]);
  });
  test("الحكمُ على الوسيطِ: تشغيلٌ شاذٌّ واحدٌ لا يُحرِّكُه", () => {
    const i = input({ throttled: [alive(7300), alive(7310), alive(20_000)] });
    expect(rules(i)).toEqual([]);
    expect(evaluateFirstPaint(i).medians.fcp).toBe(7310);
  });
});

describe("أدواتٌ مساعدةٌ", () => {
  test("الوسيطُ لعددٍ زوجيٍّ وفرديٍّ", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow();
  });
  test("قارئُ القراراتِ يقرأُ صفوفَ الجدولِ وحدَها لا الإحالاتِ في النصِّ", () => {
    const text =
      "| DEC-01 | سؤال | مالك | `[!]` |\nيُحيلُ إلى DEC-99 في النصِّ\n| DEC-19 | x | y | `[!]` |";
    expect([...declaredDecisionIds(text)].sort()).toEqual(["DEC-01", "DEC-19"]);
  });
});
