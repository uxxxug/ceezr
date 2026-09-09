#!/usr/bin/env bun
/**
 * # حاجزُ سلامةِ الهجراتِ — لا هجرةً تُدمَجُ وهي تُوقِفُ الكتابةَ على جدولٍ حارٍّ
 *
 * **الغرض:** يفرضُ البندَ `F7-07` والعائقَ `CAP-007` («الهجرات غير آمنة على
 * الإنتاج — لا `CONCURRENTLY`، لا `NOT VALID`») بستِّ قواعدَ تُقرأُ من نصِّ كلِّ
 * هجرةٍ جديدةٍ، منطقُها كلُّه في `scripts/lib/migration-safety.ts` — المصدرِ
 * الذي يقرأُه المُطبِّقُ نفسُه (`scripts/migrate.ts`) قبلَ أن يُخاطِبَ قاعدةً:
 *
 * ١) الطورُ مُصرَّحٌ بصيغةٍ حرفيّةٍ (`expand → backfill → validate → switch →
 *    contract` وطورُ `index`).
 * ٢) الفهرسُ `concurrently` وفي ملفٍّ وحدَه (لأنّه لا يُقبَلُ في معاملةٍ).
 * ٣) القيدُ يُضافُ `not valid` ويُصادَقُ في طورٍ تالٍ.
 * ٤) `set not null` ممنوعةٌ (مسحٌ كاملٌ تحتَ قفلٍ حاجزٍ).
 * ٥) الحذفُ وإعادةُ التسميةِ في طورِ `contract` وحدَه.
 * ٦) كلُّ عبارةٍ مُسترجَعةٌ (لا سجلَّ هجراتٍ في القاعدةِ — ADR 0068).
 *
 * ثمَّ يتحقّقُ من **سلامةِ الدَّينِ المُعلَنِ** نفسِه: كلُّ ملفٍّ قبلَ حدِّ
 * التقادمِ مُعلَنٌ في القائمةِ المُجمَّدةِ، وكلُّ مُدخلٍ في القائمةِ له ملفٌّ
 * قائمٌ (فلا مُدخلَ ميّتاً يُعفي ملفّاً مستقبليّاً)، ولا مُدخلَ تاريخُه بعدَ
 * الحدِّ (فلا تسلُّلَ بتأريخٍ إلى الوراءِ).
 *
 * **الحالة:** `F7-07` / `CAP-007` — مُنفَّذ · مُختبَر.
 *
 * **ينتمي إلى:** سلسلةَ `bun run ci` · خطوةً مُسمّاةً في `.github/workflows/ci.yml`.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** كلُّ هجرةٍ جديدةٍ، وأوّلُها هجراتُ `F7-03`
 * (التقسيمُ الزمنيُّ) و`F7-08` (التجميعاتُ المادّيّةُ).
 *
 * **ملاحظات مستقبلية:** القاعدةُ السابعةُ الطبيعيّةُ أن يُقاسَ زمنُ كلِّ هجرةٍ
 * على قاعدةٍ بحجمِ الإنتاجِ، وذلكَ يحتاجُ بيئةً شبيهةً بالإنتاجِ فهو دَينٌ
 * مُعلَنٌ في `docs/adr/0068-safe-migration-tooling.md` §٧.
 *
 * **ما لا يفعله هذا الحاجزُ عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ:**
 * - **لا يلمسُ قاعدةً.** حكمُه نصٌّ؛ ومَن يُثبِتُ أنَّ السلسلةَ تُطبَّقُ فعلاً
 *   ومرّتَينِ بالنتيجةِ نفسِها هو `tests/integration/safe-migration-runner.test.ts`
 *   على PostgreSQL حقيقيٍّ في CI.
 * - **لا يقرأُ DDL مُركَّباً في زمنِ التشغيلِ** (`execute format(…)`) — حدٌّ
 *   مشتركٌ معَ `check-rollback-safety`، ومكشوفٌ في `rollback-schema-drill`.
 * - **لا يمنعُ التضييقَ ولا الحذفَ.** يمنعُ أن يقعا **صامتَينِ** أو في الطورِ
 *   الخطأِ؛ ومسارُ العودةِ بابُ `check-rollback-safety` لا بابُه.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LEGACY_MIGRATIONS, MIGRATION_SAFETY_CUTOFF } from "./lib/migration-baseline.ts";
import { judgeMigration, type SafetyFinding } from "./lib/migration-safety.ts";

const MIGRATIONS_DIR = "supabase/migrations";

interface FileVerdict {
  readonly file: string;
  readonly findings: readonly SafetyFinding[];
}

/** بادئةُ الطابعِ الزمنيِّ (`YYYYMMDDHHMMSS`) من اسمِ الملفِّ، أو `null`. */
export function stampOf(file: string): string | null {
  const match = /^(\d{14})_/.exec(file);
  return match?.[1] ?? null;
}

