/**
 * اختباراتُ حَكَمِ سطحِ الراكبِ على «Slow 4G» (`DEC-19` · `ADR 0185`) — سالبٌ مزروعٌ لكلِّ قاعدةٍ (`ح-7`).
 */

import { describe, expect, it } from "bun:test";
import {
  evaluateRiderSurface,
  RIDER_SURFACE_LIMITS,
  type RiderSurfaceRun,
  SLOW_4G,
  SLOW_4G_GATE_MODE,
} from "../../scripts/lib/rider-surface-budget.ts";

function run(fcp: number, lcp: number, rendered: number): RiderSurfaceRun {
  return {
    fcpMs: fcp,
    lcpMs: lcp,
    surfaceRenderedMs: rendered,
    rootChildCount: 1,
    failedSameOriginRequests: [],
    uncaughtExceptions: [],
    interactiveMarked: true,
    surface: "rider",
    timingEntryCount: 1,
    timingInBusyTree: false,
  };
}
/** أرقامُ القرارِ على CI (35972593440) — فوقَ الحدودِ. */
const AT_DECISION = [run(4148, 4748, 4150), run(4172, 4772, 4176), run(4156, 4756, 4160)];
const WITHIN = [run(1500, 2200, 1700), run(1510, 2210, 1710), run(1490, 2190, 1690)];
const P = SLOW_4G.id;
const ONE = run(4156, 4756, 4160);

describe("الملفُّ والحدودُ منقولةٌ حرفاً", () => {
  it("Slow4GConditions: 562.5 ms · 180,000 B/s · 84,375 B/s · CPU ×4", () => {
    expect(SLOW_4G.latencyMs).toBe(562.5);
    expect(SLOW_4G.downloadBytesPerSecond).toBe(180_000);
    expect(SLOW_4G.uploadBytesPerSecond).toBe(84_375);
    expect(SLOW_4G.cpuSlowdown).toBe(4);
  });
  it("الحدودُ لا تُخفَّضُ: 1.8 / 2.5 / 2.0 s", () => {
    expect(RIDER_SURFACE_LIMITS).toEqual({ fcpMs: 1800, lcpMs: 2500, surfaceRenderedMs: 2000 });
  });
  // زيادةٌ 2026-09-25 (`D-34` · DEC-19): استُوفيَت الحدودُ الثلاثةُ في CI (`READY_TO_BLOCK` · run 36075503975)
  // فحُوِّلَ الوضعُ كما يفرضُ `ADR 0185` بموافقةِ المالكِ الصريحةِ (2026-09-25). وعودتُه إلى التقريرِ تُسقِطُ هذا الاختبارَ لا تمرُّ صامتةً.
  it("الوضعُ على main حاجزٌ بعدَ استيفاءِ الحدودِ (DEC-19)", () => {
    expect(SLOW_4G_GATE_MODE).toBe("blocking");
  });
});

describe("وضعُ التقريرِ", () => {
  it("فوقَ الحدودِ ⇒ لا مشكلةَ حاجزةً، والأرقامُ غيرُ مستوفاةٍ", () => {
    const v = evaluateRiderSurface({ runs: AT_DECISION, mode: "report-only", profileId: P });
    expect(v.problems).toEqual([]);
    expect(v.allMet).toBe(false);
    expect(v.metrics.map((m) => [m.metric, m.medianMs, m.met])).toEqual([
      ["fcp", 4156, false],
      ["lcp", 4756, false],
      ["surface-rendered", 4160, false],
    ]);
  });
  it("ضمنَ الحدودِ والوضعُ تقريرٌ ⇒ READY_TO_BLOCK (التحوُّلُ مفروضٌ)", () => {
    const v = evaluateRiderSurface({ runs: WITHIN, mode: "report-only", profileId: P });
    expect(v.allMet).toBe(true);
    expect(v.problems.map((p) => p.rule)).toEqual(["READY_TO_BLOCK"]);
  });
  it("حدٌّ واحدٌ غيرُ مستوفىً ⇒ لا READY_TO_BLOCK", () => {
    const runs = WITHIN.map((r) => ({ ...r, lcpMs: 2600 }));
    const v = evaluateRiderSurface({ runs, mode: "report-only", profileId: P });
    expect(v.allMet).toBe(false);
    expect(v.problems).toEqual([]);
  });
});

