/**
 * الغرض: بوابةُ CI للضابطِ الأوّلِ من `F8-08` — **التفويضُ على مستوى الكائنِ في
 *    كلِّ مسارٍ**. تقرأُ موجّهاتِ البوّابةِ من القرصِ وتحكمُ بعقدٍ مكتوبٍ في
 *    `scripts/lib/object-authorization-contract.ts`.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُستخدم من: package.json (سلسلةُ `ci`) · .github/workflows/ci.yml (وظيفةُ `verify`)
 * الحاكم: ADR 0132 · البند `F8-08` (الضابطُ الأوّلُ وحدَه)
 * ملاحظات مستقبلية: الضوابطُ الخمسةَ عشرَ الأخرى في `F8-08` **ليست ههنا ولا
 *    يُدَّعى أيٌّ منها**؛ وهذا الحاجزُ يحكمُ **شكلَ المُعالِجِ** — وأثرُ المِلكِيَّةِ
 *    في القاعدةِ يُقاسُ في `tests/integration/object-level-authorization.test.ts`.
 *
 * لماذا فحصٌ لا مراجعة: ثغرةُ المِلكِيَّةِ لا تُسقِطُ اختباراً ولا تُبطئُ طلباً ولا
 * تظهرُ في سجلٍّ — المسارُ يعملُ ويُعيدُ ٢٠٠ وجسمُه صفٌّ لغيرِ سائلِه. ومسارٌ سادسٌ
 * وعشرونَ يُكتَبُ غداً بلا ناظرٍ يمرُّ من كلِّ مراجعةٍ بشريّةٍ مشغولةٍ.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import {
  describeObjectAuthorizationViolation,
  OBJECT_ROUTE_EXEMPTIONS,
  objectAuthorizationViolations,
  parseRouteHandlers,
  type RouteSource,
} from "./lib/object-authorization-contract.ts";
import { toPosixPath } from "./lib/repo-path.ts";

const ROOT = process.cwd();
const ROUTES_DIRECTORY = join(ROOT, "apps", "gateway", "src", "routes");

function typeScriptFilesIn(directory: string): string[] {
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(directory, entry);
    let isDirectory = false;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) {
      found.push(...typeScriptFilesIn(full));
      continue;
    }
    if (extname(entry) !== ".ts") continue;
    if (entry.endsWith(".test.ts")) continue;
    found.push(full);
  }
  return found;
}

const sources: RouteSource[] = [];
for (const file of typeScriptFilesIn(ROUTES_DIRECTORY)) {
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  sources.push({ path: toPosixPath(relative(ROOT, file)), source });
}

// **وصفرُ ملفّاتٍ خرقٌ لا نجاحٌ**: فحصٌ لا يجدُ ما يفحصُه يُخفِقُ بصوتٍ، وإلّا
// صارَ نقلُ مجلَّدٍ طريقةً صامتةً لإطفاءِ الحاجزِ.
if (sources.length === 0) {
  console.error("✗ F8-08: لم يُقرأْ موجّهٌ واحدٌ من `apps/gateway/src/routes` — الفحصُ بلا مُدخَلٍ خرقٌ");
  process.exit(1);
}

const handlers = parseRouteHandlers(sources);
const violations = objectAuthorizationViolations(sources, { completeTree: true });

if (violations.length > 0) {
  console.error(`✗ F8-08: ${violations.length} خرقاً في التفويضِ على مستوى الكائنِ`);
  for (const violation of violations) {
    console.error(`  ${describeObjectAuthorizationViolation(violation)}`);
  }
  process.exit(1);
}

const exempt = OBJECT_ROUTE_EXEMPTIONS.length;
console.log(
  `✓ F8-08 (الضابطُ الأوّلُ): ${String(handlers.length)} مساراً بمعرِّفِ كائنٍ — ` +
    `${String(handlers.length - exempt)} مُقيَّداً بالناظرِ · ${String(exempt)} مستثنىً بصنفِه وسببِه ودليلِه. ` +
    "ولا يُدَّعى شيءٌ من الضوابطِ الخمسةَ عشرَ الأخرى.",
);
