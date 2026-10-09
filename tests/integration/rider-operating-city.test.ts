/**
 * الغرض: R1 · ADR 0252 — المدينةُ التشغيليّةُ للراكبِ من آخرِ موقعٍ صالحٍ على PostgreSQL حقيقيّ:
 *   الانتقالُ بينَ مدينتَين مفعَّلتَين، والموقعُ خارجَ المدنِ المفعَّلة، والمدينةُ غيرُ المفعَّلة،
 *   والنقطةُ غيرُ الصالحة، ورحلةٌ قائمةٌ لا تُغيَّرُ مدينتُها ولا مدينةُ صاحبِها، وغيرُ الراكب.
 * الحالة: منفّذ فعلياً.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createOperatingCityStore } from "../../packages/infrastructure/rider-city/operating-city-store.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  اختبارُ المدينةِ التشغيليّةِ مُتخطّىً: عيّن TEST_DATABASE_URL.");
}

const RUN_BASE = 3_900_000_000 + (Date.now() % 90_000_000);
const TG = {
  rider: RUN_BASE + 1,
  busy: RUN_BASE + 2,
  driver: RUN_BASE + 3,
} as const;
const ID = {
  cityA: "55555555-0000-0000-0000-0000000001a1",
  cityB: "55555555-0000-0000-0000-0000000001b1",
  cityOff: "55555555-0000-0000-0000-0000000001c1",
  rider: "66666666-0000-0000-0000-0000000001a1",
  busy: "66666666-0000-0000-0000-0000000001a2",
  driver: "66666666-0000-0000-0000-0000000001a3",
  riderRow: "77777777-0000-0000-0000-0000000001a1",
  busyRow: "77777777-0000-0000-0000-0000000001a2",
  order: "88888888-0000-0000-0000-0000000001a2",
} as const;

// ثلاثةُ مستطيلاتٍ متباعدةٌ في المحيطِ الهادئ: لا تتقاطعُ مع حدودِ البذورِ القائمة.
const BOX = {
  a: "POLYGON((-150 10, -149 10, -149 11, -150 11, -150 10))",
  b: "POLYGON((-140 10, -139 10, -139 11, -140 11, -140 10))",
  off: "POLYGON((-130 10, -129 10, -129 11, -130 11, -130 10))",
} as const;
const IN = {
  a: { lat: 10.5, lng: -149.5 },
  b: { lat: 10.5, lng: -139.5 },
  off: { lat: 10.5, lng: -129.5 },
  nowhere: { lat: -45, lng: -120 },
} as const;

describeIf("R1 — المدينةُ التشغيليّةُ من آخرِ موقعٍ صالح", () => {
  let sql: Sql;

  const cityOf = async (userId: string) => {
    const rows = await sql<{ code: string | null }[]>`
      select c.code from users u left join cities c on c.id = u.city_id where u.id = ${userId}`;
    return rows[0]?.code ?? null;
  };
  const riderCityOf = async (riderId: string) => {
    const rows = await sql<{ code: string | null }[]>`
      select c.code from riders r left join cities c on c.id = r.city_id where r.id = ${riderId}`;
    return rows[0]?.code ?? null;
  };

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string, max: 1 });
    await sql`begin`;
    for (const [id, code, active] of [
      [ID.cityA, "RA1", true],
      [ID.cityB, "RB1", true],
      [ID.cityOff, "RC1", false],
    ] as const) {
      await sql`insert into cities (id, code, name_ar, name_en, is_active,
          telegram_support_group_id, telegram_escalation_group_id, telegram_unsubscribed_drivers_group_id)
        values (${id}, ${code}, ${`مدينة ${code}`}, ${`City ${code}`}, ${active}, -1001, -1002, -1003)`;
    }
    for (const [city, box] of [
      [ID.cityA, BOX.a],
      [ID.cityB, BOX.b],
      [ID.cityOff, BOX.off],
    ] as const) {
      await sql`insert into city_service_areas (city_id, area, area_version, source, is_active)
        values (${city}, st_geogfromtext(${`SRID=4326;${box}`}), 'r1-test', 'اختبار R1', true)`;
    }
    for (const [id, tg, role] of [
      [ID.rider, TG.rider, "rider"],
      [ID.busy, TG.busy, "rider"],
      [ID.driver, TG.driver, "driver"],
    ] as const) {
      await sql`insert into users (id, city_id, telegram_id, role, full_name, language_code, is_blocked)
        values (${id}, ${ID.cityA}, ${tg}, ${role}, 'اختبار', 'ar', false)`;
    }
    await sql`insert into riders (id, city_id, user_id) values (${ID.riderRow}, ${ID.cityA}, ${ID.rider})`;
    await sql`insert into riders (id, city_id, user_id) values (${ID.busyRow}, ${ID.cityA}, ${ID.busy})`;
    await sql`insert into orders (id, city_id, rider_id, service, status, pickup)
      values (${ID.order}, ${ID.cityA}, ${ID.busyRow}, 'transport', 'searching',
              st_geogfromtext(${`SRID=4326;POINT(${IN.a.lng} ${IN.a.lat})`}))`;
  });

  afterAll(async () => {
    await sql`rollback`;
    await sql.end();
  });

  it("١. داخلَ المدينةِ نفسِها ⇒ SAME_CITY بلا كتابة", async () => {
    const store = createOperatingCityStore(sql);
    const result = await store.locate({ telegramUserId: String(TG.rider), ...IN.a });
    expect(result.ok && result.value.outcome).toBe("SAME_CITY");
    expect(result.ok && result.value.city?.code).toBe("RA1");
    expect(await cityOf(ID.rider)).toBe("RA1");
  });

  it("٢. انتقالٌ إلى مدينةٍ مفعَّلةٍ أخرى ⇒ CHANGED، وصفّا المستخدمِ والراكبِ معاً، وسطرُ تدقيقٍ بلا إحداثيّات", async () => {
    const store = createOperatingCityStore(sql);
    const result = await store.locate({ telegramUserId: String(TG.rider), ...IN.b });
    expect(result.ok && result.value.outcome).toBe("CHANGED");
    expect(result.ok && result.value.city?.code).toBe("RB1");
    expect(await cityOf(ID.rider)).toBe("RB1");
    expect(await riderCityOf(ID.riderRow)).toBe("RB1");
    const audit = await sql<{ payload: Record<string, unknown>; city_id: string }[]>`
      select payload, city_id from audit_log
       where action = 'rider.operating_city_changed' and entity_id = ${ID.rider}`;
    expect(audit.length).toBe(1);
    expect(audit[0]?.payload).toEqual({
      from_city: "RA1",
      to_city: "RB1",
      source: "device_location",
    });
    expect(JSON.stringify(audit[0]?.payload)).not.toContain(String(IN.b.lat));
  });

  it("٣. والعودةُ إلى الأولى تعملُ بالحكمِ نفسِه", async () => {
    const store = createOperatingCityStore(sql);
    const result = await store.locate({ telegramUserId: String(TG.rider), ...IN.a });
    expect(result.ok && result.value.outcome).toBe("CHANGED");
    expect(await cityOf(ID.rider)).toBe("RA1");
  });

  it("٤. مدينةٌ غيرُ مفعَّلةٍ أو لا مدينة ⇒ OUTSIDE_ACTIVE_CITIES، والمدينةُ الحاليّةُ كما هي", async () => {
    const store = createOperatingCityStore(sql);
    for (const point of [IN.off, IN.nowhere]) {
      const result = await store.locate({ telegramUserId: String(TG.rider), ...point });
      expect(result.ok && result.value.outcome).toBe("OUTSIDE_ACTIVE_CITIES");
      expect(result.ok && result.value.city?.code).toBe("RA1");
    }
    expect(await cityOf(ID.rider)).toBe("RA1");
  });

  it("٥. نقطةٌ غيرُ صالحةٍ ⇒ INVALID_POINT من القاعدةِ نفسِها", async () => {
    for (const [lat, lng] of [
      [91, 0],
      [0, 181],
      [Number.NaN, 0],
    ] as const) {
      const rows = await sql<{ result: { ok: boolean; error?: string } }[]>`
        select locate_rider_operating_city(${String(TG.rider)}, ${lat}::double precision, ${lng}::double precision) as result`;
      expect(rows[0]?.result).toEqual({ ok: false, error: "INVALID_POINT" });
    }
    expect(await cityOf(ID.rider)).toBe("RA1");
  });

  it("٦. رحلةٌ قائمةٌ ⇒ ACTIVE_RIDE: لا تتغيّرُ مدينةُ الراكبِ ولا مدينةُ الرحلة", async () => {
    const store = createOperatingCityStore(sql);
    const result = await store.locate({ telegramUserId: String(TG.busy), ...IN.b });
    expect(result.ok && result.value.outcome).toBe("ACTIVE_RIDE");
    expect(await cityOf(ID.busy)).toBe("RA1");
    const order = await sql<
      { city_id: string }[]
    >`select city_id from orders where id = ${ID.order}`;
    expect(order[0]?.city_id).toBe(ID.cityA);
  });

  it("٧. بعدَ انتهاءِ الرحلةِ يتغيّرُ الراكبُ وتبقى الرحلةُ المنتهيةُ على مدينتِها (لا أثرَ رجعيّ)", async () => {
    await sql`update orders set status = 'cancelled' where id = ${ID.order}`;
    const store = createOperatingCityStore(sql);
    const result = await store.locate({ telegramUserId: String(TG.busy), ...IN.b });
    expect(result.ok && result.value.outcome).toBe("CHANGED");
    expect(await cityOf(ID.busy)).toBe("RB1");
    const order = await sql<
      { city_id: string }[]
    >`select city_id from orders where id = ${ID.order}`;
    expect(order[0]?.city_id).toBe(ID.cityA);
  });

  it("٨. غيرُ الراكبِ ⇒ NOT_A_RIDER ولا تُمَسُّ مدينتُه", async () => {
    const store = createOperatingCityStore(sql);
    const result = await store.locate({ telegramUserId: String(TG.driver), ...IN.b });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.reason).toBe("NOT_A_RIDER");
    expect(await cityOf(ID.driver)).toBe("RA1");
  });

  it("٩. مستخدمٌ غيرُ موجودٍ ⇒ USER_NOT_FOUND، والقراءةُ تعيدُ المدينةَ الحاليّة", async () => {
    const store = createOperatingCityStore(sql);
    const missing = await store.locate({ telegramUserId: String(RUN_BASE + 99), ...IN.a });
    expect(!missing.ok && missing.error.reason).toBe("USER_NOT_FOUND");
    const read = await store.read(String(TG.rider));
    expect(read.ok && read.value?.code).toBe("RA1");
    expect(read.ok && read.value?.isActive).toBe(true);
  });

  it("١٠. الطلبُ يُنشأُ في المدينةِ التي حكمَت بها القاعدة (request_ride تقرأُ صفَّ المستخدم)", async () => {
    // الراكبُ `busy` صارَ في RB1؛ فطلبٌ نقطتُه في RA1 يُرفَضُ خارجَ الحدّ.
    const inB = await sql<{ result: { ok: boolean; error?: string } }[]>`
      select request_ride(${TG.busy}::bigint, ${`r1-${RUN_BASE}`}, 'transport'::service_type,
        ${IN.b.lat}::double precision, ${IN.b.lng}::double precision, null, null, null) as result`;
    // المدينةُ الاختباريّةُ بلا سائقٍ موثَّقٍ مشترِك، فالحكمُ يبلغُ فحصَ القدرةِ **بعدَ** فحصَي المدينةِ
    // والحدّ: الرفضُ بالقدرةِ دليلٌ على أنَّ الطلبَ حُكمَ في RB1 وأنَّ نقطتَه داخلَ حدِّها.
    expect(inB[0]?.result).toEqual({ ok: false, error: "SERVICE_NOT_AVAILABLE_IN_CITY" });
    const inA = await sql<{ result: { ok: boolean; error?: string } }[]>`
      select request_ride(${TG.busy}::bigint, ${`r1a-${RUN_BASE}`}, 'transport'::service_type,
        ${IN.a.lat}::double precision, ${IN.a.lng}::double precision, null, null, null) as result`;
    expect(inA[0]?.result).toEqual({ ok: false, error: "ORIGIN_OUTSIDE_SERVICE_AREA" });
  });
});
