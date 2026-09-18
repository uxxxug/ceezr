#!/usr/bin/env bun
/**
 * # الحاجزُ الساكنُ: ميزانيةُ العملِ المطلقةِ محروسةٌ في مصدرٍ واحد — `F9-06`
 *
 * **الغرض:** أن يستحيلَ أن تُحذَفَ ميزانيةُ العملِ أو تُفرَّغَ أو تُكرَّرَ قيمُها
 * في الاختبارِ، **قبلَ** تشغيلِ اختبارِ الصمودِ. هذا حاجزٌ ساكنٌ يُفحَصُ في
 * وظيفةِ `verify` بلا قاعدةِ بياناتٍ.
 *
 * **الحالة:** `F9-06` — مُنفَّذ · مُختبَر · مبرهَنُ السقوطِ (`ح-7`).
 *
 * **ينتمي إلى:** البند `F9-06` · `OPS-005` · `DEC-18` (وحدةُ القياسِ).
 *
 * **يُستخدَمُ من:** سلسلةُ `bun run ci` · خطوةٌ مُسمّاةٌ في `.github/workflows/ci.yml`.
 *
 * **يحرسُه:** `tests/unit/check-work-budget.test.ts` — سالبةٌ مبذورةٌ لكلِّ قاعدةٍ.
 *
 * **ما لا يفعلُه هذا الحاجزُ عن قصدٍ:**
 * - **لا يُثبِتُ أنَّ العملَ ضمنَ الميزانيّةِ.** ذاكَ يُقاسُ في اختبارِ الصمودِ
 *   على قاعدةٍ حقيقيّةٍ، لا ههنا.
 * - **لا يقرأُ قاعدةً جاريةً.** ساكنٌ عن قصدٍ.
 */

import { existsSync, readFileSync } from "node:fs";
import {
  BLOCKS_TOUCHED_BUDGET,
  ROWS_SCANNED_BUDGET,
  RULE_NAMES,
  type RuleName,
  SOAK_TEST_FILE,
} from "./lib/work-budget.ts";

interface Problem {
  readonly rule: RuleName;
  readonly problem: string;
}

export function auditWorkBudget(): Problem[] {
  const problems: Problem[] = [];

  // 1. الملفُ موجودٌ
  if (!existsSync(SOAK_TEST_FILE)) {
    problems.push({
      rule: "budget.assertion-present",
      problem: `ملفُّ اختبارِ الصمودِ غائبٌ: ${SOAK_TEST_FILE}`,
    });
    return problems;
  }

  const testSource = readFileSync(SOAK_TEST_FILE, "utf8");

  // 2. الاستيرادُ من مصدرٍ واحد
  const importPattern = /from\s+["'`][^"'`]*work-budget/;
  if (!importPattern.test(testSource)) {
    problems.push({
      rule: "budget.imported",
      problem: "اختبارُ الصمودِ لا يستوردُ الميزانيّةَ من `scripts/lib/work-budget.ts`",
    });
  }

  // 3. التوكيدُ على الصفوفِ موجودٌ
  if (!testSource.includes("ROWS_SCANNED_BUDGET")) {
    problems.push({
      rule: "budget.assertion-present",
      problem: "اختبارُ الصمودِ لا يوكِّدُ على `ROWS_SCANNED_BUDGET`",
    });
  }

  // 4. التوكيدُ على الكُتَلِ موجودٌ
  if (!testSource.includes("BLOCKS_TOUCHED_BUDGET")) {
    problems.push({
      rule: "budget.assertion-present",
      problem: "اختبارُ الصمودِ لا يوكِّدُ على `BLOCKS_TOUCHED_BUDGET`",
    });
  }

  // 5. لا تكرارُ القيمِ في الاختبارِ — مصدرُ حقيقةٍ واحد
  const budgetInTest = new RegExp(
    String(ROWS_SCANNED_BUDGET) + "|" + String(BLOCKS_TOUCHED_BUDGET),
  );
  if (budgetInTest.test(testSource)) {
    problems.push({
      rule: "budget.single-source",
      problem: "قيمُ الميزانيّةِ مكرَّرةٌ في الاختبارِ بدلَ الاستيرادِ من المصدرِ الواحد",
    });
  }

  // 6. لا صفرَ ولا ما لا نهاية
  if (ROWS_SCANNED_BUDGET <= 0 || BLOCKS_TOUCHED_BUDGET <= 0) {
    problems.push({
      rule: "budget.not-zero",
      problem: "سقفُ الميزانيّةِ صفرٌ أو سالبٌ — حاجزٌ بلا رقمٍ",
    });
  }

  if (!Number.isFinite(ROWS_SCANNED_BUDGET) || !Number.isFinite(BLOCKS_TOUCHED_BUDGET)) {
    problems.push({
      rule: "budget.not-infinite",
      problem: "سقفُ الميزانيّةِ غيرُ منتهٍ — حاجزٌ بلا حدٍّ",
    });
  }

  return problems;
}

function main(): void {
  const problems = auditWorkBudget();

  if (problems.length > 0) {
    console.error("✗ ميزانيّةُ العملِ المطلقةِ مخروقةٌ:\n");
    for (const problem of problems) {
      console.error(`  ــ [${problem.rule}] ${problem.problem}`);
    }
    console.error(
      "\nوالعلاجُ في الجِذرِ: يُستورَدُ السقفُ من `scripts/lib/work-budget.ts` " +
        "ويُوكَّدُ عليه في الاختبارِ، ولا تُكرَّرُ القيمُ. وإسكاتُ الحاجزِ ليسَ علاجاً.",
    );
    process.exit(1);
  }

  console.log(
    `✓ ميزانيّةُ العملِ محروسةٌ: ${String(ROWS_SCANNED_BUDGET)} صفّاً · ` +
      `${String(BLOCKS_TOUCHED_BUDGET)} كتلةً · ${String(RULE_NAMES.length)} قواعدَ. ` +
      "وهذا **حِفظُ شرطٍ لا قياسُ عملٍ**: العملُ يُقاسُ في اختبارِ الصمودِ على قاعدةٍ حقيقيّةٍ.",
  );
}

main();
