/**
 * الغرض: إثبات تكامل مسار النسخ والاستعادة: أرشيف PostgreSQL التالف لا يوسم
 *   ناجحاً، والأرشيف السليم يستعاد في قاعدة مستقلة وتثبت بصمته ثم يوسم متحققاً.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL وأدوات PostgreSQL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI وبوابة إثبات قابلية النسخ للاستعادة.
 *
 * ## لماذا قاعدةُ مصدرٍ خاصّةٌ بهذا الاختبار
 *
 * كان الاختبار يُصوّر قاعدةَ الاختبار المشتركة نفسها. و`pg_dump` يأخذ قفلَ
 * `ACCESS SHARE` على كلّ جدول، وكلُّ اختبارِ تكاملٍ آخر يبدأ بـ`truncate` الذي
 * يطلب `ACCESS EXCLUSIVE`. فحين تعمل المجموعةُ كاملةً تتشابك الطلباتُ في طابور
 * واحد: التصويرُ ينتظر اقتطاعاً، والاقتطاعاتُ التالية تنتظر التصوير — فتنتهي
 * مهلةُ التسعين ثانية. والاختبارُ ينجح وحده في ثانيتَين، أي أنّ الإخفاق كان في
 * تزامنِ الاختبارات لا في المنتج، وهو أسوأُ نوعٍ من الإخفاق: ضجيجٌ يُدرَّب
 * القارئُ على تجاهله حتى يُخفي عيباً حقيقياً يوماً.
 *
 * فالاختبارُ الآن يبني قاعدةَ مصدرٍ خاصّةً به بترحيلات المستودع نفسها (أقلّ من
 * ثانيتَين)، ويُصوّرها، ويحفظ سجلَّ النسخة فيها، ويحذفها بعده. لا قفلَ مشتركاً،
 * ولا اعتمادَ على ترتيبِ التشغيل، والبرهانُ كما هو: بنيةٌ حقيقيةٌ بسياساتها ودوالّها.
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
const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url).pathname;

let sql: Sql;
let cityId = "";
let directory = "";
let adminSql: Sql;
let sourceUrl = "";
let sourceDatabase = "";

/** يبدّل اسمَ القاعدة في الرابط ويُبقي بقيّته كما هي. */
function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * المخرجُ الأوّل يُهمَل والخطأُ يُستهلَك كاملاً قبل الانتظار: أنبوبٌ لا يقرؤه أحدٌ
 * يبقى مفتوحاً، فيُبلّغ مشغّلُ الاختبارات عن «عمليّةٍ معلّقة» ويقتلها، فتُخفق
 * خطّافاتُ ملفٍّ لا علاقةَ له بها. هذا ما يجعل إخفاقاً واحداً يبدو ستّة.
 */
async function psql(args: readonly string[]): Promise<void> {
  const proc = Bun.spawn(["psql", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", ...args], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`psql فشل (${code}): ${stderr.slice(-600)}`);
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  adminSql = createSql({ connectionString: DATABASE_URL, max: 1 });
  /**
   * الاسمُ ثابتٌ والحذفُ في البداية لا في النهاية: حذفُ قاعدةٍ في خطّافِ التنظيف
   * تحت حملِ المجموعة كاملةً كان يتجاوز الدقيقة فيُسقط ملفّاً نجحت اختباراتُه
   * كلُّها. والحذفُ أوّلاً يمنع البناءَ على أثرِ تشغيلٍ سابق، وهو الغرضُ الحقيقيّ.
   */
  sourceDatabase = "waslah_backup_source_probe";
  await adminSql.unsafe(`drop database if exists ${sourceDatabase} with (force)`);
  await adminSql.unsafe(`create database ${sourceDatabase}`);
  sourceUrl = withDatabase(DATABASE_URL, sourceDatabase);

  // الترحيلاتُ نفسها بترتيبها: البنيةُ المُصوَّرة هي بنيةُ الإنتاج لا نموذجٌ مصغّر،
  // وإلّا لأثبت الاختبارُ استعادةَ شيءٍ لا نُشغّله.
  const glob = new Bun.Glob("*.sql");
  const files = [...glob.scanSync({ cwd: MIGRATIONS })].sort();
  if (files.length === 0) throw new Error("لا ترحيلات لبناء قاعدة المصدر");
  for (const file of files) {
    await psql(["-q", "-d", sourceUrl, "-f", join(MIGRATIONS, file)]);
  }

  sql = createSql({ connectionString: sourceUrl });
  const [city] = await sql<{ id: string }[]>`select id from cities order by code limit 1`;
  if (city === undefined) throw new Error("لا مدينة متاحة لاختبار تحقق الاستعادة");
  cityId = city.id;
  directory = join(tmpdir(), `waslah-backup-restore-test-${crypto.randomUUID()}`);
  await mkdir(directory, { recursive: true });
  // مهلةُ الخطّاف صريحةٌ: افتراضُ الخمسِ ثوانٍ يكفي وحده ولا يكفي تحت حملِ
  // المجموعة كاملةً، فيُخفق بناءُ القاعدة لا المنتج — وهو إخفاقٌ يُدرَّب القارئُ
  // على تجاهله.
}, 120_000);

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  // الاتّصالُ يُغلق قبل الحذف: قاعدةٌ ذاتُ اتّصالٍ مفتوحٍ لا تُحذف، وتبقى أثراً
  // يتراكم في العنقود بعد كلّ تشغيل.
  // الحمايةُ من `undefined` مقصودة: إن أخفق الخطّافُ الأوّل فالتنظيفُ يجب أن
  // يحذف القاعدةَ لا أن يُخفق هو أيضاً ويُخفي السببَ الأوّل.
  await sql?.end({ timeout: 5 });
  await adminSql?.end({ timeout: 5 });
  if (directory !== "") await rm(directory, { recursive: true, force: true });
}, 60_000);

async function prepareBackup(corrupt: boolean): Promise<{
  readonly runId: string;
  readonly storage: ReturnType<typeof createLocalBackupStorage>;
}> {
  const dumper = createPgDumper();
  const [archive, roles] = await Promise.all([
    dumper.dump(sourceUrl),
    dumper.dumpGlobals?.(sourceUrl),
  ]);
  if (!archive.ok || roles === undefined || !roles.ok) {
    /**
     * تفصيلُ الخطأ يُرفَع في الرسالة لا يُطرَح: الرسالةُ المجرّدة أخفت على آلةِ
     * التكامل سببَ إخفاقٍ لم يظهر محلّياً قطّ — و`BackupJobError.detail` يحمل
     * `stderr` الحقيقيّ من `pg_dump`/`pg_dumpall` ورمزَ خروجهما. وطمسُه يُحوّل
     * عيباً واحداً معروفَ السببِ إلى تخمينٍ يتكرّر كلَّ دفعة.
     */
    const why = [
      archive.ok ? null : `الأرشيف: ${archive.error.detail}`,
      roles === undefined ? "الأدوار: المنفذ لا يوفّر dumpGlobals" : null,
      roles !== undefined && !roles.ok ? `الأدوار: ${roles.error.detail}` : null,
    ]
      .filter((line): line is string => line !== null)
      .join(" | ");
    throw new Error(`تعذر إنشاء أثر النسخة لاختبار التكامل — ${why}`);
  }
  const storage = createLocalBackupStorage({ directory });
  const runId = crypto.randomUUID();
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
        databaseUrl: sourceUrl,
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
        databaseUrl: sourceUrl,
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
