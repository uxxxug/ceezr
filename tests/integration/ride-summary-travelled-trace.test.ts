/**
 * الغرض: قياسُ **مسافةِ الأثرِ المسجَّلِ** على قاعدةٍ حقيقيّةٍ — المنفذُ الضيّقُ
 *   يعيدُ الصفوفَ، والدالّةُ الصرفةُ تقيسُ، والنافذةُ تُخرِجُ ما ليسَ من
 *   الرحلةِ (البند `F2-07` · `ADR 0208`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-07` (الشقُّ المملوكُ للمستودَعِ).
 * ينتمي إلى: tests/integration
 * يُستخدم من: `bun test` وخطوةُ «تكاملٌ على PostgreSQL حقيقيٍّ» في CI.
 *
 * وما لا يُدَّعى ههنا (`ح-5`): لا قياسَ إنتاجيَّ — لا نشرَ حيَّ ولا رحلةً
 * حقيقيّةً قيسَت مسافتَها؛ المقيسُ التركيبُ على قاعدةٍ حقيقيّةٍ لا أكثرَ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { travelledDistanceFromTrace } from "../../packages/domain/geo/travelled-distance.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createRideTraceReader } from "../../packages/infrastructure/transport/ride-trace-store.ts";
import { LOCATION_HOT_DAYS } from "../../packages/shared/config/retention-policy.ts";
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

const RIDER_TELEGRAM_ID = 900_000_981;
const DRIVER_TELEGRAM_ID = 900_000_982;
const OTHER_DRIVER_TELEGRAM_ID = 900_000_983;

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let riderId = "";
let driverId = "";
let otherDriverId = "";

/** نقطةُ أثرٍ كما تُزرَعُ في `driver_location_history` — الجدولُ ملحَقٌ لا مفتاحَ لهُ. */
async function seedTrace(input: {
  readonly driver: string;
  readonly minutesAgo: number;
  readonly lat: number;
  readonly lng?: number;
  readonly quality?: string;
  readonly accuracy?: number | null;
}): Promise<void> {
  await sql`
    insert into driver_location_history (
      city_id, driver_id, position, recorded_at, accuracy_m, quality, source
    ) values (
      ${cityId}, ${input.driver},
      st_setsrid(st_makepoint(${input.lng ?? 39.19}, ${input.lat}), 4326)::geography,
      now() - make_interval(mins => ${input.minutesAgo}),
      ${input.accuracy ?? 10}, ${input.quality ?? "ACCEPT"}, 'direct'
    )
  `;
}

