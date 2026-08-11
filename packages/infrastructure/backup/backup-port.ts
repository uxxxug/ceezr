/**
 * الغرض: عقد رفع نسخة احتياطية إلى تخزين خارجي (Google Drive) — المنفذ الذي
 *   يُخاطب به العاملُ التخزينَ السحابيّ. لا تنفيذ هنا: التنفيذ في
 *   `google-drive-adapter.ts`، والمزدوجات في tests/support.
 * الحالة: منفّذ فعلياً — البند 7 (النسخ الاحتياطي على Google Drive).
 * ينتمي إلى: application/ports (موضوعة هنا بجوار المحوّل لأنها خاصّة به وحده)
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/jobs/backup-database.ts
 * ملاحظات مستقبلية: لو أُضيف مزوّد تخزين ثانٍ (S3، Backblaze) يُحقن من هنا
 *   بلا تغيير المهمّة ولا القاعدة.
 */

import type { Result } from "../../shared/result/index.ts";

/** نتيجة رفع نسخة واحدة. */
export interface BackupUploadResult {
  /** معرّف الملف عند مزوّد التخزين (Drive file id). */
  readonly remoteFileId: string;
  /** حجم الملف المرفوع بالبايت. */
  readonly bytes: number;
  /** وقت الرفع. */
  readonly uploadedAt: Date;
}

/** وصف ملفٍّ يحذره الترقية لتنفيذ سياسة الاحتفاظ (retention). */
export interface RemoteBackupFile {
  readonly remoteFileId: string;
  readonly name: string;
  readonly uploadedAt: Date;
}

/**
 * منفذ التخزين الخارجي. المسؤولية الوحيدة: رفع ملف مضغوط، وقراءة قائمة النسخ
 * الموجودة، وحذف نسخة بالإدخال. لا يعرف شيئاً عن القاعدة ولا عن pg_dump ولا
 * عن سياسة الاحتفاظ — كلّها مسؤولية المهمّة.
 */
export interface BackupStoragePort {
  /** يرفع ملفاً مضغوطاً إلى المجلد المضبوط. */
  upload(name: string, content: Uint8Array): Promise<Result<BackupUploadResult, BackupStorageError>>;

  /** يعدّد النسخ الموجودة في المجلد مرتّبة من الأقدم للأحدث. */
  list(): Promise<Result<readonly RemoteBackupFile[], BackupStorageError>>;

  /** يحذف نسخة بمعرّفها. */
  delete(remoteFileId: string): Promise<Result<void, BackupStorageError>>;
}

export class BackupStorageError {
  readonly code = "BACKUP_STORAGE_FAILURE" as const;
  constructor(
    readonly port: string,
    readonly detail: string,
  ) {}
}
