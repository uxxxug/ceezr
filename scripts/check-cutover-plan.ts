#!/usr/bin/env bun
/**
 * # حاجزُ سجلِّ التحوُّلِ والاسترجاعِ (`W-9` · ADR 0088)
 *
 * يفرضُ أن يبقى السجلُّ **مُشتَقّاً** لا مكتوباً، وأن يبقى لكلِّ خطوةٍ عكسٌ
 * ومِسبارُ قراءةٍ، وأن يبقى التمرينُ **مرفوضاً بالإنشاءِ** ما دامَ حاجزٌ من
 * حواجزِ التمرينِ مفتوحاً في `ROADMAP.md`.
 *
 * `--write` يُولِّدُ `docs/wasla/cutover-plan.md` وحدَه. والوثيقةُ لا تُحرَّرُ يداً
 * (القاعدةُ 0.6)، والفحصُ الأخيرُ يقيسُ التطابقَ.
 *
 * **ما لا يفعلُه:** لا يُشغِّلُ تمريناً، ولا يتّصلُ بقاعدةٍ، ولا يزعمُ أنَّ
 * الاسترجاعَ مُجرَّبٌ. إعلانُ العكسِ ليسَ برهانَ العكسِ.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseBlockers } from "./lib/wasla-blockers.ts";
import {
  CUTOVER_PHASES,
  type CutoverStep,
  deriveCutoverPlan,
  isReadOnlyStatement,
  isRehearsalRefused,
  REHEARSAL_GATE_BLOCKERS,
  rehearseReadOnly,
  rollbackOrder,
} from "./lib/wasla-cutover-plan.ts";
import { WASLA_MIGRATION_MATRIX } from "./lib/wasla-migration-matrix.ts";

const ROOT = process.cwd();
const DOC_PATH = "docs/wasla/cutover-plan.md";
const EXECUTOR_PATH = "scripts/rehearse-cutover.ts";
const SELF_PATH = "scripts/check-cutover-plan.ts";
const LIB_PATH = "scripts/lib/wasla-cutover-plan.ts";

/** كلماتُ الكتابةِ الممنوعةُ في المُنفِّذِ — التمرينُ لا يكتبُ حرفاً. */
const WRITE_TOKENS = [
  "insert into",
  "update ",
  "delete from",
  "drop ",
  "truncate",
  "alter table",
  "create table",
  "grant ",
];

export interface Problem {
  readonly check: string;
  readonly detail: string;
}

export interface CutoverInputs {
  readonly roadmapText: string;
  readonly docText: string | null;
  readonly executorSource: string;
  readonly steps: readonly CutoverStep[];
  /** ملفّاتُ TypeScript المفحوصةُ: لا مُنفِّذَ ثانياً يبني تمريناً بنفسِه. */
  readonly sources: readonly { readonly file: string; readonly text: string }[];
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const child = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "dist", "build", ".next", "coverage"].includes(entry.name)) {
        continue;
      }
      walk(child, out);
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(child);
  }
}

export function typescriptFiles(): readonly string[] {
  const out: string[] = [];
  for (const dir of ["scripts", "packages", "apps", "tests"]) {
    try {
      walk(dir, out);
    } catch {
      // مجلَّدٌ غائبٌ لا يُسكِتُ الفحصَ: البقيّةُ تُمسَحُ، والغيابُ يظهرُ في العددِ.
    }
  }
  return out.map((file) => relative(".", file)).sort();
}