async function seedCompletedOrder(input: {
  readonly startedMinutesAgo: number;
  readonly completedMinutesAgo: number;
  readonly driver: string;
}): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into orders (
      city_id, rider_id, service, status, pickup, dropoff, pickup_label, dropoff_label,
      assigned_driver_id, idempotency_key, matched_at, started_at, completed_at
    ) values (
      ${cityId}, ${riderId}, 'transport'::service_type, 'completed'::order_status,
      st_setsrid(st_makepoint(39.19, 21.4858), 4326)::geography,
      st_setsrid(st_makepoint(39.1553, 21.5591), 4326)::geography,
      'البلد', 'الروضة', ${input.driver},
      ${`trace-summary:${crypto.randomUUID()}`},
      now() - make_interval(mins => ${input.startedMinutesAgo + 5}),
      now() - make_interval(mins => ${input.startedMinutesAgo}),
      now() - make_interval(mins => ${input.completedMinutesAgo})
    ) returning id
  `;
  if (row === undefined) throw new Error("تعذّر زرعُ الطلبِ");
  return row.id;
}

/** القارئُ الضيّقُ + الدالّةُ الصرفةُ — التركيبُ نفسُهُ الذي يُركِّبُهُ مسارُ البوّابةِ. */
async function measure(orderId: string) {
  const reader = createRideTraceReader(sql);
  const read = await reader.read({ orderId });
  if (!read.ok) throw new Error(`فشلُ قراءةِ الأثرِ: ${read.error.reason}`);
  const found = read.value;
  if (!found.found) return null;
  const { trace } = found;
  return {
    trace,
    verdict: travelledDistanceFromTrace({
      points: trace.points,
      startedAtMs: trace.startedAtMs,
      completedAtMs: trace.completedAtMs,
      gapLimitSeconds: trace.gapLimitSeconds,
      nowMs: Date.now(),
      hotWindowDays: LOCATION_HOT_DAYS,
    }),
  };
}

/** الأثرُ يُمحى بينَ الحالاتِ: الحالاتُ تتشاركُ السائقَ، وبقاءُ أثرِ حالةٍ
 *  سابقةٍ يجعلُ «رحلةً بلا أثرٍ» كذبةً مقيسةً. */
async function clearTrace(): Promise<void> {
  await sql`
    delete from driver_location_history
     where driver_id in (${driverId}, ${otherDriverId})
  `;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكب الأثر', '+966500000981')
    returning id
  `;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ الراكبِ");
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUser.id}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبِ");
  riderId = rider.id;

  for (const [telegramId, name] of [
    [DRIVER_TELEGRAM_ID, "سائق الأثر"],
    [OTHER_DRIVER_TELEGRAM_ID, "سائق آخر"],
  ] as const) {
    const [user] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${telegramId}, 'driver', ${name}, '+966500000982')
      returning id
    `;
    if (user === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
    const [driver] = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status)
      values (${cityId}, ${user.id}, 'verified'::verification_status)
      returning id
    `;
    if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
    if (telegramId === DRIVER_TELEGRAM_ID) driverId = driver.id;
    else otherDriverId = driver.id;
  }
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  // الحصادُ **بمعرِّفاتِ الزرعِ لا بمتغيّراتٍ قد تَبقَى فارغةً** إن أخفقَ
  // `beforeAll` في منتصفِهِ: التنظيفُ اللاحقُ لا يُفسِدُهُ فشلُ سابقٍ، وإلّا
  // بقِيَت بذورٌ تُفسِدُ كلَّ جولةٍ تاليةٍ بمفتاحٍ مكرَّرٍ.
  await sql`
    delete from driver_location_history
     where driver_id in (
       select d.id from drivers d
        join users u on u.id = d.user_id
        where u.telegram_id in (${DRIVER_TELEGRAM_ID}, ${OTHER_DRIVER_TELEGRAM_ID})
     )
  `;
  await sql`
    delete from orders
     where idempotency_key like 'trace-summary:%'
  `;
  await sql`
    delete from drivers
     where user_id in (select id from users where telegram_id in (${DRIVER_TELEGRAM_ID}, ${OTHER_DRIVER_TELEGRAM_ID}))
  `;
  await sql`
    delete from riders
     where user_id in (select id from users where telegram_id = ${RIDER_TELEGRAM_ID})
  `;
  await sql`
    delete from users
     where telegram_id in (${RIDER_TELEGRAM_ID}, ${DRIVER_TELEGRAM_ID}, ${OTHER_DRIVER_TELEGRAM_ID})
  `;
  await restoreCityBaseline(sql, cityHandle);
  cityHandle = undefined;
});