describe("وضعُ الحاجزِ", () => {
  it("فوقَ الحدودِ ⇒ LIMIT_NOT_MET لكلِّ مقياسٍ", () => {
    const v = evaluateRiderSurface({ runs: AT_DECISION, mode: "blocking", profileId: P });
    expect(v.problems.map((p) => p.rule)).toEqual([
      "LIMIT_NOT_MET",
      "LIMIT_NOT_MET",
      "LIMIT_NOT_MET",
    ]);
  });
  it("ضمنَ الحدودِ ⇒ لا مشكلةَ", () => {
    expect(evaluateRiderSurface({ runs: WITHIN, mode: "blocking", profileId: P }).problems).toEqual(
      [],
    );
  });
  it("عندَ الحدِّ بالضبطِ مستوفىً", () => {
    const v = evaluateRiderSurface({
      runs: [run(1800, 2500, 2000)],
      mode: "blocking",
      profileId: P,
    });
    expect(v.problems).toEqual([]);
  });
});

describe("شرطُ الحياةِ وصحّةُ القياسِ — حاجزٌ في الوضعَينِ", () => {
  for (const mode of ["report-only", "blocking"] as const) {
    it(`${mode}: شاشةٌ بيضاءُ ⇒ EMPTY_ROOT`, () => {
      const runs = [{ ...ONE, rootChildCount: 0 }];
      expect(
        evaluateRiderSurface({ runs, mode, profileId: P }).problems.map((p) => p.rule),
      ).toContain("EMPTY_ROOT");
    });
    it(`${mode}: طلبٌ أخفقَ ⇒ FAILED_REQUEST`, () => {
      const runs = [{ ...ONE, failedSameOriginRequests: ["500 /v1/me"] }];
      expect(
        evaluateRiderSurface({ runs, mode, profileId: P }).problems.map((p) => p.rule),
      ).toContain("FAILED_REQUEST");
    });
    it(`${mode}: استثناءٌ غيرُ ممسوكٍ ⇒ UNCAUGHT_EXCEPTION`, () => {
      const runs = [{ ...ONE, uncaughtExceptions: ["TypeError"] }];
      expect(
        evaluateRiderSurface({ runs, mode, profileId: P }).problems.map((p) => p.rule),
      ).toContain("UNCAUGHT_EXCEPTION");
    });
  }
  it("سطحُ سائقٍ لا راكبٍ ⇒ WRONG_SURFACE", () => {
    const runs = [{ ...ONE, surface: "driver" as const }];
    expect(
      evaluateRiderSurface({ runs, mode: "report-only", profileId: P }).problems.map((p) => p.rule),
    ).toContain("WRONG_SURFACE");
  });
  it("لا LCP ⇒ NO_LCP", () => {
    const runs = [{ ...ONE, lcpMs: null }];
    expect(
      evaluateRiderSurface({ runs, mode: "report-only", profileId: P }).problems.map((p) => p.rule),
    ).toContain("NO_LCP");
  });
  it("لا علامةَ بلوغِ السطحِ المرسومِ ⇒ NO_SURFACE_RENDERED", () => {
    const runs = [{ ...ONE, surfaceRenderedMs: null }];
    expect(
      evaluateRiderSurface({ runs, mode: "report-only", profileId: P }).problems.map((p) => p.rule),
    ).toContain("NO_SURFACE_RENDERED");
  });
  it("لا تشغيلَ ⇒ NO_RUNS", () => {
    expect(
      evaluateRiderSurface({ runs: [], mode: "report-only", profileId: P }).problems.map(
        (p) => p.rule,
      ),
    ).toEqual(["NO_RUNS"]);
  });
});
