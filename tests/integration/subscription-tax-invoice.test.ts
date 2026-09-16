/**
 * الغرض: قياسُ فاتورةِ الاشتراكِ الضريبيّةِ على PostgreSQL حقيقيٍّ (`F3-09` · `SD-08`):
 *   رقمٌ واحدٌ لتوريدٍ واحدٍ ولو نُودِيَ مِراراً ومتوازياً، وضريبةٌ **مُستخرَجةٌ من
 *   مبلغٍ شاملٍ** لا مضافةٌ عليه، وصفٌّ **لا يُعدَّلُ ولا يُحذَفُ** بحاجزٍ في القاعدةِ
 *   لا بأدبٍ في الكودِ، ورمزُ استجابةٍ يُفكِّكُه **عرّافٌ مستقلٌّ**، وغيابُ هُويّةٍ
 *   ضريبيّةٍ **رفضٌ مُسمّىً** لا رقمٌ مُختَرَعٌ.
 * الحالة: مُختبَرٌ على قاعدةٍ حقيقيّةٍ — البند `F3-09`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: `bun run test:integration` وخطوةُ «تكامل على PostgreSQL حقيقي» في CI.
 * يُتوقع أن يستخدمه لاحقاً: سطحُ الفاتورةِ في التطبيقِ المُصغَّرِ (الدفعةُ الثانيةُ).
 * يحرسُه: scripts/check-tax-invoice-contract.ts
 * الحاكم: docs/adr/0127-simplified-tax-invoice.md
 *
 * ولِمَ على قاعدةٍ حقيقيّةٍ لا بمُهايِئٍ: كلُّ ما يُدَّعى ههنا **حكمُ مُحرِّكٍ** لا
 * حكمُ لغةٍ: التسلسلُ، والقيدُ الفريدُ، وحاجزُ التعديلِ، و`for update`، وحسابُ
 * `numeric`. ومُهايِئٌ مصنوعٌ يُرجِعُ ما كُتِبَ فيه فيقيسُ كاتبَه.
 *
 * ## وما لا يقيسُه هذا المِلفُّ عن قصدٍ — (`ح-5`)
 *
 * - **لا يدَّعي امتثالاً للمرحلةِ الثانيةِ** من الفوترةِ الإلكترونيّةِ: لا ختمَ
 *   تشفيرٍ، ولا `CSID`، ولا إبلاغَ خلالَ أربعٍ وعشرينَ ساعةً، ولا `UBL 2.1`.
 *   المقيسُ: صفٌّ ثابتٌ ورمزُ استجابةٍ بحقولِه الخمسةِ.
 * - **لا يقيسُ شاشةً**: المُحوِّلاتُ والمساراتُ في `tests/unit`.
 * - **لا يقيسُ مزوّدَ دفعٍ**: المعاملةُ تُزرَعُ صفّاً، فلا شبكةَ ولا مِحفظةَ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { decodeTlv, SIMPLIFIED_INVOICE_TAGS, tlvValue } from "../support/zatca-tlv.ts";

/**
 * تتابعٌ صناعيٌّ للإدراجِ المباشرِ في سنةٍ (`2999`) **لا تُصدَرُ فيها فاتورةٌ
 * حقيقيّةٌ**: فلو رُفِضَ صفٌّ لعلّةٍ غيرِ العلّةِ المقيسةِ (تكرارُ تتابعٍ مثلاً)
 * لَقالَ الاختبارُ «نجحَ» بدليلٍ كاذبٍ. فرقمٌ فريدٌ لكلِّ إدراجٍ.
 */
let directSequenceCounter = 900_000;
function nextDirectSequence(): number {
  directSequenceCounter += 1;
  return directSequenceCounter;
}

