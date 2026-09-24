/**
 * اختباراتُ حَكَمِ زمنِ بلوغِ سطحِ الراكبِ المرسومِ على «3G» (حارسُ انحدارٍ · DEC-19؛ وكانَ «وقتَ التفاعلِ» قبلَه) — سوالبُ مزروعةٌ بلا متصفّحٍ.
 * الحالة: اختبارٌ وحدويٌّ — `ح-7`.
 */

import { describe, expect, it } from "bun:test";
import {
  DECLARED_SURFACE_RENDERED_BREACHES,
  declaredDecisionIds,
  evaluateInteractive,
  type InteractiveRun,
  interactiveLivenessProblems,
  median,
} from "../../scripts/lib/interactive-budget.ts";

const VALID_DECISIONS = new Set(["DEC-19"]);

function goodRun(surfaceRenderedMs: number): InteractiveRun {
  return {
    surfaceRenderedMs,
    fcpMs: 100,
    rootChildCount: 3,
    failedSameOriginRequests: [],
    uncaughtExceptions: [],
    interactiveMarked: true,
    surface: "rider",
    timingEntryCount: 1,
    timingInBusyTree: false,
  };
}

function deadRun(): InteractiveRun {
  return {
    surfaceRenderedMs: null,
    fcpMs: null,
    rootChildCount: 0,
    failedSameOriginRequests: [],
    uncaughtExceptions: [],
    interactiveMarked: false,
    surface: null,
    timingEntryCount: 0,
    timingInBusyTree: false,
  };
}

