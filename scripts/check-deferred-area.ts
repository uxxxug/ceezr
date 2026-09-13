#!/usr/bin/env bun
/**
 * # الحاجزُ: منطقةُ التأجيلِ مُقفَلةٌ لا مفتوحةٌ — `S-2` · `ADR 0095`
 *
 * **الغرض:** أن يكونَ التأجيلُ **واقعاً مقيساً** لا تسميةَ مجلَّدٍ. فالنقلُ إلى
 * `deferred/` لا يُجدي شيئاً إن بقيَ التطبيقُ يستوردُ منه، أو بقيَ المُطبِّقُ
 * يُطبِّقُ هجراتِه، أو دخلَ مجلّدٌ مؤجَّلٌ بلا سببٍ مكتوبٍ. وههنا يُقاسُ ذلكَ:
 *
 * 1. **لا استيرادَ**: لا ملفَّ تحتَ `apps/` أو `packages/` أو `tests/` أو
 *    `scripts/` يستوردُ شيئاً من `deferred/`. والمُستثنى بالاسمِ: هذا الحاجزُ،
 *    و`scripts/lib/migration-sources.ts` الذي **يُعلِنُ** المسارَ ولا يُنفِّذُه.
 * 2. **لا تطبيقَ**: لا اسمَ ملفِّ هجرةٍ مؤجَّلةٍ مذكورٌ في مصفوفةِ الهجرةِ ولا
 *    في المُطبِّقِ، ولا يوجدُ ملفٌّ بالاسمِ نفسِه في `supabase/migrations` —
 *    فالتوأمُ يُبطِلُ التأجيلَ صامتاً.
 * 3. **لا صمتَ**: كلُّ مجلّدٍ مباشرٍ تحتَ `deferred/` له `README.md` يسمّي البندَ
 *    والقرارَ وشرطَ الاستئنافِ.
 *
 * **الحالة:** `S-2` — مُنفَّذ · مُختبَرٌ سقوطُه في
 * `tests/unit/check-deferred-area.test.ts`.
 *
 * **ينتمي إلى:** `ADR 0095` · تعليمةُ المالكِ `O-7`.
 *
 * **ما لا يفعلُه عن قصدٍ:**
 * - **لا يمنعُ التأجيلَ.** التأجيلُ قرارُ مالكٍ؛ والمقيسُ ههنا أنَّه **مُطبَّقٌ**
 *   لا مُدَّعى.
 * - **لا يقرأُ TypeScript بمُحلِّلٍ.** البحثُ نصّيٌّ على صيغِ الاستيرادِ
 *   المعروفةِ — والحدُّ مُعلَنٌ لا مضمرٌ.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { appliedMigrations, DEFERRED_MIGRATION_DIRS } from "./lib/migration-sources.ts";

const DEFERRED_ROOT = "deferred";
const SCAN_ROOTS = ["apps", "packages", "tests", "scripts"] as const;

/** ملفّاتٌ تذكرُ المسارَ المؤجَّلَ **إعلاناً** لا استيراداً. */
const DECLARERS: readonly string[] = [
  "scripts/check-deferred-area.ts",
  "scripts/lib/migration-sources.ts",
  "scripts/lib/skip-registry.ts",
  "scripts/check-core-contract-parity.ts",
  "tests/unit/check-deferred-area.test.ts",
  "tests/unit/core-contract-parity.test.ts",
  "tests/unit/skip-audit.test.ts",
];

/** أقسامٌ لا يكونُ بيانُ التأجيلِ بياناً بلا واحدٍ منها. */
const REQUIRED_README_SECTIONS = ["البند", "القرار", "شرطُ الاستئناف"] as const;

export interface Problem {
  readonly where: string;
  readonly detail: string;
}

export interface DeferredInputs {
  /** ملفّاتُ الشجرةِ الحيّةِ: المسارُ ونصُّه. */
  readonly sources: readonly { readonly file: string; readonly text: string }[];
  /** أسماءُ ملفّاتِ الهجراتِ المؤجَّلةِ. */
  readonly deferredMigrations: readonly string[];
  /** أسماءُ ملفّاتِ الهجراتِ المُطبَّقةِ. */
  readonly appliedMigrationNames: readonly string[];
  /** لكلِّ مجلّدٍ مؤجَّلٍ: نصُّ `README.md` أو `null` إن غابَ. */
  readonly readmes: readonly { readonly dir: string; readonly text: string | null }[];
}

