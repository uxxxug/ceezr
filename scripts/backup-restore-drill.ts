/**
 * الغرض: تنفيذ تمرين استعادة يدوي قابل للتكرار: أخذ أرشيف ومرافق أدوار من قاعدة
 *   محددة، تسجيلهما غير متحققين، واستعادتهما إلى waslah_drill مع حفظ الدليل.
 * الحالة: منفّذ فعلياً — يتطلب DATABASE_URL وخادم PostgreSQL وأدوات العميل.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: مشغل الحوادث أو مراجعة البند 22 قبل أي إصدار.
 * ملاحظات مستقبلية: المجلد المحلي مؤقت للتمرين فقط؛ النسخ التشغيلية تستخدم
 *   BACKUP_LOCAL_DIR الدائم أو Google Drive ولا توضع أي أسرار في هذا الملف.
 */

import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPgDumper } from "../apps/workers/src/jobs/backup-database.ts";
import { runBackupRestoreVerification } from "../apps/workers/src/jobs/verify-backup-restore.ts";
import { createLocalBackupStorage } from "../packages/infrastructure/backup/index.ts";
import { createSql } from "../packages/infrastructure/db/client.ts";

const databaseUrl = process.env.DATABASE_URL;

async function main(): Promise<void> {
  if (!databaseUrl) {
    console.error("DATABASE_URL مطلوب لتنفيذ تمرين الاستعادة.");
    process.exitCode = 1;
    return;
  }

  const sql = createSql({ connectionString: databaseUrl });
  const directory = join(tmpdir(), `waslah-backup-drill-${crypto.randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const storage = createLocalBackupStorage({ directory });
  const dumper = createPgDumper();
  const runId = crypto.randomUUID();
  const suffix = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveName = `waslah-drill-${suffix}.dump`;
  const roleName = `waslah-drill-${suffix}.roles.sql`;

  try {
    const [archive, roles] = await Promise.all([
      dumper.dump(databaseUrl),
      dumper.dumpGlobals?.(databaseUrl),
    ]);
    if (!archive.ok || roles === undefined || !roles.ok) {
      // السببُ يُحسَب في تعبيرٍ مُصرَّحٍ لا داخل ثلاثيّاتٍ مُتداخلة: التضييق داخلها
      // لا يَبلُغ `roles.ok`، فكان `roles.error` يُقرأ على نوعٍ قد يكون `Ok`.
      const detail = !archive.ok
        ? archive.error.detail
        : roles === undefined
          ? "pg_dumpall غير متاح"
          : !roles.ok
            ? roles.error.detail
            : "سببٌ غير متوقَّع";
      console.error(JSON.stringify({ status: "failed", detail }));
      process.exitCode = 1;
      return;
    }
    const [uploadedArchive, uploadedRoles] = await Promise.all([
      storage.upload(archiveName, archive.value),
      storage.upload(roleName, roles.value),
    ]);
    if (!uploadedArchive.ok || !uploadedRoles.ok) {
      console.error(
        JSON.stringify({ status: "failed", detail: "تعذر حفظ أثر تمرين الاستعادة محلياً" }),
      );
      process.exitCode = 1;
      return;
    }

    const inserted = await sql`
      insert into db_backups
        (city_id, backup_run_id, remote_file_id, file_name, bytes, status,
         role_remote_file_id, role_file_name, role_bytes, restore_verification_status)
      select c.id, ${runId}, ${uploadedArchive.value.remoteFileId}, ${archiveName},
             ${uploadedArchive.value.bytes}, 'success',
             ${uploadedRoles.value.remoteFileId}, ${roleName}, ${uploadedRoles.value.bytes}, 'unverified'
        from cities c
    `;
    if (inserted.count === 0) {
      console.error(JSON.stringify({ status: "failed", detail: "لا مدينة لتسجيل نتيجة التمرين" }));
      process.exitCode = 1;
      return;
    }

    const result = await runBackupRestoreVerification(
      {
        databaseUrl,
        backupRunId: runId,
        targetDatabaseName: "waslah_drill",
        keepRestoreDatabase: true,
      },
      { storage, sql },
    );
    if (!result.ok || result.value.status !== "verified") {
      console.error(
        JSON.stringify({
          status: "failed",
          detail: result.ok ? result.value.status : result.error.detail,
          backupRunId: runId,
        }),
      );
      process.exitCode = 1;
      return;
    }

    const [record] = await sql<{ detail: string }[]>`
      select restore_verification_detail::text as detail
        from db_backups
       where backup_run_id = ${runId}
       limit 1
    `;
    console.log(
      JSON.stringify({
        status: result.value.status,
        backupRunId: runId,
        targetDatabase: result.value.targetDatabase,
        equivalence: JSON.parse(record?.detail ?? "{}") as Record<string, unknown>,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
