/**
 * الغرض: إنفاذُ قاعدةٍ واحدةٍ على المستودَعِ كلِّه — **لا مُعامِلَ يُربَطُ بـ`::jsonb`
 *   مباشرةً**. الشرحُ والأبدالُ في `scripts/lib/jsonb-binding.ts`.
 * الحالة: منفّذ فعلياً — بوّابةُ CI.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run ci` و .github/workflows/ci.yml
 * يُتوقع أن يستخدمه لاحقاً: كلُّ بندٍ يكتبُ `jsonb` من العميلِ.
 *
 * ## لماذا سكربتٌ منفصلٌ عن المكتبةِ
 * المنطقُ خالصٌ في المكتبةِ فيُقاسُ بنصٍّ مزروعٍ لا بما يصادفُه القرصُ (ح-٧)،
 * وهذا الملفُّ مسحُ قرصٍ وحكمُ خروجٍ. وقد مرَّ في هذا المستودَعِ حاجزٌ **أخضرُ
 * وهوَ معطوبٌ** لأنّه قِيسَ على المستودَعِ الحقيقيِّ وحدَه — فالفصلُ ليسَ أناقةً.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ
 * ــ **لا يمسُّ `supabase/migrations`**: الحرفُ الثابتُ في هجرةٍ لا يمرُّ بسائقٍ.
 * ــ **لا يُصلِحُ آلياً**: البديلُ الصحيحُ يتوقّفُ على نيّةِ الكاتبِ — رقماً أرادَ
 *    أم كائناً أم بايتاً كما هو — والتخمينُ ههنا يُنتِجُ عطباً أهدأَ لا أقلَّ.
 */
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  describeJsonbViolation,
  JSONB_SCAN_ROOTS,
  type JsonbViolation,
  jsonbViolationsIn,
} from "./lib/jsonb-binding.ts";
import { toPosixPath } from "./lib/repo-path.ts";

const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "build", ".git", "coverage"]);

async function listSourceFiles(root: string): Promise<readonly string[]> {
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
    if (entry.isDirectory()) found.push(...(await listSourceFiles(path)));
    else if (/\.(ts|tsx|mts|mjs)$/.test(entry.name)) found.push(path);
  }
  return found;
}

async function main(): Promise<void> {
  const files: string[] = [];
  for (const root of JSONB_SCAN_ROOTS) files.push(...(await listSourceFiles(root)));

  const violations: JsonbViolation[] = [];
  for (const file of files.sort()) {
    violations.push(...jsonbViolationsIn(file, await readFile(file, "utf8")));
  }

  if (violations.length === 0) {
    console.log(`✅ ${String(files.length)} ملفّاً: لا مُعامِلَ مربوطاً بـ\`::jsonb\` بلا ترميزٍ واحدٍ.`);
    return;
  }

  console.error("❌ ربطُ مُعامِلٍ بـ`::jsonb` — القيمةُ تُرمَّزُ مرّتَينِ فتصلُ القاعدةَ نصّاً:\n");
  for (const violation of violations) console.error(`${describeJsonbViolation(violation)}\n`);
  process.exit(1);
}

await main();
