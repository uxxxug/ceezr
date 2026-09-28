/**
 * حَكَمُ خطةِ الحملِ الموزَّعِ — `F9-03` · `OPS-004`.
 *
 * كلُّ قاعدةٍ من قواعدِ الحَكَمِ الستِّ لها سالبةٌ مزروعةٌ (`ح-7`): اختبارٌ
 * يفسدُ عمداً المدخلَ الذي تحكمُ عليهِ القاعدةُ ويرفضُ البنيةَ إذا لم تسقطْ.
 * فالحَكَمُ الذي لا يرى الإخفاقَ ليسَ حَكَماً — والتقريرُ الأخضرُ من مقياسٍ
 * أعمى لا قيمةَ له.
 */

import { describe, expect, it } from "bun:test";
import {
  computeDistributedLoadFingerprint,
  type DistributedLoadPlan,
  decideDistributedLoadVerdict,
  type GeneratorReport,
  partitionForGenerator,
} from "../../scripts/lib/bench-distributed-plan.ts";

const PLAN: DistributedLoadPlan = {
  target: "http://127.0.0.1:4301/health",
  method: "GET",
  arrivalRatePerSecond: 30,
  durationMs: 3_000,
  generators: 3,
  schedulingLagBudgetP95Ms: 250,
};

const FINGERPRINT = computeDistributedLoadFingerprint(PLAN);

function reportOf(index: number, overrides: Partial<GeneratorReport> = {}): GeneratorReport {
  const partition = partitionForGenerator(PLAN, index);
  return {
    generatorId: `gen-${index + 1}`,
    index,
    fingerprint: FINGERPRINT,
    scheduled: partition.scheduledCount,
    launched: partition.scheduledCount,
    failed: 0,
    schedulingLagP95Ms: 3,
    ...overrides,
  };
}

function ruleNamed(verdict: ReturnType<typeof decideDistributedLoadVerdict>, rule: string) {
  const found = verdict.rules.find((entry) => entry.rule === rule);
  if (found === undefined) throw new Error(`قاعدةٌ مجهولةٌ في الحَكَمِ: ${rule}`);
  return found;
}

describe("تقسيمُ الخطةِ حتميٌّ", () => {
  it("الخطةُ والفهرسُ نفسُهما يُنتجانِ الحصةَ نفسَها", () => {
    expect(partitionForGenerator(PLAN, 1)).toEqual(partitionForGenerator(PLAN, 1));
  });

  it("مجموعُ حصصِ المولّداتِ يساوي الحملَ المُعلَنَ لا يُفلِّتُ منهُ شيئاً", () => {
    const total = Array.from({ length: PLAN.generators }, (_unused, index) =>
      partitionForGenerator(PLAN, index),
    ).reduce((sum, partition) => sum + partition.arrivalRatePerSecond, 0);
    expect(total).toBe(Math.round(PLAN.arrivalRatePerSecond));
  });

  it("الفهرسُ خارجَ النطاقِ مرفوضٌ لا مُتسامَحٌ معهُ", () => {
    expect(() => partitionForGenerator(PLAN, -1)).toThrow();
    expect(() => partitionForGenerator(PLAN, PLAN.generators)).toThrow();
  });

  it("الباقيُ غيرُ القابلِ للقسمةِ يوزَّعُ على الأوائلِ بالترتيبِ حتميّاً", () => {
    const uneven: DistributedLoadPlan = { ...PLAN, arrivalRatePerSecond: 10, generators: 3 };
    const rates = [0, 1, 2].map(
      (index) => partitionForGenerator(uneven, index).arrivalRatePerSecond,
    );
    expect(rates).toEqual([4, 3, 3]);
  });
});

describe("بصمةُ الخطةِ", () => {
  it("مستقرةٌ على المدخلاتِ نفسِها", () => {
    expect(computeDistributedLoadFingerprint(PLAN)).toBe(FINGERPRINT);
  });

  it("كلُّ عنصرٍ من الخطةِ داخلَ البصمةِ — تغييرُهُ يُغيِّرُها", () => {
    const mutations: DistributedLoadPlan[] = [
      { ...PLAN, target: "http://127.0.0.1:4302/health" },
      { ...PLAN, method: "POST" },
      { ...PLAN, arrivalRatePerSecond: 31 },
      { ...PLAN, durationMs: 3_001 },
      { ...PLAN, generators: 4 },
      { ...PLAN, schedulingLagBudgetP95Ms: 251 },
    ];
    for (const mutation of mutations) {
      expect(computeDistributedLoadFingerprint(mutation)).not.toBe(FINGERPRINT);
    }
  });

  it("الخطةُ الفاسدةُ مرفوضةٌ عندَ البصمةِ لا بعدَها", () => {
    expect(() => computeDistributedLoadFingerprint({ ...PLAN, arrivalRatePerSecond: 0 })).toThrow();
    expect(() => computeDistributedLoadFingerprint({ ...PLAN, generators: 0 })).toThrow();
  });
});

