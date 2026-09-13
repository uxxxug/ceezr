/**
 * الغرض: بوابةُ CI تفرضُ أنَّ **جردَ حدودِ WASLA كاملٌ ومطابقٌ للمخطَّطِ** — كلُّ
 *    جدولٍ في `supabase/migrations` مُصنَّفٌ في `scripts/lib/wasla-boundary-registry.ts`
 *    بوجهةٍ من أربعٍ، وكلُّ مُدخلٍ في السجلِّ يقابلُه جدولٌ موجودٌ، والوثيقةُ
 *    `docs/wasla/boundary-audit.md` مُولَّدةٌ من السجلِّ لا مكتوبةٌ بيدٍ.
 * الحالة: منفّذ فعلياً — أداةُ تحقُّقٍ، ليست منطقَ أعمالٍ.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: package.json (`bun run ci`) · .github/workflows/ci.yml
 * ملاحظات مستقبلية: لا يُضعَّفُ هذا الحاجزُ ولا يُفتَحُ فيه تجاوزٌ. إن أُضيفَ جدولٌ
 *    جديدٌ فالطريقُ تصنيفُه، لا استثناؤه.
 *
 * ## العطبُ الذي يُغلِقُه (ADR 0080)
 *
 * البندُ `W-1` في `ROADMAP.md` جردٌ، والجردُ الذي يسكنُ وثيقةً وحدَه يتقادمُ
 * **بلا سطرٍ خاطئٍ**: هجرةٌ واحدةٌ تُضيفُ جدولاً فيبقى غيرَ مُصنَّفٍ، ولا ترجمةٌ
 * تُخفِقُ ولا اختبارٌ يسقطُ، ويُقرأُ الجردُ بعدَها «كاملاً» فتُبنى عليه مصفوفةُ
 * الهجرةِ وعقدُ الهويّةِ ونموذجُ المهمّةِ. وأخطرُ من جردٍ ناقصٍ جردٌ **يُظَنُّ**
 * كاملاً. فالحاجزُ يقيسُ الفرقَ بينَ ما في المخطَّطِ وما في السجلِّ، ويُسقِطُ
 * البناءَ عندَ أوّلِ فرقٍ.
 *
 * ولا يقيسُ ما لا يملكُ قياسَه: **صوابُ** الوجهةِ حكمُ معماريٍّ يُراجَعُ بالقراءةِ،
 * وهذا يفرضُ **الشمولَ والتطابقَ وعدمَ التقادمِ** وحدَها.
 *
 * الاستخدامُ:
 *   bun run scripts/check-boundary-audit.ts            # فحصٌ
 *   bun run scripts/check-boundary-audit.ts --write    # توليدُ جدولِ الوثيقةِ
 */

import { readFileSync, writeFileSync } from "node:fs";
import { findTableBlocks } from "./check-migrations.ts";
import { declaredMigrations } from "./lib/migration-sources.ts";
import {
  DISPOSITIONS,
  WASLA_BOUNDARY_INVENTORY,
  WASLA_COLUMN_CONCERNS,
} from "./lib/wasla-boundary-registry.ts";

// الجردُ يقرأُ **المُعلَنَ** لا المُطبَّقَ وحدَه: جدولٌ مؤجَّلٌ يبقى مُصنَّفاً
// (`ADR 0095` · `scripts/lib/migration-sources.ts`).
const AUDIT_DOC = "docs/wasla/boundary-audit.md";
const BEGIN = "<!-- BEGIN GENERATED: boundary-inventory -->";
const END = "<!-- END GENERATED: boundary-inventory -->";

export type Problem = { readonly where: string; readonly detail: string };

export interface MigrationFile {
  readonly file: string;
  readonly sql: string;
}

function migrationSql(): MigrationFile[] {
  return declaredMigrations().map(({ file, sql }) => ({ file, sql }));
}

/** أسماءُ كلِّ الجداولِ التي تُنشئُها الهجراتُ — بالمُستخرِجِ نفسِه الذي يقرؤه حاجزُ `city_id`. */
export function tablesInSchema(files: readonly MigrationFile[]): Set<string> {
  const tables = new Set<string>();
  for (const { sql } of files) for (const block of findTableBlocks(sql)) tables.add(block.name);
  return tables;
}

