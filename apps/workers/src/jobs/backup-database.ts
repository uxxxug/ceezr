/**
 * الغرض: مهمّة النسخ الاحتياطي اليومي — تصدير القاعدة بـ pg_dump، ضغطه، رفعه إلى
 *   Google Drive، وتطبيق سياسة الاحتفاظ (حذف الأقدم بعد العدد المحدّد). ثم تسجيل
 *   النتيجة في جدول `db_backups` لتراها لوحة الإدارة بلا فحص يدويّ.
 * الحالة: منفّذ فعلياً — البند 7.
 * ينتمي إلى: apps/workers/src/jobs
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/container.ts (مهمّة عامّة لا لكل مدينة)
 * ملاحظات مستقبلية: التردد يوميّ لا أقلّ (البند 7.2). الاحتفاظ بعدد محدود (افتراضيّ 14)
 *   لا زمن — لأن الامتلاء دالّةٌ في عدد الملفات لا في عمرها.
 */

import type { Clock } from "../../../../packages/shared/kernel/index.ts";
import { err, ok, type Result } from "../../../../packages/shared/result/index.ts";
import type { BackupStoragePort, RemoteBackupFile } from "../../../../packages/infrastructure/backup/index.ts";
import type { Sql } from "../../../../packages/infrastructure/db/client.ts";

export interface BackupConfig {
  /** رابط اتصال PostgreSQL — يُمرَّر إلى pg_dump. */
  readonly databaseUrl: string;
  /** عدد النسخ المحفوظة قبل حذف الأقدم. */
  readonly retentionCount: number;
}

export interface BackupDeps {
  readonly storage: BackupStoragePort;
  readonly sql: Sql;
  readonly clock: Clock;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export interface BackupOutcome {
  readonly status: "uploaded" | "skipped_no_config" | "skipped_disabled";
  readonly remoteFileId?: string;
  readonly bytes?: number;
  readonly pruned?: number;
}

export class BackupJobError {
  readonly code = "BACKUP_JOB_FAILURE" as const;
  constructor(readonly detail: string) {}
}

/**
 * التصدير الأساسيّ: يُنتج ملفّ dump مضغوطاً من pg_dump.
 * يُفصل كدالّة مستقلّة ليُختبر بمحاكاة العملية لا بـ pg_dump حقيقيّ.
 */
export interface Dumper {
  dump(databaseUrl: string): Promise<Result<Uint8Array, BackupJobError>>;
}

/** منفذ pg_dump الحقيقيّ عبر Bun.spawn. */
export function createPgDumper(): Dumper {
  return {
    dump: async (databaseUrl) => {
      try {
        const proc = Bun.spawn({
          cmd: ["pg_dump", databaseUrl, "--no-owner", "--no-privileges", "--format=plain"],
          stdout: "pipe",
          stderr: "pipe",
        });
        const output = await new Response(proc.stdout).arrayBuffer();
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
          const stderr = await new Response(proc.stderr).text();
          return err(new BackupJobError(`pg_dump فشل (خروج ${exitCode}): ${stderr}`));
        }
        return ok(new Uint8Array(output));
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        return err(new BackupJobError(`pg_dump غير متاح: ${detail}`));
      }
    },
  };
}

/** يضغط بيانات بـ gzip عبر Bun's CompressionStream. */
export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * تختار النسخ التي تتجاوز سقف الاحتفاظ — الأقدم وحدها تُحذف.
 * مستخرجة لاختبار منطق الاحتفاظ بلا شبكة.
 */
export function selectForPruning(
  files: readonly RemoteBackupFile[],
  retentionCount: number,
): readonly RemoteBackupFile[] {
  if (retentionCount <= 0 || files.length <= retentionCount) return [];
  // مرتّبة من الأقدم للأحدث (القائمة من Drive هكذا أصلاً)
  return files.slice(0, files.length - retentionCount);
}

/**
 * ينفّذ نسخة احتياطية كاملة: تصدير ← ضغط ← رفع ← احتفاظ ← تسجيل.
 * أيّ فشل في الر steps السابقة للرفع لا يُسجَّل كنسخة فاشلة في القاعدة — فقط الرفع
 * والاحتفاظ يُسجّلان، لأنّ فشل التصدير عطلٌ تقنيّ يُظهره السجلّ لا عجز سياسة.
 */
export async function runDatabaseBackup(
  config: BackupConfig | null,
  deps: BackupDeps,
  dumper: Dumper,
): Promise<Result<BackupOutcome, BackupJobError>> {
  const log = deps.log ?? (() => {});

  // لا إعداد = ميزة معطّلة لا خطأ: من لم يُدخل اعتمادات Google Drive لا يُوقف
  // العاملَ خطأٌ في ميزة لم يُفعّلها. هذا اتّساق مع `TRANSLATION_PROVIDER=none`.
  if (config === null) {
    return ok({ status: "skipped_no_config" });
  }

  const now = deps.clock.now();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const name = `wasalah-backup-${stamp}.sql.gz`;

  const dumped = await dumper.dump(config.databaseUrl);
  if (!dumped.ok) {
    log("backup.dump_failed", { detail: dumped.error.detail });
    return err(dumped.error);
  }

  const compressed = await gzip(dumped.value);
  log("backup.dumped", { rawBytes: dumped.value.byteLength, gzippedBytes: compressed.byteLength });

  const uploaded = await deps.storage.upload(name, compressed);
  if (!uploaded.ok) {
    log("backup.upload_failed", { detail: uploaded.error.detail });
    return err(new BackupJobError(uploaded.error.detail));
  }

  // الاحتفاظ: احذف الأقدم بعد العدد المحدّد.
  let pruned = 0;
  const listed = await deps.storage.list();
  if (listed.ok) {
    const toDelete = selectForPruning(listed.value, config.retentionCount);
    for (const file of toDelete) {
      const deleted = await deps.storage.delete(file.remoteFileId);
      if (deleted.ok) pruned += 1;
      else log("backup.prune_failed", { fileId: file.remoteFileId, detail: deleted.error.detail });
    }
  } else {
    log("backup.list_failed", { detail: listed.error.detail });
  }

  // تسجيل النسخة الناجحة في القاعدة لتراها لوحة الإدارة.
  try {
    await deps.sql`
      insert into db_backups (remote_file_id, file_name, bytes, status)
      values (${uploaded.value.remoteFileId}, ${name}, ${uploaded.value.bytes}, 'success')
    `;
  } catch (cause) {
    // فشل التسجيل لا يُبطل النسخة: الملف مرفوع فعلاً. السجلّ يكشف الفقدان.
    log("backup.record_failed", { detail: cause instanceof Error ? cause.message : String(cause) });
  }

  log("backup.uploaded", { remoteFileId: uploaded.value.remoteFileId, pruned });

  return ok({
    status: "uploaded",
    remoteFileId: uploaded.value.remoteFileId,
    bytes: uploaded.value.bytes,
    pruned,
  });
}
