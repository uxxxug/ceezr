/**
 * الغرض: قياسُ **سقوطِ** حاجزِ ميزانِ التوثيقِ بخرقٍ مزروعٍ لا بالمستودَعِ كما هوَ.
 *   فحاجزٌ أخضرُ على الحاضرِ لا يُثبتُ أنَّه يحمرُّ حينَ يلزمُ.
 * الحالة: منفّذ فعلياً — `S-4` · `ADR 0097`.
 * ينتمي إلى: tests/unit.
 */

import { describe, expect, test } from "bun:test";
import { defaultInputs } from "../../scripts/check-docs-budget.ts";
import {
  type DocsBudgetInputs,
  docsBudgetProblems,
  isRawOutput,
  LEDGER_PATHS,
  MAX_DOCS_TO_SOURCE_RATIO,
  NEW_DOC_LINE_CAP,
  ratchetBaseline,
} from "../../scripts/lib/docs-budget.ts";

function inputsOf(overrides: Partial<DocsBudgetInputs>): DocsBudgetInputs {
  return {
    docs: [{ path: "docs/short.md", lines: 10 }],
    sourceLines: 1000,
    baseline: {},
    ...overrides,
  };
}

const rules = (inputs: DocsBudgetInputs): readonly string[] =>
  docsBudgetProblems(inputs).map((problem) => problem.rule);

describe("ميزانُ التوثيقِ — الحاجزُ أخضرُ على المستودعِ كما هوَ", () => {
  test("لا مخالفةَ واحدةً في المُدخلِ الحقيقيِّ الكاملِ", () => {
    expect(docsBudgetProblems(defaultInputs())).toEqual([]);
  });

  test("المُدخلُ الحقيقيُّ يقرأُ شجرةً غيرَ فارغةٍ — وإلّا فالأخضرُ كاذبٌ", () => {
    const inputs = defaultInputs();
    expect(inputs.docs.length).toBeGreaterThan(200);
    expect(inputs.sourceLines).toBeGreaterThan(50_000);
    expect(Object.keys(inputs.baseline).length).toBeGreaterThan(20);
  });

  test("كلُّ مفتاحٍ في خطِّ الأساسِ موجودٌ فعلاً وعددُه لا يقلُّ عن الحاضرِ", () => {
    const inputs = defaultInputs();
    const actual = new Map(inputs.docs.map((doc) => [doc.path, doc.lines]));
    for (const [path, allowance] of Object.entries(inputs.baseline)) {
      expect(actual.has(path)).toBe(true);
      expect(actual.get(path)).toBeLessThanOrEqual(allowance);
    }
  });
});

describe("ميزانُ التوثيقِ — الخرقُ المزروعُ يُسقِطُ الحاجزَ", () => {
  test("وثيقةٌ جديدةٌ فوقَ السقفِ ⇒ `new-doc-cap`", () => {
    const problems = rules(
      inputsOf({ docs: [{ path: "docs/new-report.md", lines: NEW_DOC_LINE_CAP + 1 }] }),
    );
    expect(problems).toEqual(["new-doc-cap"]);
  });

  test("وثيقةٌ جديدةٌ على السقفِ بالضبطِ تمرُّ — الحدُّ مُعلَنٌ لا مضمرٌ", () => {
    expect(
      rules(inputsOf({ docs: [{ path: "docs/new-report.md", lines: NEW_DOC_LINE_CAP }] })),
    ).toEqual([]);
  });

  test("وثيقةٌ مُستثناةٌ نمَت سطراً واحداً ⇒ `ratchet`", () => {
    const problems = rules(
      inputsOf({
        docs: [{ path: "docs/runbook.md", lines: 5001 }],
        sourceLines: 100_000,
        baseline: { "docs/runbook.md": 5000 },
      }),
    );
    expect(problems).toEqual(["ratchet"]);
  });

  test("وثيقةٌ مُستثناةٌ نقصَت تمرُّ — السقّاطةُ تسمحُ بالنقصِ وحدَه", () => {
    expect(
      rules(
        inputsOf({
          docs: [{ path: "docs/runbook.md", lines: 4200 }],
          sourceLines: 100_000,
          baseline: { "docs/runbook.md": 5000 },
        }),
      ),
    ).toEqual([]);
  });

  test("مُخرَجٌ خامٌّ جديدٌ خارجَ الأرشيفِ ⇒ `raw-outside-archive`", () => {
    expect(
      rules(inputsOf({ docs: [{ path: "docs/evidence/run-output.txt", lines: 12 }] })),
    ).toEqual(["raw-outside-archive"]);
  });

  test("المُخرَجُ الخامُّ داخلَ الأرشيفِ يمرُّ ولو كانَ ضخماً — يُحفَظُ ولا يُقرَأُ", () => {
    expect(
      rules(
        inputsOf({
          docs: [{ path: "docs/evidence/archive/run-output.txt", lines: 90_000 }],
          sourceLines: 10_000_000,
        }),
      ),
    ).toEqual([]);
  });

  test("مُخرَجٌ خامٌّ جديدٌ ضخمٌ خارجَ الأرشيفِ يُسقِطُ قاعدتَينِ معاً", () => {
    expect(new Set(rules(inputsOf({ docs: [{ path: "docs/dump.log", lines: 4000 }] })))).toEqual(
      new Set(["new-doc-cap", "raw-outside-archive", "ratio"]),
    );
  });

  test("مفتاحٌ في خطِّ الأساسِ لا ملفَّ له ⇒ `stale-baseline`", () => {
    expect(rules(inputsOf({ baseline: { "docs/gone.md": 900 } }))).toEqual(["stale-baseline"]);
  });

  test("تجاوزُ نسبةِ التوثيقِ إلى الكودِ ⇒ `ratio`", () => {
    const lines = Math.ceil(1000 * MAX_DOCS_TO_SOURCE_RATIO) + 1;
    expect(
      rules(inputsOf({ docs: [{ path: "docs/a.md", lines }], baseline: { "docs/a.md": lines } })),
    ).toEqual(["ratio"]);
  });

  test("النسبةُ على السقفِ بالضبطِ تمرُّ", () => {
    const lines = 750;
    expect(
      rules(inputsOf({ docs: [{ path: "docs/a.md", lines }], baseline: { "docs/a.md": lines } })),
    ).toEqual([]);
  });

  test("كودٌ بصفرِ سطرٍ لا يُحسَبُ نسبةً — لا قسمةَ على صفرٍ ولا أحمرَ كاذبٌ", () => {
    expect(rules(inputsOf({ sourceLines: 0 }))).toEqual([]);
  });

  test("كلُّ قاعدةٍ من القواعدِ الخمسِ لها خرقٌ مقيسٌ", () => {
    const covered = new Set([
      ...rules(inputsOf({ docs: [{ path: "docs/x.md", lines: 500 }] })),
      ...rules(inputsOf({ docs: [{ path: "docs/x.md", lines: 9 }], baseline: { "docs/x.md": 8 } })),
      ...rules(inputsOf({ docs: [{ path: "docs/x.txt", lines: 9 }] })),
      ...rules(inputsOf({ baseline: { "docs/gone.md": 1 } })),
      ...rules(inputsOf({ docs: [{ path: "docs/x.md", lines: 800 }], sourceLines: 1000 })),
    ]);
    expect(covered).toEqual(
      new Set(["new-doc-cap", "ratchet", "raw-outside-archive", "stale-baseline", "ratio"]),
    );
  });
});

