/**
 * # سقوطُ حاجزِ تكافؤِ الإنفاذِ مقيسٌ لا مفترَضٌ — `ح-7`
 *
 * الأخضرُ على المستودعِ كما هوَ **لا يُثبِتُ** أنَّ الحاجزَ يفحصُ شيئاً: قد يكونُ
 * كشفُه معطوباً فيمرَّ كلُّ شيءٍ. فلكلِّ قاعدةٍ ههنا خرقٌ **مزروعٌ** يجبُ أن يُسقِطَها،
 * ولكلِّ إعفاءٍ بائتٌ في أصولِه الثلاثةِ، ولكلِّ سببٍ أخرسَ رفضٌ.
 *
 * **وما لا يُدَّعى:** لا يُدَّعى أنَّ هذا الاختبارَ يُثبِتُ أنَّ سيرَ العملِ نفسَه
 * يُشغِّلُ الخطوةَ فعلاً — ذاكَ حكمُ CI وحدَه، وهوَ مُسجَّلٌ في الدليلِ.
 */

import { describe, expect, test } from "bun:test";
import { defaultInputs, stripFullLineComments } from "../../scripts/check-guard-enforcement.ts";
import {
  type GuardEnforcementInputs,
  guardEnforcementProblems,
  MIN_REASON_LENGTH,
} from "../../scripts/lib/guard-enforcement.ts";

const LONG_REASON = "سببٌ منطوقٌ طويلٌ بما يكفي ليُعلِّلَ استحالةَ التشغيلِ في الجانبِ الآخرِ فعلاً";

function baseInputs(): GuardEnforcementInputs {
  return {
    localGuards: ["scripts/check-a.ts", "scripts/check-b.ts"],
    workflowGuards: ["scripts/check-a.ts", "scripts/check-b.ts"],
    guardsOnDisk: ["scripts/check-a.ts", "scripts/check-b.ts"],
    localOnlyExemptions: [],
    remoteOnlyExemptions: [],
    uninvokedExemptions: [],
  };
}

function rules(inputs: GuardEnforcementInputs): readonly string[] {
  return guardEnforcementProblems(inputs).map((problem) => problem.rule);
}