/** أجسامُ `create table` لجدولٍ بعينِه، وكلُّ `alter table … add column` يمسُّه. */
function textDefining(table: string, files: readonly MigrationFile[]): string {
  const parts: string[] = [];
  for (const { sql } of files) {
    for (const block of findTableBlocks(sql)) if (block.name === table) parts.push(block.body);
    const alter = new RegExp(
      `alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(?:"?[a-z_][a-z0-9_]*"?\\s*\\.\\s*)?"?${table}"?\\s+([^;]*);`,
      "gi",
    );
    for (const match of sql.matchAll(alter)) parts.push(match[1] ?? "");
  }
  return parts.join("\n");
}

function hasColumn(text: string, column: string): boolean {
  return new RegExp(`(^|[\\s,("])"?${column}"?([\\s,)]|$)`, "mi").test(text);
}

export function renderInventoryTable(): string {
  const header = [
    "| # | الجدول | المفهوم | المالك | الوجهة | التعليل |",
    "|---|---|---|---|---|---|",
  ];
  const rows = WASLA_BOUNDARY_INVENTORY.map(
    (e, i) =>
      `| ${i + 1} | \`${e.table}\` | ${e.concern} | ${e.owner} | \`${e.disposition}\` | ${e.rationale} |`,
  );
  const columnHeader = [
    "",
    "### اختراقاتُ الحدِّ على مستوى العمودِ",
    "",
    "| الجدول | العمود | المفهوم | المالك | الوجهة | التعليل |",
    "|---|---|---|---|---|---|",
  ];
  const columnRows = WASLA_COLUMN_CONCERNS.map(
    (c) =>
      `| \`${c.table}\` | \`${c.column}\` | ${c.concern} | ${c.owner} | \`${c.disposition}\` | ${c.rationale} |`,
  );
  const tally = new Map<string, number>();
  for (const e of WASLA_BOUNDARY_INVENTORY)
    tally.set(e.disposition, (tally.get(e.disposition) ?? 0) + 1);
  const summary = [
    "",
    "### الحصيلة",
    "",
    "| الوجهة | عددُ الجداولِ |",
    "|---|---|",
    ...DISPOSITIONS.map((d) => `| \`${d}\` | ${tally.get(d) ?? 0} |`),
    `| **المجموع** | **${WASLA_BOUNDARY_INVENTORY.length}** |`,
  ];
  return [...header, ...rows, ...columnHeader, ...columnRows, ...summary].join("\n");
}

/**
 * كلُّ مخالفةٍ يراها الحاجزُ، دالّةً خالصةً على نصِّ الهجراتِ ونصِّ الوثيقةِ — فتُختبَرُ
 * حالاتُ الإخفاقِ بلا لمسِ قرصٍ وبلا إسقاطِ عمليّةٍ. و`docText === null` يعني «لا
 * تفحصِ الوثيقةَ» (مسارُ `--write` يتولّاها).
 */