describe("حَكَمُ الجولةِ — ستُّ قواعدَ وسالباتُها المزروعةُ", () => {
  it("جولةٌ مكتملةٌ صادقةٌ تنجحُ بقواعدِها الستِّ كلِّها", () => {
    const verdict = decideDistributedLoadVerdict(PLAN, [reportOf(0), reportOf(1), reportOf(2)]);
    expect(verdict.passed).toBe(true);
    expect(verdict.rules).toHaveLength(6);
    for (const rule of verdict.rules) expect(rule.passed).toBe(true);
  });

  it("سالبةٌ: مولّدٌ غابَ فجولةٌ ناقصةٌ تُفشِلُ بقاعدةِ البلاغِ — لا خسارةَ صامتةَ", () => {
    const verdict = decideDistributedLoadVerdict(PLAN, [reportOf(0), reportOf(1)]);
    expect(verdict.passed).toBe(false);
    expect(ruleNamed(verdict, "all-generators-reported").passed).toBe(false);
  });

  it("سالبةٌ: تقريرٌ ببصمةٍ أجنبيّةٍ يُرفَضُ — جولةٌ أخرى لا تُخلطُ بهذه", () => {
    const verdict = decideDistributedLoadVerdict(PLAN, [
      reportOf(0),
      reportOf(1),
      reportOf(2, { fingerprint: "deadbeefdeadbeef" }),
    ]);
    expect(verdict.passed).toBe(false);
    expect(ruleNamed(verdict, "fingerprint-agreement").passed).toBe(false);
  });

  it("سالبةٌ: مولّدٌ أعلنَ عدداً غيرَ حصتِهِ يُفشِلُ سلامةَ التقسيمِ", () => {
    const verdict = decideDistributedLoadVerdict(PLAN, [
      reportOf(0),
      reportOf(1),
      reportOf(2, { scheduled: reportOf(2).scheduled + 5 }),
    ]);
    expect(verdict.passed).toBe(false);
    expect(ruleNamed(verdict, "partition-integrity").passed).toBe(false);
  });

  it("سالبةٌ: مولّدٌ أطلقَ أقلَّ مما جدَّلَهُ أخلَّ بقانونِ الحلقةِ المفتوحةِ", () => {
    const verdict = decideDistributedLoadVerdict(PLAN, [
      reportOf(0),
      reportOf(1),
      reportOf(2, { launched: reportOf(2).scheduled - 1 }),
    ]);
    expect(verdict.passed).toBe(false);
    expect(ruleNamed(verdict, "schedule-honored").passed).toBe(false);
  });

  it("سالبةٌ: خطأُ نقلٍ واحدٌ يُبطلُ الجولةَ كلَّها", () => {
    const verdict = decideDistributedLoadVerdict(PLAN, [
      reportOf(0),
      reportOf(1),
      reportOf(2, { failed: 1 }),
    ]);
    expect(verdict.passed).toBe(false);
    expect(ruleNamed(verdict, "no-transport-errors").passed).toBe(false);
  });

  it("سالبةٌ: انزلاقُ جدولةٍ فوقَ السقفِ المُعلَّنِ يُفشِلُ الجولةَ", () => {
    const verdict = decideDistributedLoadVerdict(PLAN, [
      reportOf(0),
      reportOf(1),
      reportOf(2, { schedulingLagP95Ms: PLAN.schedulingLagBudgetP95Ms + 1 }),
    ]);
    expect(verdict.passed).toBe(false);
    expect(ruleNamed(verdict, "scheduling-lag-bounded").passed).toBe(false);
  });

  it("تقريرٌ بفهرسٍ مكرَّرٍ لا يُحتسَبَ اثنينِ — الأولُ يبقى والغائبُ يُفشِلُ", () => {
    const verdict = decideDistributedLoadVerdict(PLAN, [reportOf(0), reportOf(1), reportOf(1)]);
    expect(verdict.passed).toBe(false);
    expect(ruleNamed(verdict, "all-generators-reported").passed).toBe(false);
  });
});
