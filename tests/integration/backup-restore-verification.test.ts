/**
 * الغرض: إثبات تكامل مسار النسخ والاستعادة: أرشيف PostgreSQL التالف لا يوسم
 *   ناجحاً، والأرشيف السليم يستعاد في قاعدة مستقلة وتثبت بصمته ثم يوسم متحققاً.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL وأدوات PostgreSQL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI وبوابة إثبات قابلية النسخ للاستعادة.
 * ملاحظات مستقبلية: قاعدة الاستعادة تسمى عشوائياً وتحذف بعد كل اختبار، فلا تمس
 *   قاعدة المصدر ولا أثر تمرين waslah_drill اليدوي.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPgDumper } from "../../apps/workers/src/jobs/backup-database.ts";
import { runBackupRestoreVerification } from "../../apps/workers/src/jobs/verify-backup-restore.ts";
import { createLocalBackupStorage } from "../../packages/infrastructure/backup/index.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

let sql: Sql;
let cityId = "";
let directory = "";
const createdRunIds: string[] = [];

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  const [city] = await sql<{ id: string }[]>`select id from cities order by code limit 1`;
  if (city === undefined) throw new Error("لا مدينة متاحة لاختبار تحقق الاستعادة");
  cityId = city.id;
  directory = join(tmpdir(), `waslah-backup-restore-test-${crypto.randomUUID()}`);
  await mkdir(directory, { recursive: true });
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (createdRunIds.length > 0) {
    await sql`delete from db_backups where backup_run_id = any(${createdRunIds}::uuid[])`;
  }
  await sql.end({ timeout: 5 });
  await rm(directory, { recursive: true, force: true });
});

async function prepareBackup(corrupt: boolean): Promise<{
  readonly runId: string;
  readonly storage: ReturnType<typeof createLocalBackupStorage>;
}> {
  if (DATABASE_URL === undefined) throw new Error("رابط قاعدة الاختبار مفقود");
  const dumper = createPgDumper();
  const [archive, roles] = await Promise.all([
    dumper.dump(DATABASE_URL),
    dumper.dumpGlobals?.(DATABASE_URL),
  ]);
  if (!archive.ok || roles === undefined || !roles.ok) {
    throw new Error("تعذر إنشاء أثر النسخة لاختبار التكامل");
  }
  const storage = createLocalBackupStorage({ directory });
  const runId = crypto.randomUUID();
  createdRunIds.push(runId);
  const archiveName = `${runId}.dump`;
  const rolesName = `${runId}.roles.sql`;
  const uploadedArchive = await storage.upload(
    archiveName,
    corrupt ? new Uint8Array([0x00, 0x01, 0x02, 0x03]) : archive.value,
  );
  const uploadedRoles = await storage.upload(rolesName, roles.value);
  if (!uploadedArchive.ok || !uploadedRoles.ok) throw new Error("تعذر حفظ أثر اختبار التكامل");
  await sql`
    insert into db_backups
      (city_id, backup_run_id, remote_file_id, file_name, bytes, status,
       role_remote_file_id, role_file_name, role_bytes, restore_verification_status)
    values
      (${cityId}, ${runId}, ${uploadedArchive.value.remoteFileId}, ${archiveName},
       ${uploadedArchive.value.bytes}, 'success',
       ${uploadedRoles.value.remoteFileId}, ${rolesName}, ${uploadedRoles.value.bytes}, 'unverified')
  `;
  return { runId, storage };
}

describeIf("تحقق استعادة النسخ الاحتياطية", () => {
  it("يكتشف الأرشيف المقتطع ولا يسمه متحققاً", async () => {
    const backup = await prepareBackup(true);
    const result = await runBackupRestoreVerification(
      {
        databaseUrl: DATABASE_URL ?? "",
        backupRunId: backup.runId,
        targetDatabaseName: `waslah_restore_bad_${backup.runId.replaceAll("-", "").slice(0, 16)}`,
      },
      { storage: backup.storage, sql },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("verification_failed");
    const [record] = await sql<{ status: string; detail: string }[]>`
      select restore_verification_status as status, restore_verification_detail::text as detail
        from db_backups where backup_run_id = ${backup.runId}
    `;
    expect(record?.status).toBe("verification_failed");
    expect(JSON.parse(record?.detail ?? "{}").code).toBe("BACKUP_RESTORE_VERIFICATION_FAILURE");
  }, 90_000);

  it("يستعيد الأرشيف السليم ويثبت البنية والسياسات والصفوف ثم يسمه متحققاً", async () => {
    const backup = await prepareBackup(false);
    const result = await runBackupRestoreVerification(
      {
        databaseUrl: DATABASE_URL ?? "",
        backupRunId: backup.runId,
        targetDatabaseName: `waslah_restore_good_${backup.runId.replaceAll("-", "").slice(0, 16)}`,
      },
      { storage: backup.storage, sql },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("verified");
    const [record] = await sql<{ status: string; detail: string }[]>`
      select restore_verification_status as status, restore_verification_detail::text as detail
        from db_backups where backup_run_id = ${backup.runId}
    `;
    const detail = JSON.parse(record?.detail ?? "{}") as {
      tables?: number;
      functions?: number;
      rlsPolicies?: number;
      constraints?: number;
      indexes?: number;
      rowCountTables?: number;
      rolesArtifactVerified?: boolean;
    };
    expect(record?.status).toBe("verified");
    expect(detail.tables).toBeGreaterThan(0);
    expect(detail.functions).toBeGreaterThan(0);
    expect(detail.rlsPolicies).toBeGreaterThan(0);
    expect(detail.constraints).toBeGreaterThan(0);
    expect(detail.indexes).toBeGreaterThan(0);
    expect(detail.rowCountTables).toBeGreaterThan(0);
    expect(detail.rolesArtifactVerified).toBe(true);
  }, 90_000);
});
