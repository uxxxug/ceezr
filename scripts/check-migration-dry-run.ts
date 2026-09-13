#!/usr/bin/env bun
/**
 * الغرض: حارسُ أداتَي التشغيلِ الجافِّ والتسويةِ (`W-8` / ADR 0085). ويُنفِذُ
 *   سبعةَ أمورٍ، وكلُّها **قابلةٌ للإخفاقِ فعلاً** لا شكليّةٌ:
 *
 *   ١. **لا فعلَ كتابةٍ في وحدةِ التشغيلِ الجافِّ** — بعدَ حذفِ التعليقاتِ، فتعليقٌ
 *      يذكرُ `INSERT` لا يُخفِقُ، وسطرُ شيفرةٍ يذكرُهُ يُخفِقُ.
 *   ٢. **الإنفاذُ قائمٌ في الشيفرةِ** — `READ ONLY` و`ROLLBACK` موجودانِ. وهذا
 *      يمنعُ أن يُنزَعَ الإنفاذُ فيبقى الاسمُ «تشغيلاً جافّاً» بلا معنىً.
 *   ٣. **كلُّ عمودِ تجميعٍ موجودٌ في المخطَّطِ فعلاً** — خطّةٌ تُجمِّعُ بعمودٍ لا
 *      وجودَ لهُ تُخفِقُ لحظةَ التحوُّلِ، وهوَ أسوأُ وقتٍ.
 *   ٤. **لا جدولَ في الموجتَينِ المحجوزتَينِ بلا مِسبارٍ** — الطرفُ الأوّلُ.
 *   ٥. **لا مِسبارَ خارجَ الموجتَينِ** — الطرفُ الثاني: أداةٌ تقيسُ ما لم يُحجَزْ
 *      تُقرَأُ إنجازاً لبندٍ آخرَ لم يُنفَّذْ.
 *   ٦. **لا `RECONCILED` يُكتَبُ في شيفرةِ إنتاجٍ ما دامَ `DEP-CORE-007` مفتوحاً**
 *      — الحاجزُ الذي يمنعُ الأخضرَ الزائفَ، مقروءاً من `ROADMAP.md` لا مفترضاً.
 *   ٧. **الوثيقةُ المولَّدةُ تطابقُ السجلَّ** — فلا وصفٌ يهجرُ ما يُنفَّذُ.
 *
 * الحالة: منفّذ فعلياً — `W-8`، ومربوطٌ بسلسلةِ `ci` وبوظيفةِ `verify` **قبلَ**
 *   خطوةِ `city_id` الحمراءِ، لأنَّ خطوةً بعدَها تُقرَأُ `skipped` فلا حكمَ لها.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: كلُّ تعديلٍ على مسابرِ الموجاتِ أو على مفرداتِ
 *   التسويةِ، و`W-9` عندَ إضافةِ مسابرِ التحوُّلِ.
 * ملاحظات مستقبلية: عندَ إغلاقِ `DEP-CORE-007` يسقطُ الفحصُ السادسُ من نفسِه
 *   بلا تعديلِ حرفٍ: شرطُهُ مقروءٌ من `ROADMAP.md`.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { declaredMigrationsText } from "./lib/migration-sources.ts";
import {
  buildProbeStatement,
  columnsFromSchema,
  DRY_RUN_POST_MATRIX_TABLES,
  DRY_RUN_PROBES,
  DRY_RUN_RESERVED_WAVES,
  entryConditionOf,
  FORBIDDEN_WRITE_VERBS,
} from "./lib/wasla-migration-dry-run.ts";
import { WASLA_MIGRATION_MATRIX } from "./lib/wasla-migration-matrix.ts";

export interface Problem {
  readonly check: string;
  readonly detail: string;
}

const DOC_PATH = "docs/migration/dry-run-and-reconciliation.md";
const TOOL_PATH = "scripts/wasla-migration-dry-run.ts";
const LIB_PATH = "scripts/lib/wasla-migration-dry-run.ts";
// مسابرُ التحوُّلِ تُقاسُ على المُعلَنِ: عمودٌ في هجرةٍ مؤجَّلةٍ موجودٌ
// مكتوباً وإن لم يُطبَّقْ بعدُ (`ADR 0095`).
const MIGRATIONS_DIR = "supabase/migrations";
const BEGIN_MARKER = "<!-- BEGIN GENERATED: dry-run-and-reconciliation -->";
const END_MARKER = "<!-- END GENERATED: dry-run-and-reconciliation -->";
const CORE_ENV_DEPENDENCY = "DEP-CORE-007";

/**
 * يحذفُ التعليقاتَ والنصوصَ الحرفيّةَ الطويلةَ من TypeScript. **لازمٌ**: هذا
 * الملفُّ نفسُه يذكرُ أفعالَ الكتابةِ في وثيقتِه، فحارسٌ يقرأُ النصَّ خاماً
 * يُخفِقُ على نفسِه ثمَّ يُخفَّفُ — والتخفيفُ هوَ العطبُ الذي نمنعُهُ.
 */
