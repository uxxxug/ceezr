#!/usr/bin/env bun
/**
 * # الحاجزُ: ميزانُ التوثيقِ — `S-4` · `ADR 0097`
 *
 * **الغرض:** أن تبقى الوثيقةُ **وسيلةً لا تسليماً** (`ADR 0094` §3). فالشكوى
 * التي أنشأَت هذا البندَ أنَّ التوثيقَ صارَ أكبرَ من المنتجِ؛ والجوابُ ليسَ حذفَ
 * دليلٍ (`ح-2`) بل **سقّاطةً** تمنعُ النموَّ:
 *
 * 1. **سقفُ الجديدِ**: وثيقةٌ ليسَت في خطِّ الأساسِ لا تتجاوزُ 400 سطرٍ.
 * 2. **السقّاطةُ**: وثيقةٌ في خطِّ الأساسِ **تنقصُ ولا تنمو**.
 * 3. **المُخرَجُ الخامُّ**: `.txt`/`.log`/`.out` جديدٌ لا يسكنُ إلّا
 *    `docs/evidence/archive/`.
 * 4. **النسبةُ**: سطورُ `docs/` ≤ 0.75 × سطورِ الكودِ (الحالُ ~0.55).
 *
 * **الحالة:** مُنفَّذ · مُختبَرٌ سقوطُه بخرقٍ مزروعٍ في
 * `tests/unit/check-docs-budget.test.ts` — لا بالمستودَعِ كما هوَ.
 *
 * **ما لا يفعلُه عن قصدٍ:**
 * - **لا يحذفُ ولا يقترحُ حذفاً.** الدليلُ يُؤرشَفُ ولا يُمحى.
 * - **لا يحسبُ خطَّ الأساسِ من الحاضرِ.** خطُّ الأساسِ ملفٌّ مُلتزَمٌ، و`--write`
 *   يُنزِلُ ويُسقِطُ ولا يرفعُ ولا يُضيفُ متجاوزاً.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type DocFile,
  type DocsBudgetInputs,
  docsBudgetProblems,
  MAX_DOCS_TO_SOURCE_RATIO,
  ratchetBaseline,
} from "./lib/docs-budget.ts";

const DOCS_ROOT = "docs";
const SOURCE_ROOTS = ["apps", "packages", "scripts", "supabase"] as const;
const BASELINE_PATH = "scripts/lib/docs-budget-baseline.json";
const DOC_EXTENSIONS = /\.(md|txt|log|out)$/;
const SOURCE_EXTENSIONS = /\.(ts|tsx|sql|sh)$/;

function walk(dir: string, pattern: RegExp, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, pattern, out);
    else if (pattern.test(entry)) out.push(path);
  }
}

/** عددُ السطورِ كما يعدُّها `wc -l`: فواصلُ الأسطرِ لا الأسطرُ المنطقيّةُ. */
function countLines(path: string): number {
  const text = readFileSync(path, "utf8");
  let lines = 0;
  for (const character of text) if (character === "\n") lines += 1;
  return lines;
}

export function defaultInputs(): DocsBudgetInputs {
  const docPaths: string[] = [];
  walk(DOCS_ROOT, DOC_EXTENSIONS, docPaths);

  const sourcePaths: string[] = [];
  for (const root of SOURCE_ROOTS) walk(root, SOURCE_EXTENSIONS, sourcePaths);

  const docs: DocFile[] = docPaths.map((path) => ({
    path: path.split("\\").join("/"),
    lines: countLines(path),
  }));
  const sourceLines = sourcePaths.reduce((sum, path) => sum + countLines(path), 0);

  return {
    docs,
    sourceLines,
    baseline: JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Record<string, number>,
  };
}

if (import.meta.main) {
  const inputs = defaultInputs();

  if (inputs.docs.length === 0 || inputs.sourceLines === 0) {
    console.error("✗ لم يُقرأ توثيقٌ أو كودٌ — الكشفُ معطوبٌ، ولا يُقرأُ نجاحاً.");
    process.exit(1);
  }

  if (process.argv.includes("--write")) {
    const next = ratchetBaseline(inputs);
    const ordered = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(BASELINE_PATH, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
    const lowered = Object.entries(ordered).filter(
      ([path, allowance]) => inputs.baseline[path] !== allowance,
    ).length;
    const dropped = Object.keys(inputs.baseline).length - Object.keys(ordered).length;
    console.log(`✍️  خطُّ أساسِ الميزانِ: ${lowered} رقماً نزلَ · ${dropped} مفتاحاً سقطَ.`);
    process.exit(0);
  }

  const problems = docsBudgetProblems(inputs);
  if (problems.length > 0) {
    console.error(`✗ ${problems.length} مخالفةً في ميزانِ التوثيقِ (ADR 0097):\n`);
    for (const problem of problems) console.error(`  • [${problem.rule}] ${problem.detail}\n`);
    process.exit(1);
  }

  const docsLines = inputs.docs.reduce((sum, doc) => sum + doc.lines, 0);
  const ratio = (docsLines / inputs.sourceLines).toFixed(3);
  console.log(
    `✅ ميزانُ التوثيقِ مستقيمٌ: ${inputs.docs.length} وثيقةً · ${docsLines} سطراً ` +
      `مقابلَ ${inputs.sourceLines} سطرَ كودٍ (نسبةٌ ${ratio} والسقفُ ${MAX_DOCS_TO_SOURCE_RATIO}) · ` +
      `${Object.keys(inputs.baseline).length} وثيقةً مُستثناةً لا تنمو.`,
  );
}
