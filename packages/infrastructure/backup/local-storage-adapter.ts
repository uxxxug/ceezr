/**
 * الغرض: محوّل تخزين محلي اختياري لنسخ قاعدة البيانات عندما لا تتوفر إعدادات
 *   Google Drive؛ يبقي الأثر قابلاً للاستعادة ولا يجعل غياب خدمة خارجية عطلاً.
 * الحالة: منفّذ فعلياً — يدعم الرفع والتنزيل والاحتفاظ للتحقق الدوري.
 * ينتمي إلى: infrastructure/backup
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/container.ts عبر BACKUP_LOCAL_DIR.
 * ملاحظات مستقبلية: المسار يجب أن يكون حجماً دائماً ومشفراً في بيئة الإنتاج،
 *   ولا يجوز اعتباره بديلاً عن نسخة خارج الخادم.
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "../../shared/result/index.ts";
import {
  BackupStorageError,
  type BackupStoragePort,
  type BackupUploadResult,
  type RemoteBackupFile,
} from "./backup-port.ts";

export interface LocalBackupStorageConfig {
  /** المسار المطلق للمجلد الدائم الخاص بالنسخ. */
  readonly directory: string;
}

function safeName(name: string): boolean {
  return (
    name.length > 0 && !name.includes("/") && !name.includes("\\") && name !== "." && name !== ".."
  );
}

export function createLocalBackupStorage(config: LocalBackupStorageConfig): BackupStoragePort {
  const failure = (port: string, detail: string): BackupStorageError =>
    new BackupStorageError(port, detail);

  return {
    upload: async (name, content): Promise<Result<BackupUploadResult, BackupStorageError>> => {
      if (!safeName(name)) return err(failure("local.upload", "اسم ملف النسخة غير آمن"));
      try {
        await mkdir(config.directory, { recursive: true });
        const path = join(config.directory, name);
        await writeFile(path, content);
        return ok({ remoteFileId: name, bytes: content.byteLength, uploadedAt: new Date() });
      } catch (cause) {
        return err(failure("local.upload", cause instanceof Error ? cause.message : String(cause)));
      }
    },

    download: async (remoteFileId): Promise<Result<Uint8Array, BackupStorageError>> => {
      if (!safeName(remoteFileId)) return err(failure("local.download", "معرّف ملف النسخة غير آمن"));
      try {
        return ok(new Uint8Array(await readFile(join(config.directory, remoteFileId))));
      } catch (cause) {
        return err(
          failure("local.download", cause instanceof Error ? cause.message : String(cause)),
        );
      }
    },

    list: async (): Promise<Result<readonly RemoteBackupFile[], BackupStorageError>> => {
      try {
        await mkdir(config.directory, { recursive: true });
        const names = await readdir(config.directory);
        const files = await Promise.all(
          names.filter(safeName).map(async (name): Promise<RemoteBackupFile> => {
            const metadata = await stat(join(config.directory, name));
            return { remoteFileId: name, name, uploadedAt: metadata.mtime };
          }),
        );
        files.sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime());
        return ok(files);
      } catch (cause) {
        return err(failure("local.list", cause instanceof Error ? cause.message : String(cause)));
      }
    },

    delete: async (remoteFileId): Promise<Result<void, BackupStorageError>> => {
      if (!safeName(remoteFileId)) return err(failure("local.delete", "معرّف ملف النسخة غير آمن"));
      try {
        await rm(join(config.directory, remoteFileId), { force: true });
        return ok(undefined);
      } catch (cause) {
        return err(failure("local.delete", cause instanceof Error ? cause.message : String(cause)));
      }
    },
  };
}
