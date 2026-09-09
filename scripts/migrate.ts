#!/usr/bin/env bun
/**
 * # مُطبِّقُ الهجراتِ الآمنُ — مهلةُ قفلٍ، ومعاملةٌ يملكُها المُطبِّقُ، وفهرسٌ متزامنٌ
 *
 * **الغرض:** يفرضُ البندَ `F7-07` («أدوات هجرة آمنة على الإنتاج») في مكانِ
 * الفعلِ لا في التوثيقِ. وكانَ التطبيقُ قبلَه حلقةَ `psql` عاريةً — في CI وفي
 * إجراءِ النشرِ سواءً — بلا مهلةِ قفلٍ ولا مهلةِ عبارةٍ ولا معاملةٍ: فهجرةٌ
 * تُصادِفُ معاملةً طويلةً تنتظرُ قفلَها **إلى الأبدِ**، وتُوقِفُ في انتظارِها كلَّ
 * كاتبٍ على الجدولِ (طابورُ الأقفالِ في PostgreSQL)؛ وهجرةٌ تسقطُ في عبارتِها
 * الخامسةِ تتركُ مخطَّطاً نصفَ مُطبَّقٍ يبدو ناجحاً.
 *
 * فالمُطبِّقُ يفعلُ أربعةً:
 * ١) **يرفضُ قبلَ أن يُخاطِبَ قاعدةً** أيَّ هجرةٍ تُخالِفُ قواعدَ
 *    `scripts/lib/migration-safety.ts` — المنطقُ نفسُه الذي يقرأُه حاجزُ CI،
 *    فلا مُطبِّقٌ يُطبِّقُ ما يرفضُه الحاجزُ ولا قاعدةٌ مكتوبةٌ مرّتَينِ.
 * ٢) **يضبطُ `lock_timeout` و`statement_timeout`** لكلِّ ملفٍّ: فالانتظارُ
 *    ينقطعُ بخطأٍ مقروءٍ بدلَ أن يُجمِّدَ الخدمةَ.
 * ٣) **يملكُ المعاملةَ**: ملفٌّ واحدٌ = معاملةٌ واحدةٌ، فينجحُ كلُّه أو يسقطُ
 *    كلُّه. وطورُ `index` وحدَه يُطبَّقُ بلا معاملةٍ لأنَّ
 *    `create index concurrently` لا تُقبَلُ داخلَها.
 * ٤) **يُعيدُ الملفّاتِ كلَّها في كلِّ تشغيلٍ** ويعتمدُ على استرجاعِها
 *    (idempotence) المفروضِ نصّاً في الحاجزِ ومقيسٍ في CI بتطبيقٍ مرّتَينِ —
 *    **وهذا يصحُّ على ما بعدَ حدِّ التقادُمِ وحدَه**، فانظر الحدَّ المُعلَنَ أدناهُ.
 *
 * **الحدُّ المُقاسُ لا المُدَّعى — `--from` ولِمَ وُجِدَ:** الهجراتُ الثمانُ
 * والسبعونَ الموروثةُ **ليست مُسترجَعةً**، وذلكَ **قِيسَ في CI لا استُنبِطَ**:
 * إعادةُ تطبيقِ السلسلةِ كلِّها على قاعدةٍ فيها المخطَّطُ تسقطُ بـ
 * `42710 trigger "cities_set_updated_at" for relation "cities" already exists`
 * (التشغيلُ `34315907516`). وهوَ عينُ الدَّينِ المُعلَنِ في
 * `scripts/lib/migration-baseline.ts`: القاعدةُ الخامسةُ لم تكنْ تُفرَضُ يومَ
 * كُتِبَت تلكَ الملفّاتُ. فلذلكَ:
 * - **قاعدةٌ فارغةٌ** (CI · بيئةٌ جديدةٌ): تُطبَّقُ السلسلةُ كلُّها — الافتراضُ.
 * - **قاعدةٌ فيها المخطَّطُ** (الإنتاجُ): `--from <آخرُ طابعٍ مُطبَّقٍ>` فيُطبَّقُ
 *   ما بعدَه وحدَه. والمُشغِّلُ يقولُ الطابعَ صراحةً لأنَّ القاعدةَ لا تحفظُه —
 *   ولا سجلَّ هجراتٍ فيها، والسببُ أدناهُ.
 *
 * **ولا سجلَّ هجراتٍ مُطبَّقةٍ في القاعدةِ، والسببُ مُعلَنٌ لا مسكوتٌ عنه:**
 * القاعدةُ السياديّةُ 0.4 في `docs/MASTER_DIRECTIVE.md` تفرضُ `city_id` على كلِّ
 * جدولٍ، وسجلُّ الهجراتِ ليسَ بياناً مدينيّاً؛ وتوسيعُ صنفِ الاستثناءِ المغلقِ
 * **قرارُ مالكٍ لا قرارُ منفِّذٍ**. فاختِيرَ الطريقُ الذي لا يحتاجُ استثناءً:
 * استرجاعٌ مفروضٌ ومقيسٌ بدلَ حالةٍ ثانيةٍ تُصانُ. والتفصيلُ في
 * `docs/adr/0068-safe-migration-tooling.md`.
 *
 * **الحالة:** `F7-07` / `CAP-007` — مُنفَّذ · مُختبَر (تكاملُ CI على PostgreSQL
 * حقيقيّةٍ). ولا PostgreSQL على جهازِ التنفيذِ، فلا نتيجةَ محليّةً تُقال.
 *
 * **ينتمي إلى:** خطوةَ «تطبيقُ الهجراتِ بالترتيبِ» في
 * `.github/workflows/ci.yml`، وإجراءَ النشرِ في `docs/render-deployment-vars.md` §4.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** كلُّ نشرٍ، وكلُّ هجرةٍ جديدةٍ.
 *
 * **ملاحظات مستقبلية:** `--only <file>` لتطبيقِ ملفٍّ واحدٍ (يحتاجُه طورُ
 * `backfill` المُقطَّعُ في `F7-03`)؛ ولم يُكتَب قبلَ أن يُحتاجَ. ولو قرَّرَ المالكُ
 * توسيعَ صنفِ الاستثناءِ للقاعدةِ 0.4 لَحلَّ سجلٌّ في القاعدةِ محلَّ `--from`
 * إضافةً بلا نقضٍ — والمُطبِّقُ مبنيٌّ على أن يقبلَ ذلك.
 *
 * **ما لا يفعله هذا المُطبِّقُ عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ:**
 * - **لا يُعيدُ هجرةً إلى الوراءِ.** لا `down` في المستودعِ، ومسارُ العودةِ
 *   بابُ `check-rollback-safety` و`rollback-schema-drill`.
 * - **لا يقيسُ زمنَ الهجرةِ على حجمِ الإنتاجِ.** يضبطُ مهلةً ويُبلِغُ زمناً.
 * - **لا يقرأُ رابطَ القاعدةِ من مكانَينِ**: `DATABASE_URL` أو الوسيطُ الأوّلُ.
 * - **لا يطبعُ الرابطَ ولا كلمةَ سرِّه** في نجاحٍ ولا في فشلٍ.
 *
 * **الاستعمال:**
 * ```bash
 * bun run scripts/migrate.ts --dry-run                 # الخُطّةُ بلا اتّصالٍ
 * DATABASE_URL=… bun run scripts/migrate.ts            # التطبيقُ
 * bun run scripts/migrate.ts --url "postgres://…"      # رابطٌ صريحٌ
 * bun run scripts/migrate.ts --from 20260909040000     # ما بعدَ طابعٍ مُطبَّقٍ
 * ```
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { declaredPhase, judgeMigration, planFor } from "./lib/migration-safety.ts";

const MIGRATIONS_DIR = "supabase/migrations";

/**
 * مهلةُ القفلِ: ثلاثُ ثوانٍ. الهجرةُ التي لا تنالُ قفلَها في ثلاثِ ثوانٍ تسقطُ
 * بخطأٍ مقروءٍ — وذلكَ أرحمُ من انتظارٍ يُصطَفُّ خلفَه كلُّ كاتبٍ على الجدولِ.
 */
