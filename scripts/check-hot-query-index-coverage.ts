/**
 * الغرض: `F7-02` / `CAP-005` — حاجزٌ يُثبِتُ أنَّ كلَّ فهرسٍ في سجلِّ الاستعلاماتِ
 *   الساخنةِ: (١) لهُ ملفُّ هجرةٍ موجودٌ يُنشئُه بالاسمِ · (٢) والهجرةُ تُصرِّحُ
 *   `-- migration-phase: index` وتُنشئُ فهرساً واحداً `concurrently if not exists`
 *   لا غيرَ · (٣) ولهُ مُستدعٍ إنتاجيٌّ ملفُّه موجودٌ ويذكرُ جدولَه (القاعدةُ 0.1)
 *   · (٤) وليسَ مُكرِّراً لفهرسٍ قائمٍ بنفسِ الأعمدةِ ونفسِ الشرطِ · (٥) وأنَّ
 *   اختبارَ خطّةِ التنفيذِ يقيسُه بالاسمِ فلا يبقى فهرسٌ بلا قياسٍ قبل/بعد.
 *
 * الحالة: حاجزٌ في `package.json ci` ووظيفةِ `verify`.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: كلُّ فهرسٍ يُضافُ لخدمةِ استعلامٍ ساخنٍ.
 * ملاحظات مستقبلية: إن صارَت الفهارسُ عشراتٍ فليُقسَمِ السجلُّ بالمجالِ لا
 *   بالحجمِ، فالمصدرُ الواحدُ أهمُّ من قِصَرِ الملفِّ.
 * ما لا يفعله — وحدودُه مُعلَنةٌ لا مضمرةٌ:
 *   - لا يتّصلُ بقاعدةٍ ولا يُنفِّذُ `explain`؛ الخطّةُ تُقاسُ في التكاملِ على
 *     محرِّكٍ حقيقيٍّ (`tests/integration/hot-query-index-plans.test.ts`)، وهذا
 *     الحاجزُ يُثبِتُ الاتّساقَ النصّيَّ وحدَه.
 *   - لا يتحقّقُ من وجودِ العمودِ في المخطَّطِ؛ الهجرةُ نفسُها تسقطُ في CI إن
 *     كانَ العمودُ معدوماً، وذلكَ قياسٌ أصدقُ من تحليلٍ نصّيٍّ.
 *   - لا يُرتِّبُ الأثرَ ولا يُراجِعُه؛ الرتبةُ إعلانٌ بشريٌّ في السجلِّ.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HOT_QUERY_INDEX_PHASE,
  HOT_QUERY_INDEXES,
  indexColumnsOf,
  indexPredicateOf,
} from "./lib/hot-query-indexes.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const PLAN_TEST = "tests/integration/hot-query-index-plans.test.ts";

const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

const migrationNames = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql"));

/** نصُّ كلِّ الهجراتِ مجموعاً — لحصرِ الفهارسِ القائمةِ على الجدولِ نفسِه. */
const allMigrationsSql = migrationNames
  .map((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8"))
  .join("\n");

const planTestSql = existsSync(PLAN_TEST) ? readFileSync(PLAN_TEST, "utf8") : null;
if (planTestSql === null) {
  fail(`اختبارُ الخطّةِ معدومٌ: ${PLAN_TEST} — فالفهارسُ تُنشأُ بلا قياسِ قبل/بعد.`);
}

/** عباراتُ `create index` في نصٍّ ما — بلا تعليقاتٍ. */
function createIndexStatements(sql: string): string[] {
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  return withoutComments
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => /^create\s+(unique\s+)?index\b/i.test(statement));
}

for (const entry of HOT_QUERY_INDEXES) {
  const label = `${entry.name}`;
  const path = join(MIGRATIONS_DIR, entry.migration);

  if (!existsSync(path)) {
    fail(`${label}: ملفُّ الهجرةِ معدومٌ — ${path}`);
    continue;
  }

  const sql = readFileSync(path, "utf8");

  if (!sql.includes(`-- migration-phase: ${HOT_QUERY_INDEX_PHASE}`)) {
    fail(
      `${label}: الهجرةُ لا تُصرِّحُ \`-- migration-phase: ${HOT_QUERY_INDEX_PHASE}\` — ` +
        "والفهرسُ المتزامنُ لا يُطبَّقُ داخلَ معاملةٍ.",
    );
  }

  const statements = createIndexStatements(sql);
  if (statements.length !== 1) {
    fail(
      `${label}: الهجرةُ فيها ${statements.length} عبارةَ فهرسٍ — ` +
        "والفهرسُ المتزامنُ يكونُ في ملفٍّ وحدَه.",
    );
    continue;
  }

  const statement = statements[0] ?? "";
  if (!new RegExp(`\\b${entry.name}\\b`).test(statement)) {
    fail(`${label}: الهجرةُ ${entry.migration} لا تُنشئُ فهرساً بهذا الاسمِ.`);
  }
  if (!/\bconcurrently\b/i.test(statement)) {
    fail(`${label}: بلا \`concurrently\` — قفلٌ يحجبُ الكتابةَ على جدولٍ حارٍّ (CAP-007).`);
  }
  if (!/\bif\s+not\s+exists\b/i.test(statement)) {
    fail(`${label}: بلا \`if not exists\` — والاسترجاعُ شرطُ إعادةِ التطبيقِ (F7-07).`);
  }
  if (!new RegExp(`\\bon\\s+(public\\.)?${entry.table}\\b`, "i").test(statement)) {
    fail(`${label}: الهجرةُ لا تُنشئُ الفهرسَ على \`${entry.table}\` كما في السجلِّ.`);
  }

  const columns = indexColumnsOf(statement, entry.table);
  if (columns === null || columns.length === 0) {
    fail(`${label}: تعذّرَ استخراجُ أعمدةِ الفهرسِ من الهجرةِ.`);
  } else {
    const predicate = indexPredicateOf(statement);
    const duplicates = createIndexStatements(allMigrationsSql).filter((other) => {
      if (other === statement) return false;
      const otherColumns = indexColumnsOf(other, entry.table);
      if (otherColumns === null) return false;
      if (otherColumns.join(",") !== columns.join(",")) return false;
      return indexPredicateOf(other) === predicate;
    });
    if (duplicates.length > 0) {
      fail(
        `${label}: مُكرِّرٌ — فهرسٌ قائمٌ على \`${entry.table}\` بنفسِ الأعمدةِ ` +
          `(${columns.join(", ")}) ونفسِ الشرطِ.`,
      );
    }
  }

  if (entry.callers.length === 0) {
    fail(`${label}: بلا مُستدعٍ مُصرَّحٍ — والقاعدةُ 0.1 تمنعُ ما لا مُستدعيَ لهُ.`);
  }
  for (const caller of entry.callers) {
    if (!existsSync(caller.file)) {
      fail(`${label}: المُستدعي المُصرَّحُ معدومٌ — ${caller.file}`);
      continue;
    }
    const callerSource = readFileSync(caller.file, "utf8");
    if (!new RegExp(`\\b${entry.table}\\b`).test(callerSource)) {
      fail(`${label}: المُستدعي ${caller.file} لا يذكرُ \`${entry.table}\` ألبتّةَ.`);
    }
  }

  if (planTestSql !== null && !planTestSql.includes(entry.name)) {
    fail(`${label}: لا يقيسُه اختبارُ الخطّةِ — فلا دليلَ قبل/بعد عليه.`);
  }
}

const ranks = HOT_QUERY_INDEXES.map((entry) => entry.rank);
if (new Set(ranks).size !== ranks.length) {
  fail("رُتبُ الأثرِ مُكرَّرةٌ — والرتبةُ ترتيبٌ لا وسمٌ.");
}
const names = HOT_QUERY_INDEXES.map((entry) => entry.name);
if (new Set(names).size !== names.length) {
  fail("أسماءُ الفهارسِ مُكرَّرةٌ في السجلِّ.");
}

if (failures.length > 0) {
  console.error("❌ تغطيةُ فهارسِ الاستعلاماتِ الساخنةِ: أخفقَ الفحصُ");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `✅ تغطيةُ فهارسِ الاستعلاماتِ الساخنةِ: نجحَ — ${HOT_QUERY_INDEXES.length} فهارسَ، ` +
    `لكلٍّ هجرةٌ في طورِ \`${HOT_QUERY_INDEX_PHASE}\` بـ\`concurrently\`، ` +
    `و${HOT_QUERY_INDEXES.reduce((sum, entry) => sum + entry.callers.length, 0)} مُستدعياً ` +
    "إنتاجيّاً مُصرَّحاً، وكلُّها مقيسةٌ بخطّةِ تنفيذٍ قبل/بعد.",
);
