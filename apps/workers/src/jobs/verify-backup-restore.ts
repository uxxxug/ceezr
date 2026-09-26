/**
 * الغرض: مهمة دورية تقرأ نسخة غير متحقق منها، تنزل الأرشيف ومرافق الأدوار،
 *   وتستعيدهما في قاعدة مستقلة ثم تسجل نتيجة التكافؤ في db_backups.
 * الحالة: منفّذ فعلياً — تحتاج فقط إلى تسجيلها في حاوية العامل كما في
 *   WIRING_BACKUP.md؛ المشغّل الموجود يضيف القفل الموزع باسم المهمة تلقائياً.
 * ينتمي إلى: apps/workers/src/jobs
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/container.ts وواجهة تشغيل النسخ.
 * ملاحظات مستقبلية: لا تطبق المهمة SQL الأدوار على الخادم؛ ذلك إجراء استعادة
 *   يدوي واعٍ موثق في runbook لأن الأدوار عامة على العنقود.
 */

import {
  type BackupStoragePort,
  type RestoreTimings,
  verifyBackupRestore,
} from "../../../../packages/infrastructure/backup/index.ts";
import type { Sql } from "../../../../packages/infrastructure/db/client.ts";
import { err, ok, type Result } from "../../../../packages/shared/result/index.ts";

export interface VerifyBackupRestoreConfig {
  readonly databaseUrl: string;
  /** لا يستعمل إلا في الاختبار أو تمرين يدوي محدد؛ الدوري يولد اسماً آمناً. */
  readonly targetDatabaseName?: string;
  /** يتيح اختبار سجل تفريغ واحد من دون منافسة بقية النسخ غير المتحققة. */
  readonly backupRunId?: string;
  /** يبقي القاعدة المستعادة لتشخيص التمرين اليدوي، لا للدورة المعتادة. */
  readonly keepRestoreDatabase?: boolean;
}