/**
 * يردُّ نصَّ الخطأِ الذي ردَّتْ بهِ القاعدةُ، أو يرمي إن قبِلَت ما كانَ يجبُ أن
 * تَرُدَّه. **ولا يُستعمَلُ `expect(…).rejects` على استعلامٍ ههنا**: كائنُ استعلامِ
 * `postgres.js` مُرجَأٌ لا وعدٌ منطلقٌ، ومطالبتُه بالإنجازِ من مُطابِقٍ لا يُنادي
 * `then` تُعلِّقُ المجرى بلا حدٍّ — **وقد علَّقَت وظيفةَ CI ساعةً في `F3-07` بلا
 * سطرِ فشلٍ واحدٍ** (`ADR 0122`)، وحاجزُ `check-lazy-query-assertion` يمنعُ عودَها.
 * والتعليقُ الصامتُ أسوأُ من الأحمرِ: الأحمرُ يقولُ أينَ.
 */
async function rejectionOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("القاعدةُ قبِلَت ما كانَ يجبُ أن تَرُدَّه");
}

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

const DRIVER_TELEGRAM_ID = 900_000_381;
const STRANGER_TELEGRAM_ID = 900_000_382;
const ABSENT_TELEGRAM_ID = 900_000_383;

const KEY_SELLER_NAME = "tax_seller_name";
const KEY_SELLER_VAT = "tax_seller_vat_number";
const KEY_VAT_RATE = "vat_rate_bps";

const SELLER_NAME = "شركةُ سِيزر للتقنيّةِ";
const SELLER_VAT = "300000000000003";

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let driverUserId = "";
let driverId = "";
let strangerUserId = "";

interface Payload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly [key: string]: unknown;
}

async function callJson(query: Promise<{ result: Payload }[]>): Promise<Payload> {
  const [row] = await query;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

function issue(telegramId: number, transactionId: string): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select issue_subscription_tax_invoice(${telegramId}::bigint, ${transactionId}::uuid) as result
  `);
}

function readInvoice(telegramId: number, transactionId: string): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select driver_subscription_tax_invoice(${telegramId}::bigint, ${transactionId}::uuid) as result
  `);
}

