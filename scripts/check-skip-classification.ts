#!/usr/bin/env bun
/**
 * # الحاجزُ: لا تجاوزَ بلا تصنيف — `OPS-009`
 *
 * **الغرض:** أن يستحيل أن يدخل المستودعَ اختبارٌ متجاوَزٌ لا يُعرَف سببُه ولا مَن
 * يملك إزالتَه ولا شرطُ تفعيلِه. والحاجزُ يقرأ **الشيفرةَ** فيكتشف مواضعَ
 * التجاوز، ويقرأ **السجلَّ** فيطابقهما، ويقرأ **ملفَّ سيرِ العمل** فيتحقّق أنّ ما
 * يُزعَم أنّه يعمل في خطوةٍ ما يعمل فيها حقّاً.
 *
 * **الحالة:** `OPS-009` — مُنفَّذ · مُختبَر (ADR 0046) · مبرهَنُ السقوط.
 *
 * **ينتمي إلى:** البند `OPS-009` · القسم 11-د.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** سلسلةُ `bun run ci` · وخطوةٌ مُسمّاةٌ في
 * `.github/workflows/ci.yml`.
 *
 * **ملاحظات مستقبلية:** متى ظهرت صيغةُ تعليقٍ جديدةٌ في bun تُضاف في
 * `scripts/lib/skip-audit.ts` لا ههنا.
 *
 * **ما لا يفعله هذا الحاجزُ عن قصدٍ:**
 * - **لا يمنع التجاوزَ المشروطَ.** اختبارٌ يحتاج قاعدةً حقيقيّةً لا يصحّ أن يعمل
 *   بلا قاعدةٍ؛ والمطلوبُ أن يكون تجاوزُه **مُعلَناً مملوكاً** لا صامتاً.
 * - **لا يتحقّق أنّ الاختبارَ نجح حيثُ عمل.** ذلك شأنُ
 *   `scripts/check-no-skipped-tests.ts` على مخرجاتِ تشغيلٍ حقيقيّ.
 * - **لا يقرأ YAML بمُحلِّلٍ.** الحدُّ مُعلَنٌ في وحدةِ التدقيق.
 */

import { readFileSync } from "node:fs";
import { Glob } from "bun";
import { auditRegistry, type CiStep, parseCiSteps } from "./lib/skip-audit.ts";
import { SKIP_REGISTRY } from "./lib/skip-registry.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const WORKFLOW = ".github/workflows/ci.yml";

function readTestSources(): ReadonlyMap<string, string> {
  const sources = new Map<string, string>();
  const glob = new Glob("**/*.test.{ts,tsx}");
  for (const relative of glob.scanSync({ cwd: ROOT, onlyFiles: true })) {
    if (relative.startsWith("node_modules/") || relative.includes("/node_modules/")) {
      continue;
    }
    sources.set(relative, readFileSync(`${ROOT}${relative}`, "utf8"));
  }
  return sources;
}

function readScriptPaths(): ReadonlyMap<string, string> {
  const manifest = JSON.parse(readFileSync(`${ROOT}package.json`, "utf8")) as {
    readonly scripts?: Record<string, string>;
  };
  const paths = new Map<string, string>();
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    const match = /bun\s+test\s+([^\s|;&]+)/.exec(command);
    if (match !== null && !(match[1] as string).startsWith("-")) {
      paths.set(name, match[1] as string);
    }
  }
  return paths;
}

function main(): void {
  const sources = readTestSources();
  if (sources.size === 0) {
    console.error("✗ لم يُقرأ أيُّ ملفِّ اختبارٍ — الكشفُ نفسُه معطوبٌ، ولا يُقرَأ ذلك نجاحاً.");
    process.exit(1);
  }

  let ciSteps: readonly CiStep[] = [];
  try {
    ciSteps = parseCiSteps(readFileSync(`${ROOT}${WORKFLOW}`, "utf8"));
  } catch {
    console.error(`✗ لم يُقرأ ${WORKFLOW} — ولا يُتحقّق مُشغِّلٌ بلا ملفِّ سيرِ عمل.`);
    process.exit(1);
  }
  if (ciSteps.length === 0) {
    console.error(`✗ لم تُقرأ خطوةٌ واحدةٌ من ${WORKFLOW} — القراءةُ النصّيّةُ معطوبةٌ.`);
    process.exit(1);
  }

  const violations = auditRegistry({
    registry: SKIP_REGISTRY,
    sources,
    ciSteps,
    scriptPaths: readScriptPaths(),
  });

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} مخالفةً في تصنيفِ التجاوز (OPS-009):\n`);
    for (const violation of violations) {
      console.error(`  • ${violation}\n`);
    }
    process.exit(1);
  }

  const totalSkipped = SKIP_REGISTRY.reduce((sum, entry) => sum + entry.skipped, 0);
  const critical = SKIP_REGISTRY.filter((entry) => entry.criticalPath !== null).length;
  const unrun = SKIP_REGISTRY.filter((entry) => entry.runsIn === null);
  console.log(
    `✅ كلُّ تجاوزٍ مُصنَّفٌ: ${SKIP_REGISTRY.length} ملفّاً (${totalSkipped} حالةً مقيسةً)، ` +
      `منها ${critical} على مساراتٍ حرجةٍ ولكلٍّ منها مُشغِّلٌ مُتحقَّقٌ في ${WORKFLOW}.`,
  );
  for (const entry of unrun) {
    console.log(
      `⚠ ${entry.file}: ${entry.skipped} حالةً لا مُشغِّلَ لها اليوم (${entry.gate}) — ` +
        `مُعلَنٌ دَيناً، مالكُه: ${entry.owner}.`,
    );
  }
}

main();