const DEFAULT_LOCK_TIMEOUT = "3s";
/** مهلةُ العبارةِ: خمسُ دقائقَ — سقفٌ لهجرةٍ غيرِ مُقطَّعةٍ لا وعدُ سرعةٍ. */
const DEFAULT_STATEMENT_TIMEOUT = "5min";

interface Options {
  readonly dryRun: boolean;
  readonly url: string | null;
  readonly from: string | null;
  readonly lockTimeout: string;
  readonly statementTimeout: string;
}

export function parseArgs(argv: readonly string[]): Options {
  let url: string | null = null;
  let from: string | null = null;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--url") {
      url = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === "--from") {
      from = argv[index + 1] ?? null;
      index += 1;
    }
  }
  return {
    dryRun,
    from,
    url: url ?? process.env.DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL ?? null,
    lockTimeout: process.env.MIGRATION_LOCK_TIMEOUT ?? DEFAULT_LOCK_TIMEOUT,
    statementTimeout: process.env.MIGRATION_STATEMENT_TIMEOUT ?? DEFAULT_STATEMENT_TIMEOUT,
  };
}

export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
  readonly phase: string | null;
  readonly transactional: boolean;
  readonly statements: readonly string[];
}

/**
 * الملفّاتُ بترتيبِ أسمائِها — الطابعُ الزمنيُّ يجعلُ الترتيبَ الأبجديَّ ترتيبَ زمنٍ.
 *
 * و`from` طابعٌ **حصريٌّ**: يُطبَّقُ ما طابعُه أكبرُ منه. والمقارنةُ نصّيّةٌ لأنَّ
 * الطابعَ `YYYYMMDDHHMMSS` ثابتُ الطولِ فترتيبُه المعجميُّ ترتيبُه الزمنيُّ.
 */