export function stripCommentsAndDocs(source: string): string {
  let out = "";
  let index = 0;
  let inBlock = false;
  let inLine = false;
  while (index < source.length) {
    const two = source.slice(index, index + 2);
    if (!inBlock && !inLine && two === "/*") {
      inBlock = true;
      index += 2;
      continue;
    }
    if (inBlock && two === "*/") {
      inBlock = false;
      index += 2;
      continue;
    }
    if (!inBlock && !inLine && two === "//") {
      inLine = true;
      index += 2;
      continue;
    }
    if (inLine && source[index] === "\n") {
      inLine = false;
      out += "\n";
      index += 1;
      continue;
    }
    if (!inBlock && !inLine) out += source[index];
    index += 1;
  }
  return out;
}

/** يقرأُ كلَّ نصوصِ الهجراتِ مُجمَّعةً. */
export function readMigrationsText(dir?: string): string {
  if (dir === undefined) return declaredMigrationsText();
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .join("\n");
}

/** ما يُمرَّرُ إلى `dryRunProblems` كي تكونَ الدالّةُ نقيّةً قابلةً للإفسادِ. */
export interface DryRunInputs {
  readonly toolSource: string;
  readonly libSource: string;
  readonly schemaSql: string;
  readonly roadmapText: string;
  readonly docText: string;
  readonly probes: readonly { table: string; groupBy: readonly string[]; measures: string }[];
  readonly reservedWaves: readonly number[];
}

export function defaultInputs(): DryRunInputs {
  return {
    toolSource: readFileSync(TOOL_PATH, "utf8"),
    libSource: readFileSync(LIB_PATH, "utf8"),
    schemaSql: readMigrationsText(),
    roadmapText: readFileSync("ROADMAP.md", "utf8"),
    docText: readFileSync(DOC_PATH, "utf8"),
    probes: DRY_RUN_PROBES,
    reservedWaves: DRY_RUN_RESERVED_WAVES,
  };
}

/** هل التبعيّةُ مُعلَنةٌ مفتوحةً في الخارطةِ؟ يُقرأُ ولا يُفترَضُ. */
export function coreEnvironmentDependencyOpen(roadmapText: string): boolean {
  if (!roadmapText.includes(CORE_ENV_DEPENDENCY)) return false;
  const closedPattern = new RegExp(`${CORE_ENV_DEPENDENCY}[^\\n]*\\b(CLOSED|مُغلَقة|مغلقة)\\b`);
  return !closedPattern.test(roadmapText);
}

