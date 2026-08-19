/**
 * الغرض: مهمّة النسخ الاحتياطي اليومي — تصدير القاعدة بأرشيف pg_dump قابل
 *   للاستعادة، مع مرافق الأدوار، ورفعهما إلى التخزين ثم تسجيلهما كـ«غير متحقق».
 * الحالة: منفّذ فعلياً — التحقق الدوري المنفصل يثبت الاستعادة قبل وصفها بالصالحة.
 * ينتمي إلى: apps/workers/src/jobs
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/container.ts (تُشغَّل مرّة واحدة لا لكل مدينة)
 *   التشغيل واحد لأنّ pg_dump يفرّغ العنقود كلّه، لكنّ التسجيل صفٌّ لكل مدينة: الملف
 *   الواحد يضمّ بيانات كل مدينة موجودة وقت أخذه، وهذه شهادةٌ صادقة لكل مدينة على حِدة
 *   لا تكرارٌ زائد — وبها يحمل db_backups مدينةً حقيقية بلا استثناء من القاعدة 0.4.
 * ملاحظات مستقبلية: التردد يوميّ لا أقلّ (البند 7.2). الاحتفاظ بعدد محدود (افتراضيّ 14)
 *   لا زمن — لأن الامتلاء دالّةٌ في عدد الملفات لا في عمرها.
 */

import type {
  BackupStoragePort,
  RemoteBackupFile,
} from "../../../../packages/infrastructure/backup/index.ts";
import type { Sql } from "../../../../packages/infrastructure/db/client.ts";
import type { Clock } from "../../../../packages/shared/kernel/index.ts";
import { err, ok, type Result } from "../../../../packages/shared/result/index.ts";

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
  readonly backupRunId?: string;
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
  /**
   * مرفق الأدوار العام. اختياري لتبقى مزدوجات الاختبار القديمة صالحة؛ المنفذ
   * الحقيقي يوفره دائماً، ومهمة التحقق ترفض النسخة التي لا يحمل سجلها المرافق.
   */
  dumpGlobals?(databaseUrl: string): Promise<Result<Uint8Array, BackupJobError>>;
}

