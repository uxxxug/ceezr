/**
 * الغرض: استعادة أرشيف PostgreSQL في قاعدة مؤقتة مستقلة ثم قياس تكافؤ البنية
 *   والبيانات المهمة مع المصدر، لإثبات قابلية النسخة للاستعادة لا مجرد رفعها.
 * الحالة: منفّذ فعلياً — يستعمل pg_restore وPostgreSQL محليين أو في بيئة العامل.
 * ينتمي إلى: infrastructure/backup
 * يُتوقع أن يستخدمه لاحقاً: jobs/verify-backup-restore.ts وسكربت تمرين التعافي.
 * ملاحظات مستقبلية: التحقق لا يطبق ملف الأدوار على الخادم الحي؛ يتأكد من وجود
 *   تعريفاتها في المرافق، لأن تطبيق أدوار عامة أثناء تمرين دوري تغيير خطر.
 */

import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type Result } from "../../shared/result/index.ts";
import { createSql } from "../db/client.ts";

export interface DatabaseFingerprint {
  readonly tableCount: number;
  readonly functionCount: number;
  readonly rlsPolicyCount: number;
  readonly constraintCount: number;
  readonly indexCount: number;
  readonly rowCounts: Readonly<Record<string, number>>;
  readonly roles: readonly string[];
}

export interface RestoreVerification {
  readonly targetDatabase: string;
  readonly source: DatabaseFingerprint;
  readonly restored: DatabaseFingerprint;
  readonly rolesArtifactVerified: boolean;
}

export interface RestoreVerifyOptions {
  /** رابط قاعدة المصدر؛ لا يسجل مطلقاً في أخطاء النتيجة. */
  readonly sourceDatabaseUrl: string;
  /** اسم قاعدة نظيفة مخصصة للتمرين، لا رابطاً ولا صيغة SQL. */
  readonly targetDatabaseName: string;
  /** إن صح بقيت قاعدة التمرين لفحص المشغل يدوياً بعد النجاح أو الفشل. */
  readonly keepRestoreDatabase?: boolean;
}

export class BackupRestoreError {
  readonly code = "BACKUP_RESTORE_VERIFICATION_FAILURE" as const;
  constructor(readonly detail: string) {}
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function validDatabaseName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name);
}

