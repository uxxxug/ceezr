/**
 * الغرض: قياسُ سياسةِ نبضةِ الموقعِ على PostgreSQL حقيقيٍّ — السببُ من حالةِ
 *   المَهمّةِ والتوافُرِ، والمُدّةُ من `platform_settings` لمدينةِ السائقِ، والغيابُ
 *   `null` لا صفرٌ، والكتلةُ منشورةٌ في مَخرجَي `driver_active_job` (البند `F3-04`).
 * الحالة: مُختبَرٌ على قاعدةٍ حقيقيّةٍ — البند `F3-04`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: `bun run test:integration` وخطوةُ «تكامل على PostgreSQL حقيقي» في CI.
 * الحاكم: docs/adr/0119-a-heartbeat-needs-a-published-reason.md
 *
 * ولِمَ الحالةُ تُصنَعُ بالإيكالِ الحقيقيِّ: قياسُ سياسةٍ على حالةٍ صُنِعَت
 * بـ`update orders set status` يقيسُ حالةً لا تقعُ في الإنتاجِ.
 *
 * ## وما لا يقيسُه هذا المِلفُّ عن قصدٍ — (`ح-5`)
 *
 * - **لا يقيسُ مؤقّتَ المتصفِّحِ ولا استهلاكَ البطاريّةِ**: كلاهما غيرُ مقيسٍ
 *   ولا يُدَّعى؛ المقيسُ ههنا **حكمُ الخادمِ** الذي يُطيعُه العميلُ.
 * - **لا يقيسُ استقبالَ الموقعِ** (`F4-01`): لهُ اختبارُه القائمُ، وهذا البندُ
 *   لم يُغيِّرْ فيه سطراً.
 * - **لا يدَّعي تتبُّعاً حيّاً للراكبِ**: عائقُ `F2-06` يبقى مفتوحاً (ADR 0035 §4).
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

/** معرّفاتٌ يزرعُها هذا الملفُّ وحدَه. */
const DRIVER_TELEGRAM_ID = 900_000_361;
const RIDER_TELEGRAM_ID = 900_000_362;
const RIDER_PHONE = "+966500000362";

const PICKUP = { lat: 21.4858, lng: 39.1925 };
const DROPOFF = { lat: 21.5433, lng: 39.1728 };

const KEY_AVAILABLE = "location_broadcast_seconds_available";
const KEY_MATCHED = "location_broadcast_seconds_matched";
const KEY_ON_TRIP = "location_broadcast_seconds_on_trip";

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let driverUserId = "";
let driverId = "";
let riderUserId = "";
let riderId = "";

interface Payload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly [key: string]: unknown;
}

interface Broadcast {
  readonly reason: string | null;
  readonly interval_seconds: number | null;
}

async function callJson(query: Promise<{ result: Payload }[]>): Promise<Payload> {
  const [row] = await query;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

function activeJob(telegramId: number): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select driver_active_job(${telegramId}::bigint) as result
  `);
}

/** الكتلةُ كما يقرأُها العميلُ: في **جذرِ** الحمولةِ لا داخلَ المَهمّةِ. */
function broadcast(payload: Payload): Broadcast {
  const value = payload.location_broadcast;
  if (value === null || typeof value !== "object") {
    throw new Error("لا كتلةَ بثٍّ في جذرِ الحمولةِ");
  }
  return value as unknown as Broadcast;
}

async function policy(options: {
  readonly status?: string | null;
  readonly arrivedAt?: string | null;
  readonly isAvailable?: boolean | null;
}): Promise<Broadcast> {
  const [row] = await sql<{ result: Broadcast }[]>`
    select driver_location_broadcast_policy(
      ${cityId}::uuid,
      ${options.status ?? null}::text,
      ${options.arrivedAt ?? null}::timestamptz,
      ${options.isAvailable ?? null}::boolean
    ) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من دالّةِ السياسةِ");
  return row.result;
}