export function dryRunProblems(inputs: DryRunInputs): readonly Problem[] {
  const problems: Problem[] = [];
  const toolCode = stripCommentsAndDocs(inputs.toolSource);
  const libCode = stripCommentsAndDocs(inputs.libSource);

  // ١. لا فعلَ كتابةٍ في شيفرةِ الأداةِ.
  for (const verb of FORBIDDEN_WRITE_VERBS) {
    const pattern = new RegExp(`\\b${verb}\\b`);
    if (pattern.test(toolCode)) {
      problems.push({
        check: "١. لا فعلَ كتابةٍ في وحدةِ التشغيلِ الجافِّ",
        detail: `\`${TOOL_PATH}\` يذكرُ \`${verb}\` في شيفرةٍ مُنفَّذةٍ لا في تعليقٍ. والتشغيلُ الجافُّ لا يكتبُ، ولا يُستثنى فعلٌ ههنا: الاستثناءُ الأوّلُ يُلغي المعنى.`,
      });
    }
  }

  // ٢. الإنفاذُ قائمٌ لا منزوعٌ.
  if (!libCode.includes("READ ONLY")) {
    problems.push({
      check: "٢. الإنفاذُ قائمٌ في الشيفرةِ",
      detail: `\`${LIB_PATH}\` لا يُعلِنُ \`READ ONLY\`. ونزعُها يجعلُ الاسمَ «تشغيلاً جافّاً» والسلوكَ كتابةً مُمكنةً — وذاكَ أخطرُ من غيابِ الأداةِ.`,
    });
  }
  if (!toolCode.includes("ROLLBACK")) {
    problems.push({
      check: "٢. الإنفاذُ قائمٌ في الشيفرةِ",
      detail: `\`${TOOL_PATH}\` لا يلفُّ المُعاملةَ بـ\`ROLLBACK\`. والسبيلانِ مقصودانِ: لو أُسقِطَ \`READ ONLY\` سهواً لَمنعَ اللفُّ الأثرَ من الثباتِ.`,
    });
  }

  if (!toolCode.includes("reserve()")) {
    problems.push({
      check: "٢. الإنفاذُ قائمٌ في الشيفرةِ",
      detail: `\`${TOOL_PATH}\` لا يحجزُ اتّصالاً واحداً بـ\`reserve()\`. وبلا حجزٍ تُفتَحُ \`READ ONLY\` على اتّصالٍ ويجري المِسبارُ على آخرَ من التجمُّعِ، فالقراءةُ-فقط خاصّةُ اتّصالٍ لا يجري عليهِ شيءٌ والمِسبارُ على اتّصالٍ **يستطيعُ الكتابةَ**: ثابتٌ مُعلَنٌ وسلوكٌ مخالفٌ. وقد كشفَ ذلكَ القياسُ على قاعدةٍ حقيقيّةٍ لا المراجعةُ.`,
    });
  }

  // ٣. كلُّ عمودِ تجميعٍ موجودٌ في المخطَّطِ.
  const schema = columnsFromSchema(inputs.schemaSql);
  for (const probe of inputs.probes) {
    const columns = schema.get(probe.table);
    if (columns === undefined) {
      problems.push({
        check: "٣. كلُّ عمودِ تجميعٍ موجودٌ في المخطَّطِ",
        detail: `المِسبارُ يقيسُ \`${probe.table}\` ولا جدولَ بهذا الاسمِ في \`${MIGRATIONS_DIR}\`. فالخطّةُ تُخفِقُ لحظةَ التحوُّلِ لا لحظةَ المراجعةِ.`,
      });
      continue;
    }
    for (const column of probe.groupBy) {
      if (!columns.has(column)) {
        problems.push({
          check: "٣. كلُّ عمودِ تجميعٍ موجودٌ في المخطَّطِ",
          detail: `المِسبارُ يُجمِّعُ \`${probe.table}\` بالعمودِ \`${column}\` ولا وجودَ لهُ في المخطَّطِ. والأعمدةُ الموجودةُ: ${[...columns].join(", ")}.`,
        });
      }
    }
    if (probe.groupBy.length === 0) {
      problems.push({
        check: "٣. كلُّ عمودِ تجميعٍ موجودٌ في المخطَّطِ",
        detail: `المِسبارُ \`${probe.table}\` بلا عمودِ تجميعٍ. ورقمٌ واحدٌ لجدولٍ كاملٍ يُخفي التوزيعَ، والتوزيعُ هوَ المخاطرةُ.`,
      });
    }
    if (probe.measures.trim().length < 40) {
      problems.push({
        check: "٣. كلُّ عمودِ تجميعٍ موجودٌ في المخطَّطِ",
        detail: `المِسبارُ \`${probe.table}\` بلا سببِ قياسٍ مقروءٍ. وتقريرٌ يقولُ «١٤٢ صفّاً» بلا سببٍ لا يُراجَعُ.`,
      });
    }
  }

  // ٤ و ٥. الطرفانِ: لا جدولَ محجوزاً بلا مِسبارٍ، ولا مِسبارَ خارجَ الحجزِ.
  const probed = new Set(inputs.probes.map((probe) => probe.table));
  const reserved = new Set(inputs.reservedWaves);
  const postMatrix = new Set<string>(DRY_RUN_POST_MATRIX_TABLES);
  for (const entry of WASLA_MIGRATION_MATRIX) {
    if (!reserved.has(entry.wave) || entry.mechanism === "NONE") continue;
    if (!probed.has(entry.table)) {
      problems.push({
        check: "٤. لا جدولَ في الموجتَينِ المحجوزتَينِ بلا مِسبارٍ",
        detail: `\`${entry.table}\` في الموجةِ ${entry.wave} بآليّةِ \`${entry.mechanism}\` ولا مِسبارَ لهُ. فالتشغيلُ الجافُّ يُقرَأُ شاملاً وهوَ ناقصٌ — وجدولٌ لا يُقاسُ يُلمَسُ لحظةَ التحوُّلِ بلا عددٍ سابقٍ.`,
      });
    }
  }
  const matrixTables = new Map(WASLA_MIGRATION_MATRIX.map((entry) => [entry.table, entry.wave]));
  for (const probe of inputs.probes) {
    if (postMatrix.has(probe.table)) continue;
    const wave = matrixTables.get(probe.table);
    if (wave === undefined) {
      problems.push({
        check: "٥. لا مِسبارَ خارجَ الموجتَينِ المحجوزتَينِ",
        detail: `المِسبارُ \`${probe.table}\` لا سطرَ لهُ في المصفوفةِ ولا هوَ في \`DRY_RUN_POST_MATRIX_TABLES\`. فإمّا سطرٌ في المصفوفةِ وإمّا إعلانٌ صريحٌ — لا ثالثَ.`,
      });
      continue;
    }
    if (!reserved.has(wave)) {
      problems.push({
        check: "٥. لا مِسبارَ خارجَ الموجتَينِ المحجوزتَينِ",
        detail: `المِسبارُ \`${probe.table}\` في الموجةِ ${wave} وهيَ خارجَ حجزِ \`W-8\` (${inputs.reservedWaves.join(", ")}). وأداةٌ تقيسُ ما لم يُحجَزْ تُقرَأُ إنجازاً لبندٍ آخرَ لم يُنفَّذْ.`,
      });
    }
  }

  // ٦. الحاجزُ الذي يمنعُ الأخضرَ الزائفَ.
  if (coreEnvironmentDependencyOpen(inputs.roadmapText)) {
    const claim = /"RECONCILED"|'RECONCILED'|`RECONCILED`/;
    if (claim.test(toolCode)) {
      problems.push({
        check: `٦. لا \`RECONCILED\` ما دامَ \`${CORE_ENV_DEPENDENCY}\` مفتوحاً`,
        detail: `\`${TOOL_PATH}\` يُثبِتُ \`RECONCILED\` في شيفرةٍ مُنفَّذةٍ، و\`${CORE_ENV_DEPENDENCY}\` مفتوحٌ في \`ROADMAP.md\` فلا مصدرَ في CORE يُقرأُ منه الطرفُ الآخرُ. والحالةُ الصادقةُ الوحيدةُ \`UNVERIFIABLE\`، وتُشتَقُّ في \`deriveReconciliation\` لا تُكتَبُ ههنا.`,
      });
    }
    if (!toolCode.includes("NO_CORE_READER")) {
      problems.push({
        check: `٦. لا \`RECONCILED\` ما دامَ \`${CORE_ENV_DEPENDENCY}\` مفتوحاً`,
        detail: `\`${TOOL_PATH}\` لا يستعملُ \`NO_CORE_READER\`. وما دامَ \`${CORE_ENV_DEPENDENCY}\` مفتوحاً فالقارئُ الصادقُ هوَ الذي يُعيدُ «لا قراءةَ»، لا قارئٌ يُعيدُ صفراً فيُقرَأُ الصفرُ تطابقاً.`,
      });
    }
  }

  // ٧. الوثيقةُ تطابقُ السجلَّ.
  const expected = generatedSlice(inputs);
  const actual = extractSlice(inputs.docText);
  if (actual === undefined) {
    problems.push({
      check: "٧. الوثيقةُ المولَّدةُ تطابقُ السجلَّ",
      detail: `\`${DOC_PATH}\` بلا علامتَي التوليدِ. شغِّل \`bun run scripts/check-migration-dry-run.ts --write\`.`,
    });
  } else if (actual.trim() !== expected.trim()) {
    problems.push({
      check: "٧. الوثيقةُ المولَّدةُ تطابقُ السجلَّ",
      detail: `\`${DOC_PATH}\` يهجرُ السجلَّ. شغِّل \`bun run scripts/check-migration-dry-run.ts --write\`. ولا يُحرَّرُ ما بينَ العلامتَينِ يدوياً: مصدرُ الحقيقةِ واحدٌ (القاعدةُ 0.6).`,
    });
  }
  return problems;
}

