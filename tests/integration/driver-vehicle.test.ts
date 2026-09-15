/**
 * الغرض: قياسُ لوحِ مركبةِ السائقِ على PostgreSQL حقيقيٍّ — بياناتُ المركبةِ
 *   الأساسيّةُ ووثائقُها الثلاثُ (رخصةُ السيرِ، التأمينُ، الفحصُ الفنّيُّ)
 *   تُقرأُ في نداءٍ واحدٍ، والملكيّةُ مُنفَّذةٌ في القاعدةِ (البند `F3-07` · `SD-11`).
 * الحالة: مُختبَرٌ على قاعدةٍ حقيقيّةٍ — البند `F3-07`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: `bun run test:integration` وخطوةُ «تكامل على PostgreSQL حقيقي» في CI.
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ## وما لا يقيسُه هذا المِلفُّ عن قصدٍ — (`ح-5`)
 *
 * - **لا يقيسُ شاشةً ولا مُضيفَ تلغرامَ**: المُحوِّلاتُ في `tests/unit`.
 * - **لا يقيسُ رفعَ ملفّاتٍ**: رفعُ الشعارِ والباركودِ يمرُّ عبرَ `F3-01`.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

const DRIVER_TELEGRAM_ID = 900_000_571;
const STRANGER_TELEGRAM_ID = 900_000_572;
const DRIVER_USER_ID = "a3f07071-0000-0000-0000-0000000571a3";

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let driverUserId = "";
let driverId = "";

async function seedDriver(telegramId: number): Promise<{ userId: string; driverId: string }> {
  const userId = DRIVER_USER_ID;
  await sql`
    insert into users (id, telegram_id, city_id, language_code, role)
    values (${userId}::uuid, ${telegramId}::bigint, ${cityId}::uuid, 'ar', 'driver')
    on conflict (telegram_id) do nothing
  `;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (id, city_id, user_id, verification_status, vehicle_type, plate_number, vehicle_year)
    values (gen_random_uuid(), ${cityId}::uuid, ${userId}::uuid, 'verified', 'sedan', 'ABC-1234', 2020)
    on conflict (user_id) do update set
      vehicle_type = 'sedan', plate_number = 'ABC-1234', vehicle_year = 2020
    returning id
  `;
  if (!driver) throw new Error("seedDriver: failed to insert driver");
  return { userId, driverId: driver.id };
}

async function seedDocument(
  driverIdVal: string,
  docType: string,
  status: string,
  expiresAt: string | null,
): Promise<void> {
  await sql`
    insert into driver_documents (city_id, driver_id, doc_type, status, object_path, expires_at, submitted_at)
    values (${cityId}::uuid, ${driverIdVal}::uuid, ${docType}::driver_document_type, ${status}::driver_document_status, ${`vehicle/${docType}.png`}, ${expiresAt}::date, now())
    on conflict (driver_id, doc_type) do update set status = ${status}::driver_document_status, expires_at = ${expiresAt}::date
  `;
}

interface VehicleRow {
  vehicle_type: string | null;
  plate_number: string | null;
  vehicle_year: number | null;
  logo_object_path: string | null;
  barcode_object_path: string | null;
  registration_status: string | null;
  registration_expires_at: string | null;
  insurance_status: string | null;
  insurance_expires_at: string | null;
  inspection_status: string | null;
  inspection_expires_at: string | null;
}

async function readVehicle(telegramId: number): Promise<VehicleRow | null> {
  const rows = await sql<VehicleRow[]>`
    select * from driver_vehicle(${telegramId}::bigint)
  `;
  return rows[0] ?? null;
}

async function updateVehicle(
  telegramId: number,
  type: string | null,
  plate: string | null,
  year: number | null,
): Promise<void> {
  await sql`
    select update_driver_vehicle(
      ${telegramId}::bigint,
      ${type}::text,
      ${plate}::text,
      ${year}::int
    )
  `;
}

async function updateAssets(
  telegramId: number,
  logoPath: string | null,
  barcodePath: string | null,
): Promise<void> {
  await sql`
    select update_driver_vehicle_assets(
      ${telegramId}::bigint,
      ${logoPath}::text,
      ${barcodePath}::text
    )
  `;
}

describeIf("F3-07 driver vehicle on real PostgreSQL", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    cityHandle = await ensureActiveCity(sql);
    cityId = cityHandle.cityId;
    const seeded = await seedDriver(DRIVER_TELEGRAM_ID);
    driverUserId = seeded.userId;
    driverId = seeded.driverId;
  });

  afterAll(async () => {
    try {
      await sql`delete from driver_documents where driver_id = ${driverId}::uuid`;
      await sql`delete from drivers where user_id = ${driverUserId}::uuid`;
      await sql`delete from users where telegram_id = ${DRIVER_TELEGRAM_ID}::bigint or telegram_id = ${STRANGER_TELEGRAM_ID}::bigint`;
      if (cityHandle !== undefined) await restoreCityBaseline(sql, cityHandle);
    } finally {
      await sql.end();
    }
  });

  it("reads vehicle data and three documents in one call", async () => {
    await seedDocument(driverId, "vehicle_registration", "accepted", "2027-01-01");
    await seedDocument(driverId, "insurance", "accepted", "2027-06-01");
    await seedDocument(driverId, "periodic_inspection", "under_review", null);

    const row = await readVehicle(DRIVER_TELEGRAM_ID);
    expect(row).not.toBeNull();
    if (!row) throw new Error("row should not be null");
    expect(row.vehicle_type).toBe("sedan");
    expect(row.plate_number).toBe("ABC-1234");
    expect(row.vehicle_year).toBe(2020);
    expect(row.registration_status).toBe("accepted");
    expect(row.registration_expires_at).toBe("2027-01-01");
    expect(row.insurance_status).toBe("accepted");
    expect(row.insurance_expires_at).toBe("2027-06-01");
    expect(row.inspection_status).toBe("under_review");
    expect(row.inspection_expires_at).toBeNull();
  });

  it("returns null logo and barcode when not set", async () => {
    const row = await readVehicle(DRIVER_TELEGRAM_ID);
    if (!row) throw new Error("row should not be null");
    expect(row.logo_object_path).toBeNull();
    expect(row.barcode_object_path).toBeNull();
  });

  it("updates vehicle basic data", async () => {
    await updateVehicle(DRIVER_TELEGRAM_ID, "suv", "XYZ-5678", 2022);
    const row = await readVehicle(DRIVER_TELEGRAM_ID);
    if (!row) throw new Error("row should not be null");
    expect(row.vehicle_type).toBe("suv");
    expect(row.plate_number).toBe("XYZ-5678");
    expect(row.vehicle_year).toBe(2022);
  });

  it("updates logo and barcode asset paths", async () => {
    await updateAssets(DRIVER_TELEGRAM_ID, "vehicle/logo.png", "vehicle/barcode.png");
    const row = await readVehicle(DRIVER_TELEGRAM_ID);
    if (!row) throw new Error("row should not be null");
    expect(row.logo_object_path).toBe("vehicle/logo.png");
    expect(row.barcode_object_path).toBe("vehicle/barcode.png");
  });

  it("clears logo and barcode with null", async () => {
    await updateAssets(DRIVER_TELEGRAM_ID, null, null);
    const row = await readVehicle(DRIVER_TELEGRAM_ID);
    if (!row) throw new Error("row should not be null");
    expect(row.logo_object_path).toBeNull();
    expect(row.barcode_object_path).toBeNull();
  });

  it("returns no rows for unknown telegram user", async () => {
    const row = await readVehicle(STRANGER_TELEGRAM_ID);
    expect(row).toBeNull();
  });

  it("clears vehicle type and plate with null", async () => {
    await updateVehicle(DRIVER_TELEGRAM_ID, null, null, null);
    const row = await readVehicle(DRIVER_TELEGRAM_ID);
    if (!row) throw new Error("row should not be null");
    expect(row.vehicle_type).toBeNull();
    expect(row.plate_number).toBeNull();
    expect(row.vehicle_year).toBeNull();
  });

  it("reads documents even when some are missing", async () => {
    await sql`delete from driver_documents where driver_id = ${driverId}::uuid and doc_type = 'periodic_inspection'`;
    const row = await readVehicle(DRIVER_TELEGRAM_ID);
    if (!row) throw new Error("row should not be null");
    expect(row.registration_status).not.toBeNull();
    expect(row.inspection_status).toBeNull();
  });

  it("reads all documents as null when none registered", async () => {
    await sql`delete from driver_documents where driver_id = ${driverId}::uuid`;
    const row = await readVehicle(DRIVER_TELEGRAM_ID);
    if (!row) throw new Error("row should not be null");
    expect(row.registration_status).toBeNull();
    expect(row.registration_expires_at).toBeNull();
    expect(row.insurance_status).toBeNull();
    expect(row.inspection_status).toBeNull();
  });

  it("update_driver_vehicle raises USER_NOT_FOUND for unknown user", async () => {
    await expect(
      sql`select update_driver_vehicle(${STRANGER_TELEGRAM_ID}::bigint, 'sedan'::text, 'TEST'::text, 2020::int)`,
    ).rejects.toThrow(/USER_NOT_FOUND/);
  });

  it("update_driver_vehicle_assets raises USER_NOT_FOUND for unknown user", async () => {
    await expect(
      sql`select update_driver_vehicle_assets(${STRANGER_TELEGRAM_ID}::bigint, 'logo.png'::text, 'barcode.png'::text)`,
    ).rejects.toThrow(/USER_NOT_FOUND/);
  });

  it("reads back updated year", async () => {
    await updateVehicle(DRIVER_TELEGRAM_ID, "sedan", "ABC-1234", 2019);
    const row = await readVehicle(DRIVER_TELEGRAM_ID);
    if (!row) throw new Error("row should not be null");
    expect(row.vehicle_year).toBe(2019);
  });

  it("update with empty strings clears to null", async () => {
    await updateVehicle(DRIVER_TELEGRAM_ID, "", "", null);
    const row = await readVehicle(DRIVER_TELEGRAM_ID);
    if (!row) throw new Error("row should not be null");
    expect(row.vehicle_type).toBeNull();
    expect(row.plate_number).toBeNull();
  });
});
