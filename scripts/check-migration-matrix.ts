/**
 * الغرض: بوابةُ CI تفرضُ أنَّ **مصفوفةَ الهجرةِ (`W-2`) كاملةٌ ومتماسكةٌ وصادقةٌ** —
 *    لكلِّ جدولٍ في جردِ الحدودِ مُدخلٌ واحدٌ، وكلُّ آليّةٍ تُوافقُ وجهةَ الجردِ،
 *    وكلُّ شرطٍ سابقٍ معرّفٌ مُعلَنٌ في `ROADMAP.md`، وكلُّ موجةٍ لا تسبقُ ما تعتمدُ
 *    عليه، والوثيقةُ `docs/migration/matrix.md` مُولَّدةٌ من السجلِّ لا مكتوبةٌ بيدٍ،
 *    **ولا مُدخلَ يدّعي تنفيذاً وقسمُ «Migrated» في `ROADMAP.md` خالٍ**.
 * الحالة: منفّذ فعلياً — أداةُ تحقُّقٍ، ليست منطقَ أعمالٍ.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: package.json (`bun run ci`) · .github/workflows/ci.yml
 * ملاحظات مستقبلية: لا يُضعَّفُ هذا الحاجزُ ولا يُفتَحُ فيه تجاوزٌ. إن أُضيفَ جدولٌ
 *    فالطريقُ سطرٌ في المصفوفةِ، لا استثناءٌ ههنا.
 *
 * ## العطبُ الذي يُغلِقُه (ADR 0083)
 *
 * خطّةُ الهجرةِ التي تسكنُ وثيقةً وحدَها تتقادمُ **بلا سطرٍ خاطئٍ**: هجرةٌ تُضيفُ
 * جدولاً فلا خطّةَ له؛ أو تُبدَّلُ وجهةُ جدولٍ في جردِ الحدودِ فتبقى خطّتُه على
 * الوجهةِ القديمةِ — فيقرأُ منفِّذٌ خطّةً صحيحةَ الشكلِ تُخالِفُ القرارَ النافذَ.
 * ولا ترجمةٌ تُخفِقُ ولا اختبارٌ يسقطُ. **وأخطرُ من خطّةٍ ناقصةٍ خطّةٌ يُظَنُّ أنَّها
 * مطابقةٌ.** فالحاجزُ يقيسُ الفرقَ بينَ الجردِ والمصفوفةِ والوثيقةِ و`ROADMAP.md`،
 * ويُسقِطُ البناءَ عندَ أوّلِ فرقٍ.
 *
 * وأخصُّ ما يقيسُه الفحصُ التاسعُ: **مُدخلٌ يدّعي `executed` وقسمُ «Migrated» خالٍ**.
 * فأكثرُ ما تكذبُ به خطّةٌ ليس سطراً ناقصاً بل سطراً يُعلَّمُ منتهياً قبلَ أن يُنتهيَ،
 * وحالةُ المستودعِ ههنا هيَ المُقابِلُ: لا صفَّ هُوجِرَ، فلا سطرَ يُعلَّمُ مُهاجَراً.
 *
 * ولا يقيسُ ما لا يملكُ قياسَه: **صوابُ** الآليّةِ ورشدُ ترتيبِ الموجاتِ حكمانِ
 * معماريّانِ يُراجَعانِ بالقراءةِ. وهذا يفرضُ الشمولَ والتطابقَ والتماسكَ وصدقَ
 * الادّعاءِ وحدَها — وهيَ ما يُقاسُ آليّاً.
 *
 * الاستخدامُ:
 *   bun run scripts/check-migration-matrix.ts            # فحصٌ
 *   bun run scripts/check-migration-matrix.ts --write    # توليدُ جدولِ الوثيقةِ
 */

import { readFileSync, writeFileSync } from "node:fs";
import { WASLA_BOUNDARY_INVENTORY, WASLA_COLUMN_CONCERNS } from "./lib/wasla-boundary-registry.ts";
import {
  type ColumnPlanEntry,
  columnConcernKeys,
  dispositionOf,
  type MatrixEntry,
  MECHANISMS,
  mechanismById,
  WASLA_COLUMN_MIGRATION_PLAN,
  WASLA_MIGRATION_MATRIX,
  WAVES,
  waveByNumber,
} from "./lib/wasla-migration-matrix.ts";

const MATRIX_DOC = "docs/migration/matrix.md";
const ROADMAP = "ROADMAP.md";
const BEGIN = "<!-- BEGIN GENERATED: migration-matrix -->";
const END = "<!-- END GENERATED: migration-matrix -->";