export function auditProblems(files: readonly MigrationFile[], docText: string | null): Problem[] {
  const schemaTables = tablesInSchema(files);
  const problems: Problem[] = [];

  // ١ — لا تصنيفَ مكرَّرٌ، ولا مُدخلَ بلا جدولٍ، والترتيبُ أبجديٌّ (المُولَّدُ يعتمدُه).
  const seen = new Set<string>();
  for (const entry of WASLA_BOUNDARY_INVENTORY) {
    if (seen.has(entry.table)) problems.push({ where: entry.table, detail: "مُصنَّفٌ مرّتينِ في السجلِّ" });
    seen.add(entry.table);
    if (!schemaTables.has(entry.table))
      problems.push({
        where: entry.table,
        detail: "مُدخلٌ في السجلِّ بلا `create table` يقابلُه (مُدخلٌ ميّتٌ)",
      });
    if (!DISPOSITIONS.includes(entry.disposition))
      problems.push({ where: entry.table, detail: `وجهةٌ غيرُ معروفةٍ: ${entry.disposition}` });
    if (entry.rationale.trim().length < 20)
      problems.push({ where: entry.table, detail: "تعليلٌ أقصرُ من أن يُقرأَ حكماً" });
    if (entry.concern.trim().length === 0)
      problems.push({ where: entry.table, detail: "بلا مفهومٍ مُصرَّحٍ" });
  }
  const sorted = [...WASLA_BOUNDARY_INVENTORY].map((e) => e.table).sort();
  const actual = WASLA_BOUNDARY_INVENTORY.map((e) => e.table);
  if (sorted.join(",") !== actual.join(","))
    problems.push({
      where: "scripts/lib/wasla-boundary-registry.ts",
      detail: "السجلُّ غيرُ مُرتَّبٍ أبجديّاً — والوثيقةُ تُولَّدُ منه فيصيرُ الفرقُ بلا معنى",
    });

  // ٢ — الشمولُ: جدولٌ في المخطَّطِ بلا تصنيفٍ يُسقِطُ البناءَ. هذا هو الحاجزُ الأصلُ.
  for (const table of [...schemaTables].sort())
    if (!seen.has(table))
      problems.push({
        where: table,
        detail: "جدولٌ في المخطَّطِ بلا تصنيفٍ في جردِ الحدودِ (W-1)",
      });

  // ٣ — أعمدةُ الاختراقِ موجودةٌ فعلاً، فلا مُدخلَ ميّتاً يوسِّعُ الجردَ بلا مقابلٍ.
  for (const concern of WASLA_COLUMN_CONCERNS) {
    if (!schemaTables.has(concern.table)) {
      problems.push({
        where: `${concern.table}.${concern.column}`,
        detail: "جدولُ العمودِ غيرُ موجودٍ في المخطَّطِ",
      });
      continue;
    }
    if (!hasColumn(textDefining(concern.table, files), concern.column))
      problems.push({
        where: `${concern.table}.${concern.column}`,
        detail: "عمودٌ مُصرَّحٌ في الجردِ ولا وجودَ له في الهجراتِ",
      });
  }

  // ٤ — الوثيقةُ مُولَّدةٌ من السجلِّ: مصدرُ حقيقةٍ واحدٌ لا نسختانِ تفترقانِ.
  if (docText !== null) {
    const slice = generatedSlice(docText);
    if (slice === null)
      problems.push({
        where: AUDIT_DOC,
        detail: `الوثيقةُ بلا علامتَي التوليدِ ${BEGIN} … ${END}`,
      });
    else if (slice.trim() !== renderInventoryTable())
      problems.push({
        where: AUDIT_DOC,
        detail: "جدولُ الوثيقةِ لا يطابقُ السجلَّ — شغِّل `--write` ولا تُحرِّرْه بيدٍ",
      });
  }

  return problems;
}

/** ما بينَ علامتَي التوليدِ، أو `null` إن غابَت إحداهما أو انقلبَ ترتيبُهما. */
export function generatedSlice(docText: string): string | null {
  const begin = docText.indexOf(BEGIN);
  const end = docText.indexOf(END);
  if (begin === -1 || end === -1 || end < begin) return null;
  return docText.slice(begin + BEGIN.length, end);
}

/** إعادةُ كتابةِ الكتلةِ المُولَّدةِ في نصِّ الوثيقةِ. */
export function withGeneratedBlock(docText: string, generated: string): string {
  const begin = docText.indexOf(BEGIN);
  const end = docText.indexOf(END);
  return `${docText.slice(0, begin + BEGIN.length)}\n\n${generated}\n\n${docText.slice(end)}`;
}

function main(): void {
  const write = process.argv.includes("--write");
  const files = migrationSql();
  let doc = readFileSync(AUDIT_DOC, "utf8");

  if (write && generatedSlice(doc) !== null) {
    const generated = renderInventoryTable();
    if (generatedSlice(doc)?.trim() !== generated) {
      doc = withGeneratedBlock(doc, generated);
      writeFileSync(AUDIT_DOC, doc);
      console.log(`✍️  أُعيدَ توليدُ جدولِ الجردِ في ${AUDIT_DOC}`);
    }
  }

  const problems = auditProblems(files, doc);

  if (problems.length > 0) {
    console.error("❌ جردُ حدودِ WASLA (W-1) غيرُ متطابقٍ:");
    for (const p of problems) console.error(`  - [${p.where}] ${p.detail}`);
    process.exit(1);
  }

  const tally = DISPOSITIONS.map(
    (d) => `${d}=${WASLA_BOUNDARY_INVENTORY.filter((e) => e.disposition === d).length}`,
  ).join(" · ");
  console.log(
    `✅ جردُ الحدودِ يغطّي ${tablesInSchema(files).size} جدولاً بلا زيادةٍ ولا نقصٍ (${tally})، و${WASLA_COLUMN_CONCERNS.length} اختراقَ عمودٍ كلُّها موجودةٌ في الهجراتِ، والوثيقةُ مطابقةٌ للسجلِّ.`,
  );
}

if (import.meta.main) {
  main();
}
