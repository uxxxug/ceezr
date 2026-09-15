#!/usr/bin/env bun
/**
 * الغرض: إنفاذُ قاعدةٍ واحدةٍ على كلِّ اختباراتِ المستودَعِ — **لا منطقةَ زمنٍ
 *   مُثبَّتةً بحرفٍ في ملفٍّ يقرأُ نافذةً محليّةً**. الشرحُ والبديلُ في
 *   `scripts/lib/wall-clock-window-tests.ts`.
 * الحالة: منفّذ فعلياً — بوّابةُ CI.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run ci` و .github/workflows/ci.yml
 * يُتوقع أن يستخدمه لاحقاً: كلُّ بندٍ يقيسُ تقريراً بنافذةِ يومٍ أو أسبوعٍ أو شهرٍ.
 * الحاكم: docs/adr/0123-a-local-window-is-not-the-wall-clock.md
 *
 * ## لماذا سكربتٌ منفصلٌ عن المكتبةِ
 * المنطقُ خالصٌ في المكتبةِ فيُقاسُ بنصٍّ مزروعٍ لا بما يصادفُه القرصُ (ح-٧)،
 * وهذا الملفُّ مسحُ قرصٍ وحكمُ خروجٍ. وقد مرَّ في هذا المستودَعِ حاجزٌ **أخضرُ
 * وهوَ معطوبٌ** لأنّه قِيسَ على المستودَعِ الحقيقيِّ وحدَه — فالفصلُ ليسَ أناقةً.
 */

import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { toPosixPath } from "./lib/repo-path.ts";
import {
  describeWallClockWindowViolation,
  TEST_ROOTS,
  type WallClockWindowViolation,
  wallClockWindowViolationsIn,
} from "./lib/wall-clock-window-tests.ts";

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

  const violations: WallClockWindowViolation[] = [];
  for (const file of files.sort()) {
    violations.push(...wallClockWindowViolationsIn(file, await readFile(file, "utf8")));
  }

  if (violations.length === 0) {
    console.log(
      `✅ ${String(files.length)} ملفَّ اختبارٍ: لا منطقةَ زمنٍ مُثبَّتةً بحرفٍ في ` +
        `ملفٍّ يقرأُ نافذةً محليّةً — فلا فحصَ يسقطُ بعدَ منتصفِ الليلِ.`,
    );
    return;
  }

  console.error("❌ منطقةُ زمنٍ مُثبَّتةٌ بحرفٍ في اختبارٍ يقرأُ نافذةً محليّةً — فحصٌ رهنَ ساعةِ الحائطِ:\n");
  for (const violation of violations)
    console.error(`${describeWallClockWindowViolation(violation)}\n`);
  process.exit(1);
}

await main();
