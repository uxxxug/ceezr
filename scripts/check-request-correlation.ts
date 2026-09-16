/**
 * الغرض: بوابةُ CI للبندِ `F8-01` — **سلسلةُ ارتباطٍ واحدةٌ من الحافةِ إلى القاعدةِ
 *    وعبرَ الطابورِ** (`OPS-002` · `ADR 0129`). تقرأُ الهجراتَ وشيفرةَ الخادمِ
 *    وتحكمُ بعقدٍ مكتوبٍ في `scripts/lib/request-correlation-contract.ts`.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُستخدم من: package.json (سلسلةُ `ci`) · .github/workflows/ci.yml (وظيفةُ `verify`)
 * الحاكم: ADR 0129 · البند `F8-01`
 * ملاحظات مستقبلية: ناقلُ OTel وجامِعُه ليسا ههنا (`DEC-17` · `F9-01`)؛ وهذا الحاجزُ
 *    يحكمُ **بنيةَ** السلسلةِ لا وصولَها إلى جامعٍ خارجيٍّ.
 *
 * لماذا فحصٌ لا مراجعة: سلسلةُ ارتباطٍ تنكسرُ بسطرٍ واحدٍ — دعوةٌ لا تُلفَّ، أو
 * عمودٌ يُدرَجُ صريحاً بقيمةٍ من عندِه، أو اسمُ متغيّرٍ يُنسَخُ إلى ملفٍّ ثانٍ فينحرفُ.
 * ولا يُكتشَفُ الكسرُ إلّا في ليلةِ العطبِ التي بُنيَ لها. فالبناءُ يحكمُ الآنَ.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { toPosixPath } from "./lib/repo-path.ts";
import {
  auditRequestCorrelation,
  CORRELATED_CALL_SITES,
  CORRELATED_TABLES,
  CORRELATION_MIGRATION,
  CORRELATION_VALIDATE_MIGRATION,
  SCANNED_ROOTS,
} from "./lib/request-correlation-contract.ts";

// الجذرُ هوَ مجلَّدُ التشغيلِ: كلُّ فاحصٍ ههنا يُشغَّلُ من جذرِ المستودعِ
// (`bun run ci`)، وتوحيدُ الفاصلِ يجعلُ الحكمَ واحداً على كلِّ نظامِ تشغيلٍ.
const ROOT = process.cwd();
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx"]);

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (SCANNED_EXTENSIONS.has(extname(entry))) out.push(full);
  }
}

function readRelative(path: string): string | null {
  try {
    return readFileSync(join(ROOT, path), "utf8");
  } catch {
    return null;
  }
}

const migration = readRelative(CORRELATION_MIGRATION);
const validateMigration = readRelative(CORRELATION_VALIDATE_MIGRATION);
if (migration === null || validateMigration === null) {
  console.error(`✗ F8-01: هجرةُ الارتباطِ أو هجرةُ التحقُّقِ غيرُ موجودةٍ`);
  process.exit(1);
}

const migrationsDir = join(ROOT, "supabase/migrations");
const allMigrations: Record<string, string> = {};
for (const entry of readdirSync(migrationsDir)) {
  if (!entry.endsWith(".sql")) continue;
  allMigrations[`supabase/migrations/${entry}`] = readFileSync(join(migrationsDir, entry), "utf8");
}

const sourceFiles: string[] = [];
for (const root of SCANNED_ROOTS) walk(join(ROOT, root), sourceFiles);
// اختبارٌ يُذكَرُ فيه اسمُ المتغيّرِ صراحةً لغرضٍ مُعلَنٍ، فيدخلُ الفحصَ ليحكمَه العقدُ.
for (const extra of [
  "tests/unit/request-correlation-guard.test.ts",
  "tests/integration/request-correlation.test.ts",
]) {
  sourceFiles.push(join(ROOT, extra));
}

const sources: Record<string, string> = {};
for (const file of sourceFiles) {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  sources[toPosixPath(relative(ROOT, file))] = text;
}

// **وصفرُ مواضعَ خرقٌ لا نجاحٌ** (`ح-5`): فحصٌ لا يجدُ ما يفحصُه يُخفِقُ بصوتٍ.
if (Object.keys(sources).length === 0 || Object.keys(allMigrations).length === 0) {
  console.error("✗ F8-01: لم يُقرأْ شيءٌ — الفحصُ بلا مُدخَلٍ خرقٌ");
  process.exit(1);
}

const findings = auditRequestCorrelation({
  migration,
  validateMigration,
  allMigrations,
  sources,
});

if (findings.length > 0) {
  console.error(`✗ F8-01: ${findings.length} خرقاً في سلسلةِ ارتباطِ الطلبِ`);
  for (const finding of findings) console.error(`  [${finding.rule}] ${finding.detail}`);
  process.exit(1);
}

console.log(
  `✓ F8-01: سلسلةُ ارتباطِ الطلبِ سليمةٌ — ${CORRELATED_TABLES.length} جداولَ موصولةً · ` +
    `${CORRELATED_CALL_SITES.length} مواضعَ استدعاءٍ مُعلَنةً · ${Object.keys(allMigrations).length} هجرةً مفحوصةً`,
);
