#!/usr/bin/env bun
/**
 * # تمرينُ مسارِ العودةِ على قاعدةٍ حقيقيةٍ — لا قراءةَ ملفٍّ وحدَها
 *
 * **الغرض:** الحاجزُ الساكنُ (`check-rollback-safety.ts`) يقرأ نصّاً، والنصُّ يكذب:
 * تغييرٌ يُبنى بنصٍّ مُركَّبٍ أو بـ`execute format(…)` يُفلِت من كلِّ مطابقةٍ. فهذا
 * التمرينُ **يُطبِّق الهجراتِ واحدةً واحدةً على PostgreSQL حقيقيٍّ**، ويأخذ صورةً
 * للكاتالوجِ بعدَ كلِّ واحدةٍ، ثمّ يُقارِن: كلُّ ما كان موجوداً في الخطوةِ `k-1`
 * وغابَ أو ضاقَ في `k` هو **فقدٌ**؛ وكلُّ هجرةٍ تُنتِج فقداً يجب أن تكون **مُعلَنةً**
 * في `scripts/lib/rollback-registry.ts` أو يسقط التمرين.
 *
 * وهو بذلك يفعل شيئَين لا واحداً: يُثبِت أنّ سلسلةَ الهجراتِ تُطبَّق بالترتيبِ بلا
 * خطأٍ، و**يُدقِّق الحاجزَ الساكنَ نفسَه** — فحاجزٌ أعمى وهو أخضرُ أسوأُ من لا حاجزٍ،
 * وقد وقع ذلك فعلاً في هذا المستودعِ مرّتَين (ADR 0045 §٧ · ADR 0046 §٨).
 *
 * **الحالة:** `OPS-010` — مُنفَّذ، **ويُشغَّل في CI وحدَه** (مهمّةُ التكامل فيها
 * خدمةُ PostgreSQL). ولا مُشغِّلَ له في هذه الجلسةِ: لا PostgreSQL على جهازِ
 * التنفيذ، فنتيجتُه المحليّةُ **غيرُ موجودةٍ** ولا يُقال إنّها ناجحةٌ.
 *
 * **ينتمي إلى:** البند `OPS-010` · خطوةً في مهمّةِ التكاملِ في
 * `.github/workflows/ci.yml`.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** كلُّ هجرةٍ جديدةٍ تمرّ به؛ والبوّابةُ H عندَ قياسِ
 * `RTO`/`RPO` على بيئةٍ شبيهةٍ بالإنتاج.
 *
 * **ملاحظات مستقبلية:** الخطوةُ التاليةُ الطبيعيّةُ أن يُشغَّل عليه **الشيفرةُ
 * السابقةُ** لا الكاتالوجُ وحدَه (نداءٌ حقيقيٌّ لكلِّ RPC كانت النسخةُ السابقةُ
 * تناديه)، وذلك يحتاج وسمَ إصدارٍ في `git` فيُقرَّر بـADR.
 *
 * **ما لا يفعله هذا التمرينُ عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ:**
 * - **لا يُعيد هجرةً إلى الوراء.** لا `down` في المستودعِ، ولا تُختلَق ههنا؛
 *   المقياسُ **هل يحتمل المخطّطُ الجديدُ الصورةَ السابقةَ**، لا هل يُعكَس.
 * - **لا يقرأ بياناتٍ.** المخطّطُ والصلاحياتُ فقط.
 * - **لا يُنشئ حكماً على الأداء.** لا زمنَ ولا `RTO`؛ تلك قياساتٌ تحتاج بيئةً
 *   شبيهةً بالإنتاجِ وهي دَينٌ مُعلَنٌ في `docs/rollback.md`.
 * - **لا يمسّ القاعدةَ المُعطاةَ.** يُنشئ قاعدةً خادشةً مستقلّةً ويُسقِطها.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { ROLLBACK_DECLARATIONS } from "./lib/rollback-registry.ts";

const MIGRATIONS_DIR = "supabase/migrations";
/** الأدوارُ التي تُقرأ صلاحياتُها: هي سطحُ النظامِ كلُّه أمامَ العميلِ والعامل. */
const WATCHED_ROLES = ["anon", "authenticated", "service_role"] as const;

