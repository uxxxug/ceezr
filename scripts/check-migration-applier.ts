/**
 * الغرض: حاجزٌ يمنع عودةَ تطبيقِ الهجراتِ بحلقةِ `psql` عاريةٍ في CI — مصدرُ
 *    الحقيقةِ الواحدُ لتطبيقِ الهجراتِ هو `scripts/migrate.ts` (F7-07 · ADR 0068).
 * الحالة: منفّذ فعلياً — أداةُ تحقّقٍ، ليست منطقَ أعمالٍ.
 * ينتمي إلى: scripts
 * يستخدمه: `bun run ci` و`tests/unit/check-migration-applier.test.ts`.
 *
 * لماذا؟ لأنّ العيبَ وقعَ فعلاً في هذا المستودعِ ولم يُكشَف إلّا بمراجعةٍ لاحقةٍ:
 * البندُ `F7-07` استبدلَ حلقتَي `psql` في `.github/workflows/ci.yml` بالمُطبِّقِ
 * الآمنِ ودُمِجَ (`aadba70` ثمّ `524f266`)، ثمّ أعادَ حلُّ تعارضٍ في دمجِ فرعٍ
 * آخرَ (`a16bf97` — «merge main into F7-02 after F7-07 merge») النسخةَ القديمةَ
 * من الملفِّ، فرجعتِ الحلقتانِ إلى `main` بلا التزامٍ يقول ذلك ولا مراجعةٍ تراه.
 * فبقيتِ الوثائقُ وADR 0068 تقولُ إنّ المُطبِّقَ «هو نفسُه ما يُطبِّقُ في CI» —
 * وهو زعمٌ صارَ كاذباً في مكانِ الفعلِ وحدَه.
 *
 * والضررُ ليس شكليّاً: الحلقةُ العاريةُ بلا `lock_timeout` ولا `statement_timeout`
 * ولا معاملةٍ يملكُها المُطبِّقُ، ولا تمرُّ على حُكمِ `migration-safety`. فما يرفضُه
 * الحاجزُ قد تُطبِّقُه الحلقةُ، وتُقرأُ الوظيفةُ خضراءَ على مسارٍ لا يُشبِهُ النشرَ.
 *
 * وإصلاحٌ يدويٌّ واحدٌ لا يمنعُ التكرار — ولا سيّما أنّ سببَ التكرارِ حلُّ تعارضٍ
 * لا كتابةُ كودٍ. فهذا الفاحصُ هو ما يمنعُه: يسقطُ البناءُ إن عادتِ الحلقةُ، وإن
 * وُجِدَت وظيفةٌ تُهيّئُ قاعدةَ الهجراتِ ثمّ لا تنادي المُطبِّقَ.
 */

import { existsSync, readFileSync } from "node:fs";

const DEFAULT_WORKFLOW = ".github/workflows/ci.yml";

/** المُطبِّقُ المُعتمَدُ — الطريقُ الوحيدُ لتطبيقِ الهجراتِ. */
export const APPLIER = "scripts/migrate.ts";

/** دليلُ أنّ الوظيفةَ تُهيّئُ قاعدةَ الهجراتِ: أدوارُ Supabase التي تفترضُها. */
const ROLE_BOOTSTRAP_MARKER = /create\s+role\s+(anon|authenticated|service_role)/i;

/** مسارُ ملفّاتِ الهجرات كما تُكتَبُ في أيِّ أمرِ صدَفةٍ. */
const MIGRATIONS_GLOB = /supabase\/migrations/;

export interface Finding {
  readonly code: "PSQL_APPLY" | "PSQL_LOOP" | "APPLIER_MISSING";
  readonly job: string;
  readonly line: number;
  readonly message: string;
}

interface JobBlock {
  readonly name: string;
  readonly startLine: number;
  readonly lines: readonly string[];
}

/**
 * يُقسِّمُ محتوى ملفِّ سيرِ عملٍ إلى وظائفَ. التقسيمُ نصّيٌّ بمفتاحِ الإزاحةِ
 * (وظيفةٌ = مفتاحٌ بإزاحةِ مسافتَين تحت `jobs:`) لأنّ الحاجزَ يقرأُ أوامرَ صدَفةٍ
 * سطراً سطراً ويحتاجُ رقمَ السطرِ الحقيقيَّ في الملفِّ لا شجرةَ YAML.
 */
export function jobsOf(content: string): JobBlock[] {
  const lines = content.split("\n");
  const jobs: JobBlock[] = [];
  let inJobs = false;
  let current: { name: string; startLine: number; lines: string[] } | null = null;

  const push = (): void => {
    if (current !== null) jobs.push({ ...current, lines: current.lines });
    current = null;
  };

  for (const [index, line] of lines.entries()) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    // مفتاحٌ بإزاحةِ صفرٍ يُنهي قسمَ الوظائفِ (مثل `on:` لو جاءَ بعدَها).
    if (/^\S/.test(line)) {
      push();
      inJobs = false;
      continue;
    }
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header?.[1] !== undefined) {
      push();
      current = { name: header[1], startLine: index + 1, lines: [] };
      continue;
    }
    current?.lines.push(line);
  }
  push();
  return jobs;
}