export function renderDoc(steps: readonly CutoverStep[]): string {
  const lines: string[] = [
    "# سجلُّ خطواتِ التحوُّلِ والاسترجاعِ — مُولَّدٌ",
    "",
    "> **لا تُحرَّرْ يداً.** هذه الوثيقةُ تُولَّدُ بـ",
    "> `bun run scripts/check-cutover-plan.ts --write` من `scripts/lib/wasla-cutover-plan.ts`،",
    "> وهوَ يشتقُّها من `scripts/lib/wasla-migration-matrix.ts` ومن حالةِ الحواجزِ في",
    "> `ROADMAP.md`. والحاجزُ يُخفِقُ إن اختلفَت.",
    "",
    "**ولا تمرينَ جرى، ولا موجةَ نُفِّذَت، ولا صفَّ كُتِبَ.** التمرينُ مرفوضٌ",
    `بالإنشاءِ ما دامَ حاجزٌ من ${REHEARSAL_GATE_BLOCKERS.map((id) => `\`${id}\``).join(" · ")}`,
    "مفتوحاً، وأقصى ما يُنتِجُه المُنفِّذُ حينَ تُغلَقُ كلُّها هوَ مِسبارُ قراءةٍ —",
    "لا شهادةٌ على تحوُّلٍ.",
    "",
    `عددُ الخطواتِ: **${steps.length}**. وترتيبُ الاسترجاعِ **عكسُ** ترتيبِ التحوُّلِ حرفاً بحرفٍ.`,
    "",
    "## الخطواتُ بترتيبِ التنفيذِ",
    "",
    "| # | الخطوةُ | الموجةُ | الطورُ | الآليّةُ | يستعيدُ بياناتٍ؟ | محجوبةٌ بـ |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const step of steps) {
    lines.push(
      `| ${step.order} | \`${step.id}\` | ${step.wave} | ${step.phase} | ${step.mechanism} | ` +
        `${step.rollback.requiresDataRestore ? "نعم" : "لا"} | ` +
        `${step.blockedBy.map((id) => `\`${id}\``).join(" · ") || "—"} |`,
    );
  }
  lines.push("", "## العكسُ والمِسبارُ لكلِّ خطوةٍ", "");
  for (const step of steps) {
    lines.push(
      `### \`${step.id}\``,
      "",
      `- **الجدولُ**: \`${step.table}\` · **الطورُ**: ${step.phase} · **الرتبةُ**: ${step.order}`,
      `- **خطوةُ الاسترجاعِ العكسيّةُ** (عكسُ \`${step.rollback.inverseOf}\`): ${step.rollback.action}`,
      `- **شكلُ العودةِ للآليّةِ**: ${step.rollback.shape}`,
      `- **مِسبارُ التحقُّقِ (قراءةٌ فقط)**: \`${step.probe.statement}\``,
      `- **يُقرأُ «تمَّت» بـ**: ${step.probe.readsAs}`,
      "",
    );
  }
  lines.push("## ترتيبُ الاسترجاعِ (معكوسٌ)", "");
  for (const [index, step] of rollbackOrder(steps).entries()) {
    lines.push(`${index + 1}. عكسُ \`${step.inverseOf}\``);
  }
  lines.push("");
  return lines.join("\n");
}