export type Problem = { readonly where: string; readonly detail: string };

/**
 * مُدخلاتُ الفحصِ. تُمرَّرُ صراحةً — لا تُقرأُ من الوحدةِ — كي **تُختبَرَ مساراتُ
 * الفشلِ بمُدخلاتٍ مزروعةٍ**. حاجزٌ لا تُثبَتُ إخفاقاتُه حاجزٌ يُظَنُّ أنَّه يحرسُ.
 */
export interface MatrixInputs {
  readonly matrix: readonly MatrixEntry[];
  readonly columnPlan: readonly ColumnPlanEntry[];
}

export const DEFAULT_INPUTS: MatrixInputs = {
  matrix: WASLA_MIGRATION_MATRIX,
  columnPlan: WASLA_COLUMN_MIGRATION_PLAN,
};

/** معرّفاتُ الحواجزِ والتبعيّاتِ وقراراتِ المالكِ **كما يُعلِنُها `ROADMAP.md`**. */
export function declaredIds(roadmapText: string): Set<string> {
  return new Set(roadmapText.match(/\b(?:B-\d+|O-\d+|DEP-CORE-\d{3})\b/g) ?? []);
}

/**
 * هل قسمُ «Migrated» في `ROADMAP.md` خالٍ؟ الخلوُّ هوَ الحالةُ التي تمنعُ أيَّ
 * ادّعاءِ تنفيذٍ. ويُقرأُ القسمُ نصّاً لا يُفترَضُ: عنوانٌ ثمَّ ما دونَه حتّى العنوانِ
 * التالي، فإن كانَ سطراً واحداً يبدأُ بـ«Nothing» فهوَ خالٍ.
 */