export function migrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function main(): void {
  const files = migrationFiles();
  const legacy = new Set(LEGACY_MIGRATIONS);
  const problems: string[] = [];
  const verdicts: FileVerdict[] = [];
  let judged = 0;

  for (const file of files) {
    const stamp = stampOf(file);
    if (stamp === null) {
      problems.push(`الملفُّ «${file}» بلا طابعٍ زمنيٍّ في اسمِه، فترتيبُ تطبيقِه غيرُ مضمونٍ.`);
      continue;
    }
    const isLegacy = legacy.has(file);
    if (stamp < MIGRATION_SAFETY_CUTOFF && !isLegacy) {
      problems.push(
        `الملفُّ «${file}» تاريخُه قبلَ حدِّ التقادمِ (${MIGRATION_SAFETY_CUTOFF}) وليسَ في القائمةِ المُجمَّدةِ: إمّا أنّه جديدٌ مُؤرَّخٌ إلى الوراءِ — وذلكَ تسلُّلٌ من القواعدِ — وإمّا أنَّ القائمةَ ناقصةٌ.`,
      );
      continue;
    }
    if (isLegacy) {
      if (stamp >= MIGRATION_SAFETY_CUTOFF) {
        problems.push(
          `الملفُّ «${file}» في القائمةِ المُجمَّدةِ وتاريخُه بعدَ حدِّ التقادمِ: الدَّينُ لا ينمو، والهجرةُ الجديدةُ تُحاكَمُ بالقواعدِ.`,
        );
      }
      continue;
    }
    judged += 1;
    const findings = judgeMigration(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    if (findings.length > 0) verdicts.push({ file, findings });
  }

  for (const declared of LEGACY_MIGRATIONS) {
    if (!files.includes(declared)) {
      problems.push(
        `المُدخلُ «${declared}» في القائمةِ المُجمَّدةِ ولا ملفَّ له: مُدخلٌ ميّتٌ يُعفي ملفّاً مستقبليّاً بالاسمِ نفسِه.`,
      );
    }
  }

  if (problems.length === 0 && verdicts.length === 0) {
    console.log(
      `فحصُ سلامةِ الهجراتِ: نجحَ — ${files.length} هجرةً، منها ${judged} مُحاكَمةً بالقواعدِ الستِّ و${LEGACY_MIGRATIONS.length} دَيناً مُعلَناً مُجمَّداً.`,
    );
    return;
  }

  console.error("✖ فحصُ سلامةِ الهجراتِ: سقطَ.\n");
  for (const problem of problems) console.error(`  • ${problem}`);
  for (const verdict of verdicts) {
    console.error(`\n  ${verdict.file}:`);
    for (const finding of verdict.findings) {
      const where = finding.line === null ? "الملفُّ" : `السطرُ ${finding.line}`;
      console.error(`    - [${finding.code}] ${where}: ${finding.reason}`);
    }
  }
  console.error(
    "\nولا يُعالَجُ هذا بإضافةِ الملفِّ إلى القائمةِ المُجمَّدةِ: القائمةُ دَينٌ مضى لا إعفاءٌ لجديدٍ.",
  );
  process.exit(1);
}

if (import.meta.main) main();