describe("تكافؤُ الإنفاذِ — مُدخَلاتٌ مزروعةٌ", () => {
  test("مُدخَلٌ متكافئٌ لا يُنتِجُ مخالفةً", () => {
    expect(guardEnforcementProblems(baseInputs())).toHaveLength(0);
  });

  test("حاجزٌ محلّيٌّ لا يُنادى في سيرِ عملٍ يُسقِطُ الفحصَ", () => {
    const problems = guardEnforcementProblems({
      ...baseInputs(),
      localGuards: ["scripts/check-a.ts", "scripts/check-b.ts", "scripts/check-orphan.ts"],
      guardsOnDisk: ["scripts/check-a.ts", "scripts/check-b.ts", "scripts/check-orphan.ts"],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.rule).toContain("لا يُنفَّذُ في CI");
    expect(problems[0]?.detail).toContain("scripts/check-orphan.ts");
  });

  test("إعفاءٌ مكتوبٌ يُسكِتُ المخالفةَ ذاتَها — ولا يُسكِتُ غيرَها", () => {
    const seeded: GuardEnforcementInputs = {
      ...baseInputs(),
      localGuards: ["scripts/check-a.ts", "scripts/check-b.ts", "scripts/check-orphan.ts"],
      guardsOnDisk: ["scripts/check-a.ts", "scripts/check-b.ts", "scripts/check-orphan.ts"],
      localOnlyExemptions: [{ script: "scripts/check-orphan.ts", reason: LONG_REASON }],
    };
    expect(guardEnforcementProblems(seeded)).toHaveLength(0);
  });

  test("حاجزٌ في سيرِ العملِ لا يُشغَّلُ محلّيًّا يُسقِطُ الفحصَ", () => {
    const problems = guardEnforcementProblems({
      ...baseInputs(),
      workflowGuards: ["scripts/check-a.ts", "scripts/check-b.ts", "scripts/check-remote.ts"],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.rule).toContain("لا يُشغَّلُ محلّيًّا");
  });

  test("ملفٌّ على القرصِ لا يُنادى في أيِّ مشغِّلٍ يُسقِطُ الفحصَ", () => {
    const problems = guardEnforcementProblems({
      ...baseInputs(),
      guardsOnDisk: ["scripts/check-a.ts", "scripts/check-b.ts", "scripts/check-ghost.ts"],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.rule).toContain("لا يُنادى في أيِّ مشغِّلٍ");
  });

  test("إعفاءٌ بائتٌ يُسقِطُ الفحصَ في أصولِه الثلاثةِ", () => {
    const stale = { script: "scripts/check-a.ts", reason: LONG_REASON };
    // `check-a` في الجانبَينِ، فكلُّ إعفاءٍ له لم يبقَ له موجِبٌ.
    expect(rules({ ...baseInputs(), localOnlyExemptions: [stale] })).toEqual(["إعفاءٌ بائتٌ"]);
    expect(rules({ ...baseInputs(), remoteOnlyExemptions: [stale] })).toEqual(["إعفاءٌ بائتٌ"]);
    expect(rules({ ...baseInputs(), uninvokedExemptions: [stale] })).toEqual(["إعفاءٌ بائتٌ"]);
  });

  test("إعفاءٌ بسببٍ أخرسَ مرفوضٌ ولو كانَ موجِبُه قائماً", () => {
    const problems = guardEnforcementProblems({
      ...baseInputs(),
      localGuards: ["scripts/check-a.ts", "scripts/check-b.ts", "scripts/check-orphan.ts"],
      guardsOnDisk: ["scripts/check-a.ts", "scripts/check-b.ts", "scripts/check-orphan.ts"],
      localOnlyExemptions: [{ script: "scripts/check-orphan.ts", reason: "لاحقاً" }],
    });
    expect(problems.map((problem) => problem.rule)).toEqual(["إعفاءٌ بلا سببٍ منطوقٍ"]);
    expect(problems[0]?.detail).toContain(String(MIN_REASON_LENGTH));
  });

  test("كشفٌ فارغٌ لا يُقرأُ نجاحاً", () => {
    expect(rules({ ...baseInputs(), localGuards: [] })).toEqual(["الكشفُ فارغٌ — لا يُقرأُ نجاحاً"]);
    expect(rules({ ...baseInputs(), workflowGuards: [] })).toEqual(["الكشفُ فارغٌ — لا يُقرأُ نجاحاً"]);
  });
});

describe("تكافؤُ الإنفاذِ — المستودعُ كما هوَ", () => {
  test("لا مخالفةَ في الحالةِ الراهنةِ", () => {
    expect(guardEnforcementProblems(defaultInputs())).toEqual([]);
  });

  test("الكشفُ غيرُ فارغٍ فعلاً — وإلّا كانَ الأخضرُ أعلاه أخضرَ فراغٍ", () => {
    const inputs = defaultInputs();
    expect(inputs.localGuards.length).toBeGreaterThan(50);
    expect(inputs.workflowGuards.length).toBeGreaterThan(50);
    expect(inputs.guardsOnDisk.length).toBeGreaterThan(50);
    expect(inputs.guardsOnDisk).toContain("scripts/check-guard-enforcement.ts");
  });

  test("تعليقٌ لا يُقرأُ تنفيذاً — وهذا هوَ العطبُ الذي أخفى الخلَلَ أوّلاً", () => {
    const yaml = [
      "      # run: bun run ci",
      "      - name: خطوةٌ",
      "        run: bun run lint",
    ].join("\n");
    const stripped = stripFullLineComments(yaml);
    expect(stripped).not.toContain("bun run ci");
    expect(stripped).toContain("bun run lint");
  });

  test("الحاجزُ نفسُه مُنفَّذٌ في الجانبَينِ — لا يُعفي ذاتَه", () => {
    const inputs = defaultInputs();
    expect(inputs.localGuards).toContain("scripts/check-guard-enforcement.ts");
    expect(inputs.workflowGuards).toContain("scripts/check-guard-enforcement.ts");
  });
});
