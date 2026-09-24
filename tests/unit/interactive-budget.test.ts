/**
 * اختباراتُ حَكَمِ وقتِ التفاعلِ — سوالبُ مزروعةٌ بلا متصفّحٍ.
 * الحالة: اختبارٌ وحدويٌّ — `ح-7`.
 */

import { describe, expect, it } from "bun:test";
import {
  DECLARED_TTI_BREACHES,
  declaredDecisionIds,
  evaluateInteractive,
  type InteractiveRun,
  interactiveLivenessProblems,
  median,
} from "../../scripts/lib/interactive-budget.ts";

const VALID_DECISIONS = new Set(["DEC-19"]);

function goodRun(ttiMs: number): InteractiveRun {
  return {
    ttiMs,
    fcpMs: 100,
    rootChildCount: 3,
    failedSameOriginRequests: [],
    uncaughtExceptions: [],
    interactiveMarked: true,
  };
}

function deadRun(): InteractiveRun {
  return {
    ttiMs: null,
    fcpMs: null,
    rootChildCount: 0,
    failedSameOriginRequests: [],
    uncaughtExceptions: [],
    interactiveMarked: false,
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
      const run: InteractiveRun = { ...goodRun(1000), interactiveMarked: false, ttiMs: null };
      const problems = interactiveLivenessProblems(run, "test");
      expect(problems.some((p) => p.rule === "NO_INTERACTIVE")).toBe(true);
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
      expect(verdict.medianTtiMs).toBe(1500);
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
        declared: DECLARED_TTI_BREACHES,
        knownDecisions: VALID_DECISIONS,
      });
      expect(verdict.problems).toHaveLength(0);
      expect(verdict.medianTtiMs).toBe(8000);
    });

    it("فوقَ السقفِ المُعلَنِ ⇒ BREACH_REGRESSED", () => {
      const verdict = evaluateInteractive({
        unthrottled: goodRun(100),
        profileId: "test",
        throttled: [goodRun(13000), goodRun(14000), goodRun(12000)],
        declared: DECLARED_TTI_BREACHES,
        knownDecisions: VALID_DECISIONS,
      });
      expect(verdict.problems.some((p) => p.rule === "BREACH_REGRESSED")).toBe(true);
    });

    it("ضمنَ الحدِّ معَ إعلانٍ ⇒ DEAD_DECLARATION", () => {
      const verdict = evaluateInteractive({
        unthrottled: goodRun(100),
        profileId: "test",
        throttled: [goodRun(1500), goodRun(1600), goodRun(1400)],
        declared: DECLARED_TTI_BREACHES,
        knownDecisions: VALID_DECISIONS,
      });
      expect(verdict.problems.some((p) => p.rule === "DEAD_DECLARATION")).toBe(true);
    });

    it("قرارٌ غيرُ مُعلَنٍ ⇒ UNKNOWN_DECISION", () => {
      const verdict = evaluateInteractive({
        unthrottled: goodRun(100),
        profileId: "test",
        throttled: [goodRun(8000), goodRun(9000), goodRun(7000)],
        declared: DECLARED_TTI_BREACHES,
        knownDecisions: new Set<string>(),
      });
      expect(verdict.problems.some((p) => p.rule === "UNKNOWN_DECISION")).toBe(true);
    });

    it("تشغيلٌ شاذٌّ واحدٌ لا يُحرِّكُ الحكمَ", () => {
      const verdict = evaluateInteractive({
        unthrottled: goodRun(100),
        profileId: "test",
        throttled: [goodRun(8000), goodRun(13000), goodRun(8000)],
        declared: DECLARED_TTI_BREACHES,
        knownDecisions: VALID_DECISIONS,
      });
      // الوسيطُ 8000 — ضمنَ السقفِ.
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