export function readMigrations(
  dir: string = MIGRATIONS_DIR,
  from: string | null = null,
): MigrationFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => from === null || name.slice(0, from.length) > from)
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name), "utf8");
      const plan = planFor(sql);
      return {
        name,
        sql,
        phase: declaredPhase(sql).value,
        transactional: plan.transactional,
        statements: plan.statements,
      };
    });
}

/**
 * التطبيقُ الفعليُّ لملفٍّ واحدٍ.
 *
 * المهلتانِ تُضبَطانِ **داخلَ** المعاملةِ بـ`set local` فتنقضيانِ بانقضائِها،
 * وفي الطورِ غيرِ المعاملاتيِّ تُضبَطانِ للجلسةِ قبلَ العبارةِ. و`sql.unsafe`
 * ههنا نصُّ ملفٍّ من المستودعِ لا مُدخَلَ مستخدمٍ — ولا وسائطَ فيه أصلاً.
 */
export async function applyMigration(
  sql: postgres.Sql,
  file: MigrationFile,
  options: Pick<Options, "lockTimeout" | "statementTimeout">,
): Promise<number> {
  const startedAt = Date.now();
  if (file.transactional) {
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local lock_timeout = '${options.lockTimeout}'`);
      await tx.unsafe(`set local statement_timeout = '${options.statementTimeout}'`);
      for (const statement of file.statements) await tx.unsafe(statement);
    });
  } else {
    await sql.unsafe(`set lock_timeout = '${options.lockTimeout}'`);
    await sql.unsafe(`set statement_timeout = '${options.statementTimeout}'`);
    for (const statement of file.statements) await sql.unsafe(statement);
  }
  return Date.now() - startedAt;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const files = readMigrations(MIGRATIONS_DIR, options.from);
  if (files.length === 0) {
    console.log(
      `لا هجرةَ بعدَ الطابعِ ${options.from ?? "(بلا حدٍّ)"} — ولا شيءَ يُطبَّقُ. وهذا نجاحٌ لا إخفاقٌ.`,
    );
    return;
  }

  // الرفضُ قبلَ الاتّصالِ: الحاجزُ نفسُه لا نسخةٌ ثانيةٌ منه.
  const rejected = files
    .map((file) => ({ file, findings: judgeMigration(file.sql) }))
    .filter(({ file, findings }) => findings.length > 0 && file.phase !== null);
  if (rejected.length > 0) {
    console.error("✖ التطبيقُ رُفِضَ قبلَ الاتّصالِ: هجرةٌ تُخالِفُ قواعدَ السلامةِ.\n");
    for (const { file, findings } of rejected) {
      console.error(`  ${file.name}:`);
      for (const finding of findings) console.error(`    - [${finding.code}] ${finding.reason}`);
    }
    console.error("\nوالحكمُ الكاملُ في `bun run scripts/check-migration-safety.ts`.");
    process.exit(1);
  }

  if (options.dryRun) {
    console.log(
      `خُطّةُ التطبيقِ — ${files.length} هجرةً${options.from === null ? " (السلسلةُ كلُّها — تصلحُ لقاعدةٍ فارغةٍ)" : ` بعدَ الطابعِ ${options.from}`}:`,
    );
    for (const file of files) {
      const mode = file.transactional ? "معاملةٌ واحدةٌ" : "بلا معاملةٍ (فهرسٌ متزامنٌ)";
      console.log(
        `  • ${file.name} · طورٌ: ${file.phase ?? "غيرُ مُصرَّحٍ (دَينٌ مُعلَنٌ)"} · ${file.statements.length} عبارةً · ${mode}`,
      );
    }
    console.log(
      `مهلةُ القفلِ ${options.lockTimeout} · مهلةُ العبارةِ ${options.statementTimeout} · ولا اتّصالَ في هذا الوضعِ.`,
    );
    return;
  }

  if (options.url === null) {
    console.error(
      "✖ لا رابطَ قاعدةٍ: عيِّن `DATABASE_URL` أو `MIGRATION_DATABASE_URL` أو مرِّر `--url`. وللخُطّةِ بلا اتّصالٍ: `--dry-run`.",
    );
    process.exit(1);
  }

  const sql = postgres(options.url, { max: 1, onnotice: () => {} });
  let applied = 0;
  try {
    for (const file of files) {
      const mode = file.transactional ? "معاملةٌ" : "بلا معاملةٍ";
      try {
        const durationMs = await applyMigration(sql, file, options);
        applied += 1;
        console.log(`▶ ${file.name} · ${mode} · ${file.statements.length} عبارةً · ${durationMs}ms`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`✖ توقّفَ عندَ ${file.name}: ${message}`);
        console.error(
          `تطبيقَ ${applied} هجرةً قبلَها، وهذه سقطَت ${file.transactional ? "كلُّها معاً فلا مخطَّطَ نصفَ مُطبَّقٍ" : "وقد تكونُ عباراتُها السابقةُ نفذَت (طورٌ بلا معاملةٍ)"}.`,
        );
        /**
         * `42710` (كائنٌ موجودٌ) و`42P07` (جدولٌ موجودٌ) على قاعدةٍ فيها المخطَّطُ
         * أصلاً ليسا عطلاً في الهجرةِ بل تشغيلاً بلا `--from`: الهجراتُ الموروثةُ
         * غيرُ مُسترجَعةٍ (دَينٌ مُعلَنٌ)، وقد قِيسَ ذلك لا استُنبِطَ.
         */
        const code = (error as { code?: string }).code;
        if (options.from === null && (code === "42710" || code === "42P07")) {
          console.error(
            "↳ والقاعدةُ فيها هذا الكائنُ سابقاً: الهجراتُ الموروثةُ غيرُ مُسترجَعةٍ (دَينٌ مُعلَنٌ في `scripts/lib/migration-baseline.ts`). فإن كانت القاعدةُ مُهاجَرةً من قبلُ فمرِّرْ `--from <آخرُ طابعٍ مُطبَّقٍ>` ليُطبَّقَ ما بعدَه وحدَه. والسلسلةُ كلُّها لقاعدةٍ فارغةٍ.",
          );
        }
        process.exit(1);
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  console.log(
    `✅ طُبِّقَت ${applied} هجرةً بالترتيبِ${options.from === null ? "" : ` بعدَ ${options.from}`} · مهلةُ قفلٍ ${options.lockTimeout}.`,
  );
}

if (import.meta.main) await main();
