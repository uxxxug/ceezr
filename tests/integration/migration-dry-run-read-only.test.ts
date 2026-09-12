/**
 * الغرض: قياسُ الثابتِ الحاكمِ في `W-8` على PostgreSQL **حقيقيٍّ** لا مزدوجٍ:
 *   أنَّ التشغيلَ الجافَّ **لا يستطيعُ** الكتابةَ. والقياسُ لا الوعدُ:
 *
 *   ١. تُعَدُّ الصفوفُ قبلَ التشغيلِ الجافِّ.
 *   ٢. يُشغَّلُ التشغيلُ الجافُّ كاملاً على الجداولِ الموجودةِ فعلاً.
 *   ٣. **تُحاوَلُ كتابةٌ داخلَ الجلسةِ عينِها** ويُثبَتُ أنَّها تُخفِقُ بالرمزِ
 *      `25006` — فالمنعُ خاصّةُ المحرِّكِ لا انتباهُ الكاتبِ.
 *   ٤. تُعَدُّ الصفوفُ بعدَه ويُثبَتُ أنَّها لم تتغيَّرْ.
 *
 *   والفحصُ الثالثُ هوَ الذي يجعلُ البندَ مَقيساً لا مُدَّعىً: اختبارٌ يقولُ «لم
 *   يتغيَّرِ العددُ» يمرُّ كذلكَ لو كانَ التشغيلُ الجافُّ لا يفعلُ شيئاً أصلاً.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: `W-9` قبلَ تمرينِ التحوُّلِ، وكلُّ تعديلٍ على
 *   `scripts/wasla-migration-dry-run.ts`.
 * ملاحظات مستقبلية: الجداولُ الغائبةُ عن القاعدةِ المُمرَّرةِ **تُعلَنُ ولا
 *   تُسكَتُ**: الاختبارُ يفشلُ إن لم يُوجَدْ أيُّ جدولٍ من المسابرِ، لأنَّ قاعدةً
 *   بلا مخطَّطٍ لا تقيسُ شيئاً وتمريرُها خضراءَ كذبٌ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  buildProbeStatement,
  DRY_RUN_BEGIN,
  DRY_RUN_PROBES,
  READ_ONLY_SQLSTATE,
} from "../../scripts/lib/wasla-migration-dry-run.ts";
import {
  NO_CORE_READER,
  type ProbeReport,
  type ReservableClient,
  reconcile,
  renderReport,
  runProbes,
} from "../../scripts/wasla-migration-dry-run.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

let sql: Sql;
let present: typeof DRY_RUN_PROBES;
let countsBefore: Map<string, number>;
let reports: readonly ProbeReport[];

async function countAll(tables: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const table of tables) {
    const rows = (await sql.unsafe(`SELECT count(*)::bigint AS n FROM "${table}"`)) as unknown as {
      n: string;
    }[];
    counts.set(table, Number(rows[0]?.n ?? 0));
  }
  return counts;
}

describeIf("W-8 — التشغيلُ الجافُّ لا يستطيعُ الكتابةَ (PostgreSQL حقيقيّ)", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const existing = (await sql`
      select table_name from information_schema.tables where table_schema = 'public'
    `) as unknown as { table_name: string }[];
    const names = new Set(existing.map((row) => row.table_name));
    present = DRY_RUN_PROBES.filter((probe) => names.has(probe.table));
    countsBefore = await countAll(present.map((probe) => probe.table));
    reports = await runProbes(sql as unknown as ReservableClient, present);
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("يقيسُ جداولَ موجودةً فعلاً — وقاعدةٌ بلا مخطَّطٍ تُفشِلُ الاختبارَ لا تُمرِّرُه", () => {
    expect(present.length).toBeGreaterThan(0);
    expect(reports.length).toBe(present.length);
  });

  it("وكلُّ مِسبارٍ يُخرِجُ عدداً حقيقيّاً بجملةِ قراءةٍ", () => {
    for (const report of reports) {
      expect(
        buildProbeStatement(DRY_RUN_PROBES.find((probe) => probe.table === report.table) as never),
      ).toBe(report.statement);
      expect(report.statement.startsWith("SELECT ")).toBe(true);
      expect(report.totalRows).toBeGreaterThanOrEqual(0);
      expect(report.totalRows).toBe(report.groups.reduce((sum, group) => sum + group.rows, 0));
    }
  });

  it("**والكتابةُ داخلَ جلسةِ التشغيلِ الجافِّ تُخفِقُ بالرمزِ 25006** — منعُ المحرِّكِ لا وعدُ الشيفرةِ", async () => {
    const table = present[0]?.table;
    expect(table).toBeDefined();
    const reserved = await sql.reserve();
    await reserved.unsafe(DRY_RUN_BEGIN);
    let code: string | undefined;
    try {
      await reserved.unsafe(`DELETE FROM "${table}" WHERE false`);
    } catch (error) {
      code = (error as { code?: string }).code;
    } finally {
      await reserved.unsafe("ROLLBACK");
      reserved.release();
    }
    expect(code).toBe(READ_ONLY_SQLSTATE);
  });

  it("ولا صفَّ تغيَّرَ بعدَ التشغيلِ الجافِّ كاملاً", async () => {
    const countsAfter = await countAll(present.map((probe) => probe.table));
    for (const [table, before] of countsBefore) {
      expect(countsAfter.get(table)).toBe(before);
    }
  });

  it("والتسويةُ تُخرِجُ `UNVERIFIABLE` لكلِّ جدولٍ ما دامَ `DEP-CORE-007` مفتوحاً — لا صفراً يُقرَأُ تطابقاً", async () => {
    const records = await reconcile(reports, NO_CORE_READER);
    expect(records.length).toBe(reports.length);
    for (const record of records) {
      expect(record.status).toBe("UNVERIFIABLE");
      expect(record.coreRows).toBeUndefined();
    }
  });

  it("والتقريرُ يُصيَّرُ نصّاً يُقرأُ في مراجعةٍ، وفيهِ شرطُ الدخولِ", async () => {
    const records = await reconcile(reports, NO_CORE_READER);
    const rendered = renderReport(1, reports, records);
    expect(rendered).toContain("شرطُ الدخولِ المُعلَنُ");
    expect(rendered).toContain("UNVERIFIABLE");
    expect(rendered).toContain("BEGIN TRANSACTION READ ONLY");
    for (const report of reports) expect(rendered).toContain(`\`${report.table}\``);
  });
});
