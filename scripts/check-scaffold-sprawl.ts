#!/usr/bin/env bun
/**
 * # الحاجزُ: ملفّاتُ القوالبِ الفارغةُ (scaffold sprawl) — D-15
 *
 * **الغرض:** أن يكونَ وجودُ ملفّاتٍ بـ`export {};` فقط **مُقيساً** لا مُدَّعى.
 * فالمشروعُ يحوي ملفّاتٍ كثيرةً أُنشِئَتْ قوالبَ للعملِ المستقبليِّ ولم تُملأ
 * بعدُ. وجودُها ليسَ عيباً في ذاتِه — لكنَّ استيرادَها في شيفرةٍ إنتاجيّةٍ
 * عيبٌ: ملفٌّ فارغٌ لا يُصدِّرُ شيئاً يُستوردُ صامتاً فيفشلُ في وقتِ التشغيلِ
 * أو يُنتِجُ سلوكاً فارغاً.
 *
 * **ما يفحصُ:**
 * 1. يجدُ كلَّ ملفٍّ `.ts`/`.tsx` محتواهُ `export {};` فقط (سواءٌ معَ بياضٍ
 *    وتعليقاتٍ أو بلا).
 * 2. يفحصُ أنَّ لا أحدَ يستوردُ من هذه الملفّاتِ في `apps/` أو `packages/`
 *    أو `tests/` أو `scripts/`.
 *
 * **ما لا يفعلهُ عن قصدٍ:**
 * - **لا يحذفُ الملفّاتِ الفارغةَ.** الحذفُ قرارُ تطويرٍ، والحاجزُ يُقيسُ
 *   الأثرَ لا يُحدِّدُه.
 * - **لا يُجبرُ على ملءِ الملفّاتِ.** القالبُ الفارغُ مشروعٌ ما دامَ
 *   لا يُستوردُ.
 *
 * **الحالة:** D-15 — مُنفَّذ.
 * **ينتمي إلى:** سجلُّ الديونِ التقنيّةِ 2026-09-17.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const SCAN_ROOTS = ["apps", "packages", "tests", "scripts"] as const;
const FILE_EXTENSIONS = [".ts", ".tsx"] as const;

/** يجدُ كلَّ ملفٍّ في الشجرةِ */
function walk(dir: string, results: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath, results);
    } else if (FILE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

/** يتحقَّقُ هل الملفُّ قالبٌ فارغٌ (محتواهُ `export {};` فقط معَ بياضٍ وتعليقاتٍ) */
function isScaffoldOnly(filePath: string): boolean {
  const raw = readFileSync(filePath, "utf-8");
  // أزلِ التعليقاتِ والبياضَ
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/\/\/[^\n]*/g, "") // line comments
    .replace(/\s+/g, "")
    .trim();
  return stripped === "export{};" || stripped === "export{}";
}

/** يستخرجُ مسارَ الاستيرادِ من سطرِ استيرادٍ */
function extractImportPaths(content: string): string[] {
  const paths: string[] = [];
  // import ... from "..."
  const fromMatches = content.matchAll(/from\s+["']([^"']+)["']/g);
  for (const m of fromMatches) if (m[1] !== undefined) paths.push(m[1]);
  // import "..."
  const bareMatches = content.matchAll(/import\s+["']([^"']+)["']/g);
  for (const m of bareMatches) if (m[1] !== undefined) paths.push(m[1]);
  // dynamic import("...")
  const dynamicMatches = content.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g);
  for (const m of dynamicMatches) if (m[1] !== undefined) paths.push(m[1]);
  return paths;
}

/** يحلُّ مسارَ استيرادٍ نسبيٍّ إلى مسارِ ملفٍّ مُحتمل */
function resolveImportPath(importPath: string, importerDir: string): string[] {
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
    return []; // non-relative imports can't be scaffold files
  }
  const candidates: string[] = [];
  const basePath = join(importerDir, importPath);
  for (const ext of FILE_EXTENSIONS) {
    candidates.push(`${basePath}${ext}`);
    candidates.push(join(basePath, `index${ext}`));
  }
  return candidates;
}

function main(): void {
  const allFiles: string[] = [];
  for (const root of SCAN_ROOTS) {
    try {
      walk(root, allFiles);
    } catch {
      // root doesn't exist
    }
  }

  // Step 1: Find scaffold files
  const scaffoldFiles = new Set<string>();
  for (const file of allFiles) {
    if (isScaffoldOnly(file)) {
      scaffoldFiles.add(file);
    }
  }

  console.log(`▶ ${scaffoldFiles.size} ملفُّ قالبٍ فارغٌ (export {};) — فحصُ الاستيراد...`);

  // Step 2: Check if any non-scaffold file imports from scaffold files
  const violations: string[] = [];
  for (const file of allFiles) {
    if (scaffoldFiles.has(file)) continue;

    const content = readFileSync(file, "utf-8");
    const importPaths = extractImportPaths(content);
    const importerDir = dirname(file);

    for (const imp of importPaths) {
      const resolved = resolveImportPath(imp, importerDir);
      for (const candidate of resolved) {
        if (scaffoldFiles.has(candidate)) {
          violations.push(
            `❌ ${relative(".", file)} يستوردُ ${relative(".", candidate)} — قالبٌ فارغٌ في الإنتاجِ`,
          );
        }
      }
    }
  }

  if (violations.length > 0) {
    for (const v of violations) console.error(v);
    console.error(`\n❌ ${violations.length} استيرادٌ من ملفّاتٍ فارغةٍ — يُمنعُ في الإنتاجِ`);
    process.exit(1);
  }

  console.log(`✅ لا استيرادَ من ملفّاتٍ فارغةٍ في الإنتاجِ (${scaffoldFiles.size} ملفُّ قالبٍ مُقيسٌ)`);
}

main();
