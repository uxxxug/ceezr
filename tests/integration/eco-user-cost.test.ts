/**
 * الغرض: قياسُ **مقاماتِ التكلفةِ الإجماليّةِ** — البندُ `ECO-001` (الزيادةُ الأولى،
 *   الشقُّ المملوكُ للمستودَعِ). يعدُّ المستخدمينَ النشطينَ (ركّابٌ + سائقونَ) والرحلاتِ
 *   في نافذةٍ `[from, to)` محقونةٍ على قاعدةِ PostgreSQL حقيقيّةٍ، ثمَّ يُغذّي المقاماتِ
 *   لحَكَمِ `scripts/lib/eco-user-cost.ts` الذي يحسبُ الكميّاتِ الشهريّةَ والنِسبَيّةَ
 *   والتكلفةَ النقديّةَ المحقونةَ.
 *
 *   والمقاماتُ المقيسةُ:
 *     ١) الراكبونَ النشطونَ: `count(DISTINCT orders.rider_id)` في النافذةِ.
 *     ٢) السائقونَ النشطونَ: `count(DISTINCT orders.assigned_driver_id)` ∪
 *        `count(DISTINCT order_offers.driver_id)` — فالسائقُ يستهلكُ مواردَ دونَ إسنادٍ.
 *     ٣) الطلباتُ المُنشأةُ: `count(*) FROM orders WHERE created_at ∈ [from, to)`.
 *     ٤) الرحلاتُ المُكمَّلةُ: `count(*) FROM orders WHERE completed_at ∈ [from, to)`.
 *
 *   والكميّاتُ الشهريّةُ **مشتقّةٌ من حدٍّ أعلى** (`ECO-004`) لا مقيسةٌ على نشرٍ حيٍّ.
 *   والسعرُ محقونٌ أو غائبٌ (`REQ-09`).
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يحكمُه: `docs/adr/0154-eco-001-first-increment-active-user-and-ride-denominators.md`
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ — ويُعلَنُ في الدليلِ ═══
 * ــ **لا تُحسَبُ تكلفةٌ بالمالٍ**: السعرُ في فاتورةِ مزوّدِ سحابةٍ (`REQ-09`).
 * ــ **لا يُقاسُ سلوكُ مستخدمينَ حقيقيّينَ**: النافذةُ محقونةٌ والبياناتُ مزروعةٌ.
 * ــ **لا يُوثَّقُ أرقامُ قاعدةٍ حيّةٍ كدليلِ إنتاجٍ**: البياناتُ مزروعةٌ في CI.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveUserCounts,
  judgeEcoUserCost,
  type MonthlyWindow,
  type PerRideQuantities,
  type UnitPrices,
} from "../../scripts/lib/eco-user-cost.ts";
import {
  databaseBlockBudget,
  databaseRowBudget,
  networkByteBudget,
  queueMessageBudget,
  redisCommandBudget,
  storageRowBudget,
} from "../../scripts/lib/resource-usage-budget.ts";
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

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderUserId = "";
let riderId = "";
let driverUserId = "";
let driverId = "";

/** تواريخُ ثابتةٌ — لا وقتَ متحرّكاً. */
const WINDOW_FROM = new Date("2026-08-20T00:00:00Z");
const WINDOW_TO = new Date("2026-09-20T00:00:00Z");
const ORDER_CREATED_AT = new Date("2026-09-10T12:00:00Z");
const ORDER_COMPLETED_AT = new Date("2026-09-10T12:30:00Z");

