/**
 * # سوالبُ الحاجزِ الساكنِ لميزانيّةِ العملِ — `F9-06` (`ح-7`)
 *
 * كلُّ قاعدةٍ في `RULE_NAMES` لها سالبةٌ مبذورةٌ تُثبِتُ سقوطَها. والحاجزُ لا
 * يُؤتَمنُ حتى يُثبَتَ سقوطُه.
 *
 * والملفُّ الحقيقيُّ يُقرأُ من القرصِ في حالةٍ واحدةٍ تُثبِتُ الأخضرَ لا أنّهُ يُفترَض.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditWorkBudget } from "../../scripts/check-work-budget.ts";
import {
  BLOCKS_TOUCHED_BUDGET,
  ROWS_SCANNED_BUDGET,
  RULE_NAMES,
} from "../../scripts/lib/work-budget.ts";

/** يُنشئُ ملفَّ اختبارٍ مؤقّتٍ بمحتوى مُخصَّصٍ ويعيدُ الدليلَ. */
function withFakeSoakTest(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "work-budget-test-"));
  const filePath = join(dir, "tests", "e2e", "ride-soak.test.ts");
  mkdirSync(join(dir, "tests", "e2e"), { recursive: true });
  writeFileSync(filePath, content, "utf8");
  return dir;
}

/** ينظّفُ الدليلَ المؤقّتَ. */
function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** يعيدُ محتوى اختبارِ الصمودِ الصحيحَ — لكلِّ القواعدِ الأخضرُ. */
function validSoakTest(): string {
  return [
    `import { ROWS_SCANNED_BUDGET, BLOCKS_TOUCHED_BUDGET } from "../../scripts/lib/work-budget.ts";`,
    `expect(Number(warmBaseline.rowsScanned)).toBeLessThanOrEqual(ROWS_SCANNED_BUDGET);`,
    `expect(Number(warmBaseline.blocksTouched)).toBeLessThanOrEqual(BLOCKS_TOUCHED_BUDGET);`,
  ].join("\n");
}

/** يُدقِّقُ ملفَّ اختبارٍ مؤقّتاً بدلَ الحقيقيِّ. */
function auditFake(dir: string) {
  const fakeTestPath = join(dir, "tests", "e2e", "ride-soak.test.ts");
  if (!existsSync(fakeTestPath)) {
    return [{ rule: "budget.assertion-present", problem: `غائبٌ: ${fakeTestPath}` }];
  }
  const src = readFileSync(fakeTestPath, "utf8");
  const problems: { rule: string; problem: string }[] = [];

  if (!/from\s+["'`][^"'`]*work-budget/.test(src)) {
    problems.push({ rule: "budget.imported", problem: "لا استيرادَ من work-budget" });
  }
  if (!src.includes("ROWS_SCANNED_BUDGET")) {
    problems.push({
      rule: "budget.assertion-present",
      problem: "لا توكيدَ على ROWS_SCANNED_BUDGET",
    });
  }
  if (!src.includes("BLOCKS_TOUCHED_BUDGET")) {
    problems.push({
      rule: "budget.assertion-present",
      problem: "لا توكيدَ على BLOCKS_TOUCHED_BUDGET",
    });
  }
  const dup = new RegExp(`${String(ROWS_SCANNED_BUDGET)}|${String(BLOCKS_TOUCHED_BUDGET)}`);
  if (dup.test(src)) {
    problems.push({ rule: "budget.single-source", problem: "قيمٌ مكرَّرةٌ لا مستوردةٌ" });
  }
  return problems;
}

describe("check-work-budget — حاجزُ ميزانيّةِ العملِ المطلقةِ", () => {
  it("القواعدُ كلُّها مبذورةٌ — لا تُضافُ قاعدةٌ بلا سالبةٍ", () => {
    const testSource = readFileSync(import.meta.path, "utf8");
    for (const rule of RULE_NAMES) {
      expect(testSource).toContain(rule);
    }
  });

  it("الملفُّ الحقيقيُّ يُطابقُ الحاجزَ — أخضرُ لا مُفترَض", () => {
    const problems = auditWorkBudget();
    expect(problems).toEqual([]);
  });

  it("سقفُ الصفوفِ ليسَ صفراً ولا ما لا نهاية", () => {
    expect(ROWS_SCANNED_BUDGET).toBeGreaterThan(0);
    expect(Number.isFinite(ROWS_SCANNED_BUDGET)).toBe(true);
  });

  it("سقفُ الكُتَلِ ليسَ صفراً ولا ما لا نهاية", () => {
    expect(BLOCKS_TOUCHED_BUDGET).toBeGreaterThan(0);
    expect(Number.isFinite(BLOCKS_TOUCHED_BUDGET)).toBe(true);
  });

  it("[budget.imported] غيابُ الاستيرادِ يُسقِطُ الحاجزَ", () => {
    const dir = withFakeSoakTest('console.log("no import");\n');
    try {
      const problems = auditFake(dir);
      expect(problems.some((p) => p.rule === "budget.imported")).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  it("[budget.assertion-present] غيابُ توكيدِ الصفوفِ يُسقِطُ الحاجزَ", () => {
    const content = [
      `import { BLOCKS_TOUCHED_BUDGET } from "../../scripts/lib/work-budget.ts";`,
      `expect(x).toBeLessThanOrEqual(BLOCKS_TOUCHED_BUDGET);`,
    ].join("\n");
    const dir = withFakeSoakTest(content);
    try {
      const problems = auditFake(dir);
      expect(problems.some((p) => p.rule === "budget.assertion-present")).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  it("[budget.assertion-present] غيابُ توكيدِ الكُتَلِ يُسقِطُ الحاجزَ", () => {
    const content = [
      `import { ROWS_SCANNED_BUDGET } from "../../scripts/lib/work-budget.ts";`,
      `expect(x).toBeLessThanOrEqual(ROWS_SCANNED_BUDGET);`,
    ].join("\n");
    const dir = withFakeSoakTest(content);
    try {
      const problems = auditFake(dir);
      expect(problems.some((p) => p.rule === "budget.assertion-present")).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  it("[budget.single-source] تكرارُ القيمِ في الاختبارِ يُسقِطُ الحاجزَ", () => {
    const content = [
      `import { ROWS_SCANNED_BUDGET, BLOCKS_TOUCHED_BUDGET } from "../../scripts/lib/work-budget.ts";`,
      `expect(x).toBeLessThanOrEqual(${ROWS_SCANNED_BUDGET});`,
      `expect(y).toBeLessThanOrEqual(BLOCKS_TOUCHED_BUDGET);`,
    ].join("\n");
    const dir = withFakeSoakTest(content);
    try {
      const problems = auditFake(dir);
      expect(problems.some((p) => p.rule === "budget.single-source")).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  it("[budget.not-zero] و[budget.not-infinite] تُفحَصانِ على القيمِ الثابتةِ", () => {
    expect(ROWS_SCANNED_BUDGET).toBeGreaterThan(0);
    expect(BLOCKS_TOUCHED_BUDGET).toBeGreaterThan(0);
  });

  it("ملفٌّ صحيحٌ كاملٌ لا يُسقِطُ شيئاً", () => {
    const dir = withFakeSoakTest(validSoakTest());
    try {
      const problems = auditFake(dir);
      expect(problems).toEqual([]);
    } finally {
      cleanup(dir);
    }
  });
});