async function setSeconds(key: string, seconds: number | null): Promise<void> {
  if (seconds === null) {
    await sql`delete from platform_settings where city_id = ${cityId} and key = ${key}`;
    return;
  }
  await sql`
    insert into platform_settings (city_id, key, value, value_type, description_ar)
    values (${cityId}, ${key}, to_jsonb(${seconds}::numeric), 'number', 'قياسٌ')
    on conflict (city_id, key) do update set value = to_jsonb(${seconds}::numeric),
                                            value_type = 'number'
  `;
}

async function setAvailability(isAvailable: boolean): Promise<void> {
  await sql`
    update driver_availability set is_available = ${isAvailable} where driver_id = ${driverId}
  `;
}

async function seedMatchedOrder(): Promise<string> {
  const [order] = await sql<{ id: string }[]>`
    insert into orders (
      city_id, rider_id, service, status, pickup, dropoff, pickup_label, dropoff_label
    ) values (
      ${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
      st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
      st_setsrid(st_makepoint(${DROPOFF.lng}, ${DROPOFF.lat}), 4326)::geography,
      'دوّارُ الانطلاقِ', 'بوّابةُ الوجهةِ'
    ) returning id
  `;
  if (order === undefined) throw new Error("تعذّر زرعُ الطلبِ");
  await sql`
    insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
    values (${cityId}, ${order.id}, ${driverId}, 1, 'pending'::offer_status,
            now() + make_interval(secs => 120))
  `;
  const claim = await callJson(sql<{ result: Payload }[]>`
    select claim_ride(${order.id}::uuid, ${driverId}::uuid) as result
  `);
  if (claim.ok !== true) throw new Error(`تعذّر الإيكالُ: ${String(claim.error)}`);
  return order.id;
}

