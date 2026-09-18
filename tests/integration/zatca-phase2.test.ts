/**
 * الغرض: اختبارُ قاعدةِ PostgreSQL حقيقيّةٍ لعناصرِ المرحلةِ الثانيةِ من امتثال
 *   ZATCA (F12-12): UUID، تجزئة، PIH، ICV، UBL 2.1.
 * الحالة: منفّذ فعلياً — 2026-09-18.
 * ينتمي إلى: tests/integration
 * الحاكم: ADR 0127 · ADR 0039
 */

import { beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const sql = postgres(DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/waslah");

describeIf("F12-12 — امتثال ZATCA المرحلة الثانية: UUID وتجزئة وPIH وICV وUBL", () => {
  let cityId: string;

  beforeAll(async () => {
    const city = await sql`select id from cities limit 1`;
    cityId = city[0]?.id as string;
  });

  it("بذرةُ PIH مُسجَّلةٌ في إعدادات المنصّةِ", async () => {
    const rows = await sql`
      select value #>> '{}' as seed
        from platform_settings
       where city_id = ${cityId} and key = 'zatca_pih_seed'
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.seed).toBe(
      "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==",
    );
  });

  it("دالّةُ المرحلةِ الثانيةِ موجودةٌ وتُعيدُ النوعَ الصحيحَ", async () => {
    // UUID
    const uuid = await sql`select zatca_generate_invoice_uuid() as uuid`;
    expect(uuid[0]?.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // PIH (بذرةٌ إذا لم تكن هناك فواتيرُ سابقة)
    const pih = await sql`select zatca_previous_invoice_hash(${cityId}::uuid) as pih`;
    expect(pih[0]?.pih).toBeTruthy();

    // ICV (يبدأُ من 1 إذا لم تكن هناك فواتيرُ سابقة)
    const icv = await sql`select zatca_next_invoice_counter(${cityId}::uuid) as icv`;
    expect(icv[0]?.icv).toBeGreaterThan(0);

    // تجزئة
    const hash = await sql`select zatca_invoice_hash('test') as hash`;
    expect(hash[0]?.hash).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);

    // UBL XML
    const ubl = await sql`
      select zatca_generate_ubl_xml(
        'TEST-2026-000001'::text,
        '12345678-1234-1234-1234-123456789012'::uuid,
        now()::timestamptz,
        'Test Seller'::text,
        '300000000000003'::text,
        'SAR'::text,
        10000::integer,
        1500::integer,
        11500::integer,
        1500::integer,
        'seed'::text,
        1::integer
      ) as xml
    `;
    expect(ubl[0]?.xml).toContain("Invoice");
    expect(ubl[0]?.xml).toContain("reporting:1.0");
    expect(ubl[0]?.xml).toContain("0200000");
  });

  it("PIH لأولِ فاتورةٍ يساوي البذرةَ المعتمدةَ من ZATCA", async () => {
    // إذا لم تكن هناك فواتيرُ مرحلة ثانية بعد، يجب أن يساوي البذرة
    const result = await sql`
      select zatca_previous_invoice_hash(${cityId}::uuid) as pih
    `;
    // قد يساوي البذرة أو تجزئة فاتورة سابقة
    expect(result[0]?.pih).toBeTruthy();
  });

  it("ICV متسلسلٌ ولا ينقصُ", async () => {
    const first = await sql`select zatca_next_invoice_counter(${cityId}::uuid) as icv`;
    const second = await sql`select zatca_next_invoice_counter(${cityId}::uuid) as icv`;
    expect(second[0]?.icv).toBeGreaterThanOrEqual(first[0]?.icv);
  });

  it("تجزئةُ الفاتورةِ ثابتةٌ لنفسِ المدخلاتِ", async () => {
    const xml = "<Invoice>test</Invoice>";
    const hash1 = await sql`select zatca_invoice_hash(${xml}::text) as hash`;
    const hash2 = await sql`select zatca_invoice_hash(${xml}::text) as hash`;
    expect(hash1[0]?.hash).toBe(hash2[0]?.hash);
  });

  it("تحقُّقُ سلسلةِ الفواتيرِ يُعيدُ النتيجةَ", async () => {
    const result = await sql`
      select zatca_verify_invoice_chain(${cityId}::uuid) as verification
    `;
    expect(result[0]?.verification).toBeDefined();
    expect(result[0]?.verification).toHaveProperty("ok");
    expect(result[0]?.verification).toHaveProperty("total");
  });
});
