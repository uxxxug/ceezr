/**
 * # اختبارٌ سالبٌ: الحاجزُ يرى العطبَ الذي وقعَ فعلاً — `D-24`
 *
 * لكلِّ قاعدةٍ حالةٌ مبذورةٌ تُثبِتُ أنَّ الحاجزَ **يُخفِقُ** حينَ يجبُ أن يُخفِقَ،
 * وحالةُ المستودعِ الحقيقيّةُ تُثبِتُ أنَّه لا يُخفِقُ بلا سببٍ. والحالةُ
 * المفصليّةُ هيَ **العطبُ التاريخيُّ نفسُه**: `check-no-skipped-tests.ts` في
 * السلسلةِ بلا وسيطٍ — دُمِجَ خضراءَ يوماً، ويجبُ أن يصيرَ أحمرَ اليومَ.
 */

import { describe, expect, test } from "bun:test";
import { consumesArgument, defaultInputs } from "../../scripts/check-runner-command-validity.ts";
import {
  MIN_REASON_LENGTH,
  type RunnerValidityInputs,
  runnerValidityProblems,
} from "../../scripts/lib/runner-command-validity.ts";

const base: RunnerValidityInputs = {
  commands: [{ raw: "bun run scripts/check-x.ts", scriptPath: "scripts/check-x.ts", argCount: 0 }],
  existingScriptFiles: ["scripts/check-x.ts", "scripts/check-y.ts"],
  definedNamedScripts: ["ci", "lint"],
  argumentConsumers: [],
  argumentExemptions: [],
};

describe("صلاحيّةُ نداءِ أوامرِ المشغِّلِ (D-24)", () => {
  test("المدخلُ السليمُ لا يُخرِجُ مخالفةً", () => {
    expect(runnerValidityProblems(base)).toEqual([]);
  });

  test("العطبُ التاريخيُّ: أمرٌ يستهلكُ وسيطاً ويُنادى بلا وسيطٍ ⇒ إخفاقٌ", () => {
    const problems = runnerValidityProblems({
      ...base,
      commands: [
        {
          raw: "bun run scripts/check-no-skipped-tests.ts",
          scriptPath: "scripts/check-no-skipped-tests.ts",
          argCount: 0,
        },
      ],
      existingScriptFiles: ["scripts/check-no-skipped-tests.ts"],
      argumentConsumers: ["scripts/check-no-skipped-tests.ts"],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.rule).toBe("أمرٌ يستهلكُ وسيطاً ولا يُمرَّرُ لهُ وسيطٌ");
  });

  test("والوسيطُ الممرَّرُ يُطفِئُ المخالفةَ — لا تُشتَرَطُ صيغةٌ زائدةٌ", () => {
    const problems = runnerValidityProblems({
      ...base,
      commands: [
        {
          raw: "bun run scripts/check-no-skipped-tests.ts /tmp/ci-output.log",
          scriptPath: "scripts/check-no-skipped-tests.ts",
          argCount: 1,
        },
      ],
      existingScriptFiles: ["scripts/check-no-skipped-tests.ts"],
      argumentConsumers: ["scripts/check-no-skipped-tests.ts"],
    });
    expect(problems).toEqual([]);
  });

  test("ملفٌّ لا وجودَ لهُ على القرصِ ⇒ إخفاقٌ", () => {
    const problems = runnerValidityProblems({
      ...base,
      commands: [
        {
          raw: "bun run scripts/check-ghost.ts",
          scriptPath: "scripts/check-ghost.ts",
          argCount: 0,
        },
      ],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.rule).toBe("أمرٌ في المشغِّلِ يشيرُ إلى ملفٍّ لا وجودَ لهُ");
  });

  test("اسمٌ غيرُ معرَّفٍ في `package.json` ⇒ إخفاقٌ", () => {
    const problems = runnerValidityProblems({
      ...base,
      commands: [{ raw: "bun run typechek", namedScript: "typechek", argCount: 0 }],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.rule).toBe("أمرٌ في المشغِّلِ يُنادي اسماً غيرَ معرَّفٍ");
  });

  test("إعفاءٌ بسببٍ أقصرَ من الحدِّ ⇒ إخفاقٌ (إسكاتٌ لا سببٌ)", () => {
    const problems = runnerValidityProblems({
      ...base,
      argumentConsumers: ["scripts/check-x.ts"],
      argumentExemptions: [{ script: "scripts/check-x.ts", reason: "لاحقاً" }],
    });
    expect(problems.some((problem) => problem.rule === "إعفاءٌ بلا سببٍ منطوقٍ")).toBe(true);
    expect("لاحقاً".length).toBeLessThan(MIN_REASON_LENGTH);
  });

  test("إعفاءٌ لا يُقابِلُه أمرٌ في السلسلةِ ⇒ إخفاقٌ (إعفاءٌ بائتٌ)", () => {
    const problems = runnerValidityProblems({
      ...base,
      argumentExemptions: [
        {
          script: "scripts/check-gone.ts",
          reason: "سببٌ منطوقٌ طويلٌ بما يكفي ليَعبُرَ حدَّ الحروفِ المفروضَ في المنطقِ النقيِّ.",
        },
      ],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.rule).toBe("إعفاءٌ بائتٌ");
  });

  test("سلسلةٌ فارغةٌ لا تُقرأُ نجاحاً", () => {
    const problems = runnerValidityProblems({ ...base, commands: [] });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.rule).toBe("الكشفُ فارغٌ — لا يُقرأُ نجاحاً");
  });

  test("قرصٌ بلا ملفّاتٍ لا يُقرأُ نجاحاً", () => {
    const problems = runnerValidityProblems({ ...base, existingScriptFiles: [] });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.rule).toBe("الكشفُ فارغٌ — لا يُقرأُ نجاحاً");
  });

  test("سطرُ استعمالٍ في تعليقٍ ليسَ استهلاكاً — ولا يُقرأُ تنفيذاً", () => {
    const inComment = "/**\n * الاستعمال: bun run x.ts <ملف>\n */\nprocess.exit(1);\n";
    expect(consumesArgument(inComment)).toBe(false);
    const printed = 'console.error("✗ الاستعمال: bun run x.ts <ملف>");\nprocess.exit(1);\n';
    expect(consumesArgument(printed)).toBe(true);
  });

  test("طبعُ استعمالٍ بلا خروجٍ بغيرِ صفرٍ ليسَ استهلاكاً مانعاً", () => {
    expect(consumesArgument('console.log("الاستعمال: كذا");\nprocess.exit(0);\n')).toBe(false);
  });

  test("المستودعُ الحقيقيُّ: لا مخالفةَ اليومَ والكشفُ غيرُ فارغٍ", () => {
    const inputs = defaultInputs();
    expect(inputs.commands.length).toBeGreaterThan(50);
    expect(inputs.existingScriptFiles.length).toBeGreaterThan(50);
    expect(inputs.argumentConsumers.length).toBeGreaterThan(0);
    expect(runnerValidityProblems(inputs)).toEqual([]);
  });

  test("المستودعُ الحقيقيُّ: `--cwd` يُحَلُّ في حزمتِهِ لا في الجذرِ", () => {
    const inputs = defaultInputs();
    const key = inputs.commands
      .map((command) => command.namedScript)
      .find((name): name is string => name !== undefined && name.includes("apps/miniapp#"));
    expect(key).toBeDefined();
    expect(inputs.definedNamedScripts).toContain(key ?? "");
  });
});
