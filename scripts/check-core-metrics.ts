#!/usr/bin/env bun
/**
 * الغرض: إنفاذُ عقدِ **المقاييسِ الأساسيّةِ** (`F8-02`) على القرصِ: يقرأُ الملفّاتِ
 *   المحروسةَ، ويُطبِّقُ قواعدَ `scripts/lib/core-metrics-contract.ts`، ويُنهي
 *   بخروجٍ غيرِ صفريٍّ عندَ أوّلِ مخالفةٍ.
 * الحالة: منفّذ فعلياً — بوّابةُ CI.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run ci` و .github/workflows/ci.yml (وظيفةُ `verify`)
 * يُتوقع أن يستخدمه لاحقاً: `F8-07` عندَ ربطِ اللوحاتِ بهذه العائلاتِ نفسِها.
 * الحاكم: docs/adr/0131-a-published-metric-is-a-contract-not-a-comment.md
 *
 * ## لماذا سكربتٌ منفصلٌ عن المكتبةِ
 *
 * المنطقُ خالصٌ في المكتبةِ فيُقاسُ بنصوصٍ مبذورةٍ لا بما يصادفُه القرصُ (`ح-٧`)،
 * وهذا الملفُّ **قراءةُ قرصٍ وحكمُ خروجٍ** لا أكثرُ. وقد مرَّ في هذا المستودَعِ
 * حاجزٌ أخضرُ وهوَ معطوبٌ لأنّه قِيسَ على المستودَعِ الحقيقيِّ وحدَه.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type CoreMetricsViolation,
  coreMetricsViolations,
  describeCoreMetricsViolation,
  GUARDED_FILES,
  type GuardedFileKey,
  unlabelledRouteTemplates,
} from "./lib/core-metrics-contract.ts";

/** جذرُ مساراتِ البوّابةِ: كلُّ قالبٍ مُعلَنٍ تحتَه محكومٌ بقاعدةِ الوسمِ. */
const GATEWAY_ROUTES_ROOT = "apps/gateway/src";

async function readTypeScriptTree(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    // غيابُ الجذرِ تحكُمُ عليهِ `file.present` عبرَ ملفِّ الوسيطِ المحروسِ.
    return files;
  }
  for (const entry of entries) {
    const path = join(root, entry);
    if ((await stat(path)).isDirectory()) {
      Object.assign(files, await readTypeScriptTree(path));
      continue;
    }
    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
    const content = await readIfExists(path);
    if (content !== undefined) files[path] = content;
  }
  return files;
}

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    // الغيابُ **لا يُبتلَعُ**: يُمرَّرُ `undefined` فتحكُمُ عليهِ قاعدةُ
    // `file.present` بمخالفةٍ باسمِ الملفِّ. حاجزٌ يصمتُ عندَ غيابِ ما يحرسُه
    // ليسَ حاجزاً.
    return undefined;
  }
}

async function main(): Promise<void> {
  const sources: Partial<Record<GuardedFileKey, string>> = {};
  for (const [key, path] of Object.entries(GUARDED_FILES) as [GuardedFileKey, string][]) {
    const content = await readIfExists(path);
    if (content !== undefined) sources[key] = content;
  }

  const violations: readonly CoreMetricsViolation[] = [
    ...coreMetricsViolations(sources),
    ...unlabelledRouteTemplates(await readTypeScriptTree(GATEWAY_ROUTES_ROOT)),
  ];

  if (violations.length === 0) {
    console.log(
      "✅ عقدُ المقاييسِ الأساسيّةِ (`F8-02`): الفئاتُ التسعُ منشورةٌ بعائلاتِها، " +
        "ولا وسمَ منفجرَ التعدُّدِ، ولا نسبةَ محسوبةً تُنشَرُ رقماً، " +
        "وزمنُ الإسنادِ من الختمِ المكتوبِ بنافذةٍ منشورةٍ، والمسارُ ما زالَ محروساً، " +
        "وكلُّ قالبٍ مُعلَنٍ في البوّابةِ يبقى وسمَ نفسِه.",
    );
    return;
  }

  console.error("❌ عقدُ المقاييسِ الأساسيّةِ (`F8-02`) مخروقٌ:\n");
  for (const violation of violations) console.error(describeCoreMetricsViolation(violation));
  console.error("");
  process.exit(1);
}

await main();
