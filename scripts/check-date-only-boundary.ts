#!/usr/bin/env bun
/**
 * الغرض: إنفاذُ قاعدةٍ واحدةٍ على كلِّ هجراتِ المستودَعِ — **لا عمودَ `date` في
 *   عقدِ خرجِ دالّةِ قاعدةٍ**. الشرحُ والبديلُ في
 *   `scripts/lib/date-only-boundary.ts`.
 * الحالة: منفّذ فعلياً — بوّابةُ CI.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run ci` و .github/workflows/ci.yml
 * يُتوقع أن يستخدمه لاحقاً: كلُّ بندٍ يُخرِجُ تاريخاً مجرَّداً — الوثائقُ
 *   والاشتراكاتُ والتقاريرُ اليوميّةُ.
 * الحاكم: docs/adr/0121-a-bare-date-crosses-the-boundary-as-text.md
 *
 * ## لماذا سكربتٌ منفصلٌ عن المكتبةِ
 * المنطقُ خالصٌ في المكتبةِ فيُقاسُ بنصٍّ مزروعٍ لا بما يصادفُه القرصُ (ح-٧)،
 * وهذا الملفُّ مسحُ قرصٍ وحكمُ خروجٍ. وقد مرَّ في هذا المستودَعِ حاجزٌ **أخضرُ
 * وهوَ معطوبٌ** لأنّه قِيسَ على المستودَعِ الحقيقيِّ وحدَه — فالفصلُ ليسَ أناقةً.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type DateOnlyViolation,
  dateOnlyViolationsIn,
  describeDateOnlyViolation,
  MIGRATIONS_ROOT,
} from "./lib/date-only-boundary.ts";
import { toPosixPath } from "./lib/repo-path.ts";

function main(): void {
  const files = readdirSync(MIGRATIONS_ROOT)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const violations: DateOnlyViolation[] = [];
  for (const name of files) {
    const path = toPosixPath(join(MIGRATIONS_ROOT, name));
    violations.push(...dateOnlyViolationsIn(path, readFileSync(path, "utf8")));
  }

  if (violations.length === 0) {
    console.log(
      `✅ ${String(files.length)} هجرةً: لا عمودَ \`date\` في عقدِ خرجٍ — ` +
        `التاريخُ المجرَّدُ يعبرُ الحدَّ نصّاً بصيغةِ \`YYYY-MM-DD\`.`,
    );
    return;
  }

  console.error("❌ عمودُ `date` في عقدِ خرجٍ — يصلُ العميلَ كائنَ `Date` فيُقرأُ عَدَماً بلا خطأٍ:\n");
  for (const violation of violations) console.error(`${describeDateOnlyViolation(violation)}\n`);
  process.exit(1);
}

main();