describe("حَكَمُ وقتِ التفاعلِ", () => {
  describe("شرطُ الحياةِ", () => {
    it("شاشةٌ بيضاءُ ⇒ NO_PAINT + EMPTY_ROOT + NO_INTERACTIVE", () => {
      const problems = interactiveLivenessProblems(deadRun(), "بلا تقييدٍ");
      const rules = problems.map((p) => p.rule);
      expect(rules).toContain("NO_PAINT");
      expect(rules).toContain("EMPTY_ROOT");
      expect(rules).toContain("NO_INTERACTIVE");
    });

    it("طلبٌ أخفقَ ⇒ FAILED_REQUEST", () => {
      const run: InteractiveRun = { ...goodRun(1000), failedSameOriginRequests: ["404 /v1/me"] };
      const problems = interactiveLivenessProblems(run, "test");
      expect(problems.some((p) => p.rule === "FAILED_REQUEST")).toBe(true);
    });

    it("استثناءٌ غيرُ ممسوكٍ ⇒ UNCAUGHT_EXCEPTION", () => {
      const run: InteractiveRun = { ...goodRun(1000), uncaughtExceptions: ["TypeError"] };
      const problems = interactiveLivenessProblems(run, "test");
      expect(problems.some((p) => p.rule === "UNCAUGHT_EXCEPTION")).toBe(true);
    });

    it("العلامةُ لم تظهر ⇒ NO_INTERACTIVE", () => {
      const run: InteractiveRun = {
        ...goodRun(1000),
        interactiveMarked: false,
        surfaceRenderedMs: null,
        surface: null,
      };
      const problems = interactiveLivenessProblems(run, "test");
      expect(problems.some((p) => p.rule === "NO_INTERACTIVE")).toBe(true);
    });

    it("لا سطحَ منتج ⇒ NO_SURFACE", () => {
      const run: InteractiveRun = { ...goodRun(1000), surface: null };
      const problems = interactiveLivenessProblems(run, "test");
      expect(problems.some((p) => p.rule === "NO_SURFACE")).toBe(true);
    });

    it("علامةٌ تفاعليّةٌ بلا سطحٍ ⇒ INTERACTIVE_WITHOUT_SURFACE (إيجابٌ كاذب)", () => {
      // هذا مسارُ الإيجابِ الكاذبِ الذي أصلحَهُ التصحيحُ: العلامةُ كانت تُطلَقُ على
      // شاشةٍ نظاميّةٍ (unregistered) فيُعَدُّ التطبيقُ تفاعليّاً بلا سطحٍ منتج.
      const run: InteractiveRun = {
        surfaceRenderedMs: 1000,
        fcpMs: 100,
        rootChildCount: 3,
        failedSameOriginRequests: [],
        uncaughtExceptions: [],
        interactiveMarked: true,
        surface: null,
        timingEntryCount: 1,
        timingInBusyTree: false,
      };
      const problems = interactiveLivenessProblems(run, "test");
      expect(problems.some((p) => p.rule === "INTERACTIVE_WITHOUT_SURFACE")).toBe(true);
      expect(problems.some((p) => p.rule === "NO_SURFACE")).toBe(true);
    });

    it("شاشةٌ بيضاءُ ⇒ NO_SURFACE أيضاً", () => {
      const problems = interactiveLivenessProblems(deadRun(), "بلا تقييدٍ");
      expect(problems.some((p) => p.rule === "NO_SURFACE")).toBe(true);
    });
  });

  describe("الحكمُ على الوسيطِ", () => {
    it("لا تشغيلَ مقيَّداً ⇒ NO_RUNS", () => {
      const verdict = evaluateInteractive({
        unthrottled: goodRun(100),
        profileId: "test",
        throttled: [],
        declared: [],
        knownDecisions: VALID_DECISIONS,
      });
      expect(verdict.problems.some((p) => p.rule === "NO_RUNS")).toBe(true);
    });

    it("ضمنَ الحدِّ بلا إعلانٍ ⇒ لا مشكلة", () => {
      const verdict = evaluateInteractive({
        unthrottled: goodRun(100),
        profileId: "test",
        throttled: [goodRun(1500), goodRun(1600), goodRun(1400)],
        declared: [],
        knownDecisions: VALID_DECISIONS,
      });
      expect(verdict.problems).toHaveLength(0);
      expect(verdict.medianSurfaceRenderedMs).toBe(1500);
    });

    it("فوقَ الحدِّ بلا إعلانٍ ⇒ UNDECLARED_BREACH", () => {
      const verdict = evaluateInteractive({
        unthrottled: goodRun(100),
        profileId: "test",
        throttled: [goodRun(3000), goodRun(3100), goodRun(2900)],
        declared: [],
        knownDecisions: VALID_DECISIONS,
      });
      expect(verdict.problems.some((p) => p.rule === "UNDECLARED_BREACH")).toBe(true);
    });

    it("فوقَ الحدِّ ضمنَ السقفِ المُعلَنِ ⇒ لا مشكلة", () => {
      const verdict = evaluateInteractive({
        unthrottled: goodRun(100),
        profileId: "test",
        throttled: [goodRun(8000), goodRun(9000), goodRun(7000)],
        declared: DECLARED_SURFACE_RENDERED_BREACHES,
        knownDecisions: VALID_DECISIONS,
      });
      expect(verdict.problems).toHaveLength(0);
      expect(verdict.medianSurfaceRenderedMs).toBe(8000);
    });

    it("فوقَ السقفِ المُعلَنِ ⇒ BREACH_REGRESSED", () => {
      const verdict = evaluateInteractive({
        unthrottled: goodRun(100),
        profileId: "test",
        throttled: [goodRun(19000), goodRun(20000), goodRun(18000)],
        declared: DECLARED_SURFACE_RENDERED_BREACHES,
        knownDecisions: VALID_DECISIONS,
      });
      expect(verdict.problems.some((p) => p.rule === "BREACH_REGRESSED")).toBe(true);
    });

    it("ضمنَ الحدِّ معَ إعلانٍ ⇒ DEAD_DECLARATION", () => {
      const verdict = evaluateInteractive({
        unthrottled: goodRun(100),
        profileId: "test",
        throttled: [goodRun(1500), goodRun(1600), goodRun(1400)],
        declared: DECLARED_SURFACE_RENDERED_BREACHES,
        knownDecisions: VALID_DECISIONS,
      });
      expect(verdict.problems.some((p) => p.rule === "DEAD_DECLARATION")).toBe(true);
    });

    it("قرارٌ غيرُ مُعلَنٍ ⇒ UNKNOWN_DECISION", () => {
      const verdict = evaluateInteractive({
        unthrottled: goodRun(100),
        profileId: "test",
        throttled: [goodRun(8000), goodRun(9000), goodRun(7000)],
        declared: DECLARED_SURFACE_RENDERED_BREACHES,
        knownDecisions: new Set<string>(),
      });
      expect(verdict.problems.some((p) => p.rule === "UNKNOWN_DECISION")).toBe(true);
    });

    it("تشغيلٌ شاذٌّ واحدٌ لا يُحرِّكُ الحكمَ", () => {
      const verdict = evaluateInteractive({
        unthrottled: goodRun(100),
        profileId: "test",
        throttled: [goodRun(14000), goodRun(19000), goodRun(14000)],
        declared: DECLARED_SURFACE_RENDERED_BREACHES,
        knownDecisions: VALID_DECISIONS,
      });
      // الوسيطُ 14000 — ضمنَ السقفِ.
      expect(verdict.problems).toHaveLength(0);
    });
  });

  describe("أدواتٌ مساعدةٌ", () => {
    it("الوسيطُ لعددٍ زوجيٍّ وفرديٍّ", () => {
      expect(median([1, 3, 5])).toBe(3);
      expect(median([1, 3, 5, 7])).toBe(4);
    });

    it("قارئُ القراراتِ يقرأُ صفوفَ الجدولِ", () => {
      const text = "| DEC-19 | وصفٌ | مالكٌ | [!] |\n| DEC-20 | آخر | مالكٌ | [ ] |";
      const ids = declaredDecisionIds(text);
      expect(ids.has("DEC-19")).toBe(true);
      expect(ids.has("DEC-20")).toBe(true);
    });
  });
});

