/**
 * الغرض: اختبارات وحدة مهمّة النسخ الاحتياطي — البند 7.
 *   تُحاكي التخزين والمُصدِّر، فلا تحتاج شبكة ولا pg_dump. تثبت: الرفع الناجح،
 *   تطبيق الاحتفاظ (حذف الأقدم)، التخطّي عند غياب الإعداد، وفشل التصدير.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import {
  type BackupConfig,
  createPgDumper,
  type Dumper,
  gzip,
  runDatabaseBackup,
  selectForPruning,
} from "../../apps/workers/src/jobs/backup-database.ts";
import type { BackupStorageError } from "../../packages/infrastructure/backup/backup-port.ts";
import type {
  BackupStoragePort,
  BackupUploadResult,
  RemoteBackupFile,
} from "../../packages/infrastructure/backup/index.ts";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import { err, ok, type Result } from "../../packages/shared/result/index.ts";

/** مزدوج التخزين: يجمع الرفعات والحذف في قوائم قابلة للفحص. */
function fakeStorage(existing: RemoteBackupFile[] = []): {
  storage: BackupStoragePort;
  uploads: BackupUploadResult[];
  deletes: string[];
  failUpload?: boolean;
} {
  const files: RemoteBackupFile[] = [...existing];
  const uploads: BackupUploadResult[] = [];
  const deletes: string[] = [];
  return {
    storage: {
      upload: async (name, content) => {
        const result: BackupUploadResult = {
          remoteFileId: `file-${uploads.length + 1}`,
          bytes: content.byteLength,
          uploadedAt: new Date(),
        };
        uploads.push(result);
        files.push({ remoteFileId: result.remoteFileId, name, uploadedAt: result.uploadedAt });
        return ok(result);
      },
      list: async () => ok(files),
      delete: async (remoteFileId) => {
        deletes.push(remoteFileId);
        return ok(undefined);
      },
    },
    uploads,
    deletes,
  };
}

/** مزدوج المُصدِّر: يعيد بيانات ثابتة بلا pg_dump. */
function fakeDumper(data = new Uint8Array([1, 2, 3])): Dumper {
  return {
    dump: async () => ok(data),
  };
}

/** مزدوج Sql: لا يتصل بقاعدة، يجمع inserts. */
function fakeSql(): { sql: Sql; count: () => number } {
  let n = 0;
  // postgres.js يُستدعى كدالّة tagged template؛ نُحاكي الشكل الأدنى.
  const sql = ((_strings: TemplateStringsArray) => {
    n += 1;
    return Promise.resolve([]);
  }) as unknown as Sql;
  return { sql, count: () => n };
}

const fixedClock = { now: () => new Date("2026-08-11T10:00:00Z") };

describe("backup-database: selectForPruning", () => {
  it("يحذف الأقدم عند تجاوز سقف الاحتفاظ", () => {
    const files: RemoteBackupFile[] = [
      { remoteFileId: "a", name: "old", uploadedAt: new Date("2026-08-01") },
      { remoteFileId: "b", name: "mid", uploadedAt: new Date("2026-08-05") },
      { remoteFileId: "c", name: "new", uploadedAt: new Date("2026-08-10") },
    ];
    const toDelete = selectForPruning(files, 2);
    expect(toDelete.length).toBe(1);
    expect(toDelete[0]?.remoteFileId).toBe("a");
  });

  it("لا يحذف شيئاً تحت السقف", () => {
    const files: RemoteBackupFile[] = [
      { remoteFileId: "a", name: "only", uploadedAt: new Date("2026-08-10") },
    ];
    expect(selectForPruning(files, 14).length).toBe(0);
  });

  it("لا يحذف عند سقف صفر أو سالب", () => {
    const files: RemoteBackupFile[] = [{ remoteFileId: "a", name: "x", uploadedAt: new Date() }];
    expect(selectForPruning(files, 0).length).toBe(0);
  });
});

describe("backup-database: runDatabaseBackup", () => {
  it("يرفع نسخة ويطبّق الاحتفاظ ويسجّل في القاعدة", async () => {
    const existing: RemoteBackupFile[] = Array.from({ length: 14 }, (_, i) => ({
      remoteFileId: `old-${i}`,
      name: `wasalah-backup-${i}.sql.gz`,
      uploadedAt: new Date(2026, 7, i + 1),
    }));
    const fake = fakeStorage(existing);
    const sqlWrap = fakeSql();
    const config: BackupConfig = { databaseUrl: "postgres://test", retentionCount: 14 };

    const result = await runDatabaseBackup(
      config,
      {
        storage: fake.storage,
        sql: sqlWrap.sql,
        clock: fixedClock,
      },
      fakeDumper(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("uploaded");
    expect(result.value.remoteFileId).toBe("file-1");
    expect(result.value.pruned).toBe(1); // 15 total, keep 14, delete 1 oldest
    expect(fake.uploads.length).toBe(1);
    expect(sqlWrap.count()).toBe(1);
  });

  it("يتخطّى بلا إعداد ولا يرمي", async () => {
    const fake = fakeStorage();
    const sqlWrap = fakeSql();
    const result = await runDatabaseBackup(
      null,
      {
        storage: fake.storage,
        sql: sqlWrap.sql,
        clock: fixedClock,
      },
      fakeDumper(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("skipped_no_config");
    expect(fake.uploads.length).toBe(0);
  });

  it("يفشل عند فشل التصدير ويسجّل السبب", async () => {
    const fake = fakeStorage();
    const { sql } = fakeSql();
    const failingDumper: Dumper = {
      dump: async () => err({ code: "BACKUP_JOB_FAILURE", detail: "pg_dump غير متاح" } as never),
    };
    const config: BackupConfig = { databaseUrl: "postgres://test", retentionCount: 14 };

    const result = await runDatabaseBackup(
      config,
      {
        storage: fake.storage,
        sql,
        clock: fixedClock,
      },
      failingDumper,
    );

    expect(result.ok).toBe(false);
    expect(fake.uploads.length).toBe(0);
  });

  it("يفشل عند فشل الرفع ولا يسجّل نسخة", async () => {
    const sqlWrap = fakeSql();
    // استبدل upload بالفشل
    const failingStorage: BackupStoragePort = {
      upload: async () =>
        err(
          new (class implements BackupStorageError {
            readonly code = "BACKUP_STORAGE_FAILURE" as const;
            port = "drive.upload";
            detail = "401 unauthorized";
          })() as unknown as BackupStorageError,
        ) as unknown as Result<BackupUploadResult, BackupStorageError>,
      list: async () => ok([]),
      delete: async () => ok(undefined),
    };
    const config: BackupConfig = { databaseUrl: "postgres://test", retentionCount: 14 };

    const result = await runDatabaseBackup(
      config,
      {
        storage: failingStorage,
        sql: sqlWrap.sql,
        clock: fixedClock,
      },
      fakeDumper(),
    );

    expect(result.ok).toBe(false);
    expect(sqlWrap.count()).toBe(0);
  });
});

describe("backup-database: gzip", () => {
  it("يضغط بيانات غير فارغة", async () => {
    const data = new TextEncoder().encode("test ".repeat(100));
    const compressed = await gzip(data);
    expect(compressed.byteLength).toBeGreaterThan(0);
    // بفكّ الضغط نسترجع الأصل
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
    const restored = await new Response(stream).text();
    expect(restored).toBe("test ".repeat(100));
  });
});

describe("backup-database: createPgDumper", () => {
  it("موجود كمنفذ حقيقي", () => {
    const dumper = createPgDumper();
    expect(typeof dumper.dump).toBe("function");
  });
});