export function cutoverProblems(inputs: CutoverInputs): readonly Problem[] {
  const problems: Problem[] = [];
  const { steps } = inputs;

  // ١ — كلُّ خطوةٍ لها عكسٌ مكتوبٌ ومِسبارٌ للقراءةِ وحدَها.
  for (const step of steps) {
    if (step.rollback.action.trim().length === 0 || step.rollback.shape.trim().length === 0) {
      problems.push({
        check: "خطوةٌ بلا عكسٍ",
        detail: `${step.id} لا تُعلِنُ خطوةَ استرجاعٍ — فلا سبيلَ إلى ردِّها`,
      });
    }
    if (step.rollback.inverseOf !== step.id) {
      problems.push({
        check: "عكسٌ يُشيرُ إلى غيرِ خطوتِه",
        detail: `${step.id} عكسُها مُسنَدٌ إلى ${step.rollback.inverseOf}`,
      });
    }
    if (!isReadOnlyStatement(step.probe.statement)) {
      problems.push({
        check: "مِسبارٌ ليسَ للقراءةِ وحدَها",
        detail: `${step.id}: «${step.probe.statement}»`,
      });
    }
    if (step.probe.readsAs.trim().length === 0) {
      problems.push({
        check: "مِسبارٌ بلا قراءةٍ لـ«تمَّت»",
        detail: `${step.id} لا يُعلِنُ ما يُقرأُ به التمامُ`,
      });
    }
    if (!CUTOVER_PHASES.includes(step.phase)) {
      problems.push({ check: "طورٌ غيرُ مُعلَنٍ", detail: `${step.id}: ${step.phase}` });
    }
  }

  // ٢ — الرتبةُ كلّيّةٌ: فريدةٌ، متصاعدةٌ، بلا فراغٍ. ولا موجةٌ تسبقُ أدنى منها.
  const orders = steps.map((step) => step.order);
  if (new Set(orders).size !== orders.length) {
    problems.push({ check: "رتبةٌ مكرَّرةٌ", detail: "خطوتانِ بالرتبةِ عينِها" });
  }
  for (const [index, step] of steps.entries()) {
    if (step.order !== index + 1) {
      problems.push({
        check: "فراغٌ في الرتبةِ",
        detail: `${step.id} رتبتُها ${step.order} وموضعُها ${index + 1}`,
      });
      break;
    }
    if (index > 0) {
      const previous = steps[index - 1];
      if (previous !== undefined && previous.wave > step.wave) {
        problems.push({
          check: "موجةٌ متأخِّرةٌ قبلَ أسبقَ منها",
          detail: `${previous.id} (موجة ${previous.wave}) قبلَ ${step.id} (موجة ${step.wave})`,
        });
      }
    }
  }

  // ٣ — ترتيبُ الاسترجاعِ معكوسٌ حرفاً بحرفٍ، لا «قريبٌ من المعكوسِ».
  const reversed = rollbackOrder(steps).map((entry) => entry.inverseOf);
  const expected = steps
    .slice()
    .reverse()
    .map((step) => step.id);
  if (reversed.join("|") !== expected.join("|")) {
    problems.push({
      check: "ترتيبُ الاسترجاعِ ليسَ عكسَ التحوُّلِ",
      detail: `أوّلُ اختلافٍ: ${reversed.find((id, index) => id !== expected[index]) ?? "—"}`,
    });
  }

  // ٤ — لا خطوةَ إلّا لصفٍّ في المصفوفةِ، ولا صفَّ مُهاجِرٌ بلا خطوةٍ. الاتجاهانِ.
  const matrixTables = new Set(
    WASLA_MIGRATION_MATRIX.filter((entry) => entry.wave > 0).map((entry) => entry.table),
  );
  const stepTables = new Set(steps.map((step) => step.table));
  for (const table of stepTables) {
    if (!matrixTables.has(table)) {
      problems.push({
        check: "خطوةٌ بلا صفٍّ في المصفوفةِ",
        detail: `${table} — والسجلُّ مُشتَقٌّ فلا يُضافُ إليه جدولٌ يداً`,
      });
    }
  }
  for (const table of matrixTables) {
    if (!stepTables.has(table)) {
      problems.push({
        check: "صفٌّ مُهاجِرٌ بلا خطوةِ تحوُّلٍ",
        detail: `${table} في موجةٍ ≥ 1 ولا خطوةَ له`,
      });
    }
  }

  // ٥ — كلُّ معرّفٍ في `blockedBy` مُعلَنٌ في `ROADMAP.md`؛ فمعرّفٌ مُختلَقٌ
  //     يُقرأُ حَجباً وهميّاً أو يُسقِطُ حَجباً حقيقيّاً.
  const declared = new Set(parseBlockers(inputs.roadmapText).map((blocker) => blocker.id));
  for (const step of steps) {
    for (const id of step.blockedBy) {
      if (!declared.has(id)) {
        problems.push({
          check: "حاجزٌ غيرُ مُعلَنٍ في سجلِّ الحواجزِ",
          detail: `${step.id} محجوبةٌ بـ${id} وليسَ في جداولِ ROADMAP.md`,
        });
      }
    }
  }

  // ٦ — **الرفضُ حيٌّ**: على الخارطةِ الحقيقيّةِ يُرَدُّ `REFUSED` لا غيرُه. وهذا
  //     الفحصُ هوَ الذي يمنعُ أن يصيرَ الحاجزُ شاهداً على تمرينٍ لم يقعْ.
  const outcome = rehearseReadOnly(steps, parseBlockers(inputs.roadmapText));
  if (!isRehearsalRefused(outcome)) {
    problems.push({
      check: "الرفضُ لم يعُدْ حيّاً",
      detail:
        "على `ROADMAP.md` كما هيَ، لم يُرَدَّ `REFUSED`. فإن أُغلِقَت حواجزُ " +
        "التمرينِ فعلاً فليُسجَّلْ ذلكَ بقرارٍ ودليلٍ ويُعدَّلْ هذا الفحصُ صراحةً، " +
        "لا صمتاً.",
    });
  } else if (outcome.openGates.length === 0) {
    problems.push({
      check: "رفضٌ بلا حاجزٍ",
      detail: `الرفضُ وقعَ ولا حاجزَ مفتوحاً يُسمّى — والسببُ: ${outcome.reason}`,
    });
  }

  // ٧ — المُنفِّذُ لا يكتبُ حرفاً، ولا مُنفِّذَ ثانياً.
  const lowered = inputs.executorSource.toLowerCase();
  for (const token of WRITE_TOKENS) {
    if (lowered.includes(token)) {
      problems.push({
        check: "المُنفِّذُ يحملُ كلمةَ كتابةٍ",
        detail: `${EXECUTOR_PATH} يذكرُ «${token}» — والتمرينُ للقراءةِ وحدَها`,
      });
    }
  }
  if (!inputs.executorSource.includes("rehearseReadOnly")) {
    problems.push({
      check: "المُنفِّذُ لا يمرُّ بالرفضِ",
      detail: `${EXECUTOR_PATH} لا يستدعي \`rehearseReadOnly\`، فقد يبني حكماً بنفسِه`,
    });
  }
  for (const source of inputs.sources) {
    if (
      source.file === EXECUTOR_PATH ||
      source.file === SELF_PATH ||
      source.file === LIB_PATH ||
      source.file.startsWith("tests/")
    ) {
      continue;
    }
    if (source.text.includes("READ_ONLY_PROBED")) {
      problems.push({
        check: "حالةُ التمرينِ تُبنى خارجَ مصدرِها",
        detail: `${source.file} يذكرُ \`READ_ONLY_PROBED\` — وهيَ لا تُبنى إلّا في ${LIB_PATH}`,
      });
    }
  }

  // ٨ — الوثيقةُ مُولَّدةٌ ومطابقةٌ.
  if (inputs.docText === null) {
    problems.push({ check: "الوثيقةُ غائبةٌ", detail: `${DOC_PATH} غيرُ موجودةٍ` });
  } else if (inputs.docText !== renderDoc(steps)) {
    problems.push({
      check: "الوثيقةُ لا تطابقُ الاشتقاقَ",
      detail: `${DOC_PATH} — أعِدْ توليدَها بـ--write ولا تُحرِّرْها يداً (القاعدةُ 0.6)`,
    });
  }

  return problems;
}