describe("DEC-19 — قاعدتا المقياسِ المحكومِ (سوالبُ مزروعةٌ)", () => {
  it("FCP وصلَ بلا عنصرِ الراكبِ ⇒ NO_SURFACE_RENDERED (ولو كانَ كلُّ ما سواه سليماً)", () => {
    const run: InteractiveRun = {
      ...goodRun(1000),
      fcpMs: 400,
      surfaceRenderedMs: null,
      timingEntryCount: 0,
    };
    const rules = interactiveLivenessProblems(run, "test").map((p) => p.rule);
    expect(rules).toEqual(["NO_SURFACE_RENDERED"]);
  });

  it("العنصرُ موجودٌ مرّةً واحدةً على سطحِ الراكبِ ⇒ لا مشكلةَ", () => {
    expect(interactiveLivenessProblems(goodRun(1000), "test")).toEqual([]);
  });

  it("عنصرُ القياسِ على سطحٍ غيرِ الراكبِ ⇒ RENDERED_WITHOUT_RIDER", () => {
    const rules = interactiveLivenessProblems({ ...goodRun(1000), surface: "driver" }, "t").map(
      (p) => p.rule,
    );
    expect(rules).toContain("RENDERED_WITHOUT_RIDER");
  });

  it("عنصرُ القياسِ بلا سطحٍ ⇒ RENDERED_WITHOUT_RIDER", () => {
    const rules = interactiveLivenessProblems({ ...goodRun(1000), surface: null }, "t").map(
      (p) => p.rule,
    );
    expect(rules).toContain("RENDERED_WITHOUT_RIDER");
  });

  it("مُدخَلانِ بالمعرّفِ ⇒ DUPLICATE_TIMING_ENTRY", () => {
    const rules = interactiveLivenessProblems({ ...goodRun(1000), timingEntryCount: 2 }, "t").map(
      (p) => p.rule,
    );
    expect(rules).toContain("DUPLICATE_TIMING_ENTRY");
  });

  it("العنصرُ داخلَ حالةِ تحميلٍ ⇒ TIMING_IN_LOADING", () => {
    const rules = interactiveLivenessProblems(
      { ...goodRun(1000), timingInBusyTree: true },
      "t",
    ).map((p) => p.rule);
    expect(rules).toContain("TIMING_IN_LOADING");
  });

  it("سطحٌ بلا علامةِ بلوغِ السطحِ المرسومِ ⇒ NO_SURFACE_RENDERED", () => {
    const run: InteractiveRun = { ...goodRun(1000), surfaceRenderedMs: null };
    const rules = interactiveLivenessProblems(run, "test").map((p) => p.rule);
    expect(rules).toContain("NO_SURFACE_RENDERED");
  });

  it("علامةٌ قبلَ أوّلِ رسمٍ ⇒ RENDERED_BEFORE_PAINT", () => {
    const run: InteractiveRun = { ...goodRun(90), fcpMs: 100 };
    const rules = interactiveLivenessProblems(run, "test").map((p) => p.rule);
    expect(rules).toContain("RENDERED_BEFORE_PAINT");
  });

  it("علامةٌ بعدَ أوّلِ رسمٍ أو معَه ⇒ لا مشكلةَ من القاعدتَينِ", () => {
    const rules = [
      ...interactiveLivenessProblems({ ...goodRun(100), fcpMs: 100 }, "a"),
      ...interactiveLivenessProblems(goodRun(4134), "b"),
    ].map((p) => p.rule);
    expect(rules).not.toContain("RENDERED_BEFORE_PAINT");
    expect(rules).not.toContain("NO_SURFACE_RENDERED");
  });

  it("المقياسُ باسمِه لا «tti»", () => {
    expect(DECLARED_SURFACE_RENDERED_BREACHES.every((b) => b.metric === "surface-rendered")).toBe(
      true,
    );
  });
});