/**
 * يفحصُ وظيفةً واحدةً. الشرطانِ المفروضانِ:
 *   ١) لا سطرَ يُطبِّقُ ملفَّ هجرةٍ بـ`psql` — لا مباشرةً ولا داخلَ حلقةٍ على
 *      `supabase/migrations/*.sql`.
 *   ٢) وظيفةٌ تُهيّئُ قاعدةَ الهجراتِ (أدوارُ Supabase) أو تذكرُ مسارَ الهجراتِ في
 *      أمرِ صدَفةٍ يجبُ أن تنادي المُطبِّقَ المُعتمَدَ.
 */
function analyseJob(job: JobBlock): Finding[] {
  const findings: Finding[] = [];
  let loopVariable: string | null = null;
  let mentionsMigrations = false;
  let bootstrapsRoles = false;

  for (const [offset, raw] of job.lines.entries()) {
    const line = raw.trim();
    const lineNumber = job.startLine + offset + 1;

    if (ROLE_BOOTSTRAP_MARKER.test(line)) bootstrapsRoles = true;
    if (MIGRATIONS_GLOB.test(line)) mentionsMigrations = true;

    // حلقةٌ على ملفّاتِ الهجراتِ: يُحتفَظُ بمتغيّرِها لتُنسَبَ إليه أسطرُ الجسمِ.
    const loop = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+.*supabase\/migrations/.exec(line);
    if (loop?.[1] !== undefined) {
      loopVariable = loop[1];
      findings.push({
        code: "PSQL_LOOP",
        job: job.name,
        line: lineNumber,
        message:
          `حلقةٌ على \`supabase/migrations\` في أمرِ صدَفةٍ — ` +
          `التطبيقُ يمرُّ بـ\`${APPLIER}\` وحدَه (ADR 0068).`,
      });
      continue;
    }
    if (line === "done") loopVariable = null;

    if (!/\bpsql\b/.test(line)) continue;

    const appliesFileArgument =
      /-f\s+("?\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"?|\S*supabase\/migrations\S*)/.exec(line);
    if (appliesFileArgument === null) continue;

    const variable = appliesFileArgument[2];
    const isLoopFile = variable !== undefined && variable === loopVariable;
    const isMigrationPath = MIGRATIONS_GLOB.test(appliesFileArgument[0]);
    if (!isLoopFile && !isMigrationPath) continue;

    findings.push({
      code: "PSQL_APPLY",
      job: job.name,
      line: lineNumber,
      message:
        `تطبيقُ هجرةٍ بـ\`psql -f\` — بلا مهلةِ قفلٍ ولا معاملةٍ ولا حُكمِ ` +
        `\`migration-safety\`. النادي المُعتمَدُ: \`bun run ${APPLIER}\`.`,
    });
  }

  const callsApplier = job.lines.some((line) => line.includes(APPLIER));
  if ((bootstrapsRoles || mentionsMigrations) && !callsApplier) {
    findings.push({
      code: "APPLIER_MISSING",
      job: job.name,
      line: job.startLine,
      message:
        `وظيفةٌ تُهيّئُ قاعدةَ الهجراتِ أو تذكرُ مسارَها ولا تنادي \`${APPLIER}\` — ` +
        `إمّا أن تُطبِّقَ بالمُطبِّقِ أو لا تتظاهرَ بقاعدةٍ مُهاجَرةٍ.`,
    });
  }

  return findings;
}

/** يفحصُ محتوى ملفِّ سيرِ عملٍ كاملاً. */
export function analyse(content: string): Finding[] {
  return jobsOf(content).flatMap(analyseJob);
}

function main(): void {
  const workflow = process.argv[2] ?? DEFAULT_WORKFLOW;

  if (!existsSync(workflow)) {
    console.error(`❌ ملفُّ سيرِ العملِ غيرُ موجودٍ: ${workflow}`);
    console.error("   غيابُ الملفِّ سقوطٌ لا تخطٍّ — لا يُفحَصُ مُطبِّقٌ في العدمِ.");
    process.exit(1);
  }

  let content: string;
  try {
    content = readFileSync(workflow, "utf8");
  } catch (error) {
    console.error(`❌ تعذّرت قراءةُ ملفِّ سيرِ العملِ: ${workflow}`);
    console.error(`   ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const findings = analyse(content);
  if (findings.length > 0) {
    console.error(`❌ تطبيقُ هجراتٍ خارجَ المُطبِّقِ المُعتمَدِ في ${workflow} (F7-07 · ADR 0068):`);
    for (const finding of findings) {
      console.error(`  - [${finding.code}] ${workflow}:${finding.line} · ${finding.job}`);
      console.error(`      ${finding.message}`);
    }
    process.exit(1);
  }

  console.log(
    `✅ كلُّ وظيفةٍ في ${workflow} تُطبِّقُ الهجراتِ بـ\`${APPLIER}\` وحدَه — ` +
      "ولا حلقةَ `psql` عاريةً؛ شرطُ F7-07 قائمٌ في مكانِ الفعلِ لا في الوثيقةِ.",
  );
}

if (import.meta.main) {
  main();
}