export interface VerifyBackupRestoreDeps {
  readonly storage: BackupStoragePort;
  readonly sql: Sql;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export interface VerifyBackupRestoreOutcome {
  readonly status: "verified" | "verification_failed" | "skipped_no_unverified_backup";
  readonly backupRunId?: string;
  readonly targetDatabase?: string;
  /** أزمنةُ الأطوارِ المقيسةُ — موجودةٌ عندَ نجاحِ التحقُّقِ (`F11-10`). */
  readonly timings?: RestoreTimings;
}

export class VerifyBackupRestoreJobError {
  readonly code = "VERIFY_BACKUP_RESTORE_JOB_FAILURE" as const;
  constructor(readonly detail: string) {}
}

interface PendingBackup {
  readonly backup_run_id: string;
  readonly remote_file_id: string;
  readonly role_remote_file_id: string | null;
}

function targetName(runId: string): string {
  return `waslah_restore_verify_${runId.replaceAll("-", "").slice(0, 24)}`;
}

async function markVerification(
  sql: Sql,
  backupRunId: string,
  status: "verified" | "verification_failed",
  detail: Record<string, unknown>,
  targetDatabase: string | null,
): Promise<Result<void, VerifyBackupRestoreJobError>> {
  try {
    await sql`
      update db_backups
         set restore_verification_status = ${status},
             restore_verified_at = now(),
             restore_verified_database = ${targetDatabase},
             restore_verification_detail = ${sql.json(detail as never)}
       where backup_run_id = ${backupRunId}
    `;
    return ok(undefined);
  } catch (cause) {
    return err(
      new VerifyBackupRestoreJobError(
        `تعذر تسجيل نتيجة تحقق الاستعادة: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
    );
  }
}

/** يتحقق من تفريغ واحد فقط في كل شوط حتى لا تنافس الاستعادات الثقيلة على الخادم. */
export async function runBackupRestoreVerification(
  config: VerifyBackupRestoreConfig,
  deps: VerifyBackupRestoreDeps,
): Promise<Result<VerifyBackupRestoreOutcome, VerifyBackupRestoreJobError>> {
  const log = deps.log ?? (() => {});
  let pending: PendingBackup | undefined;
  try {
    const rows =
      config.backupRunId === undefined
        ? await deps.sql<PendingBackup[]>`
          select distinct on (backup_run_id)
                 backup_run_id, remote_file_id, role_remote_file_id
            from db_backups
           where restore_verification_status = 'unverified'
           order by backup_run_id, created_at
           limit 1
        `
        : await deps.sql<PendingBackup[]>`
          select distinct on (backup_run_id)
                 backup_run_id, remote_file_id, role_remote_file_id
            from db_backups
           where backup_run_id = ${config.backupRunId}
             and restore_verification_status = 'unverified'
           order by backup_run_id, created_at
           limit 1
        `;
    pending = rows[0];
  } catch (cause) {
    return err(
      new VerifyBackupRestoreJobError(
        `تعذر اختيار نسخة غير متحقق منها: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
    );
  }

  if (pending === undefined) return ok({ status: "skipped_no_unverified_backup" });
  const databaseName = config.targetDatabaseName ?? targetName(pending.backup_run_id);

  if (pending.role_remote_file_id === null) {
    const recorded = await markVerification(
      deps.sql,
      pending.backup_run_id,
      "verification_failed",
      { code: "ROLE_ARTIFACT_MISSING", message: "مرافق الأدوار مفقود من سجل النسخة" },
      databaseName,
    );
    if (!recorded.ok) return recorded;
    return ok({
      status: "verification_failed",
      backupRunId: pending.backup_run_id,
      targetDatabase: databaseName,
    });
  }

  if (deps.storage.download === undefined) {
    const recorded = await markVerification(
      deps.sql,
      pending.backup_run_id,
      "verification_failed",
      { code: "STORAGE_DOWNLOAD_UNSUPPORTED", message: "مخزن النسخ لا يدعم تنزيل الأثر للتحقق" },
      databaseName,
    );
    if (!recorded.ok) return recorded;
    return ok({
      status: "verification_failed",
      backupRunId: pending.backup_run_id,
      targetDatabase: databaseName,
    });
  }

  const [archive, roles] = await Promise.all([
    deps.storage.download(pending.remote_file_id),
    deps.storage.download(pending.role_remote_file_id),
  ]);
  if (!archive.ok) {
    const detail = archive.error.detail;
    const recorded = await markVerification(
      deps.sql,
      pending.backup_run_id,
      "verification_failed",
      { code: "ARTIFACT_DOWNLOAD_FAILED", message: detail },
      databaseName,
    );
    if (!recorded.ok) return recorded;
    log("backup_restore.download_failed", { backupRunId: pending.backup_run_id, detail });
    return ok({
      status: "verification_failed",
      backupRunId: pending.backup_run_id,
      targetDatabase: databaseName,
    });
  }
  if (!roles.ok) {
    const detail = roles.error.detail;
    const recorded = await markVerification(
      deps.sql,
      pending.backup_run_id,
      "verification_failed",
      { code: "ARTIFACT_DOWNLOAD_FAILED", message: detail },
      databaseName,
    );
    if (!recorded.ok) return recorded;
    log("backup_restore.download_failed", { backupRunId: pending.backup_run_id, detail });
    return ok({
      status: "verification_failed",
      backupRunId: pending.backup_run_id,
      targetDatabase: databaseName,
    });
  }

  const verification = await verifyBackupRestore(archive.value, roles.value, {
    sourceDatabaseUrl: config.databaseUrl,
    targetDatabaseName: databaseName,
    ...(config.keepRestoreDatabase === undefined
      ? {}
      : { keepRestoreDatabase: config.keepRestoreDatabase }),
  });
  if (!verification.ok) {
    const recorded = await markVerification(
      deps.sql,
      pending.backup_run_id,
      "verification_failed",
      { code: verification.error.code, message: verification.error.detail },
      databaseName,
    );
    if (!recorded.ok) return recorded;
    log("backup_restore.verification_failed", {
      backupRunId: pending.backup_run_id,
      detail: verification.error.detail,
    });
    return ok({
      status: "verification_failed",
      backupRunId: pending.backup_run_id,
      targetDatabase: databaseName,
    });
  }

  const recorded = await markVerification(
    deps.sql,
    pending.backup_run_id,
    "verified",
    {
      tables: verification.value.restored.tableCount,
      functions: verification.value.restored.functionCount,
      rlsPolicies: verification.value.restored.rlsPolicyCount,
      constraints: verification.value.restored.constraintCount,
      indexes: verification.value.restored.indexCount,
      rowCountTables: Object.keys(verification.value.restored.rowCounts).length,
      rolesArtifactVerified: verification.value.rolesArtifactVerified,
      timings: verification.value.timings,
    },
    verification.value.targetDatabase,
  );
  if (!recorded.ok) return recorded;
  log("backup_restore.verified", {
    backupRunId: pending.backup_run_id,
    targetDatabase: verification.value.targetDatabase,
    tables: verification.value.restored.tableCount,
    timings: verification.value.timings,
  });
  return ok({
    status: "verified",
    backupRunId: pending.backup_run_id,
    targetDatabase: verification.value.targetDatabase,
    timings: verification.value.timings,
  });
}
