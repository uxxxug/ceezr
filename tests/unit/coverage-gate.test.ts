/**
 * # اختباراتُ بوابةِ التغطية — `OPS-005`
 *
 * **الغرض:** برهانُ السقوطِ لا برهانُ النجاحِ: لكلِّ قاعدةٍ في الحاجزِ حالةُ خرقٍ
 * محقونةٌ تُثبِت أنّه **يسقط**، وحالةٌ على الحدِّ تُثبِت أنّه لا يسقط بلا سببٍ.
 *
 * **ينتمي إلى:** البند `OPS-005` · القسم 11-د.
 */

import { describe, expect, test } from "bun:test";
import {
  auditCoverage,
  type CoverageAuditInput,
  type CriticalPathBar,
  parseLcov,
} from "../../scripts/lib/coverage-gate.ts";
import { COVERAGE_BARS, MIN_MEASURED_FILES } from "../../scripts/lib/coverage-registry.ts";
import { CRITICAL_PATHS } from "../../scripts/lib/skip-registry.ts";

const PATH_A = CRITICAL_PATHS[0] as string;
const PATH_B = CRITICAL_PATHS[1] as string;

function bar(overrides: Partial<CriticalPathBar> = {}): CriticalPathBar {
  return {
    criticalPath: PATH_A,
    roots: ["src/a"],
    minLineCoverage: 50,
    maxUnmeasuredFiles: 0,
    reason: null,
    owner: "فريق المنصّة",
    ...overrides,
  };
}

/** يبني مدخلاً كاملاً: كلُّ المساراتِ الحرجةِ مُبَوَّبةٌ إلّا ما يُستبدَل صراحةً. */
function input(overrides: Partial<CoverageAuditInput> = {}): CoverageAuditInput {
  const bars = CRITICAL_PATHS.map((path, index) =>
    bar({
      criticalPath: path,
      roots: [`src/p${index}`],
      minLineCoverage: null,
      maxUnmeasuredFiles: null,
      reason: null,
    }),
  );
  return {
    bars,
    criticalPaths: CRITICAL_PATHS,
    coverage: new Map(),
    sourceFiles: [],
    minMeasuredFiles: 0,
    ...overrides,
  };
}

/** مدخلٌ بمسارٍ واحدٍ مُبَوَّبٍ، وبقيّةُ المساراتِ مصروفةٌ ببيانٍ كافٍ. */
function singlePath(
  target: CriticalPathBar,
  coverage: CoverageAuditInput["coverage"],
  sourceFiles: readonly string[],
): CoverageAuditInput {
  const others = CRITICAL_PATHS.filter((path) => path !== target.criticalPath).map((path, index) =>
    bar({
      criticalPath: path,
      roots: [`src/other${index}`],
      minLineCoverage: null,
      maxUnmeasuredFiles: null,
      reason: "مسارٌ مصروفٌ في هذا الاختبارِ وحدَه، وبيانُه ههنا نصٌّ كافٍ الطولِ لاستيفاءِ القاعدةِ.",
    }),
  );
  const otherFiles = others.flatMap((entry) => [`${entry.roots[0] as string}/x.ts`]);
  return {
    bars: [target, ...others],
    criticalPaths: CRITICAL_PATHS,
    coverage,
    sourceFiles: [...sourceFiles, ...otherFiles],
    minMeasuredFiles: 0,
  };
}

describe("parseLcov: قراءةُ مخرجِ التغطية", () => {
  test("يجمع الأسطرَ القابلةَ للتنفيذِ وما نُفِّذ منها", () => {
    const parsed = parseLcov(
      ["TN:", "SF:src/a/one.ts", "DA:1,3", "DA:2,0", "DA:3,1", "end_of_record"].join("\n"),
    );
    expect(parsed.get("src/a/one.ts")).toEqual({ totalLines: 3, hitLines: 2 });
  });

  test("يدمج سجلَّينِ لملفٍّ واحدٍ بأكبرِ عددِ مرّاتٍ فلا يُحتسَب سطرٌ مرّتَين", () => {
    const parsed = parseLcov(
      [
        "SF:src/a/one.ts",
        "DA:1,0",
        "DA:2,0",
        "end_of_record",
        "SF:src/a/one.ts",
        "DA:1,5",
        "DA:2,0",
        "end_of_record",
      ].join("\n"),
    );
    expect(parsed.get("src/a/one.ts")).toEqual({ totalLines: 2, hitLines: 1 });
  });

  test("يتجاهل السطورَ المعطوبةَ ولا يرمي", () => {
    const parsed = parseLcov(["SF:src/a/one.ts", "DA:غير-رقم,1", "DA:1", "DA:2,7"].join("\n"));
    expect(parsed.get("src/a/one.ts")).toEqual({ totalLines: 1, hitLines: 1 });
  });

  test("نصٌّ فارغٌ يُعطي خريطةً فارغةً — لا نجاحاً مضمراً", () => {
    expect(parseLcov("").size).toBe(0);
  });
});

