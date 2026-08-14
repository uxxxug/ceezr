/**
 * الغرض: إثبات أنّ عقد المخطّط يُقاس على قاعدةٍ حقيقية: القاعدةُ المُرحَّلة كاملةً
 *   تجتاز، والقاعدةُ المتأخّرةُ ترحيلاتٍ تُسمّي ما ينقصها بالاسم.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL وأدوات PostgreSQL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI وحمايةُ فحص /ready من أن يكذب.
 *
 * ## الفجوة التي يحرسها هذا الاختبار
 *
 * قاعدةُ الإنتاج كانت متأخّرةً سبعَ عشرةَ ترحيلةً عن المستودع: الاتّصالُ ناجح،
 * و`select 1` ناجح، و`/ready` يجيب «جاهز» — وجداولُ البثّ وإشعاراتُ الاشتراك
 * غيرُ موجودةٍ أصلاً. أي أنّ العطلَ كان سيظهر أوّلَ ما يضغط سائقٌ زرّاً، لا في
 * المراقبة. فالاختبارُ يُثبت أنّ الفحصَ الجديد يكشف هذه الحالةَ بعينها: قاعدةٌ
 * موصولةٌ سليمةُ الاتّصال، ناقصةُ المخطّط.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  CONTRACT_FUNCTIONS,
  CONTRACT_TABLES,
} from "../../packages/infrastructure/db/schema-contract.ts";
import { verifySchemaContract } from "../../packages/infrastructure/db/schema-guard.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url).pathname;

let sql: Sql;
let partialSql: Sql;
let partialDatabase = "";

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
  sql = createSql({ connectionString: DATABASE_URL });
  /**
   * الاسمُ ثابتٌ والحذفُ في البداية لا في النهاية. جرّبنا العكس: حذفٌ في خطّافِ
   * التنظيف تحت حملِ المجموعة كاملةً كان يتجاوز الدقيقة ويُسقط الملفَّ بعد نجاح
   * اختباراته كلِّها — إخفاقُ تنظيفٍ يُقرأ إخفاقَ منتج. والحذفُ في البداية يُنجِز
   * الغرضَ نفسه: لا تشغيلَ يبني على أثرِ تشغيلٍ سابق، والأثرُ الباقي قاعدةٌ صغيرةٌ
   * واحدةٌ تُدهَس في الشوط التالي.
   */
  partialDatabase = "waslah_schema_contract_probe";
  await sql.unsafe(`drop database if exists ${partialDatabase} with (force)`);
  await sql.unsafe(`create database ${partialDatabase}`);

  /**
   * قاعدةٌ متأخّرة: الترحيلاتُ الأولى فقط. هذه هي حالُ الإنتاج قبل اللحاق —
   * جداولُ الأساس موجودة، وما بُني بعدها غائب. والاكتفاءُ بالأوائل مقصود: تطبيقُ
   * نصفِ الترحيلات كان يُثقل القاعدةَ المشتركة حتى تُخفق خطّافاتُ ملفّاتٍ أخرى،
   * فيصير الاختبارُ سبباً في ضجيجٍ لا دليلاً على شيء.
   */
  const glob = new Bun.Glob("*.sql");
  const files = [...glob.scanSync({ cwd: MIGRATIONS })].sort();
  const partialUrl = withDatabase(DATABASE_URL, partialDatabase);
  for (const file of files.slice(0, 3)) {
    await psql(["-q", "-d", partialUrl, "-f", join(MIGRATIONS, file)]);
  }
  partialSql = createSql({ connectionString: partialUrl });
}, 120_000);

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await partialSql?.end({ timeout: 5 });
  await sql?.end({ timeout: 5 });
}, 60_000);

describeIf("عقد المخطّط على قاعدة حقيقية", () => {
  it("القاعدة المرحّلة كاملةً تحتوي كل ما يناديه الكود", async () => {
    const report = await verifySchemaContract(sql);
    expect(report.missingFunctions).toEqual([]);
    expect(report.missingTables).toEqual([]);
    expect(report.complete).toBe(true);
  });

  it("العقد ليس فارغاً: قائمةٌ فارغةٌ تجتاز كلَّ قاعدةٍ ولا تحرس شيئاً", () => {
    expect(CONTRACT_FUNCTIONS.length).toBeGreaterThan(50);
    expect(CONTRACT_TABLES.length).toBeGreaterThan(15);
  });

  it("القاعدة المتأخّرة ترحيلاتٍ تُرفض ويُسمّى ناقصها", async () => {
    // الاتّصالُ سليم: الفحصُ القديم (`select 1`) كان سيقول «جاهز» على هذه القاعدة.
    const [alive] = await partialSql<{ ok: number }[]>`select 1 as ok`;
    expect(alive?.ok).toBe(1);

    const report = await verifySchemaContract(partialSql);
    expect(report.complete).toBe(false);
    const missing = [...report.missingFunctions, ...report.missingTables];
    expect(missing.length).toBeGreaterThan(0);
    // الأسماءُ حقيقيّةٌ من العقد لا نصٌّ عام: التفصيلُ هو ما يُصلَح به العطل.
    for (const name of missing) {
      expect([...CONTRACT_FUNCTIONS, ...CONTRACT_TABLES]).toContain(name);
    }
  });
});