export function migratedSectionIsEmpty(roadmapText: string): boolean {
  const match = roadmapText.match(/^## Migrated\s*$([\s\S]*?)^## /m);
  const body = (match?.[1] ?? "").trim();
  return body.length === 0 || /^Nothing\b/i.test(body);
}

/** كلُّ ما يُخفِقُ الحاجزَ. دالّةٌ صافيةٌ كي تُختبَرَ مساراتُ الفشلِ بمُدخلاتٍ مزروعةٍ. */
export function matrixProblems(
  roadmapText: string,
  docText: string | null,
  inputs: MatrixInputs = DEFAULT_INPUTS,
): Problem[] {
  const { matrix, columnPlan } = inputs;
  const problems: Problem[] = [];
  const ids = declaredIds(roadmapText);
  const mechanisms = mechanismById();
  const waves = waveByNumber();
  const inventoryTables = new Set(WASLA_BOUNDARY_INVENTORY.map((e) => e.table));

  // ١ — شمولٌ وتطابقٌ: مُدخلٌ لكلِّ جدولٍ في الجردِ، وجدولٌ لكلِّ مُدخلٍ.
  const seen = new Set<string>();
  for (const entry of matrix) {
    if (!inventoryTables.has(entry.table))
      problems.push({
        where: entry.table,
        detail: "مُدخلٌ في المصفوفةِ لجدولٍ لا وجودَ له في جردِ الحدودِ — مُدخلٌ ميّتٌ",
      });
    if (seen.has(entry.table))
      problems.push({ where: entry.table, detail: "مُدخلٌ مكرَّرٌ في المصفوفةِ" });
    seen.add(entry.table);
  }
  for (const table of inventoryTables) {
    if (!seen.has(table))
      problems.push({ where: table, detail: "جدولٌ مُصنَّفٌ في الجردِ ولا خطّةَ هجرةٍ له" });
  }

  // ٢ — الآليّةُ تُوافقُ وجهةَ الجردِ. الوجهةُ تُقرأُ من الجردِ وحدَه، فلا تُكرَّرُ ههنا.
  for (const entry of matrix) {
    const mechanism = mechanisms.get(entry.mechanism);
    if (mechanism === undefined) {
      problems.push({
        where: entry.table,
        detail: `آليّةٌ خارجَ القائمةِ المغلقةِ: ${entry.mechanism}`,
      });
      continue;
    }
    const disposition = dispositionOf(entry.table);
    if (disposition !== undefined && !mechanism.allowedDispositions.includes(disposition))
      problems.push({
        where: entry.table,
        detail: `تنافرٌ: وجهةُ الجردِ ${disposition} والآليّةُ ${entry.mechanism} لا تقبلُها (المقبولُ: ${mechanism.allowedDispositions.join("، ")})`,
      });
    if (entry.mechanism === "NONE" && entry.wave !== 0)
      problems.push({
        where: entry.table,
        detail: `آليّةُ NONE في الموجةِ ${entry.wave} — «لا هجرةَ» لا تنتمي إلى موجةِ عملٍ`,
      });
    if (entry.mechanism !== "NONE" && entry.wave === 0)
      problems.push({
        where: entry.table,
        detail: `الموجةُ ٠ لا عملَ فيها، والآليّةُ ${entry.mechanism} عملٌ`,
      });
  }

  // ٣ — كلُّ جدولٍ عليه اختراقُ عمودٍ لا يجوزُ أن يكونَ «لا هجرةَ».
  const concernedTables = new Set(WASLA_COLUMN_CONCERNS.map((c) => c.table));
  for (const entry of matrix) {
    if (entry.mechanism === "NONE" && concernedTables.has(entry.table))
      problems.push({
        where: entry.table,
        detail: "«لا هجرةَ» لجدولٍ عليه اختراقُ حدٍّ عموديٌّ مُعلَنٌ في الجردِ",
      });
  }

  // ٤ — خطّةُ الأعمدةِ تُقابِلُ سجلَّ الاختراقاتِ واحداً بواحدٍ.
  const concernKeys = columnConcernKeys();
  const plannedKeys = new Set<string>();
  for (const plan of columnPlan) {
    const key = `${plan.table}.${plan.column}`;
    if (!concernKeys.has(key))
      problems.push({ where: key, detail: "خطّةُ عمودٍ لاختراقٍ غيرِ مُعلَنٍ في الجردِ" });
    if (plannedKeys.has(key)) problems.push({ where: key, detail: "خطّةُ عمودٍ مكرَّرةٌ" });
    plannedKeys.add(key);
    if (plan.mechanism === "NONE")
      problems.push({ where: key, detail: "اختراقُ حدٍّ لا يُغلَقُ بـ«لا هجرةَ»" });
  }
  for (const key of concernKeys) {
    if (!plannedKeys.has(key))
      problems.push({ where: key, detail: "اختراقُ حدٍّ مُعلَنٌ في الجردِ ولا خطّةَ عمودٍ له" });
  }

  // ٥ — كلُّ معرّفِ شرطٍ سابقٍ **مُعلَنٌ في `ROADMAP.md`**: لا معرّفَ مُختلَقٌ.
  const withPrereqs: readonly { table: string; prerequisites: readonly string[]; wave: number }[] =
    [
      ...matrix.map((e) => ({
        table: e.table,
        prerequisites: e.prerequisites,
        wave: e.wave,
      })),
      ...columnPlan.map((p) => ({
        table: `${p.table}.${p.column}`,
        prerequisites: p.prerequisites,
        wave: p.wave,
      })),
    ];
  for (const row of withPrereqs) {
    for (const id of row.prerequisites) {
      if (!ids.has(id))
        problems.push({
          where: row.table,
          detail: `شرطٌ سابقٌ بمعرّفٍ غيرِ مُعلَنٍ في ${ROADMAP}: ${id}`,
        });
    }
    if (!waves.has(row.wave))
      problems.push({ where: row.table, detail: `موجةٌ غيرُ مُعرَّفةٍ: ${row.wave}` });
  }

  // ٦ — لا آليّةٌ ميّتةٌ ولا موجةٌ فارغةٌ: القائمةُ المغلقةُ مغلقةٌ ومُستعمَلةٌ.
  const usedMechanisms = new Set<string>([
    ...matrix.map((e) => e.mechanism),
    ...columnPlan.map((p) => p.mechanism),
  ]);
  for (const mechanism of MECHANISMS) {
    if (!usedMechanisms.has(mechanism.id))
      problems.push({
        where: mechanism.id,
        detail: "آليّةٌ مُعلَنةٌ لا يستعملُها مُدخلٌ — إعلانٌ ميّتٌ يُقرأُ خطّةً",
      });
  }
  const usedWaves = new Set<number>(withPrereqs.map((r) => r.wave));
  for (const wave of WAVES) {
    if (!usedWaves.has(wave.wave))
      problems.push({ where: `wave ${wave.wave}`, detail: "موجةٌ مُعلَنةٌ بلا مُدخلٍ واحدٍ" });
  }

  // ٧ — كلُّ مُدخلٍ يحملُ مسارَ عودةٍ وقياساً غيرَ فارغَينِ: خطّةٌ بلا رجعةٍ ليست خطّةً.
  for (const entry of [...matrix, ...columnPlan]) {
    const where = "column" in entry ? `${entry.table}.${entry.column}` : entry.table;
    if (entry.rollback.trim().length === 0) problems.push({ where, detail: "مُدخلٌ بلا مسارِ عودةٍ" });
    if (entry.verification.trim().length === 0)
      problems.push({ where, detail: "مُدخلٌ بلا قياسٍ يُغلِقُه" });
  }

  // ٨ — لا يُقرَأُ جدولٌ تامّاً وفيه عمودٌ مُعلَنٌ لمّا يُنزَعْ: موجةُ الإتمامِ
  //      تُزاحِمُ أقصى موجةِ عمودٍ فيه، وإلّا فهيَ تمامٌ مُدّعى لا مقيسٌ.
  const completion = new Map(matrix.map((e) => [e.table, e.completesInWave ?? e.wave]));
  for (const plan of columnPlan) {
    const closes = completion.get(plan.table);
    if (closes !== undefined && plan.wave > closes)
      problems.push({
        where: `${plan.table}.${plan.column}`,
        detail: `خطّةُ العمودِ في الموجةِ ${plan.wave} وجدولُها يُقرَأُ تامّاً في ${closes} — تمامٌ مُدّعى وعمودٌ مُعلَنٌ لمّا يُنزَعْ`,
      });
  }
  for (const entry of matrix) {
    if (entry.completesInWave === undefined) continue;
    if (entry.completesInWave < entry.wave)
      problems.push({
        where: entry.table,
        detail: `يُقرَأُ تامّاً في الموجةِ ${entry.completesInWave} قبلَ موجةِ بدايتِه ${entry.wave}`,
      });
    if (!waves.has(entry.completesInWave))
      problems.push({
        where: entry.table,
        detail: `موجةُ إتمامٍ غيرُ مُعرّفةٍ: ${entry.completesInWave}`,
      });
  }

  // ٩ — صدقُ الادّعاءِ: لا `executed` وقسمُ «Migrated» خالٍ. هذا هوَ الفحصُ الحاكمُ.
  if (migratedSectionIsEmpty(roadmapText)) {
    for (const entry of [...matrix, ...columnPlan]) {
      const where = "column" in entry ? `${entry.table}.${entry.column}` : entry.table;
      if (entry.executed !== false)
        problems.push({
          where,
          detail: `مُدخلٌ يدّعي تنفيذاً وقسمُ «Migrated» في ${ROADMAP} خالٍ — ادّعاءٌ بلا مقابلٍ في حالةِ المستودعِ`,
        });
    }
  }

  // ١٠ — الوثيقةُ مُولَّدةٌ من السجلِّ: مصدرُ حقيقةٍ واحدٌ لا نسختانِ تفترقانِ.
  if (docText !== null) {
    const slice = generatedSlice(docText);
    if (slice === null)
      problems.push({ where: MATRIX_DOC, detail: `الوثيقةُ بلا علامتَي التوليدِ ${BEGIN} … ${END}` });
    else if (slice.trim() !== renderMatrix(inputs))
      problems.push({
        where: MATRIX_DOC,
        detail: "جدولُ الوثيقةِ لا يطابقُ السجلَّ — شغِّل `--write` ولا تُحرِّرْه بيدٍ",
      });
  }

  return problems;
}

/** حرفٌ عربيٌّ للموجةِ كي تُقرأَ الوثيقةُ بلا خلطٍ بينَ رقمِ موجةٍ ورقمِ بندٍ. */
const WAVE_LABEL = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** جدولُ الوثيقةِ — يُولَّدُ من السجلِّ، ولا يُحرَّرُ بيدٍ. */
export function renderMatrix(inputs: MatrixInputs = DEFAULT_INPUTS): string {
  const { matrix, columnPlan } = inputs;
  const lines: string[] = [];

  lines.push("### الآليّاتُ — قائمةٌ مغلقةٌ بسبعٍ");
  lines.push("");
  lines.push("| الآليّةُ | ما تفعلُه | الوجهاتُ المقبولةُ | شكلُ العودةِ |");
  lines.push("|---|---|---|---|");
  for (const m of MECHANISMS)
    lines.push(
      `| \`${m.id}\` | ${cell(m.summary)} | ${m.allowedDispositions.join(" · ")} | ${cell(m.rollbackShape)} |`,
    );

  lines.push("");
  lines.push("### الموجاتُ — رتبةُ تنفيذٍ لا تاريخٌ");
  lines.push("");
  lines.push("| الموجةُ | العنوانُ | البندُ | شرطُ الدخولِ |");
  lines.push("|---|---|---|---|");
  for (const w of WAVES)
    lines.push(
      `| ${WAVE_LABEL[w.wave] ?? w.wave} | ${cell(w.title)} | \`${w.item}\` | ${cell(w.entryCondition)} |`,
    );

  for (const w of WAVES) {
    const entries = matrix.filter((e) => e.wave === w.wave);
    const columns = columnPlan.filter((p) => p.wave === w.wave);
    if (entries.length === 0 && columns.length === 0) continue;
    lines.push("");
    lines.push(`### الموجةُ ${WAVE_LABEL[w.wave] ?? w.wave} — ${w.title}`);
    lines.push("");
    if (entries.length > 0) {
      lines.push(
        "| الجدولُ | الوجهةُ (من الجردِ) | الآليّةُ | الشروطُ السابقةُ | مسارُ العودةِ | القياسُ الذي يُغلِقُ | نُفِّذَ؟ |",
      );
      lines.push("|---|---|---|---|---|---|---|");
      for (const e of entries)
        lines.push(
          `| \`${e.table}\`${e.completesInWave !== undefined ? ` · يُقرَأُ تامّاً في الموجةِ ${WAVE_LABEL[e.completesInWave] ?? e.completesInWave}` : ""} | ${dispositionOf(e.table) ?? "—"} | \`${e.mechanism}\` | ${
            e.prerequisites.length > 0 ? e.prerequisites.map((p) => `\`${p}\``).join(" · ") : "—"
          } | ${cell(e.rollback)} | ${cell(e.verification)} | ${e.executed ? "نعم" : "لا"} |`,
        );
    }
    if (columns.length > 0) {
      lines.push("");
      lines.push(`أعمدةٌ تخترقُ الحدَّ داخلَ جداولَ تبقى، في الموجةِ نفسِها:`);
      lines.push("");
      lines.push("| العمودُ | الآليّةُ | الشروطُ السابقةُ | مسارُ العودةِ | القياسُ الذي يُغلِقُ | نُفِّذَ؟ |");
      lines.push("|---|---|---|---|---|---|");
      for (const p of columns)
        lines.push(
          `| \`${p.table}.${p.column}\` | \`${p.mechanism}\` | ${
            p.prerequisites.length > 0 ? p.prerequisites.map((x) => `\`${x}\``).join(" · ") : "—"
          } | ${cell(p.rollback)} | ${cell(p.verification)} | ${p.executed ? "نعم" : "لا"} |`,
        );
    }
  }

  return lines.join("\n");
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
  const roadmap = readFileSync(ROADMAP, "utf8");
  let doc = readFileSync(MATRIX_DOC, "utf8");

  if (write && generatedSlice(doc) !== null) {
    const generated = renderMatrix();
    if (generatedSlice(doc)?.trim() !== generated) {
      doc = withGeneratedBlock(doc, generated);
      writeFileSync(MATRIX_DOC, doc);
      console.log(`✍️  أُعيدَ توليدُ جدولِ المصفوفةِ في ${MATRIX_DOC}`);
    }
  }

  const problems = matrixProblems(roadmap, doc);

  if (problems.length > 0) {
    console.error("❌ مصفوفةُ الهجرةِ (W-2) غيرُ متماسكةٍ:");
    for (const p of problems) console.error(`  - [${p.where}] ${p.detail}`);
    process.exit(1);
  }

  const perWave = WAVES.map(
    (w) =>
      `${WAVE_LABEL[w.wave] ?? w.wave}=${WASLA_MIGRATION_MATRIX.filter((e) => e.wave === w.wave).length}`,
  ).join(" · ");
  console.log(
    `✅ مصفوفةُ الهجرةِ تغطّي ${WASLA_MIGRATION_MATRIX.length} جدولاً بلا زيادةٍ ولا نقصٍ (موجاتٌ: ${perWave})، و${WASLA_COLUMN_MIGRATION_PLAN.length} خطّةَ عمودٍ تقابلُ سجلَّ الاختراقاتِ، والوثيقةُ مطابقةٌ للسجلِّ، ولا مُدخلَ يدّعي تنفيذاً.`,
  );
}

if (import.meta.main) {
  main();
}