describe("auditCoverage: أرضيّةُ النسبة", () => {
  const coverage = new Map([["src/a/one.ts", { totalLines: 10, hitLines: 5 }]]);

  test("يسقط تحتَ الأرضيّةِ ويذكر الرقمَين", () => {
    const { violations } = auditCoverage(
      singlePath(bar({ minLineCoverage: 51, maxUnmeasuredFiles: 0 }), coverage, ["src/a/one.ts"]),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("50.00%");
    expect(violations[0]).toContain("51%");
  });

  test("لا يسقط على الحدِّ تماماً", () => {
    const { violations } = auditCoverage(
      singlePath(bar({ minLineCoverage: 50, maxUnmeasuredFiles: 0 }), coverage, ["src/a/one.ts"]),
    );
    expect(violations).toEqual([]);
  });

  test("أرضيّةٌ مضروبةٌ ولا سطرَ مقيساً = سقوطٌ لا تخطٍّ", () => {
    const { violations } = auditCoverage(
      singlePath(bar({ minLineCoverage: 10, maxUnmeasuredFiles: 1 }), new Map(), ["src/a/one.ts"]),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("غيابُ القياسِ ليس نجاحاً");
  });
});

describe("auditCoverage: سقفُ الملفّاتِ التي لا يُحمِّلها اختبارٌ", () => {
  test("يسقط متى علا العددُ السقفَ ويُسمّي الملفَّ", () => {
    const { violations } = auditCoverage(
      singlePath(bar({ minLineCoverage: null, maxUnmeasuredFiles: 1 }), new Map(), [
        "src/a/one.ts",
        "src/a/two.ts",
      ]),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("src/a/two.ts");
  });

  test("لا يسقط متى ساوى السقفَ", () => {
    const { violations } = auditCoverage(
      singlePath(bar({ minLineCoverage: null, maxUnmeasuredFiles: 2 }), new Map(), [
        "src/a/one.ts",
        "src/a/two.ts",
      ]),
    );
    expect(violations).toEqual([]);
  });

  test("ملفٌّ جديدٌ بلا اختبارٍ في مسارٍ حرجٍ يُسقِط البناءَ", () => {
    const measured = new Map([["src/a/one.ts", { totalLines: 4, hitLines: 4 }]]);
    const before = auditCoverage(
      singlePath(bar({ minLineCoverage: 100, maxUnmeasuredFiles: 0 }), measured, ["src/a/one.ts"]),
    );
    expect(before.violations).toEqual([]);
    const after = auditCoverage(
      singlePath(bar({ minLineCoverage: 100, maxUnmeasuredFiles: 0 }), measured, [
        "src/a/one.ts",
        "src/a/جديد.ts",
      ]),
    );
    expect(after.violations).toHaveLength(1);
  });
});

describe("auditCoverage: انغلاقُ القائمة", () => {
  test("مسارٌ حرجٌ بلا مدخلٍ = مخالفةٌ", () => {
    const base = input();
    const { violations } = auditCoverage({
      ...base,
      bars: base.bars.filter((entry) => entry.criticalPath !== PATH_B),
      sourceFiles: base.bars.map((entry) => `${entry.roots[0] as string}/x.ts`),
    });
    expect(violations.some((text) => text.includes(PATH_B))).toBe(true);
  });

  test("مسارٌ خارجَ القائمةِ المغلقة = مخالفةٌ", () => {
    const { violations } = auditCoverage({
      ...input(),
      bars: [bar({ criticalPath: "مسارٌ مُختلَقٌ", roots: ["src/a"] })],
      sourceFiles: ["src/a/one.ts"],
      coverage: new Map([["src/a/one.ts", { totalLines: 2, hitLines: 2 }]]),
    });
    expect(violations.some((text) => text.includes("خارجَ القائمةِ المغلقة"))).toBe(true);
  });

  test("مدخلانِ لمسارٍ واحدٍ = مخالفةٌ", () => {
    const first = bar({
      criticalPath: PATH_A,
      roots: ["src/a"],
      minLineCoverage: null,
      maxUnmeasuredFiles: 0,
    });
    const { violations } = auditCoverage({
      ...input(),
      bars: [first, { ...first }],
      sourceFiles: ["src/a/one.ts"],
      coverage: new Map([["src/a/one.ts", { totalLines: 1, hitLines: 1 }]]),
    });
    expect(violations.some((text) => text.includes("مكرَّرٌ"))).toBe(true);
  });

  test("بادئةٌ لا تُطابِق ملفّاً = مخالفةٌ (نُقِل الكودُ أو أُعيدَ تسميتُه)", () => {
    const { violations } = auditCoverage(
      singlePath(
        bar({ roots: ["src/غائب"], minLineCoverage: null, maxUnmeasuredFiles: 0 }),
        new Map(),
        [],
      ),
    );
    expect(violations.some((text) => text.includes("لا تُطابِق ملفَّ مصدرٍ"))).toBe(true);
  });

  test("سجلٌّ بلا بادئةٍ = مخالفةٌ", () => {
    const { violations } = auditCoverage(
      singlePath(bar({ roots: [], minLineCoverage: null, maxUnmeasuredFiles: 0 }), new Map(), []),
    );
    expect(violations.some((text) => text.includes("لا بادئةَ مصدرٍ"))).toBe(true);
  });

  test("مدخلٌ بلا مالكٍ = مخالفةٌ", () => {
    const { violations } = auditCoverage(
      singlePath(
        bar({ owner: "  ", minLineCoverage: null, maxUnmeasuredFiles: 0, roots: ["src/a"] }),
        new Map(),
        ["src/a/one.ts"],
      ),
    );
    expect(violations.some((text) => text.includes("لا مالكَ"))).toBe(true);
  });
});

describe("auditCoverage: البيانُ إلزاميٌّ حيثُ لا أرضيّةَ ومحرَّمٌ حيثُ أرضيّةٌ", () => {
  test("مسارٌ غيرُ مُبَوَّبٍ بلا بيانٍ = مخالفةٌ", () => {
    const { violations } = auditCoverage(
      singlePath(
        bar({ minLineCoverage: null, maxUnmeasuredFiles: null, reason: null }),
        new Map(),
        ["src/a/one.ts"],
      ),
    );
    expect(violations.some((text) => text.includes("بلا بيانٍ كافٍ"))).toBe(true);
  });

  test("بيانٌ قصيرٌ لا يُقبَل", () => {
    const { violations } = auditCoverage(
      singlePath(
        bar({ minLineCoverage: null, maxUnmeasuredFiles: null, reason: "قاعدةٌ ناقصةٌ" }),
        new Map(),
        ["src/a/one.ts"],
      ),
    );
    expect(violations.some((text) => text.includes("بلا بيانٍ كافٍ"))).toBe(true);
  });

  test("بيانٌ مع أرضيّةٍ مضروبةٍ = مخالفةٌ", () => {
    const { violations } = auditCoverage(
      singlePath(
        bar({
          minLineCoverage: 0,
          maxUnmeasuredFiles: 0,
          reason: "بيانٌ لا موضعَ له ههنا لأنّ الأرضيّةَ مضروبةٌ، وطولُه كافٍ لتجاوزِ الحدِّ النصّيّ.",
        }),
        new Map([["src/a/one.ts", { totalLines: 1, hitLines: 1 }]]),
        ["src/a/one.ts"],
      ),
    );
    expect(violations.some((text) => text.includes("ثوبَ العُذر"))).toBe(true);
  });
});

describe("auditCoverage: حرزُ القياسِ الناقص", () => {
  test("مخرجُ تغطيةٍ أصغرُ من الحدِّ = سقوطٌ", () => {
    const base = input();
    const { violations } = auditCoverage({
      ...base,
      minMeasuredFiles: 5,
      coverage: new Map([["src/p0/x.ts", { totalLines: 1, hitLines: 1 }]]),
      sourceFiles: base.bars.map((entry) => `${entry.roots[0] as string}/x.ts`),
      bars: base.bars.map((entry) => ({
        ...entry,
        reason: "مصروفٌ في هذا الاختبارِ وحدَه، والبيانُ ههنا نصٌّ كافٍ الطولِ لاستيفاءِ القاعدةِ.",
      })),
    });
    expect(violations.some((text) => text.includes("القياسُ ناقصٌ"))).toBe(true);
  });
});

describe("السجلُّ الحقيقيُّ: انسجامُه مع القائمةِ المغلقة", () => {
  test("لكلِّ مسارٍ حرجٍ مدخلٌ واحدٌ لا أكثرَ", () => {
    const paths = COVERAGE_BARS.map((entry) => entry.criticalPath);
    expect(new Set(paths).size).toBe(paths.length);
    expect([...paths].sort()).toEqual([...CRITICAL_PATHS].sort());
  });

  test("كلُّ أرضيّةٍ عددٌ صحيحٌ في [0,100] وكلُّ سقفٍ عددٌ غيرُ سالبٍ", () => {
    for (const entry of COVERAGE_BARS) {
      if (entry.minLineCoverage !== null) {
        expect(Number.isInteger(entry.minLineCoverage)).toBe(true);
        expect(entry.minLineCoverage).toBeGreaterThanOrEqual(0);
        expect(entry.minLineCoverage).toBeLessThanOrEqual(100);
      }
      if (entry.maxUnmeasuredFiles !== null) {
        expect(Number.isInteger(entry.maxUnmeasuredFiles)).toBe(true);
        expect(entry.maxUnmeasuredFiles).toBeGreaterThanOrEqual(0);
      }
      expect(entry.roots.length).toBeGreaterThan(0);
      expect(new Set(entry.roots).size).toBe(entry.roots.length);
    }
  });

  test("حدُّ القياسِ الناقصِ موجبٌ ودونَ ما قِيسَ يومَ التصنيف", () => {
    expect(MIN_MEASURED_FILES).toBeGreaterThan(0);
    expect(MIN_MEASURED_FILES).toBeLessThanOrEqual(381);
  });
});