describe("ميزانُ التوثيقِ — `--write` لا يُمرِّرُ نموّاً", () => {
  test("لا يرفعُ رقماً ولو نمَت الوثيقةُ", () => {
    const next = ratchetBaseline(
      inputsOf({
        docs: [{ path: "docs/a.md", lines: 9000 }],
        baseline: { "docs/a.md": 500 },
      }),
    );
    expect(next).toEqual({ "docs/a.md": 500 });
  });

  test("يُنزِلُ الرقمَ إلى الحاضرِ حينَ نقصَ", () => {
    const next = ratchetBaseline(
      inputsOf({ docs: [{ path: "docs/a.md", lines: 120 }], baseline: { "docs/a.md": 500 } }),
    );
    expect(next).toEqual({ "docs/a.md": 120 });
  });

  test("لا يُضيفُ مفتاحاً لوثيقةٍ جديدةٍ متجاوزةٍ — فلا مخرجَ من `new-doc-cap` بـ`--write`", () => {
    const inputs = inputsOf({ docs: [{ path: "docs/new-huge.md", lines: 5000 }] });
    expect(ratchetBaseline(inputs)).toEqual({});
    expect(rules({ ...inputs, baseline: ratchetBaseline(inputs) })).toContain("new-doc-cap");
  });

  test("يُسقِطُ مفتاحَ ملفٍّ حُذِفَ", () => {
    expect(ratchetBaseline(inputsOf({ baseline: { "docs/gone.md": 700 } }))).toEqual({});
  });

  test("خطُّ الأساسِ بعدَ `--write` على المستودعِ الحقيقيِّ يبقى أخضرَ", () => {
    const inputs = defaultInputs();
    expect(docsBudgetProblems({ ...inputs, baseline: ratchetBaseline(inputs) })).toEqual([]);
  });
});

describe("ميزانُ التوثيقِ — السِّجِلّانِ السياديّانِ", () => {
  test("سِجِلٌّ سياديٌّ ينمو بلا مخالفةٍ — لأنَّ §25 و`ح-8` يُوجِبانِ الزيادةَ", () => {
    for (const path of LEDGER_PATHS) {
      expect(rules(inputsOf({ docs: [{ path, lines: 90_000 }], sourceLines: 10_000_000 }))).toEqual(
        [],
      );
    }
  });

  test("ولكنَّ سطورَه تُحسَبُ في النسبةِ — لا إعفاءَ من الميزانِ كلِّه", () => {
    expect(rules(inputsOf({ docs: [{ path: LEDGER_PATHS[0] as string, lines: 800 }] }))).toEqual([
      "ratio",
    ]);
  });

  test("لا يدخلُ خطَّ الأساسِ، ولا يُقرَأُ غيابُه تعفُّناً", () => {
    const inputs = defaultInputs();
    for (const path of LEDGER_PATHS) expect(inputs.baseline[path]).toBeUndefined();
  });
});

describe("ميزانُ التوثيقِ — تصنيفُ المُخرَجِ الخامِّ", () => {
  test("الامتداداتُ الثلاثةُ خامّةٌ وما سواها وثيقةٌ", () => {
    expect(isRawOutput("a/b.txt")).toBe(true);
    expect(isRawOutput("a/b.log")).toBe(true);
    expect(isRawOutput("a/b.out")).toBe(true);
    expect(isRawOutput("a/b.md")).toBe(false);
  });
});