export function defaultInputs(): CutoverInputs {
  const sources = typescriptFiles().map((file) => ({
    file,
    text: readFileSync(join(ROOT, file), "utf8"),
  }));
  let docText: string | null = null;
  try {
    docText = readFileSync(join(ROOT, DOC_PATH), "utf8");
  } catch {
    docText = null;
  }
  return {
    roadmapText: readFileSync(join(ROOT, "ROADMAP.md"), "utf8"),
    docText,
    executorSource: readFileSync(join(ROOT, EXECUTOR_PATH), "utf8"),
    steps: deriveCutoverPlan(),
    sources,
  };
}

function main(): void {
  const steps = deriveCutoverPlan();
  if (process.argv.includes("--write")) {
    writeFileSync(join(ROOT, DOC_PATH), renderDoc(steps), "utf8");
    console.log(`كُتِبَت ${DOC_PATH} — ${steps.length} خطوةً.`);
    return;
  }
  const problems = cutoverProblems(defaultInputs());
  if (problems.length > 0) {
    console.error("فحصُ سجلِّ التحوُّلِ: أخفقَ.");
    for (const problem of problems) console.error(`  - [${problem.check}] ${problem.detail}`);
    process.exit(1);
  }
  const outcome = rehearseReadOnly(steps, parseBlockers(readFileSync("ROADMAP.md", "utf8")));
  const gates = isRehearsalRefused(outcome) ? outcome.openGates.join("، ") : "—";
  console.log(
    `فحصُ سجلِّ التحوُّلِ: نجح — ${steps.length} خطوةً، لكلٍّ عكسٌ ومِسبارُ قراءةٍ، ` +
      `والتمرينُ مرفوضٌ بالإنشاءِ (${gates}).`,
  );
}

if (import.meta.main) main();