/** صيغُ الاستيرادِ التي تُحدِثُ اعتماداً حقيقيّاً وقتَ التشغيلِ. */
const IMPORT_PATTERNS: readonly RegExp[] = [
  /(?:^|[^\w])from\s+["'][^"']*deferred\/[^"']*["']/,
  /(?:^|[^\w])import\s+["'][^"']*deferred\/[^"']*["']/,
  /require\(\s*["'][^"']*deferred\/[^"']*["']\s*\)/,
  /import\(\s*["'][^"']*deferred\/[^"']*["']\s*\)/,
];

export function deferredProblems(inputs: DeferredInputs): readonly Problem[] {
  const problems: Problem[] = [];

  // ١ — لا استيرادَ من المؤجَّلِ في الشجرةِ الحيّةِ.
  for (const source of inputs.sources) {
    if (DECLARERS.includes(source.file)) continue;
    if (IMPORT_PATTERNS.some((pattern) => pattern.test(source.text))) {
      problems.push({
        where: source.file,
        detail:
          "يستوردُ من `deferred/` — والتأجيلُ الذي يُستوردُ منه ليسَ تأجيلاً، " +
          "بل ميزةٌ حيّةٌ خرجَت من الحواجزِ.",
      });
    }
  }

  // ٢ — لا هجرةَ مؤجَّلةٍ لها توأمٌ في مسارِ التطبيقِ.
  const applied = new Set(inputs.appliedMigrationNames);
  for (const name of inputs.deferredMigrations) {
    if (applied.has(name)) {
      problems.push({
        where: name,
        detail:
          "هجرةٌ مؤجَّلةٌ لها ملفٌّ بالاسمِ نفسِه في `supabase/migrations` — " +
          "والتوأمُ يُبطِلُ التأجيلَ صامتاً.",
      });
    }
  }

  // ٣ — لا مجلّدَ مؤجَّلٍ بلا بيانٍ مقروءٍ.
  for (const { dir, text } of inputs.readmes) {
    if (text === null) {
      problems.push({
        where: `${DEFERRED_ROOT}/${dir}`,
        detail: "مجلّدٌ مؤجَّلٌ بلا `README.md` — تأجيلٌ بلا سببٍ مكتوبٍ مقبرةٌ لا قرارٌ.",
      });
      continue;
    }
    const missing = REQUIRED_README_SECTIONS.filter((section) => !text.includes(section));
    if (missing.length > 0) {
      problems.push({
        where: `${DEFERRED_ROOT}/${dir}/README.md`,
        detail: `بيانٌ ناقصٌ — لا يذكرُ: ${missing.join(" · ")}`,
      });
    }
  }

  return problems;
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|js|mjs|json|ya?ml|sql)$/.test(entry)) out.push(path);
  }
}

export function defaultInputs(): DeferredInputs {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) walk(root, files);

  const deferredMigrations = DEFERRED_MIGRATION_DIRS.flatMap((dir) =>
    existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".sql")) : [],
  );

  const dirs = existsSync(DEFERRED_ROOT)
    ? readdirSync(DEFERRED_ROOT).filter((entry) =>
        statSync(join(DEFERRED_ROOT, entry)).isDirectory(),
      )
    : [];

  return {
    sources: files.map((file) => ({ file, text: readFileSync(file, "utf8") })),
    deferredMigrations,
    appliedMigrationNames: appliedMigrations().map((entry) => entry.file),
    readmes: dirs.map((dir) => {
      const path = join(DEFERRED_ROOT, dir, "README.md");
      return { dir, text: existsSync(path) ? readFileSync(path, "utf8") : null };
    }),
  };
}

if (import.meta.main) {
  const inputs = defaultInputs();
  if (inputs.sources.length === 0) {
    console.error("✗ لم يُقرأ ملفٌّ واحدٌ من الشجرةِ الحيّةِ — الكشفُ معطوبٌ، ولا يُقرأُ نجاحاً.");
    process.exit(1);
  }
  const problems = deferredProblems(inputs);
  if (problems.length > 0) {
    console.error(`✗ ${problems.length} مخالفةً في منطقةِ التأجيلِ (ADR 0095):\n`);
    for (const problem of problems) console.error(`  • ${problem.where}: ${problem.detail}\n`);
    process.exit(1);
  }
  console.log(
    `✅ منطقةُ التأجيلِ مُقفَلةٌ: ${inputs.readmes.length} مجلّداً مُبيَّناً · ` +
      `${inputs.deferredMigrations.length} هجرةً مؤجَّلةً لا توأمَ لها في مسارِ التطبيقِ · ` +
      `${inputs.sources.length} ملفّاً حيّاً لا يستوردُ منها شيءٌ.`,
  );
}