async function clearOrders(): Promise<void> {
  await sql`
    delete from notification_outbox
     where order_id in (select id from orders where rider_id = ${riderId})
  `;
  await sql`
    delete from order_offers where order_id in (select id from orders where rider_id = ${riderId})
  `;
  await sql`
    delete from audit_log
     where entity_type = 'order'
       and entity_id in (select id from orders where rider_id = ${riderId})
  `;
  await sql`delete from orders where rider_id = ${riderId}`;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [user] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائقُ النبضةِ', '+966500000361')
    returning id
  `;
  if (user === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = user.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ن ب ض 361')
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;
  await sql`
    insert into driver_availability (driver_id, city_id, is_available)
    values (${driverId}, ${cityId}, true)
    on conflict (driver_id) do update set is_available = true
  `;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone, language_code)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكبةُ النبضةِ', ${RIDER_PHONE}, 'ar')
    returning id
  `;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ الراكبةِ");
  riderUserId = riderUser.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبةِ");
  riderId = rider.id;

  // الإعداداتُ تُعادُ إلى قيمِ الهجرةِ قبلَ كلِّ قياسٍ يُغيِّرُها.
  await setSeconds(KEY_AVAILABLE, 60);
  await setSeconds(KEY_MATCHED, 15);
  await setSeconds(KEY_ON_TRIP, 20);
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (riderId !== "") await clearOrders();
  if (driverId !== "") {
    await setSeconds(KEY_AVAILABLE, 60);
    await setSeconds(KEY_MATCHED, 15);
    await setSeconds(KEY_ON_TRIP, 20);
    await sql`delete from notification_outbox where driver_id = ${driverId}`;
    await sql`delete from order_offers where driver_id = ${driverId}`;
    await sql`delete from driver_availability where driver_id = ${driverId}`;
    await sql`delete from driver_documents where driver_id = ${driverId}`;
  }
  if (riderId !== "") await sql`delete from riders where id = ${riderId}`;
  if (driverId !== "") await sql`delete from drivers where id = ${driverId}`;
  for (const id of [driverUserId, riderUserId]) {
    if (id === "") continue;
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("سياسةُ النبضةِ — سببٌ مُسمّىً ومُدّةٌ من إعدادِ المدينةِ", () => {
  it("١) سائقٌ متاحٌ بلا مَهمّةٍ ⇒ `AVAILABLE` بمُدّةِ الإعدادِ", async () => {
    expect(await policy({ isAvailable: true })).toEqual({
      reason: "AVAILABLE",
      interval_seconds: 60,
    });
  });

  it("٢) سائقٌ غيرُ متاحٍ بلا مَهمّةٍ ⇒ لا سببَ ولا مُدّةَ — سكونٌ صريحٌ", async () => {
    expect(await policy({ isAvailable: false })).toEqual({
      reason: null,
      interval_seconds: null,
    });
  });

  it("٣) مَهمّةٌ مُوكَلةٌ لم يُختَم وصولُها ⇒ `TO_PICKUP` وهيَ أقصرُ مُدّةٍ", async () => {
    const verdict = await policy({ status: "matched", isAvailable: false });
    expect(verdict).toEqual({ reason: "TO_PICKUP", interval_seconds: 15 });
    expect(verdict.interval_seconds).toBeLessThan(60);
  });

  it("٤) ختمُ الوصولِ يُسكِتُ النبضةَ حتّى بدءِ الرحلةِ — ولا مسافةَ تُستنتَجُ", async () => {
    expect(
      await policy({ status: "matched", arrivedAt: new Date().toISOString(), isAvailable: false }),
    ).toEqual({ reason: null, interval_seconds: null });
  });

  it("٥) رحلةٌ جاريةٌ ⇒ `ON_TRIP` بمُدّتِه، والتوافُرُ لا يُغيِّرُها", async () => {
    expect(await policy({ status: "in_progress", isAvailable: false })).toEqual({
      reason: "ON_TRIP",
      interval_seconds: 20,
    });
    expect(await policy({ status: "in_progress", isAvailable: true })).toEqual({
      reason: "ON_TRIP",
      interval_seconds: 20,
    });
  });

  it("٦) حالةٌ مُنتهيةٌ (`completed`) ⇒ لا سببَ — لا نبضةَ بعدَ التسليمِ", async () => {
    expect(await policy({ status: "completed", isAvailable: false })).toEqual({
      reason: null,
      interval_seconds: null,
    });
  });

  it("٧) إعدادٌ غائبٌ ⇒ سببٌ منشورٌ ومُدّةٌ `null` (فشلٌ مغلقٌ لا رقمٌ مُخترَعٌ)", async () => {
    await setSeconds(KEY_ON_TRIP, null);
    try {
      expect(await policy({ status: "in_progress" })).toEqual({
        reason: "ON_TRIP",
        interval_seconds: null,
      });
    } finally {
      await setSeconds(KEY_ON_TRIP, 20);
    }
  });

  it("٨) إعدادٌ غيرُ موجبٍ (صفرٌ أو سالبٌ) ⇒ مُدّةٌ `null` لا بثٌّ متّصلٌ", async () => {
    for (const seconds of [0, -5]) {
      await setSeconds(KEY_AVAILABLE, seconds);
      expect(await policy({ isAvailable: true })).toEqual({
        reason: "AVAILABLE",
        interval_seconds: null,
      });
    }
    await setSeconds(KEY_AVAILABLE, 60);
  });

  it("٩) مُدّةٌ كسريّةٌ تُقرأُ عدداً صحيحاً لا كسراً", async () => {
    await setSeconds(KEY_AVAILABLE, 42.7);
    try {
      const verdict = await policy({ isAvailable: true });
      expect(verdict.interval_seconds).toBe(42);
    } finally {
      await setSeconds(KEY_AVAILABLE, 60);
    }
  });

  it("١٠) مدينةٌ معدومةٌ ⇒ سببٌ منشورٌ ومُدّةٌ `null` — لا انفجارَ ولا ارتدادَ", async () => {
    const [row] = await sql<{ result: Broadcast }[]>`
      select driver_location_broadcast_policy(
        '00000000-0000-0000-0000-000000000000'::uuid, 'in_progress'::text,
        null::timestamptz, false::boolean
      ) as result
    `;
    expect(row?.result).toEqual({ reason: "ON_TRIP", interval_seconds: null });
  });
});

describeIf("الكتلةُ منشورةٌ في قراءةِ المَهمّةِ — في المَخرجَينِ كِلَيهِما", () => {
  it("١١) لا مَهمّةَ وسائقٌ متاحٌ: الكتلةُ في جذرِ الحمولةِ بسببِ التوافُرِ", async () => {
    await clearOrders();
    await setAvailability(true);
    const payload = await activeJob(DRIVER_TELEGRAM_ID);
    expect(payload.ok).toBe(true);
    expect(payload.job).toBeNull();
    expect(broadcast(payload)).toEqual({ reason: "AVAILABLE", interval_seconds: 60 });
  });

  it("١٢) لا مَهمّةَ وسائقٌ مُنصَرِفٌ: الكتلةُ حاضرةٌ وقيمُها عَدَمٌ لا صفرٌ", async () => {
    await clearOrders();
    await setAvailability(false);
    try {
      const block = broadcast(await activeJob(DRIVER_TELEGRAM_ID));
      expect(block).toEqual({ reason: null, interval_seconds: null });
      expect(block.interval_seconds).not.toBe(0);
    } finally {
      await setAvailability(true);
    }
  });

  it("١٣) مَهمّةٌ مُوكَلةٌ: الكتلةُ `TO_PICKUP` وليسَت داخلَ كتلةِ المَهمّةِ", async () => {
    await clearOrders();
    const orderId = await seedMatchedOrder();
    const payload = await activeJob(DRIVER_TELEGRAM_ID);
    const job = payload.job as Readonly<Record<string, unknown>>;
    expect(job.order_id).toBe(orderId);
    expect(job.location_broadcast).toBeUndefined();
    expect(broadcast(payload)).toEqual({ reason: "TO_PICKUP", interval_seconds: 15 });
  });

  it("١٤) بعدَ ختمِ الوصولِ تسكُنُ النبضةُ، وببدءِ الرحلةِ تعودُ `ON_TRIP`", async () => {
    await clearOrders();
    const orderId = await seedMatchedOrder();
    const arrived = await callJson(sql<{ result: Payload }[]>`
      select driver_mark_arrived(${DRIVER_TELEGRAM_ID}::bigint, ${orderId}::uuid) as result
    `);
    expect(arrived.ok).toBe(true);
    expect(broadcast(await activeJob(DRIVER_TELEGRAM_ID))).toEqual({
      reason: null,
      interval_seconds: null,
    });

    const started = await callJson(sql<{ result: Payload }[]>`
      select driver_start_ride(${DRIVER_TELEGRAM_ID}::bigint, ${orderId}::uuid) as result
    `);
    expect(started.ok).toBe(true);
    expect(broadcast(await activeJob(DRIVER_TELEGRAM_ID))).toEqual({
      reason: "ON_TRIP",
      interval_seconds: 20,
    });
  });

  it("١٥) بعدَ إتمامِ الرحلةِ لا سببَ للبثِّ — والمُدّةُ لا تُورَثُ", async () => {
    await clearOrders();
    const orderId = await seedMatchedOrder();
    await sql`select driver_mark_arrived(${DRIVER_TELEGRAM_ID}::bigint, ${orderId}::uuid)`;
    await sql`select driver_start_ride(${DRIVER_TELEGRAM_ID}::bigint, ${orderId}::uuid)`;
    const done = await callJson(sql<{ result: Payload }[]>`
      select driver_complete_ride(${DRIVER_TELEGRAM_ID}::bigint, ${orderId}::uuid) as result
    `);
    expect(done.ok).toBe(true);
    const payload = await activeJob(DRIVER_TELEGRAM_ID);
    expect(payload.job).toBeNull();
    const block = broadcast(payload);
    expect(block.reason).not.toBe("ON_TRIP");
    expect(block.interval_seconds === null || block.interval_seconds === 60).toBe(true);
  });

  it("١٦) الأذوناتُ محصورةٌ: `public` و`anon` لا يُنفِّذانِ دالّةَ السياسةِ", async () => {
    const [row] = await sql<{ public_can: boolean; anon_can: boolean }[]>`
      select
        has_function_privilege('public', 'driver_location_broadcast_policy(uuid, text, timestamptz, boolean)', 'execute') as public_can,
        has_function_privilege('anon', 'driver_location_broadcast_policy(uuid, text, timestamptz, boolean)', 'execute') as anon_can
    `;
    expect(row?.public_can).toBe(false);
    expect(row?.anon_can).toBe(false);
  });
});