const RIDER_TELEGRAM_ID = 490_001;
const DRIVER_TELEGRAM_ID = 490_002;
const DRIVER2_TELEGRAM_ID = 490_003;

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  // زرعُ راكبٍ
  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكب ECO-001', '+966500000991')
    returning id
  `;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ الراكبِ");
  riderUserId = riderUser.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبِ");
  riderId = rider.id;

  // زرعُ سائقٍ أوّل
  const [driverUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائق ECO-001', '+966500000992')
    returning id
  `;
  if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = driverUser.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'م و ر 4322')
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;

  await sql`
    insert into subscriptions (city_id, driver_id, plan, status)
    values (${cityId}, ${driverId}, 'both'::subscription_plan, 'active'::subscription_status)
  `;
  await sql`
    insert into driver_capabilities (city_id, driver_id, service, is_enabled)
    values (${cityId}, ${driverId}, 'transport'::service_type, true)
  `;

  // زرعُ سائقٍ ثانٍ (يُبثُّ عرضاً ولا يُسنَدُ إليه — لاختبارِ عدِّ `order_offers`)
  const [driver2User] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${DRIVER2_TELEGRAM_ID}, 'driver', 'سائق عرض ECO-001', '+966500000993')
    returning id
  `;
  const driver2UserId = driver2User?.id ?? "";
  const [driver2] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driver2UserId}, 'verified'::verification_status, 'سيدان', 'م و ر 4323')
    returning id
  `;
  const driver2Id = driver2?.id ?? "";

  await sql`
    insert into subscriptions (city_id, driver_id, plan, status)
    values (${cityId}, ${driver2Id}, 'both'::subscription_plan, 'active'::subscription_status)
  `;
  await sql`
    insert into driver_capabilities (city_id, driver_id, service, is_enabled)
    values (${cityId}, ${driver2Id}, 'transport'::service_type, true)
  `;

  // زرعُ طلبٍ مُكمَّلٍ بتاريخٍ ثابتٍ
  const [order] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, assigned_driver_id, matched_at, started_at, completed_at, created_at)
    values (
      ${cityId},
      ${riderId},
      'transport'::service_type,
      'completed'::order_status,
      st_setsrid(st_makepoint(39.1751, 21.5471), 4326)::geography,
      ${driverId},
      ${ORDER_CREATED_AT},
      ${ORDER_CREATED_AT},
      ${ORDER_COMPLETED_AT},
      ${ORDER_CREATED_AT}
    )
    returning id
  `;
  const orderId = order?.id ?? "";

  // زرعُ عرضٍ من السائقِ الثانى (لم يُسنَدْ إليه)
  if (orderId !== "" && driver2Id !== "") {
    await sql`
      insert into order_offers (city_id, order_id, driver_id, status, expires_at, created_at)
      values (${cityId}, ${orderId}, ${driver2Id}, 'rejected'::offer_status, ${ORDER_COMPLETED_AT}, ${ORDER_CREATED_AT})
    `;
  }
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  // تنظيفُ السائقِ الثانى
  if (driverId !== "") {
    await sql`delete from order_offers where driver_id in (select id from drivers where user_id in (select id from users where telegram_id in (${DRIVER2_TELEGRAM_ID})))`;
  }
  // تنظيفُ الطلباتِ
  if (riderId !== "") {
    await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId})`;
    await sql`delete from orders where rider_id = ${riderId}`;
  }
  // تنظيفُ السائقينَ
  if (driverId !== "") {
    await sql`delete from driver_capabilities where driver_id = ${driverId}`;
    await sql`delete from subscriptions where driver_id = ${driverId}`;
    await sql`delete from drivers where id = ${driverId}`;
  }
  const driver2Rows = await sql<{ id: string }[]>`
    select id from drivers where user_id in (
      select id from users where telegram_id = ${DRIVER2_TELEGRAM_ID}
    )
  `;
  for (const row of driver2Rows) {
    await sql`delete from driver_capabilities where driver_id = ${row.id}`;
    await sql`delete from subscriptions where driver_id = ${row.id}`;
    await sql`delete from drivers where id = ${row.id}`;
  }
  // تنظيفُ الراكبِ
  if (riderId !== "") {
    await sql`delete from riders where id = ${riderId}`;
  }
  for (const id of [riderUserId, driverUserId]) {
    if (id === "") continue;
    const d2Rows = await sql<
      { id: string }[]
    >`select id from users where telegram_id = ${DRIVER2_TELEGRAM_ID}`;
    for (const row of d2Rows) {
      await sql`delete from users where id = ${row.id}`;
    }
    await sql`delete from users where id = ${id}`;
  }
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("ECO-001 — مقاماتُ التكلفةِ لكلِّ مستخدمٍ نشطٍ ولكلِّ رحلة", () => {
  it("يعدُّ الراكبينَ النشطينَ من `orders.rider_id` في النافذةِ", async () => {
    const rows = await sql<{ count: number }[]>`
      select count(DISTINCT rider_id) as count from orders
      where created_at >= ${WINDOW_FROM} and created_at < ${WINDOW_TO}
    `;
    expect(rows[0]?.count).toBeGreaterThanOrEqual(1);
  });

  it("يعدُّ السائقينَ النشطينَ من `orders.assigned_driver_id` ∪ `order_offers.driver_id`", async () => {
    const assignedRows = await sql<{ count: number }[]>`
      select count(DISTINCT assigned_driver_id) as count from orders
      where assigned_driver_id is not null
        and created_at >= ${WINDOW_FROM} and created_at < ${WINDOW_TO}
    `;
    const offerRows = await sql<{ count: number }[]>`
      select count(DISTINCT driver_id) as count from order_offers
      where created_at >= ${WINDOW_FROM} and created_at < ${WINDOW_TO}
    `;
    // السائقُ المُسنَدُ + السائقُ الذي بثَّ عرضاً = 2
    const totalDrivers = (assignedRows[0]?.count ?? 0) + (offerRows[0]?.count ?? 0);
    expect(totalDrivers).toBeGreaterThanOrEqual(2);
  });

  it("يعدُّ الطلباتِ المُنشأةَ والرحلاتِ المُكمَّلةَ منفصلةً", async () => {
    const createdRows = await sql<{ count: number }[]>`
      select count(*) as count from orders
      where created_at >= ${WINDOW_FROM} and created_at < ${WINDOW_TO}
    `;
    const completedRows = await sql<{ count: number }[]>`
      select count(*) as count from orders
      where completed_at >= ${WINDOW_FROM} and completed_at < ${WINDOW_TO}
    `;
    expect(createdRows[0]?.count).toBeGreaterThanOrEqual(1);
    expect(completedRows[0]?.count).toBeGreaterThanOrEqual(1);
  });

  it("يحسبُ الكميّاتِ الشهريّةَ والنِسبَ لكلِّ مستخدمٍ من حدٍّ أعلى مُشتقٍّ", () => {
    const activeUsers: ActiveUserCounts = {
      activeRiders: 1,
      activeDrivers: 2,
      totalActiveUsers: 3,
      ordersCreated: 1,
      completedRides: 1,
    };

    // كميّاتُ الرحلةِ من حدودِ `ECO-004` العليا — لا مقيسةٌ على نشرٍ حيٍّ
    const perRideQuantities: PerRideQuantities = {
      databaseRows: databaseRowBudget(),
      databaseBlocks: databaseBlockBudget(),
      queueMessages: queueMessageBudget(),
      redisCommands: redisCommandBudget(),
      networkBytes: networkByteBudget(),
      storageRows: storageRowBudget(),
    };

    const prices: UnitPrices = {};
    const result = judgeEcoUserCost(
      { from: WINDOW_FROM, to: WINDOW_TO } satisfies MonthlyWindow,
      activeUsers,
      perRideQuantities,
      prices,
    );

    // الكميّاتُ الشهريّةُ = حدُّ الرحلةِ × عددُ الرحلاتِ
    expect(result.monthlyUsage.monthlyDatabaseRows).toBe(databaseRowBudget() * 1);
    expect(result.monthlyUsage.monthlyRedisCommands).toBe(redisCommandBudget() * 1);

    // النِسبُ لكلِّ مستخدمٍ = الإجماليُّ ÷ 3
    expect(result.monthlyUsage.perUserDatabaseRows).toBeCloseTo(databaseRowBudget() / 3, 5);

    // التكلفةُ محجوبةٌ — السعرُ غائبٌ
    expect(result.monetaryCost.status.status).toBe("blocked");
    if (result.monetaryCost.status.status === "blocked") {
      expect(result.monetaryCost.status.reason).toBe("REQ-09");
    }
  });

  it("يحسبُ التكلفةَ النقديّةَ عندَ توفُّرِ جميعِ الأسعارِ المُحقونةِ", () => {
    const activeUsers: ActiveUserCounts = {
      activeRiders: 1,
      activeDrivers: 2,
      totalActiveUsers: 3,
      ordersCreated: 1,
      completedRides: 1,
    };

    const perRideQuantities: PerRideQuantities = {
      databaseRows: databaseRowBudget(),
      databaseBlocks: databaseBlockBudget(),
      queueMessages: queueMessageBudget(),
      redisCommands: redisCommandBudget(),
      networkBytes: networkByteBudget(),
      storageRows: storageRowBudget(),
    };

    // أسعارٌ مُحقونةٌ لأغراضِ الاختبارِ — ليست أسعارَ تشغيلٍ
    const prices: UnitPrices = {
      dbRowPrice: 0.0001,
      dbBlockPrice: 0.00005,
      queueMessagePrice: 0.001,
      redisCommandPrice: 0.00001,
      networkBytePrice: 0.00000001,
      storageRowPrice: 0.001,
    };

    const result = judgeEcoUserCost(
      { from: WINDOW_FROM, to: WINDOW_TO } satisfies MonthlyWindow,
      activeUsers,
      perRideQuantities,
      prices,
    );

    expect(result.monetaryCost.status.status).toBe("calculated");
    expect(result.monetaryCost.totalMonthlyCost).not.toBeNull();
    expect(result.monetaryCost.perUserCost).not.toBeNull();
    expect(result.monetaryCost.perRideCost).not.toBeNull();
  });
});
