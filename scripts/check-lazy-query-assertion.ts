#!/usr/bin/env bun
/**
 * الغرض: إنفاذُ قاعدةٍ واحدةٍ على كلِّ اختباراتِ المستودَعِ — **لا وسمَ استعلامٍ
 *   مُرجَأً داخلَ `expect(…)`**. الشرحُ والبديلُ في
 *   `scripts/lib/lazy-query-assertion.ts`.
 * الحالة: منفّذ فعلياً — بوّابةُ CI.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run ci` و .github/workflows/ci.yml
 * يُتوقع أن يستخدمه لاحقاً: كلُّ بندٍ يقيسُ رفضَ دالّةِ قاعدةٍ في اختبارِ تكاملٍ.
 * الحاكم: docs/adr/0122-a-deferred-query-is-not-a-promise.md
 *
 * ## لماذا سكربتٌ منفصلٌ عن المكتبةِ
 * المنطقُ خالصٌ في المكتبةِ فيُقاسُ بنصٍّ مزروعٍ لا بما يصادفُه القرصُ (ح-٧)،
 * وهذا الملفُّ مسحُ قرصٍ وحكمُ خروجٍ. وقد مرَّ في هذا المستودَعِ حاجزٌ **أخضرُ
 * وهوَ معطوبٌ** لأنّه قِيسَ على المستودَعِ الحقيقيِّ وحدَه — فالفصلُ ليسَ أناقةً.
 */

import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  describeLazyQueryViolation,
  type LazyQueryViolation,
  lazyQueryViolationsIn,
  TEST_ROOTS,
} from "./lib/lazy-query-assertion.ts";
import { toPosixPath } from "./lib/repo-path.ts";

const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "build", ".git", "coverage"]);

async function listTestFiles(root: string): Promise<readonly string[]> {
  const found: string[] = [];
  let entries: readonly Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const path = toPosixPath(join(root, entry.name));
    if (entry.isDirectory()) found.push(...(await listTestFiles(path)));
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(path);
  }
  return found;
}

async function main(): Promise<void> {
  const files: string[] = [];
  for (const root of TEST_ROOTS) files.push(...(await listTestFiles(root)));

  const violations: LazyQueryViolation[] = [];
  for (const file of files.sort()) {
    violations.push(...lazyQueryViolationsIn(file, await readFile(file, "utf8")));
  }

  if (violations.length === 0) {
    console.log(
      `✅ ${String(files.length)} ملفَّ اختبارٍ: لا وسمَ قالبٍ مُرجَأً داخلَ ` +
        `\`expect(…)\` — فلا وعدَ يبقى بلا حسمٍ.`,
    );
    return;
  }

  console.error("❌ وسمُ قالبٍ مُرجَأٌ داخلَ `expect(…)` — وعدٌ لا يُحسَمُ وتعليقٌ صامتٌ في CI:\n");
  for (const violation of violations) console.error(`${describeLazyQueryViolation(violation)}\n`);
  process.exit(1);
}

await main();
