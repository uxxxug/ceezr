#!/usr/bin/env bun
/**
 * الغرض: إنفاذُ قاعدةٍ واحدةٍ على كلِّ اختباراتِ المستودَعِ — **لا شاهدَ يقرأُ
 *   ترتيبَ التسليمِ في اختبارٍ متزامنٍ**. الشرحُ والبديلُ في
 *   `scripts/lib/sequence-witness-order.ts`.
 * الحالة: منفّذ فعلياً — بوّابةُ CI.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run ci` و .github/workflows/ci.yml
 * يُتوقع أن يستخدمه لاحقاً: كلُّ اختبارِ سباقٍ على قناةِ تتبُّعٍ.
 * الحاكم: docs/adr/0147-no-delivery-order-witness-in-a-concurrent-test.md
 *
 * ## لماذا سكربتٌ منفصلٌ عن المكتبةِ
 * المنطقُ خالصٌ في المكتبةِ فيُقاسُ بنصٍّ مزروعٍ لا بما يصادفُه القرصُ (`ح-7`)،
 * وهذا الملفُّ مسحُ قرصٍ وحكمُ خروجٍ.
 */

import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { toPosixPath } from "./lib/repo-path.ts";
import {
  describeSequenceWitnessViolation,
  type SequenceWitnessViolation,
  sequenceWitnessViolationsIn,
  TEST_ROOTS,
} from "./lib/sequence-witness-order.ts";

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

  const violations: SequenceWitnessViolation[] = [];
  for (const file of files.sort()) {
    violations.push(...sequenceWitnessViolationsIn(file, await readFile(file, "utf8")));
  }

  if (violations.length === 0) {
    console.log(
      `✅ ${String(files.length)} ملفَّ اختبارٍ: لا شاهدَ يقابلُ آخرَ المنشورِ ` +
        "بـ`last_sequence` في اختبارٍ متزامنٍ — فلا توكيدَ يقيسُ الجدولةَ.",
    );
    return;
  }

  console.error("❌ شاهدٌ يقيسُ جدولةَ التنفيذِ لا العقدَ — أخفقَ في CI ثلاثَ مرّاتٍ:\n");
  for (const violation of violations) {
    console.error(`${describeSequenceWitnessViolation(violation)}\n`);
  }
  process.exit(1);
}

await main();
