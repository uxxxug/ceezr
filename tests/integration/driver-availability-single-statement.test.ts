/**
 * الغرض: `LOAD-01` — `setAvailabilityByTelegramId` على PostgreSQL الحقيقيّ يكافئُ `findByTelegramId` ثمّ
 *   `setAvailability`: يكتبُ `driver_availability` و`attendance_log` و`audit_log` عبرَ `record_attendance` كما هي،
 *   ولا يكتبُ شيئًا لمعرّفٍ ليسَ سائقًا (`not_a_driver`)، وكلُّ ذلك برحلةٍ واحدة.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وكلُّ هجرةٍ تمسُّ `record_attendance`.
 * ملاحظات مستقبلية: لا شيء.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import type { RegisterDriverInput } from "../../packages/application/bots/types.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createDriverDirectory } from "../../packages/infrastructure/identity/directories.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
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

/** معرّفاتُ الصفوفِ التي يزرعُها هذا الملفُّ وحدَه. */
const DRIVER_TG = "900009321";
const RIDER_TG = "900009322";
const TGS = [DRIVER_TG, RIDER_TG];

let sql: Sql;
let counted: Sql;
let statements = 0;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let driverId = "";

async function state() {
  const [r] = await sql<{ avail: boolean | null; logs: number; audits: number }[]>`
    select (select is_available from driver_availability where driver_id = ${driverId}::uuid) as avail,
           (select count(*)::int from attendance_log where driver_id = ${driverId}::uuid) as logs,
           (select count(*)::int from audit_log where entity_id = ${driverId}::uuid and action = 'attendance.toggled') as audits
  `;
  if (r === undefined) throw new Error("لا صفّ");
  return r;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  counted = postgres(DATABASE_URL, {
    max: 1,
    debug: () => {
      statements += 1;
    },
  }) as unknown as Sql;
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;
  await sql`delete from users where telegram_id = any(${TGS}::bigint[])`;
  const registered = await createDriverDirectory(sql).register({
    telegramUserId: DRIVER_TG,
    cityId: cityId as CityId,
    fullName: "سائق التوفّر",
    phone: "+966500009321",
    service: "transport",
    language: "ar",
    vehicleType: "sedan",
    plateNumber: "AVL 9321",
    nationalId: "10900009321",
    vehiclePhotoFileId: null,
  } as RegisterDriverInput);
  if (!registered.ok) throw new Error("تعذّر الزرع");
  driverId = registered.value.id;
  await sql`
    insert into users (city_id, telegram_id, role, full_name)
    values (${cityId}, ${RIDER_TG}::bigint, 'rider', 'راكبٌ لا سائق')
  `;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await sql`delete from audit_log where entity_id = ${driverId}::uuid`;
  await sql`delete from users where telegram_id = any(${TGS}::bigint[])`;
  if (cityHandle !== undefined) await restoreCityBaseline(sql, cityHandle);
  await counted.end();
  await sql.end();
});

describeIf("LOAD-01 · التوفُّرُ بجملةٍ واحدة", () => {
  it("سائق: يكتبُ عبرَ record_attendance (التوفّر + attendance_log + audit_log) برحلةٍ واحدة", async () => {
    const directory = createDriverDirectory(counted);
    const before = await state();
    await counted`select 1`; // تسخينُ الاتصال
    statements = 0;
    const on = await directory.setAvailabilityByTelegramId?.(DRIVER_TG, true);
    expect(statements).toBe(1);
    expect(on).toEqual({ ok: true, value: "set" });
    const mid = await state();
    expect(mid).toEqual({ avail: true, logs: before.logs + 1, audits: before.audits + 1 });
    const off = await directory.setAvailabilityByTelegramId?.(DRIVER_TG, false);
    expect(off).toEqual({ ok: true, value: "set" });
    expect(await state()).toEqual({
      avail: false,
      logs: before.logs + 2,
      audits: before.audits + 2,
    });
    const read = await directory.findByTelegramId(DRIVER_TG);
    expect(read.ok && read.value?.isAvailable).toBe(false);
  });

  it("ليسَ سائقًا (راكبٌ أو معرّفٌ غائب): not_a_driver ولا كتابة", async () => {
    const directory = createDriverDirectory(sql);
    const before = await state();
    expect(await directory.setAvailabilityByTelegramId?.(RIDER_TG, true)).toEqual({
      ok: true,
      value: "not_a_driver",
    });
    expect(await directory.setAvailabilityByTelegramId?.("900009329", true)).toEqual({
      ok: true,
      value: "not_a_driver",
    });
    expect(await state()).toEqual(before);
  });

  it("يكافئُ المسارَ ذا الخطوتين أثرًا بأثر", async () => {
    const directory = createDriverDirectory(sql);
    const before = await state();
    const found = await directory.findByTelegramId(DRIVER_TG);
    if (!found.ok || found.value === null) throw new Error("لا سائق");
    await directory.setAvailability(found.value.id, true);
    const twoStep = await state();
    await directory.setAvailabilityByTelegramId?.(DRIVER_TG, true);
    const oneStep = await state();
    expect(twoStep.logs - before.logs).toBe(1);
    expect(oneStep.logs - twoStep.logs).toBe(1);
    expect(oneStep.audits - twoStep.audits).toBe(1);
    expect(oneStep.avail).toBe(twoStep.avail);
  });
});