describeIf("مسافةُ الأثرِ المسجَّلِ على قاعدةٍ حقيقيّةٍ (`ADR 0208`)", () => {
  it("سقفُ الفجوةِ يُقرأُ من `platform_settings` لمدينةِ الرحلةِ — لا افتراضَ", async () => {
    const orderId = await seedCompletedOrder({
      startedMinutesAgo: 35,
      completedMinutesAgo: 20,
      driver: driverId,
    });
    const result = await measure(orderId);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.trace.gapLimitSeconds).toBe(120);
    expect(result.trace.driverId).toBe(driverId);
    expect(result.trace.cityId).toBe(cityId);
  });

  it("أثرٌ متّصلٌ يتحرّكُ ⇒ measured بمجموعِ المقاطعِ لا بالوترِ، والشوائبُ لا تدخلُ", async () => {
    // رحلةٌ من ٣٥ إلى ٢٠ دقيقةً مضت: أثرٌ كلَّ دقيقةٍ يتحرّكُ شمالاً ~0.001 درجةٍ (~111م).
    // والنقاطُ **هامشاً داخلَ النافذةِ** (٣٤..٢١): حافّتا الطلبِ تُكتبانِ بلحظةٍ
    // سابقةٍ لنقاطِ الأثرِ، فنقطةٌ على الحافّةِ نفسِها قد تقعُ خارجَها بفارقِ
    // أجزاءِ الثانيةِ — وهذا من طبيعةِ «الآنَ» لا من المقيسِ.
    const orderId = await seedCompletedOrder({
      startedMinutesAgo: 35,
      completedMinutesAgo: 20,
      driver: driverId,
    });
    await clearTrace();
    for (let minute = 34; minute >= 21; minute -= 1) {
      await seedTrace({
        driver: driverId,
        minutesAgo: minute,
        lat: 21.4858 + (34 - minute) * 0.001,
      });
    }
    // شوائبٌ لا تدخلُ: سائقٌ آخرُ في النافذةِ، ونقاطُ السائقِ نفسِهِ خارجَها.
    await seedTrace({ driver: otherDriverId, minutesAgo: 30, lat: 21.9 });
    await seedTrace({ driver: driverId, minutesAgo: 40, lat: 22.5 }); // قبلَ البدءِ.
    await seedTrace({ driver: driverId, minutesAgo: 15, lat: 22.6 }); // بعدَ الإتمامِ.

    const result = await measure(orderId);
    expect(result).not.toBeNull();
    if (result === null) return;
    // ١٤ نقطةً داخلَ النافذةِ (٣٤..٢١) — لا سائقٌ آخرُ ولا خارجَ النافذةِ.
    expect(result.trace.points).toHaveLength(14);
    expect(result.verdict.kind).toBe("measured");
    if (result.verdict.kind !== "measured") return;
    // ١٣ مقطعاً × ~111م ≈ ١٤٤٣م — لا وترَ البدايةِ والنهايةِ (~٥٦٠م) ولا صفراً.
    expect(result.verdict.meters).toBeGreaterThan(1300);
    expect(result.verdict.meters).toBeLessThan(1600);
    expect(result.verdict.usablePoints).toBe(14);
  });

  it("رحلةٌ بلا أثرٍ ⇒ no_history — لا صفر", async () => {
    await clearTrace();
    const orderId = await seedCompletedOrder({
      startedMinutesAgo: 35,
      completedMinutesAgo: 20,
      driver: driverId,
    });
    const result = await measure(orderId);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.verdict).toEqual({ kind: "unmeasured", reason: "no_history" });
  });

  it("فجوةٌ داخلَ الأثرِ أكبرُ من السقفِ ⇒ الرحلةُ كلُّها غيرُ مقيسةٍ", async () => {
    await clearTrace();
    const orderId = await seedCompletedOrder({
      startedMinutesAgo: 35,
      completedMinutesAgo: 20,
      driver: driverId,
    });
    // نقطتانِ في الطرفَينِ وفجوةٌ ١٢ دقيقةً بينَهما — لا وصلَ صامتاً.
    await seedTrace({ driver: driverId, minutesAgo: 34, lat: 21.4858 });
    await seedTrace({ driver: driverId, minutesAgo: 22, lat: 21.5 });
    const result = await measure(orderId);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.verdict.kind).toBe("unmeasured");
    if (result.verdict.kind !== "unmeasured") return;
    expect(result.verdict.reason).toBe("gap_exceeded");
    expect(result.verdict.largestGapSeconds).toBeGreaterThan(719);
  });

  it("طلبٌ غيرُ مكتملٍ أو بلا سائقٍ ⇒ `found:false` — السؤالُ لا يُسألُ", async () => {
    const [row] = await sql<{ id: string }[]>`
      insert into orders (
        city_id, rider_id, service, status, pickup, idempotency_key
      ) values (
        ${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
        st_setsrid(st_makepoint(39.19, 21.4858), 4326)::geography,
        ${`trace-summary:${crypto.randomUUID()}`}
      ) returning id
    `;
    if (row === undefined) throw new Error("تعذّر زرعُ الطلبِ");
    const read = await createRideTraceReader(sql).read({ orderId: row.id });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.found).toBe(false);
  });
});
