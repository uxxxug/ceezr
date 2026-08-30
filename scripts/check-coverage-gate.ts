#!/usr/bin/env bun
/**
 * # الحاجزُ: بوابةُ تغطيةٍ دنيا على المسارات الحرجة — `OPS-005` (الشطرُ الأوّل)
 *
 * **الغرض:** أن يستحيل أن تنحدر تغطيةُ الاختبارِ على مسارٍ حرجٍ، أو أن يدخل
 * المستودعَ ملفُّ مصدرٍ في مسارٍ حرجٍ **لا يُحمِّله اختبارٌ قطُّ**، بلا سقوطِ بناءٍ.
 *
 * **الحالة:** `OPS-005` — مُنفَّذ · مُختبَر · مبرهَنُ السقوط (ADR 0048).
 * والبندُ يبقى `[~]` لا `[x]`: شطرُه الثاني (بوابةُ انحدارِ الأداءِ) محجوبٌ
 * بـ`OPS-004`/`REQ-06` — لا مولِّدَ حملٍ موزَّعٌ ولا بيئةَ قياسٍ مستقرّةٌ.
 *
 * **ينتمي إلى:** البند `OPS-005` · القسم 11-د.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** سلسلةُ `bun run ci` · وخطوةٌ مُسمّاةٌ في
 * `.github/workflows/ci.yml`.
 *
 * ## كيف يُشغَّل
 *
 * لا يُشغِّل الاختباراتَ بنفسِه — يقرأ مخرجَ قياسٍ جرى قبلَه:
 * ```
 * bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage
 * bun run scripts/check-coverage-gate.ts [مسارُ lcov.info]
 * ```
 * وغيابُ الملفِّ **سقوطٌ لا تخطٍّ**، وقياسٌ جزئيٌّ (أقلُّ من
 * `MIN_MEASURED_FILES` ملفّاً) **سقوطٌ** كذلك.
 *
 * **ما لا يفعله هذا الحاجزُ عن قصدٍ:**
 * - **لا يحكم على انحدارِ الأداءِ.** ميزانيّةُ الحِزَمِ الساكنةُ في
 *   `check-performance-budget.ts` (`F1-09`)، وانحدارُ زمنِ الاستجابةِ يحتاج
 *   `OPS-004`.
 * - **لا يقيس تغطيةَ اختباراتِ التكاملِ** — تلك لا تعمل في `verify` بلا قاعدةٍ،
 *   فما يُقاس ههنا شطرٌ من التغطيةِ الحقيقيّةِ لا كلُّها، والحدُّ مُعلَنٌ في السجلّ.
 * - **لا يُميِّز ملفَّ الأنواعِ من ملفِّ المنطق** (انظر حدودَ الوحدةِ النقيّة).
 */

import { existsSync, readFileSync } from "node:fs";
import { Glob } from "bun";
import { auditCoverage, type CriticalPathReport, parseLcov } from "./lib/coverage-gate.ts";
import { COVERAGE_BARS, MIN_MEASURED_FILES } from "./lib/coverage-registry.ts";
import { CRITICAL_PATHS } from "./lib/skip-registry.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const DEFAULT_LCOV = "coverage/lcov.info";
/** مجلّداتُ المصدرِ التي تُفحَص — البادئاتُ في السجلِّ لا تخرج عنها. */
const SOURCE_ROOTS = ["packages", "apps", "scripts", "bench", "runtime_agent"] as const;

/** كلُّ ملفّاتِ المصدرِ: `.ts`/`.tsx` بلا اختباراتٍ ولا تعريفاتٍ ولا `node_modules`. */
function readSourceFiles(): readonly string[] {
  const files: string[] = [];
  const glob = new Glob("**/*.{ts,tsx}");
  for (const root of SOURCE_ROOTS) {
    if (!existsSync(`${ROOT}${root}`)) continue;
    for (const relative of glob.scanSync({ cwd: `${ROOT}${root}`, onlyFiles: true })) {
      if (relative.startsWith("node_modules/") || relative.includes("/node_modules/")) continue;
      if (relative.endsWith(".d.ts") || relative.includes(".test.")) continue;
      files.push(`${root}/${relative}`);
    }
  }
  return files;
}

function formatReport(report: CriticalPathReport): string {
  const percent = report.lineCoverage === null ? "—" : `${report.lineCoverage.toFixed(2)}%`;
  return (
    `  • ${report.criticalPath}: ${percent} ` +
    `(${report.hitLines}/${report.totalLines} سطراً · ${report.measuredFiles}/${report.totalFiles} ملفّاً مقيساً` +
    `${report.unmeasuredFiles.length > 0 ? ` · ${report.unmeasuredFiles.length} بلا اختبارٍ` : ""})`
  );
}

function main(): void {
  const lcovPath = process.argv[2] ?? DEFAULT_LCOV;
  const absolute = lcovPath.startsWith("/") ? lcovPath : `${ROOT}${lcovPath}`;
  if (!existsSync(absolute)) {
    console.error(
      `✗ لا مخرجَ تغطيةٍ في ${lcovPath} — ولا يُقرَأ غيابُ القياسِ نجاحاً.\n` +
        `  الأمرُ: bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage`,
    );
    process.exit(1);
  }

  const coverage = parseLcov(readFileSync(absolute, "utf8"));
  const sourceFiles = readSourceFiles();
  if (sourceFiles.length === 0) {
    console.error("✗ لم يُقرأ ملفُّ مصدرٍ واحدٌ — الكشفُ نفسُه معطوبٌ، ولا يُقرَأ ذلك نجاحاً.");
    process.exit(1);
  }

  const { violations, reports } = auditCoverage({
    bars: COVERAGE_BARS,
    criticalPaths: CRITICAL_PATHS,
    coverage,
    sourceFiles,
    minMeasuredFiles: MIN_MEASURED_FILES,
  });

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} مخالفةً في بوابةِ التغطية (OPS-005):\n`);
    for (const violation of violations) {
      console.error(`  • ${violation}\n`);
    }
    console.error("  السجلُّ: scripts/lib/coverage-registry.ts — يُصلَح السببُ ولا تُخفَّض الأرضيّة.");
    process.exit(1);
  }

  console.log(
    `✅ بوابةُ التغطية: ${reports.length} مساراً حرجاً كلُّها فوقَ أرضيّتِها المقيسة ` +
      `(${coverage.size} ملفّاً مقيساً في lcov):`,
  );
  for (const report of reports) {
    console.log(formatReport(report));
  }
  const debt = reports.reduce((sum, report) => sum + report.unmeasuredFiles.length, 0);
  if (debt > 0) {
    console.log(
      `⚠ ${debt} ملفَّ مصدرٍ في مساراتٍ حرجةٍ لا يُحمِّله اختبارٌ قطُّ — مُعلَنٌ دَيناً ` +
        `بسقفٍ لا يعلو، لا تغطيةً مضمونةً.`,
    );
  }
}

main();