function readStatus(telegramId: number, transactionId: string): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select driver_subscription_payment_status(${telegramId}::bigint, ${transactionId}::uuid) as result
  `);
}

function invoiceOf(payload: Payload): Record<string, unknown> {
  const value = payload.invoice;
  if (value === null || typeof value !== "object") {
    throw new Error(`لا فاتورةَ في الجوابِ: ${JSON.stringify(payload)}`);
  }
  return value as Record<string, unknown>;
}

async function setSetting(
  key: string,
  value: string | number | null,
  valueType: "string" | "number",
): Promise<void> {
  if (value === null) {
    await sql`delete from platform_settings where city_id = ${cityId} and key = ${key}`;
    return;
  }
  const json =
    valueType === "number"
      ? sql`to_jsonb(${Number(value)}::numeric)`
      : sql`to_jsonb(${String(value)}::text)`;
  await sql`
    insert into platform_settings (city_id, key, value, value_type, description_ar)
    values (${cityId}, ${key}, ${json}, ${valueType}, 'قياسٌ')
    on conflict (city_id, key) do update set value = ${json}, value_type = ${valueType}
  `;
}

interface SettingSnapshot {
  readonly key: string;
  readonly text: string | null;
  readonly valueType: "string" | "number" | null;
}

const snapshots = new Map<string, SettingSnapshot>();

async function readSetting(key: string): Promise<SettingSnapshot> {
  const [row] = await sql<{ text: string; value_type: string }[]>`
    select value #>> '{}' as text, value_type
      from platform_settings
     where city_id = ${cityId} and key = ${key}
  `;
  if (row === undefined) return { key, text: null, valueType: null };
  if (row.value_type !== "string" && row.value_type !== "number") {
    throw new Error(`نوعٌ لا يُرجِعُه هذا الملفُّ: ${key}=${row.value_type}`);
  }
  return { key, text: row.text, valueType: row.value_type };
}

async function snapshotSetting(key: string): Promise<SettingSnapshot> {
  const existing = snapshots.get(key);
  if (existing !== undefined) return existing;
  const snapshot = await readSetting(key);
  snapshots.set(key, snapshot);
  return snapshot;
}

async function restoreSetting(snapshot: SettingSnapshot): Promise<void> {
  if (snapshot.valueType === null || snapshot.text === null) {
    await setSetting(snapshot.key, null, "string");
    return;
  }
  const value = snapshot.valueType === "number" ? Number(snapshot.text) : snapshot.text;
  await setSetting(snapshot.key, value, snapshot.valueType);
}

/** يُبدَّلُ إعدادٌ لفحصٍ واحدٍ ثمَّ يُرجَعُ **كما وُجِدَ لحظةَ النداءِ**. */
async function withSetting<T>(
  key: string,
  value: string | number | null,
  valueType: "string" | "number",
  body: () => Promise<T>,
): Promise<T> {
  const before = await readSetting(key);
  await setSetting(key, value, valueType);
  try {
    return await body();
  } finally {
    await restoreSetting(before);
  }
}

let seedCounter = 0;
/** بذرةٌ عشوائيّةٌ لكلِّ تشغيلٍ: مُعرِّفُ مزوّدٍ مُكرَّرٌ من تشغيلٍ سقطَ لا يُسقِطُ التالي. */
const RUN_TAG = crypto.randomUUID().slice(0, 8);

async function seedTransaction(options: {
  readonly amountMinor: number;
  readonly status: string;
}): Promise<string> {
  seedCounter += 1;
  const [row] = await sql<{ id: string }[]>`
    insert into payment_transactions (
      city_id, payer_driver_id, payee_id, purpose,
      amount_minor, currency, provider, provider_transaction_id,
      status, idempotency_key, metadata
    ) values (
      ${cityId}, ${driverId}, 'platform', 'driver_subscription',
      ${options.amountMinor}, 'SAR', 'manual', ${`chg_secret_${RUN_TAG}_${seedCounter}`},
      ${options.status}::text, ${`f3-09:${driverId}:${RUN_TAG}:${seedCounter}`},
      ${sql.json({ plan: "transport", checkout_url: null })}
    ) returning id
  `;
  if (row === undefined) throw new Error("تعذّر زرعُ معاملةِ الدفعِ");
  return row.id;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [user] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائقُ الفاتورةِ', '+966500000481')
    returning id
  `;
  if (user === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = user.id;

  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ف ت ر 481')
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;

  const [stranger] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${STRANGER_TELEGRAM_ID}, 'rider', 'راكبٌ غريبٌ', '+966500000482')
    returning id
  `;
  if (stranger === undefined) throw new Error("تعذّر زرعُ الغريبِ");
  strangerUserId = stranger.id;

  // هُويّةُ البائعِ **تُزرَعُ ههنا لا في الهجرةِ**: رقمٌ ضريبيٌّ مُختَرَعٌ في هجرةٍ
  // يصيرُ رقماً حقيقيّاً على فاتورةٍ حقيقيّةٍ في الإنتاجِ. فالهجرةُ تتركُ الغيابَ
  // غياباً، والقياسُ يزرعُ ما يقيسُ بهِ ويُرجِعُه.
  await snapshotSetting(KEY_SELLER_NAME);
  await snapshotSetting(KEY_SELLER_VAT);
  await snapshotSetting(KEY_VAT_RATE);
  await setSetting(KEY_SELLER_NAME, SELLER_NAME, "string");
  await setSetting(KEY_SELLER_VAT, SELLER_VAT, "string");
  await setSetting(KEY_VAT_RATE, 1500, "number");
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (driverId !== "") {
    // **تفريغٌ لا حذفٌ**: زنادُ الثباتِ يمنعُ `delete` على صفِّ فاتورةٍ (وذاكَ
    // مقيسٌ في الاختبارِ ١٨)، و`truncate` لا يُشغِّلُ زنادَ صفٍّ. وهيَ سابقةٌ
    // قائمةٌ في `tests/integration/subscription-notices.test.ts`.
    await sql`truncate table subscription_invoices`;
    await sql`delete from payment_transactions where payer_driver_id = ${driverId}`;
    await sql`delete from subscriptions where driver_id = ${driverId}`;
    await sql`delete from drivers where id = ${driverId}`;
  }
  if (strangerUserId !== "") await sql`delete from users where id = ${strangerUserId}`;
  if (driverUserId !== "") await sql`delete from users where id = ${driverUserId}`;
  for (const snapshot of snapshots.values()) await restoreSetting(snapshot);
  snapshots.clear();
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("المِلكيّةُ — فاتورةُ غيرِه لا تُوجَدُ عندَه", () => {
  it("١) حسابٌ لا صفَّ له ⇒ `USER_NOT_FOUND` في الثلاثِ", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    expect(await issue(ABSENT_TELEGRAM_ID, transactionId)).toEqual({
      ok: false,
      error: "USER_NOT_FOUND",
    });
    expect(await readInvoice(ABSENT_TELEGRAM_ID, transactionId)).toEqual({
      ok: false,
      error: "USER_NOT_FOUND",
    });
    expect(await readStatus(ABSENT_TELEGRAM_ID, transactionId)).toEqual({
      ok: false,
      error: "USER_NOT_FOUND",
    });
  });

  it("٢) حسابٌ ليسَ سائقاً ⇒ `NOT_A_DRIVER`", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    expect(await issue(STRANGER_TELEGRAM_ID, transactionId)).toEqual({
      ok: false,
      error: "NOT_A_DRIVER",
    });
  });

  it("٣) معرِّفٌ لا معاملةَ له ⇒ `TRANSACTION_NOT_FOUND` لا لوحٌ فارغٌ", async () => {
    expect(await issue(DRIVER_TELEGRAM_ID, "00000000-0000-4000-8000-000000000000")).toEqual({
      ok: false,
      error: "TRANSACTION_NOT_FOUND",
    });
  });
});

describeIf("شرطُ الإصدارِ — لا فاتورةَ لِما لم يُدفَعْ", () => {
  it.each(["pending", "failed", "canceled", "expired", "past_due"] as const)(
    "٤) حالُ «%s» ⇒ `TRANSACTION_NOT_PAID` ولا صفَّ يُكتَبُ",
    async (status) => {
      const transactionId = await seedTransaction({ amountMinor: 25_000, status });
      expect(await issue(DRIVER_TELEGRAM_ID, transactionId)).toEqual({
        ok: false,
        error: "TRANSACTION_NOT_PAID",
      });
      const [row] = await sql<{ count: string }[]>`
        select count(*)::text as count from subscription_invoices where payment_transaction_id = ${transactionId}
      `;
      expect(row?.count).toBe("0");
    },
  );

  it("٥) قراءةٌ قبلَ إصدارٍ ⇒ `INVOICE_NOT_ISSUED` لا فاتورةٌ مُشتقّةٌ", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    expect(await readInvoice(DRIVER_TELEGRAM_ID, transactionId)).toEqual({
      ok: false,
      error: "INVOICE_NOT_ISSUED",
    });
  });
});

describeIf("هُويّةٌ ضريبيّةٌ غائبةٌ — رفضٌ مُسمّىً لا رقمٌ مُختَرَعٌ", () => {
  it("٦) بلا اسمِ بائعٍ ⇒ `TAX_IDENTITY_NOT_CONFIGURED`", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    await withSetting(KEY_SELLER_NAME, null, "string", async () => {
      expect(await issue(DRIVER_TELEGRAM_ID, transactionId)).toEqual({
        ok: false,
        error: "TAX_IDENTITY_NOT_CONFIGURED",
      });
    });
  });

  it("٧) بلا رقمٍ ضريبيٍّ ⇒ `TAX_IDENTITY_NOT_CONFIGURED`", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    await withSetting(KEY_SELLER_VAT, null, "string", async () => {
      expect(await issue(DRIVER_TELEGRAM_ID, transactionId)).toEqual({
        ok: false,
        error: "TAX_IDENTITY_NOT_CONFIGURED",
      });
    });
  });

  it("٨) بلا نسبةِ ضريبةٍ ⇒ `VAT_RATE_NOT_CONFIGURED` — ولا صفرٌ صامتٌ", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    await withSetting(KEY_VAT_RATE, null, "number", async () => {
      expect(await issue(DRIVER_TELEGRAM_ID, transactionId)).toEqual({
        ok: false,
        error: "VAT_RATE_NOT_CONFIGURED",
      });
    });
  });
});

describeIf("الحسابُ — ضريبةٌ مُستخرَجةٌ من مبلغٍ شاملٍ لا مضافةٌ عليه", () => {
  it("٩) ٢٥٠ ريالاً شاملةً بنسبةِ ١٥٪ ⇒ ٣٢٦١ هللةً ضريبةً و٢١٧٣٩ وعاءً", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    const invoice = invoiceOf(await issue(DRIVER_TELEGRAM_ID, transactionId));
    expect(Number(invoice.total_incl_vat_minor)).toBe(25_000);
    expect(Number(invoice.vat_amount_minor)).toBe(3261);
    expect(Number(invoice.total_excl_vat_minor)).toBe(21_739);
    expect(Number(invoice.vat_rate_bps)).toBe(1500);
  });

  it("١٠) المجموعُ **لا يفارقُ** ما دفعَه السائقُ في أيِّ مبلغٍ", async () => {
    for (const amountMinor of [1, 99, 100, 333, 25_000, 40_000, 99_999]) {
      const transactionId = await seedTransaction({ amountMinor, status: "active" });
      const invoice = invoiceOf(await issue(DRIVER_TELEGRAM_ID, transactionId));
      expect(Number(invoice.total_incl_vat_minor)).toBe(amountMinor);
      expect(Number(invoice.total_excl_vat_minor) + Number(invoice.vat_amount_minor)).toBe(
        amountMinor,
      );
    }
  });

  it("١١) نسبةٌ أخرى تُغيّرُ الحسابَ — لا ثابتٍ صامتٍ في الكودِ", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    await withSetting(KEY_VAT_RATE, 500, "number", async () => {
      const invoice = invoiceOf(await issue(DRIVER_TELEGRAM_ID, transactionId));
      expect(Number(invoice.vat_rate_bps)).toBe(500);
      expect(Number(invoice.vat_amount_minor)).toBe(1190);
      expect(Number(invoice.total_excl_vat_minor)).toBe(23_810);
    });
  });

  it("١٢) نسبةُ صفرٍ ⇒ ضريبةٌ معدومةٌ ووعاءٌ يساوي الإجماليَّ", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    await withSetting(KEY_VAT_RATE, 0, "number", async () => {
      const invoice = invoiceOf(await issue(DRIVER_TELEGRAM_ID, transactionId));
      expect(Number(invoice.vat_amount_minor)).toBe(0);
      expect(Number(invoice.total_excl_vat_minor)).toBe(25_000);
    });
  });
});

describeIf("مرّةٌ واحدةٌ — رقمٌ واحدٌ لتوريدٍ واحدٍ", () => {
  it("١٣) نداءٌ ثانٍ ⇒ `already_issued` وبنفسِ الرقمِ وختمِ الزمنِ", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    const first = await issue(DRIVER_TELEGRAM_ID, transactionId);
    const second = await issue(DRIVER_TELEGRAM_ID, transactionId);
    expect(first.already_issued).toBe(false);
    expect(second.already_issued).toBe(true);
    expect(invoiceOf(second)).toEqual(invoiceOf(first));
  });

  it("١٤) عشرونَ نداءً متوازياً ⇒ صفٌّ واحدٌ ورقمٌ واحدٌ", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => issue(DRIVER_TELEGRAM_ID, transactionId)),
    );
    const numbers = new Set(results.map((result) => String(invoiceOf(result).invoice_number)));
    expect(numbers.size).toBe(1);
    const [row] = await sql<{ count: string }[]>`
      select count(*)::text as count from subscription_invoices where payment_transaction_id = ${transactionId}
    `;
    expect(row?.count).toBe("1");
    expect(results.filter((result) => result.already_issued === false)).toHaveLength(1);
  });

  it("١٥) الأرقامُ متسلسلةٌ ولا تتكرّرُ بينَ معاملتَينِ", async () => {
    const firstId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    const secondId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    const first = String(invoiceOf(await issue(DRIVER_TELEGRAM_ID, firstId)).invoice_number);
    const second = String(invoiceOf(await issue(DRIVER_TELEGRAM_ID, secondId)).invoice_number);
    expect(first).not.toBe(second);
    // الصيغةُ: رمزُ المدينةِ، فسنةُ الإصدارِ، فتتابعٌ بستِّ خاناتٍ — ترقيمٌ
    // **لكلِّ مدينةٍ وسنةٍ** لا مُتوالٌ عامٌّ واحدٌ.
    const shape = /^[A-Z0-9_-]+-\d{4}-(\d{6})$/;
    expect(first).toMatch(shape);
    expect(second).toMatch(shape);
    const firstSeq = Number(shape.exec(first)?.[1]);
    const secondSeq = Number(shape.exec(second)?.[1]);
    expect(secondSeq).toBe(firstSeq + 1);
  });

  it("١٦) قيدُ التوريدِ الفريدُ يمنعُ صفّاً ثانياً حتّى بإدراجٍ مباشرٍ", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    await issue(DRIVER_TELEGRAM_ID, transactionId);
    const directSeq = nextDirectSequence();
    const message = await rejectionOf(
      () => sql`
      insert into subscription_invoices (
        city_id, payment_transaction_id, driver_id, invoice_year, invoice_sequence,
        invoice_number, amount_minor, currency, plan, document_type,
        seller_name, seller_vat_number, vat_rate_bps,
        total_excl_vat_minor, vat_amount_minor, qr_tlv_base64
      ) values (
        ${cityId}, ${transactionId}, ${driverId}, 2999, ${directSeq},
        ${`DIRECT-2999-${String(directSeq).padStart(6, "0")}`}, 25000, 'SAR', 'transport',
        'SIMPLIFIED_TAX_INVOICE', ${SELLER_NAME}, ${SELLER_VAT}, 1500, 21739, 3261, 'AQEB'
      )
    `,
    );
    expect(message).toMatch(/subscription_invoices_payment_transaction_id_key|duplicate key/);
  });
});

describeIf("الثباتُ — حاجزٌ في القاعدةِ لا أدبٌ في الكودِ", () => {
  it("١٧) `update` على صفِّ فاتورةٍ ⇒ استثناءٌ مُسمّىً", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    await issue(DRIVER_TELEGRAM_ID, transactionId);
    const message = await rejectionOf(
      () => sql`
      update subscription_invoices set vat_amount_minor = 1 where payment_transaction_id = ${transactionId}
    `,
    );
    expect(message).toMatch(/TAX_INVOICE_IS_IMMUTABLE/);
  });

  it("١٨) `delete` على صفِّ فاتورةٍ ⇒ استثناءٌ مُسمّىً", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    await issue(DRIVER_TELEGRAM_ID, transactionId);
    const message = await rejectionOf(
      () => sql`delete from subscription_invoices where payment_transaction_id = ${transactionId}`,
    );
    expect(message).toMatch(/TAX_INVOICE_IS_IMMUTABLE/);
  });

  it("١٩) قيدُ الجمعِ يرفضُ صفّاً حسابُه كاذبٌ", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    const directSeq = nextDirectSequence();
    const message = await rejectionOf(
      () => sql`
      insert into subscription_invoices (
        city_id, payment_transaction_id, driver_id, invoice_year, invoice_sequence,
        invoice_number, amount_minor, currency, plan, document_type,
        seller_name, seller_vat_number, vat_rate_bps,
        total_excl_vat_minor, vat_amount_minor, qr_tlv_base64
      ) values (
        ${cityId}, ${transactionId}, ${driverId}, 2999, ${directSeq},
        ${`DIRECT-2999-${String(directSeq).padStart(6, "0")}`}, 25000, 'SAR', 'transport',
        'SIMPLIFIED_TAX_INVOICE', ${SELLER_NAME}, ${SELLER_VAT}, 1500, 20000, 3261, 'AQEB'
      )
    `,
    );
    expect(message).toMatch(/subscription_invoices_tax_all_or_none/);
  });

  it("٢٠) رقمٌ ضريبيٌّ ليسَ خمسةَ عشرَ رقماً ⇒ مرفوضٌ في القاعدةِ", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    const directSeq = nextDirectSequence();
    const message = await rejectionOf(
      () => sql`
      insert into subscription_invoices (
        city_id, payment_transaction_id, driver_id, invoice_year, invoice_sequence,
        invoice_number, amount_minor, currency, plan, document_type,
        seller_name, seller_vat_number, vat_rate_bps,
        total_excl_vat_minor, vat_amount_minor, qr_tlv_base64
      ) values (
        ${cityId}, ${transactionId}, ${driverId}, 2999, ${directSeq},
        ${`DIRECT-2999-${String(directSeq).padStart(6, "0")}`}, 25000, 'SAR', 'transport',
        'SIMPLIFIED_TAX_INVOICE', ${SELLER_NAME}, '30000', 1500, 21739, 3261, 'AQEB'
      )
    `,
    );
    expect(message).toMatch(/subscription_invoices_tax_all_or_none/);
  });
});

describeIf("رمزُ الاستجابةِ — يُفكِّكُه عرّافٌ لا يعرفُ كيفَ رُكِّبَ", () => {
  it("٢١) خمسةُ حقولٍ بوسومِها وترتيبِها", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    const invoice = invoiceOf(await issue(DRIVER_TELEGRAM_ID, transactionId));
    const decoded = decodeTlv(String(invoice.qr_tlv_base64));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.fields.map((field) => field.tag)).toEqual([...SIMPLIFIED_INVOICE_TAGS]);
  });

  it("٢٢) القيمُ المُفكَّكةُ **تُطابِقُ** حقولَ الفاتورةِ نفسَها", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    const invoice = invoiceOf(await issue(DRIVER_TELEGRAM_ID, transactionId));
    const decoded = decodeTlv(String(invoice.qr_tlv_base64));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(tlvValue(decoded.fields, 1)).toBe(SELLER_NAME);
    expect(tlvValue(decoded.fields, 2)).toBe(SELLER_VAT);
    expect(tlvValue(decoded.fields, 4)).toBe("250.00");
    expect(tlvValue(decoded.fields, 5)).toBe("32.61");
  });

  it("٢٣) ختمُ الزمنِ بـ`UTC` وبصيغةٍ مقروءةٍ تُطابِقُ `issued_at`", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    const invoice = invoiceOf(await issue(DRIVER_TELEGRAM_ID, transactionId));
    const decoded = decodeTlv(String(invoice.qr_tlv_base64));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const stamp = tlvValue(decoded.fields, 3) ?? "";
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const issuedAt = new Date(String(invoice.issued_at));
    expect(new Date(stamp).getTime()).toBe(Math.floor(issuedAt.getTime() / 1000) * 1000);
  });

  it("٢٤) الطولُ **بالبايتاتِ لا بالمحارفِ** — والعربيّةُ هيَ القياسُ", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    const invoice = invoiceOf(await issue(DRIVER_TELEGRAM_ID, transactionId));
    const decoded = decodeTlv(String(invoice.qr_tlv_base64));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const name = decoded.fields.find((field) => field.tag === 1);
    expect(name?.byteLength).toBe(new TextEncoder().encode(SELLER_NAME).length);
    expect(name?.byteLength).toBeGreaterThan(SELLER_NAME.length);
  });

  it("٢٥) اسمٌ فيهِ مئتا بايتٍ يُفَكُّ سليماً — الحدُّ مقيسٌ لا مفترَضٌ", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    const longName = "شركةٌ".repeat(20);
    await withSetting(KEY_SELLER_NAME, longName, "string", async () => {
      const invoice = invoiceOf(await issue(DRIVER_TELEGRAM_ID, transactionId));
      const decoded = decodeTlv(String(invoice.qr_tlv_base64));
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      expect(tlvValue(decoded.fields, 1)).toBe(longName);
    });
  });

  it("٢٦) وسمٌ خارجَ المدى ⇒ استثناءٌ من الدالّةِ لا بايتٌ مقطوعٌ", async () => {
    expect(await rejectionOf(() => sql`select zatca_tlv_field(0, 'س')`)).toMatch(
      /TLV_TAG_OUT_OF_RANGE/,
    );
    expect(await rejectionOf(() => sql`select zatca_tlv_field(256, 'س')`)).toMatch(
      /TLV_TAG_OUT_OF_RANGE/,
    );
  });

  it("٢٧) قيمةٌ تفوقُ ٢٥٥ بايتاً ⇒ استثناءٌ مُسمّىً", async () => {
    expect(await rejectionOf(() => sql`select zatca_tlv_field(1, repeat('س', 200))`)).toMatch(
      /TLV_VALUE_TOO_LONG/,
    );
  });
});

describeIf("حالُ الدفعةِ — رايةٌ صادقةٌ ولا معرِّفَ مزوّدٍ", () => {
  it("٢٨) `invoice_issued` تنقلبُ بالإصدارِ لا بالنيّةِ", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    const before = await readStatus(DRIVER_TELEGRAM_ID, transactionId);
    expect(before.invoice_issued).toBe(false);
    await issue(DRIVER_TELEGRAM_ID, transactionId);
    const after = await readStatus(DRIVER_TELEGRAM_ID, transactionId);
    expect(after.invoice_issued).toBe(true);
  });

  it("٢٩) لا معرِّفَ مزوّدٍ في أيِّ جوابٍ ولو كانَ في الصفِّ", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    const [row] = await sql<{ provider_transaction_id: string }[]>`
      select provider_transaction_id from payment_transactions where id = ${transactionId}
    `;
    const secret = row?.provider_transaction_id ?? "";
    expect(secret).not.toBe("");
    const status = JSON.stringify(await readStatus(DRIVER_TELEGRAM_ID, transactionId));
    const invoice = JSON.stringify(await issue(DRIVER_TELEGRAM_ID, transactionId));
    expect(status).not.toContain(secret);
    expect(invoice).not.toContain(secret);
    expect(status).not.toContain("provider");
  });

  it("٣٠) قراءةُ الحالِ **لا تُصدِرُ** فاتورةً ولو كُرِّرَت", async () => {
    const transactionId = await seedTransaction({ amountMinor: 25_000, status: "active" });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await readStatus(DRIVER_TELEGRAM_ID, transactionId);
      await readInvoice(DRIVER_TELEGRAM_ID, transactionId);
    }
    const [row] = await sql<{ count: string }[]>`
      select count(*)::text as count from subscription_invoices where payment_transaction_id = ${transactionId}
    `;
    expect(row?.count).toBe("0");
  });
});