export function extractSlice(docText: string): string | undefined {
  const start = docText.indexOf(BEGIN_MARKER);
  const end = docText.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) return undefined;
  return docText.slice(start + BEGIN_MARKER.length, end);
}

export function generatedSlice(inputs: DryRunInputs): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(
    "<!-- مولَّدٌ من `scripts/lib/wasla-migration-dry-run.ts`. لا يُحرَّرُ يدوياً: مصدرُ الحقيقةِ واحدٌ (القاعدةُ 0.6). -->",
  );
  lines.push("");
  lines.push(`## المسابرُ (${inputs.probes.length})`);
  lines.push("");
  for (const probe of inputs.probes) {
    lines.push(`### \`${probe.table}\``);
    lines.push("");
    lines.push(`- **يُجمَّعُ بـ**: ${probe.groupBy.map((column) => `\`${column}\``).join(" و ")}`);
    lines.push(`- **ولماذا**: ${probe.measures}`);
    lines.push("");
    lines.push("```sql");
    lines.push(buildProbeStatement(probe as never));
    lines.push("```");
    lines.push("");
  }
  lines.push("## الموجاتُ المحجوزةُ وشروطُ دخولِها");
  lines.push("");
  for (const wave of inputs.reservedWaves) {
    lines.push(`### الموجةُ ${wave}`);
    lines.push("");
    lines.push(entryConditionOf(wave) ?? "‹لا موجةَ بهذا الرقمِ في المصفوفةِ›");
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function withGeneratedBlock(docText: string, slice: string): string {
  const start = docText.indexOf(BEGIN_MARKER);
  const end = docText.indexOf(END_MARKER);
  if (start === -1 || end === -1)
    return `${docText.trimEnd()}\n\n${BEGIN_MARKER}${slice}${END_MARKER}\n`;
  return docText.slice(0, start + BEGIN_MARKER.length) + slice + docText.slice(end);
}

if (import.meta.main) {
  const inputs = defaultInputs();
  if (process.argv.includes("--write")) {
    writeFileSync(DOC_PATH, withGeneratedBlock(inputs.docText, generatedSlice(inputs)), "utf8");
    process.stdout.write(`كُتِبَ ${DOC_PATH}\n`);
    process.exit(0);
  }
  const problems = dryRunProblems(inputs);
  if (problems.length === 0) {
    process.stdout.write(
      `أدواتُ التشغيلِ الجافِّ والتسويةِ: ${inputs.probes.length} مِسباراً على الموجاتِ ${inputs.reservedWaves.join(", ")} — لا كتابةَ مُمكنةً ولا تسويةَ مُدَّعاةً.\n`,
    );
    process.exit(0);
  }
  for (const problem of problems)
    process.stderr.write(`✗ ${problem.check}\n  ${problem.detail}\n\n`);
  process.stderr.write(`${problems.length} مشكلةً.\n`);
  process.exit(1);
}