/** صورةُ الكاتالوجِ: مجموعةُ وسومٍ نصّيّةٍ يُقارَن بينها بالفرقِ لا بالتأويل. */
type Snapshot = ReadonlySet<string>;

async function snapshot(sql: postgres.Sql): Promise<Snapshot> {
  const tags = new Set<string>();

  const columns = await sql<
    {
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
      has_default: boolean;
    }[]
  >`
    select c.table_name, c.column_name, c.data_type, c.is_nullable,
           (c.column_default is not null) as has_default
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE'`;
  for (const row of columns) {
    tags.add(`table:${row.table_name}`);
    tags.add(`column:${row.table_name}.${row.column_name}`);
    tags.add(`type:${row.table_name}.${row.column_name}=${row.data_type}`);
    if (row.is_nullable === "NO") tags.add(`notnull:${row.table_name}.${row.column_name}`);
    if (row.has_default) tags.add(`default:${row.table_name}.${row.column_name}`);
  }

  const functions = await sql<{ signature: string }[]>`
    select p.oid::regprocedure::text as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'`;
  for (const row of functions) tags.add(`function:${row.signature}`);

  const policies = await sql<{ tablename: string; policyname: string }[]>`
    select tablename, policyname from pg_policies where schemaname = 'public'`;
  for (const row of policies) tags.add(`policy:${row.tablename}.${row.policyname}`);

  const triggers = await sql<{ table_name: string; trigger_name: string }[]>`
    select c.relname as table_name, t.tgname as trigger_name
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal`;
  for (const row of triggers) tags.add(`trigger:${row.table_name}.${row.trigger_name}`);

  const constraints = await sql<{ table_name: string; constraint_name: string }[]>`
    select c.relname as table_name, con.conname as constraint_name
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'`;
  for (const row of constraints) tags.add(`constraint:${row.table_name}.${row.constraint_name}`);

  const indexes = await sql<{ indexname: string }[]>`
    select indexname from pg_indexes where schemaname = 'public'`;
  for (const row of indexes) tags.add(`index:${row.indexname}`);

  /** الصلاحياتُ: هي ما تراه النسخةُ السابقةُ فعلاً، وغيابُها كسرٌ لا تفصيلٌ. */
  const rolesLiteral = WATCHED_ROLES as readonly string[];
  const tablePrivileges = await sql<
    { grantee: string; table_name: string; privilege_type: string }[]
  >`
    select grantee, table_name, privilege_type
      from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ${sql(rolesLiteral)}`;
  for (const row of tablePrivileges) {
    tags.add(`grant:${row.grantee}:${row.privilege_type}:table:${row.table_name}`);
  }
  const functionPrivileges = await sql<{ grantee: string; signature: string }[]>`
    select r.rolname as grantee, p.oid::regprocedure::text as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join pg_roles r
     where n.nspname = 'public'
       and r.rolname in ${sql(rolesLiteral)}
       and has_function_privilege(r.rolname, p.oid, 'EXECUTE')`;
  for (const row of functionPrivileges) {
    tags.add(`grant:${row.grantee}:EXECUTE:function:${row.signature}`);
  }
  const schemaPrivileges = await sql<{ grantee: string; has_usage: boolean }[]>`
    select r.rolname as grantee, has_schema_privilege(r.rolname, 'public', 'USAGE') as has_usage
      from pg_roles r
     where r.rolname in ${sql(rolesLiteral)}`;
  for (const row of schemaPrivileges) {
    if (row.has_usage) tags.add(`grant:${row.grantee}:USAGE:schema:public`);
  }

  return tags;
}

/**
 * الفقدُ بين صورتَين. و`notnull` **معكوسٌ**: ظهورُه تضييقٌ وغيابُه توسيعٌ — ولذلك
 * يُقرأ في الاتجاهِ الآخرِ، وهذا مكانٌ لو سُهي عنه لصار الحاجزُ أعمى في أخطرِ بابٍ.
 */
