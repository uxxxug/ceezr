/**
 * الغرض: قياسُ حارسِ اعتمادِ السائقِ (`F12-21`) على قاعدةٍ حقيقيّةٍ — أنَّ
 *   `admin_set_driver_verification` ترفضُ `verified` حينَ وثائقُ السائقِ ناقصةٌ،
 *   وتقبلُه حينَ وثائقُه كاملةٌ، وتمرِّرُ غيرَ `verified` بلا فحصٍ.
 *
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * الحاكم: docs/adr/0215-incomplete-documents-block-verification.md
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

interface Payload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly changed?: boolean;
  readonly status?: string;
  readonly block_reasons?: readonly string[];
  readonly [key: string]: unknown;
}

async function callJson(query: Promise<{ result: Payload }[]>): Promise<Payload> {
  const [row] = await query;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let adminUserId = "";
let driverId = "";
let driverUserId = "";
let requiredTypes: readonly string[] = [];

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [types] = await sql<{ types: string[] }[]>`
    select driver_required_document_types(${cityId}::uuid)::text[] as types
  `;
  requiredTypes = types?.types ?? [];
  if (requiredTypes.length === 0) {
    throw new Error("تعذّر الزرعُ: لا أنواعَ إلزاميّةً في إعداداتِ المدينةِ");
  }

  // مسؤولٌ لإصدارِ أفعالِ اللوحةِ
  const [admin] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, 900_000_401, 'admin', 'مسؤولُ الاعتمادِ', '+966500000401')
    returning id
  `;
  if (admin === undefined) throw new Error("تعذّر زرعُ المسؤولِ");
  adminUserId = admin.id;

  // سائقٌ جديدٌ بلا وثائقَ
  const [user] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, 900_000_402, 'driver', 'سائقُ الاعتمادِ', '+966500000402')
    returning id
  `;
  if (user === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = user.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${user.id}, 'pending'::verification_status, 'سيدان', 'ر س د 402')
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (driverId !== "") {
    await sql`delete from audit_log where entity_id = ${driverId} or actor_user_id = ${driverUserId}`;
    await sql`delete from driver_documents where driver_id = ${driverId}`;
    await sql`delete from driver_availability where driver_id = ${driverId}`;
    await sql`delete from subscriptions where driver_id = ${driverId}`;
    await sql`delete from subscription_wallets where driver_id = ${driverId}`;
    await sql`delete from payment_transactions where payer_driver_id = ${driverId}`;
    await sql`delete from driver_location_history where driver_id = ${driverId}`;
    await sql`delete from drivers where id = ${driverId}`;
  }
  if (driverUserId !== "") {
    await sql`delete from users where id = ${driverUserId}`;
  }
  if (adminUserId !== "") {
    await sql`delete from audit_log where actor_user_id = ${adminUserId}`;
    await sql`delete from users where id = ${adminUserId}`;
  }
  if (cityHandle !== undefined) {
    await restoreCityBaseline(sql, cityHandle);
  }
});

function setVerification(status: string): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select admin_set_driver_verification(
      ${adminUserId}::uuid, ${driverId}::uuid, ${status}
    ) as result
  `);
}

async function acceptDocument(docType: string, expiresAt: string): Promise<void> {
  const objectPath = `drivers/${driverId}/${docType}/${docType}.png`;
  await sql`
    insert into driver_documents (city_id, driver_id, doc_type, status, object_path, expires_at, submitted_at, reviewed_at)
    values (${cityId}, ${driverId}, ${docType}::driver_document_type, 'accepted', ${objectPath}, ${expiresAt}::date, now(), now())
    on conflict (driver_id, doc_type) do update
    set status = 'accepted', expires_at = ${expiresAt}::date, reviewed_at = now()
  `;
}

async function futureDate(days: number): Promise<string> {
  const [row] = await sql<{ day: string }[]>`
    select to_char(current_date + ${days}::integer, 'YYYY-MM-DD') as day
  `;
  if (row === undefined) throw new Error("تعذّر قراءةُ يومِ القاعدةِ");
  return row.day;
}

describeIf("F12-21 — حارسُ اعتمادِ السائقِ", () => {
  it("يرفضُ `verified` بلا وثائقَ إلزاميّةٍ — INCOMPLETE_DOCUMENTS", async () => {
    const result = await setVerification("verified");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("INCOMPLETE_DOCUMENTS");
    expect(Array.isArray(result.block_reasons)).toBe(true);
    expect((result.block_reasons ?? []).length).toBeGreaterThan(0);
  });

  it("يقبلُ `suspended` بلا وثائقَ — فالتعليقُ لا يشترطُ وثائقَ", async () => {
    const result = await setVerification("suspended");
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
  });

  it("يقبلُ `rejected` بلا وثائقَ — فالرفضُ لا يشترطُ وثائقَ", async () => {
    const result = await setVerification("rejected");
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
  });

  it("يرفضُ `verified` بوثائقَ ناقصةٍ (واحدةٌ مفقودةٌ)", async () => {
    // اقبل كلَّ الوثائقِ إلّا الأولى
    const future = await futureDate(400);
    for (const docType of requiredTypes.slice(1)) {
      await acceptDocument(docType, future);
    }
    const result = await setVerification("verified");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("INCOMPLETE_DOCUMENTS");
  });

  it("يقبلُ `verified` حينَ كلُّ الوثائقِ مقبولةٌ وغيرُ منتهيةٍ", async () => {
    const future = await futureDate(400);
    // اقبل الوثيقةَ المتبقّيةَ
    const firstType = requiredTypes[0];
    if (firstType === undefined) throw new Error("لا أنواعَ إلزاميّةً");
    await acceptDocument(firstType, future);
    const result = await setVerification("verified");
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.status).toBe("verified");
  });

  it("يرفضُ `verified` حينَ تنتهي صلاحيّةُ وثيقةٍ — EXPIRED", async () => {
    // انتهِ صلاحيّةُ وثيقةٍ واحدةٍ
    const docType = requiredTypes[0];
    if (docType === undefined) throw new Error("لا أنواعَ إلزاميّةً");
    await sql`
      update driver_documents set expires_at = current_date - 1
       where driver_id = ${driverId} and doc_type = ${docType}::driver_document_type
    `;
    const result = await setVerification("verified");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("INCOMPLETE_DOCUMENTS");
    // أصلِح الوثيقةَ
    const future = await futureDate(400);
    await acceptDocument(docType, future);
  });
});
