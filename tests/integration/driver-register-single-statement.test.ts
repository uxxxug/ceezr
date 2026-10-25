/**
 * الغرض: `LOAD-01` — تسجيلُ السائقِ (`createDriverDirectory().register`) بجملةٍ واحدةٍ على PostgreSQL
 *   الحقيقيّ يحفظُ عقدَ المعاملةِ السابقة: الصفوفُ الأربعةُ (`users` · `drivers` · `driver_capabilities` ·
 *   `driver_availability`)، والملفُّ المُعادُ مطابقٌ لقراءةِ `findByTelegramId` بعدَه، وإعادةُ التسجيلِ لا
 *   تُنزِلُ مسؤولًا ولا تمسُّ إتاحةً قائمةً وتُعيدُ تفعيلَ القدرة، والإخفاقُ في كتابةٍ لاحقةٍ لا يتركُ
 *   صفًّا سابقًا (الذرّيّة)، وكلُّ ذلك برحلةٍ واحدةٍ إلى القاعدة.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وكلُّ هجرةٍ تمسُّ هذه الجداولَ الأربعةَ أو مشغِّلاتِها.
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
const NEW_TG = "900009311";
const ADMIN_TG = "900009312";
const ATOMIC_TG = "900009313";
const TGS = [NEW_TG, ADMIN_TG, ATOMIC_TG];

let sql: Sql;
/** اتصالٌ ثانٍ يعدُّ كلَّ جملةٍ يرسلُها (`debug` في postgres.js يُستدعى لكلِّ رحلة، ومنها BEGIN/COMMIT). */
let counted: Sql;
let statements = 0;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";

function input(tg: string, overrides: Partial<RegisterDriverInput> = {}): RegisterDriverInput {
  return {
    telegramUserId: tg,
    cityId: cityId as CityId,
    fullName: "سائق الجملة الواحدة",
    phone: `+9665${tg.slice(-8)}`,
    service: "transport",
    language: "ar",
    vehicleType: "sedan",
    plateNumber: `SQL ${tg.slice(-4)}`,
    nationalId: `10${tg}`,
    vehiclePhotoFileId: null,
    ...overrides,
  } as RegisterDriverInput;
}

async function rowsFor(tg: string) {
  const [r] = await sql<
    {
      users: number;
      drivers: number;
      caps: number;
      avail: number;
      role: string | null;
      plate: string | null;
      enabled: boolean | null;
      is_available: boolean | null;
    }[]
  >`
    select (select count(*)::int from users where telegram_id = ${tg}::bigint) as users,
           (select count(*)::int from drivers d join users u on u.id = d.user_id where u.telegram_id = ${tg}::bigint) as drivers,
           (select count(*)::int from driver_capabilities c join drivers d on d.id = c.driver_id
              join users u on u.id = d.user_id where u.telegram_id = ${tg}::bigint) as caps,
           (select count(*)::int from driver_availability a join drivers d on d.id = a.driver_id
              join users u on u.id = d.user_id where u.telegram_id = ${tg}::bigint) as avail,
           (select role::text from users where telegram_id = ${tg}::bigint) as role,
           (select d.plate_number from drivers d join users u on u.id = d.user_id where u.telegram_id = ${tg}::bigint) as plate,
           (select c.is_enabled from driver_capabilities c join drivers d on d.id = c.driver_id
              join users u on u.id = d.user_id where u.telegram_id = ${tg}::bigint and c.service = 'transport') as enabled,
           (select a.is_available from driver_availability a join drivers d on d.id = a.driver_id
              join users u on u.id = d.user_id where u.telegram_id = ${tg}::bigint) as is_available
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
  await sql`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${ADMIN_TG}::bigint, 'admin', 'مسؤولٌ يسجّلُ سائقًا', '+966500009312')
  `;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await sql`delete from users where telegram_id = any(${TGS}::bigint[])`;
  if (cityHandle !== undefined) await restoreCityBaseline(sql, cityHandle);
  await counted.end();
  await sql.end();
});

describeIf("LOAD-01 · تسجيلُ السائقِ بجملةٍ واحدة", () => {
  it("سائقٌ جديد: الصفوفُ الأربعة، والملفُّ = قراءةُ findByTelegramId، برحلةٍ واحدة", async () => {
    const directory = createDriverDirectory(counted);
    // تسخينٌ: أوّلُ اتصالٍ يسألُ عن أنواعِ المصفوفاتِ مرّةً — ليسَ من التسجيل.
    await counted`select 1`;
    statements = 0;
    const registered = await directory.register(input(NEW_TG));
    expect(statements).toBe(1);
    if (!registered.ok) throw new Error(JSON.stringify(registered.error));
    const p = registered.value;
    expect(p.telegramUserId).toBe(NEW_TG);
    expect(p.cityId).toBe(cityId as CityId);
    expect(p.fullName).toBe("سائق الجملة الواحدة");
    expect(p.isVerified).toBe(false);
    expect(p.isAvailable).toBe(false);
    expect(p.hasLocation).toBe(false);
    expect(p.lastFix).toBeNull();

    const read = await createDriverDirectory(sql).findByTelegramId(NEW_TG);
    expect(read.ok && read.value).toEqual(p);
    expect(await rowsFor(NEW_TG)).toEqual({
      users: 1,
      drivers: 1,
      caps: 1,
      avail: 1,
      role: "driver",
      plate: `SQL ${NEW_TG.slice(-4)}`,
      enabled: true,
      is_available: false,
    });
  });

  it("إعادةُ التسجيل: تُحدِّثُ الملف، تُعيدُ تفعيلَ القدرة، ولا تمسُّ إتاحةً قائمة", async () => {
    await sql`
      update driver_availability a set is_available = true
        from drivers d join users u on u.id = d.user_id
       where a.driver_id = d.id and u.telegram_id = ${NEW_TG}::bigint
    `;
    await sql`
      update driver_capabilities c set is_enabled = false
        from drivers d join users u on u.id = d.user_id
       where c.driver_id = d.id and u.telegram_id = ${NEW_TG}::bigint
    `;
    const registered = await createDriverDirectory(sql).register(
      input(NEW_TG, { plateNumber: "NEW 9311", fullName: "اسمٌ محدَّث" }),
    );
    if (!registered.ok) throw new Error(JSON.stringify(registered.error));
    expect(registered.value.isAvailable).toBe(true);
    expect(registered.value.fullName).toBe("اسمٌ محدَّث");
    const read = await createDriverDirectory(sql).findByTelegramId(NEW_TG);
    expect(read.ok && read.value).toEqual(registered.value);
    const r = await rowsFor(NEW_TG);
    expect(r).toMatchObject({
      drivers: 1,
      caps: 1,
      avail: 1,
      plate: "NEW 9311",
      enabled: true,
      is_available: true,
    });
  });

  it("ADR 0212: تسجيلُ مسؤولٍ سائقًا لا يُنزِلُ دورَه", async () => {
    const registered = await createDriverDirectory(sql).register(input(ADMIN_TG));
    expect(registered.ok).toBe(true);
    expect((await rowsFor(ADMIN_TG)).role).toBe("admin");
  });

  it("الذرّيّة: إخفاقُ كتابةٍ لاحقة (خدمةٌ غيرُ صالحة) لا يتركُ صفَّ users ولا drivers", async () => {
    const result = await createDriverDirectory(sql).register(
      input(ATOMIC_TG, { service: "not_a_service" as never }),
    );
    expect(result.ok).toBe(false);
    expect(await rowsFor(ATOMIC_TG)).toMatchObject({ users: 0, drivers: 0, caps: 0, avail: 0 });
  });
});