async function execute(command: readonly string[]): Promise<Result<void, BackupRestoreError>> {
  try {
    const process = Bun.spawn({ cmd: [...command], stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (exitCode !== 0) {
      const detail = (stderr || stdout).trim().slice(0, 2_000);
      return err(
        new BackupRestoreError(`فشل أمر استعادة PostgreSQL (خروج ${exitCode}): ${detail}`),
      );
    }
    return ok(undefined);
  } catch (cause) {
    return err(
      new BackupRestoreError(
        `تعذر تشغيل أدوات PostgreSQL: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
    );
  }
}

function databaseUrls(
  sourceDatabaseUrl: string,
  targetDatabaseName: string,
): Result<
  {
    readonly admin: string;
    readonly target: string;
  },
  BackupRestoreError
> {
  try {
    const source = new URL(sourceDatabaseUrl);
    if (!["postgres:", "postgresql:"].includes(source.protocol)) {
      return err(new BackupRestoreError("رابط قاعدة المصدر ليس رابط PostgreSQL"));
    }
    const admin = new URL(source);
    admin.pathname = "/postgres";
    admin.search = "";
    admin.hash = "";
    const target = new URL(source);
    target.pathname = `/${targetDatabaseName}`;
    target.search = "";
    target.hash = "";
    return ok({ admin: admin.toString(), target: target.toString() });
  } catch {
    return err(new BackupRestoreError("رابط قاعدة المصدر غير صالح"));
  }
}

function rowCountTableName(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

/**
 * يقرأ البصمة من المصدر أو القاعدة المستعادة. تستثنى `db_backups` من عدّ الصفوف
 * فقط لأن صف نتيجة التحقق يضاف إلى المصدر بعد إنشاء الأرشيف؛ البنية نفسها تعدّ.
 */
export async function captureDatabaseFingerprint(
  databaseUrl: string,
): Promise<Result<DatabaseFingerprint, BackupRestoreError>> {
  const sql = createSql({ connectionString: databaseUrl, max: 1 });
  try {
    const [tables, functions, policies, constraints, indexes, roles] = await Promise.all([
      sql<{ schema_name: string; table_name: string }[]>`
        select n.nspname as schema_name, c.relname as table_name
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p')
         order by n.nspname, c.relname
      `,
      sql<{ n: number }[]>`
        select count(*)::int as n from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
      `,
      sql<{ n: number }[]>`select count(*)::int as n from pg_policies where schemaname = 'public'`,
      sql<{ n: number }[]>`
        select count(*)::int as n from pg_constraint c
          join pg_namespace n on n.oid = c.connamespace
         where n.nspname = 'public'
      `,
      sql<{ n: number }[]>`
        select count(*)::int as n from pg_index i
          join pg_class c on c.oid = i.indrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
      `,
      sql<{ role_name: string }[]>`
        select rolname as role_name
          from pg_roles
         where rolname !~ '^pg_'
         order by rolname
      `,
    ]);

    const rowCounts: Record<string, number> = {};
    for (const table of tables) {
      if (table.table_name === "db_backups") continue;
      const [count] = await sql.unsafe<{ n: string }[]>(
        `select count(*)::text as n from ${rowCountTableName(table.schema_name, table.table_name)}`,
      );
      rowCounts[`${table.schema_name}.${table.table_name}`] = Number(count?.n ?? -1);
    }

    return ok({
      tableCount: tables.length,
      functionCount: functions[0]?.n ?? 0,
      rlsPolicyCount: policies[0]?.n ?? 0,
      constraintCount: constraints[0]?.n ?? 0,
      indexCount: indexes[0]?.n ?? 0,
      rowCounts,
      roles: roles.map((role) => role.role_name),
    });
  } catch (cause) {
    return err(
      new BackupRestoreError(
        `تعذر قياس تكافؤ قاعدة الاستعادة: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function sameFingerprint(left: DatabaseFingerprint, right: DatabaseFingerprint): boolean {
  return (
    left.tableCount === right.tableCount &&
    left.functionCount === right.functionCount &&
    left.rlsPolicyCount === right.rlsPolicyCount &&
    left.constraintCount === right.constraintCount &&
    left.indexCount === right.indexCount &&
    JSON.stringify(left.rowCounts) === JSON.stringify(right.rowCounts)
  );
}

function rolesExistInArtifact(roles: readonly string[], roleDump: Uint8Array): boolean {
  const content = new TextDecoder().decode(roleDump);
  return roles.every(
    (role) =>
      content.includes(`CREATE ROLE ${quoteIdentifier(role)}`) ||
      content.includes(`CREATE ROLE ${role}`),
  );
}

/**
 * يستعيد أرشيف custom-format. يلزم أن يكون الأرشيف ناتج `pg_dump --format=custom`
 * وأن يكون مرفق الأدوار ناتج `pg_dumpall --globals-only --no-role-passwords`.
 */
export async function verifyBackupRestore(
  archive: Uint8Array,
  roleDump: Uint8Array,
  options: RestoreVerifyOptions,
): Promise<Result<RestoreVerification, BackupRestoreError>> {
  if (!validDatabaseName(options.targetDatabaseName)) {
    return err(new BackupRestoreError("اسم قاعدة تمرين الاستعادة غير صالح"));
  }
  const urls = databaseUrls(options.sourceDatabaseUrl, options.targetDatabaseName);
  if (!urls.ok) return urls;

  const source = await captureDatabaseFingerprint(options.sourceDatabaseUrl);
  if (!source.ok) return source;
  if (!rolesExistInArtifact(source.value.roles, roleDump)) {
    return err(new BackupRestoreError("مرافق الأدوار لا يحتوي تعريف كل أدوار المصدر"));
  }

  const archivePath = join(tmpdir(), `waslah-restore-${crypto.randomUUID()}.dump`);
  let databaseCreated = false;
  try {
    await Bun.write(archivePath, archive);
    const drop = await execute([
      "psql",
      "--no-psqlrc",
      "-v",
      "ON_ERROR_STOP=1",
      "-d",
      urls.value.admin,
      "-c",
      `drop database if exists ${quoteIdentifier(options.targetDatabaseName)} with (force)`,
    ]);
    if (!drop.ok) return drop;
    const create = await execute([
      "psql",
      "--no-psqlrc",
      "-v",
      "ON_ERROR_STOP=1",
      "-d",
      urls.value.admin,
      "-c",
      `create database ${quoteIdentifier(options.targetDatabaseName)} template template0`,
    ]);
    if (!create.ok) return create;
    databaseCreated = true;

    const restored = await execute([
      "pg_restore",
      "--exit-on-error",
      "--no-owner",
      "--dbname",
      urls.value.target,
      archivePath,
    ]);
    if (!restored.ok) return restored;

    const fingerprint = await captureDatabaseFingerprint(urls.value.target);
    if (!fingerprint.ok) return fingerprint;
    if (!sameFingerprint(source.value, fingerprint.value)) {
      return err(new BackupRestoreError("بصمة القاعدة المستعادة لا تكافئ بصمة المصدر"));
    }
    return ok({
      targetDatabase: options.targetDatabaseName,
      source: source.value,
      restored: fingerprint.value,
      rolesArtifactVerified: true,
    });
  } finally {
    await rm(archivePath, { force: true }).catch(() => undefined);
    if (databaseCreated && options.keepRestoreDatabase !== true) {
      await execute([
        "psql",
        "--no-psqlrc",
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        urls.value.admin,
        "-c",
        `drop database if exists ${quoteIdentifier(options.targetDatabaseName)} with (force)`,
      ]);
    }
  }
}

/** يعرض SQL الحالي فقط للاختبار ولتوثيق الاستهلاك الآمن للأسماء. */
export function quoteRestoreDatabaseNameForTest(name: string): string {
  return quoteIdentifier(name);
}