/** منفذ pg_dump الحقيقيّ عبر Bun.spawn. */
export function createPgDumper(): Dumper {
  const run = async (
    command: readonly string[],
    label: string,
  ): Promise<Result<Uint8Array, BackupJobError>> => {
    try {
      const proc = Bun.spawn({ cmd: [...command], stdout: "pipe", stderr: "pipe" });
      const [output, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).arrayBuffer(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (exitCode !== 0) {
        return err(new BackupJobError(`${label} فشل (خروج ${exitCode}): ${stderr}`));
      }
      return ok(new Uint8Array(output));
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return err(new BackupJobError(`${label} غير متاح: ${detail}`));
    }
  };

  return {
    // الصيغة المخصصة تضغط داخلياً وتحفظ ترتيب الاستعادة؛ pg_restore يقرأها
    // مباشرة بخلاف SQL+gzip الذي لا يثبت التنفيذ ولا يسمح بالتحقق البرمجي.
    dump: (databaseUrl) =>
      run(["pg_dump", databaseUrl, "--no-owner", "--format=custom"], "pg_dump"),
    // لا كلمات مرور في مرافق الأدوار. الاستعادة التشغيلية للأدوار خطوة واعية
    // منفصلة في runbook؛ التمرين يتحقق من وجود تعريفاتها فقط.
    dumpGlobals: (databaseUrl) =>
      run(
        ["pg_dumpall", "--database", databaseUrl, "--globals-only", "--no-role-passwords"],
        "pg_dumpall",
      ),
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
 * ينفّذ نسخة احتياطية قابلة للاستعادة: أرشيف قاعدة ← مرافق أدوار ← رفع ← احتفاظ ← تسجيل.
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
  const name = `wasalah-backup-${stamp}.dump`;
  const rolesName = `wasalah-backup-${stamp}.roles.sql`;

  const dumped = await dumper.dump(config.databaseUrl);
  if (!dumped.ok) {
    log("backup.dump_failed", { detail: dumped.error.detail });
    return err(dumped.error);
  }

  log("backup.dumped", { archiveBytes: dumped.value.byteLength, format: "pg_dump_custom" });

  const uploaded = await deps.storage.upload(name, dumped.value);
  if (!uploaded.ok) {
    log("backup.upload_failed", { detail: uploaded.error.detail });
    return err(new BackupJobError(uploaded.error.detail));
  }

  let uploadedRoles: { remoteFileId: string; bytes: number } | null = null;
  if (dumper.dumpGlobals !== undefined) {
    const globals = await dumper.dumpGlobals(config.databaseUrl);
    if (!globals.ok) {
      log("backup.globals_failed", { detail: globals.error.detail });
      return err(globals.error);
    }
    const roleUpload = await deps.storage.upload(rolesName, globals.value);
    if (!roleUpload.ok) {
      log("backup.globals_upload_failed", { detail: roleUpload.error.detail });
      return err(new BackupJobError(roleUpload.error.detail));
    }
    uploadedRoles = { remoteFileId: roleUpload.value.remoteFileId, bytes: roleUpload.value.bytes };
  } else {
    log("backup.globals_missing", { detail: "المصدّر لا يوفر pg_dumpall؛ ستفشل مهمة التحقق" });
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

  // تسجيل النسخة الناجحة في القاعدة لتراها لوحة الإدارة: صفٌّ لكل مدينة، بمعرّف
  // تفريغٍ واحد يجمعها. عبارة insert…select واحدة، فالصفوف كلها تظهر معاً أو لا تظهر —
  // لا حاجة إلى منطق تزامن في التطبيق، ولا إلى قائمة مدن مكتوبة في الكود.
  //
  // معرّف التفريغ يُولَّد هنا مرّة واحدة لا بـgen_random_uuid() داخل الـselect:
  // تلك دالة متقلّبة (volatile) تُقََيّم لكل صفٍّ فتُعطي كل مدينة معرّفاً مختلفاً
  // وتُبطِل الجمع الذي وُضِع لأجله — معرّف هويّة لا قيمة تجاريّة، فتوليده في التطبيق مقبول.
  const backupRunId = crypto.randomUUID();
  try {
    const inserted = await deps.sql`
      insert into db_backups
        (city_id, backup_run_id, remote_file_id, file_name, bytes, status,
         role_remote_file_id, role_file_name, role_bytes, restore_verification_status)
      select c.id, ${backupRunId}, ${uploaded.value.remoteFileId}, ${name}, ${uploaded.value.bytes}, 'success',
             ${uploadedRoles?.remoteFileId ?? null}, ${uploadedRoles === null ? null : rolesName},
             ${uploadedRoles?.bytes ?? null}, 'unverified'
        from cities c
    `;
    // قاعدة بلا مدن تعني ملفاً مرفوعاً لا تراه لوحة الإدارة. لا تُختلق له مدينة،
    // ولا يُمرّ الصمت: يُسجّل صراحةً لأنّه خلل تهيئة لا حالة طبيعيّة.
    if (inserted.count === 0) {
      log("backup.record_no_cities", { fileName: name, backupRunId });
    }
  } catch (cause) {
    // فشل التسجيل لا يُبطل النسخة: الملف مرفوع فعلاً. السجلّ يكشف الفقدان.
    log("backup.record_failed", { detail: cause instanceof Error ? cause.message : String(cause) });
  }

  log("backup.uploaded_unverified", {
    remoteFileId: uploaded.value.remoteFileId,
    backupRunId,
    rolesAttached: uploadedRoles !== null,
    pruned,
  });

  return ok({
    status: "uploaded",
    remoteFileId: uploaded.value.remoteFileId,
    bytes: uploaded.value.bytes,
    pruned,
    backupRunId,
  });
}