export function lossesBetween(before: Snapshot, after: Snapshot): readonly string[] {
  const losses: string[] = [];
  for (const tag of before) {
    if (tag.startsWith("notnull:")) continue;
    if (!after.has(tag)) losses.push(`غاب: ${tag}`);
  }
  for (const tag of after) {
    if (!tag.startsWith("notnull:")) continue;
    if (!before.has(tag)) losses.push(`ضاق: ${tag}`);
  }
  return losses;
}

function declaredMigrations(): ReadonlySet<string> {
  return new Set(ROLLBACK_DECLARATIONS.map((entry) => entry.migration));
}

async function main(): Promise<void> {
  const adminUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (adminUrl === undefined || adminUrl.trim().length === 0) {
    console.error(
      "✗ TEST_DATABASE_URL (أو DATABASE_URL) مطلوبٌ: تمرينُ العودةِ لا يُحاكى ولا يُتجاوَز صامتاً.",
    );
    process.exit(1);
  }

  const root = process.cwd();
  const files = readdirSync(join(root, MIGRATIONS_DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    console.error("✗ لا ملفَّ هجرةٍ واحداً — القراءةُ معطوبةٌ.");
    process.exit(1);
  }

  const scratch = `rollback_drill_${process.pid}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const failures: string[] = [];
  let appliedCount = 0;

  try {
    await admin.unsafe(`drop database if exists ${scratch}`);
    await admin.unsafe(`create database ${scratch}`);
  } catch (error) {
    console.error(`✗ لم تُنشأ قاعدةٌ خادشةٌ (${scratch}): ${String(error)}`);
    await admin.end();
    process.exit(1);
  }

  const scratchUrl = new URL(adminUrl);
  scratchUrl.pathname = `/${scratch}`;
  const target = postgres(scratchUrl.toString(), { max: 1, onnotice: () => {} });

  try {
    let previous: Snapshot = new Set<string>();
    const declared = declaredMigrations();
    for (const file of files) {
      const sqlText = readFileSync(join(root, MIGRATIONS_DIR, file), "utf8");
      try {
        await target.unsafe(sqlText);
      } catch (error) {
        failures.push(`${file}: لم تُطبَّق — ${String(error)}`);
        break;
      }
      appliedCount += 1;
      const current = await snapshot(target);
      const losses = lossesBetween(previous, current);
      if (losses.length > 0 && !declared.has(file)) {
        failures.push(
          `${file}: ${losses.length} فقداً مَقيساً على قاعدةٍ حقيقيةٍ ولا مدخلَ له في السجلِّ — ` +
            `${losses.slice(0, 8).join(" · ")}`,
        );
      }
      if (losses.length > 0) {
        console.log(`• ${file}: ${losses.length} فقداً${declared.has(file) ? " (مُعلَنٌ)" : ""}`);
        for (const loss of losses.slice(0, 12)) console.log(`    ${loss}`);
      }
      previous = current;
    }
  } finally {
    await target.end();
    try {
      await admin.unsafe(`drop database if exists ${scratch}`);
    } catch {
      /** إسقاطُ القاعدةِ الخادشةِ ليس شرطاً لصحّةِ التمرين. */
    }
    await admin.end();
  }

  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} إخفاقاً في تمرينِ مسارِ العودة (OPS-010):\n`);
    for (const failure of failures) console.error(`  • ${failure}\n`);
    process.exit(1);
  }

  console.log(
    `\n✅ تمرينُ مسارِ العودة: ${appliedCount} هجرةً طُبِّقت بالترتيبِ على قاعدةٍ حقيقيةٍ، ` +
      `وكلُّ فقدٍ مَقيسٍ يقابله مدخلٌ في السجلِّ.`,
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`✗ تمرينُ مسارِ العودةِ سقط: ${String(error)}`);
    process.exit(1);
  });
}
