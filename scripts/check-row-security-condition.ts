#!/usr/bin/env bun
/**
 * # الحاجزُ: بابٌ لِـ`anon` بلا سياسةٍ مُختبَرةٍ بابٌ بلا ضابطٍ — `SEC-10`
 *
 * **الغرض:** أن يستحيلَ أن يدخلَ المستودعَ سطرٌ يفتحُ القاعدةَ لدورٍ عامٍّ
 * (`anon` · `authenticated` · `public`) أو يضبطُ `force row level security` أو
 * يُعطِّلُ `RLS`، **قبلَ** استيفاءِ الشرطِ الثلاثيِّ الحاكمِ في `ADR 0006`:
 * سياساتٌ فعليّةٌ · `force` · واختبارُ تكاملٍ بدورٍ **غيرِ مالكٍ**.
 *
 * **الحالة:** `SEC-10` — مُنفَّذ · مُختبَر · مبرهَنُ السقوطِ (`ح-7`).
 *
 * **ينتمي إلى:** البند `F8-08` (`SEC-10`) · `docs/adr/0140` · `docs/adr/0006`.
 *
 * **يُستخدَمُ من:** سلسلةُ `bun run ci` · خطوةٌ مُسمّاةٌ في `.github/workflows/ci.yml`.
 *
 * **يحرسُه:** `tests/unit/check-row-security-condition.test.ts` — سالبةٌ مزروعةٌ
 * لكلِّ صنفِ مشكلةٍ.
 *
 * **ما لا يفعلُه هذا الحاجزُ عن قصدٍ:**
 * - **لا يُثبِتُ أنَّ القاعدةَ تحمي.** لا تحمي اليومَ: الخدمةُ تتّصلُ بالمالكِ
 *   و`force` غيرُ مضبوطٍ. والأثرُ يُقاسُ في
 *   `tests/integration/row-security-effect.test.ts` لا ههنا.
 * - **لا يمنعُ السياساتَ إلى الأبدِ.** يمنعُها بلا شرطٍ مُستوفىً مُسجَّلٍ.
 * - **لا يقرأُ قاعدةً جاريةً.** ساكنٌ عن قصدٍ: يعملُ في `verify` بلا خدمةٍ.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  auditRowSecurityCondition,
  EFFECT_TEST_FILE,
  FORBIDDEN_POLICY_ROLES,
  POLICY_EXCEPTIONS,
  PUBLIC_KEY_MARKERS,
  type SourceFile,
  type SqlFile,
} from "./lib/row-security-condition.ts";

const MIGRATIONS_DIR = "supabase/migrations";
/** جذورُ المصدرِ التي يُفحَصُ فيها المساسُ بمفتاحٍ عامٍّ. */
const SOURCE_ROOTS = ["apps", "packages"];
const SOURCE_EXTENSIONS = [".ts", ".tsx"];
/** لا يُفحَصُ فيها: الاختباراتُ تذكرُ الأسماءَ لتزرعَ سالبةً، وذلكَ عملُها. */
const SOURCE_EXCLUDE = ["/tests/", "/node_modules/", "/dist/", ".test.ts"];

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(path, out);
      continue;
    }
    if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(path);
  }
  return out;
}

function main(): void {
  const migrations: SqlFile[] = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => ({
      path: `${MIGRATIONS_DIR}/${name}`,
      sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8"),
    }));

  const sources: SourceFile[] = SOURCE_ROOTS.filter((root) => existsSync(root))
    .flatMap((root) => walk(root, []))
    .filter((path) => !SOURCE_EXCLUDE.some((fragment) => `/${path}`.includes(fragment)))
    .map((path) => ({ path, source: readFileSync(path, "utf8") }));

  const problems = auditRowSecurityCondition({
    migrations,
    sources,
    effectTestPresent: existsSync(EFFECT_TEST_FILE),
  });

  if (problems.length > 0) {
    console.error("✗ شرطُ ADR 0006 الحاكمُ مخروقٌ:\n");
    for (const problem of problems) {
      console.error(`  ــ [${problem.kind}] ${problem.where}: ${problem.problem}`);
    }
    console.error(
      "\nوالعلاجُ في الجِذرِ لا في الحاجزِ: تُكتَبُ سياساتٌ فعليّةٌ ويُضبَطُ " +
        "`force row level security` ويُقاسُ الأثرُ بدورٍ غيرِ مالكٍ، ثمَّ يُسجَّلُ " +
        "المدخلُ في `POLICY_EXCEPTIONS` بسببٍ ودليلٍ. وإسكاتُ الحاجزِ ليسَ علاجاً.",
    );
    process.exit(1);
  }

  console.log(
    `✓ ${migrations.length} هجرةً و${sources.length} ملفَ مصدرٍ: لا سياسةَ لِـ` +
      `${FORBIDDEN_POLICY_ROLES.join("/")} · لا force · لا تعطيلَ · لا مساسَ بمفتاحٍ عامٍّ ` +
      `(${PUBLIC_KEY_MARKERS.length} علامةً مرصودةً) · ${POLICY_EXCEPTIONS.length} استثناءً مُسجَّلاً. ` +
      "وهذا **حِفظُ شرطٍ لا إثباتُ حمايةٍ**: القاعدةُ اليومَ ليسَت خطَّ الدفاعِ، " +
      "والأثرُ يُقاسُ في اختبارِ الدورِ غيرِ المالكِ.",
  );
}

main();
