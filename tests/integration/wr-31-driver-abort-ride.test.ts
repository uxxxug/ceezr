/**
 * الغرض: قياسُ «قطعِ الرحلةِ» من سطحِ السائقِ على قاعدةٍ حقيقيّةٍ (`WR-31`):
 *   ــ أنَّ القطعَ انتقالٌ ذرّيٌّ بختمِ إنسانٍ: `matched` أو `in_progress` ←
 *      `cancelled` بلامِلكيّةِ السائقِ المعروضِ، والراكبُ يُخبَرُ عبرَ صندوقِ
 *      الصادرِ لا إرسالًا مباشرًا (ADR 0265).
 *   ــ أنَّ السائقَ يعودُ متاحًا كما في الإكمالِ: من قطعَ رحلتَهُ جاهزٌ للتاليةِ.
 *   ــ أنَّ القطعَ يفتحُ تقييمَ السائقِ للراكبِ على الرحلةِ الملغاةِ (اتجاهُ
 *      السائقِ وحدَه) — فالراكبُ المزعجُ هوَ أشدُّ ما يريدُهُ السائقُ مسجَّلًا —
 *      والراكبُ لا يُقيِّمُ ما لم يُكمَل.
 *   ــ أنَّ التكرارَ والتطفّلَ يُرَدَّانِ برموزٍ مصنَّفةٍ لا بأسرارٍ.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (خدمة postgis)
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ (`ح-5`) ═══
 * ــ **لا يُقاسُ صدقُ القطعِ في الميدانِ**: أنَّ السائقَ يضغطُ «قطعُ الرحلةِ»
 *    حينَ يقعُ الطارئُ فعلًا ليسَ مقيسًا ولا يُدَّعى؛ المقيسُ أنَّ النظامَ لا
 *    يقطعُ من تلقاءِ نفسِهِ ولا يُقطعُ أمرًا اكتملَ.
 * ــ **لا يُقاسُ نصُّ رسالةِ الراكبِ ولا تسليمُهُ**: التسليمُ للعاملِ بإعادةٍ
 *    محكومةٍ، ونصُّ الرسالةِ في طبقةِ العاملِ (وحدةٌ لا تكاملٌ).
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
const DRIVER_TELEGRAM_ID = 900_000_381;
const RIVAL_TELEGRAM_ID = 900_000_382;
const RIDER_TELEGRAM_ID = 900_000_383;

const PICKUP = { lat: 21.4858, lng: 39.1925 };
const DROPOFF = { lat: 21.5433, lng: 39.1728 };

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let driverUserId = "";
let driverId = "";
let rivalUserId = "";
let rivalDriverId = "";
let riderUserId = "";
let riderId = "";

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

function abortRide(telegramId: number, orderId: string, reason: string | null): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select driver_abort_ride(${telegramId}::bigint, ${orderId}::uuid, ${reason}) as result
  `);
}

function markArrived(telegramId: number, orderId: string): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select driver_mark_arrived(${telegramId}::bigint, ${orderId}::uuid) as result
  `);
}

function startRide(telegramId: number, orderId: string): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select driver_start_ride(${telegramId}::bigint, ${orderId}::uuid) as result
  `);
}

function submitRating(
  telegramId: number,
  orderId: string,
  stars: number,
  comment: string | null,
): Promise<Payload> {
  // نداءُ الكاتبِ القائمِ كما يُنادي بهِ الإنتاجُ: `submit_rating_with_tags`
  // (بوسوسٍ معدومةٍ) لا حملًا زائدًا بجانبِه.
  return callJson(sql<{ result: Payload }[]>`
    select submit_rating_with_tags(
      ${orderId}::uuid, ${telegramId}::bigint, ${stars}::smallint, ${comment}, null::text[]
    ) as result
  `);
}

/**
 * طلبٌ يُناطُ بسائقِ هذا الملفِّ بالإيكالِ الحقيقيِّ لا بتحديثٍ يدويٍّ:
 * الحالةُ التي يُقاسُ عليها البندُ يجبُ أن تُصنَعَ بالطريقِ الذي يصنعُها الإنتاجُ.
 */
async function seedOrder(status: "matched" | "in_progress"): Promise<string> {
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
  if (status === "in_progress") {
    const arrived = await markArrived(DRIVER_TELEGRAM_ID, order.id);
    if (arrived.ok !== true) throw new Error(`تعذّر الوصولُ: ${String(arrived.error)}`);
    const started = await startRide(DRIVER_TELEGRAM_ID, order.id);
    if (started.ok !== true) throw new Error(`تعذّر البدءُ: ${String(started.error)}`);
  }
  return order.id;
}

/** يُفرِغُ ما زرعَه قياسٌ سابقٌ كي يبدأَ كلُّ قياسٍ من لوحٍ معروفٍ. */
async function clearOrders(): Promise<void> {
  await sql`
    delete from notification_outbox
     where order_id in (select id from orders where rider_id = ${riderId})
  `;
  await sql`
    delete from ratings
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

async function riderNoticeFor(orderId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::integer as n from notification_outbox
     where kind = 'rider_trip_notice'
       and dedup_key = 'rider_trip:' || ${orderId}::text || ':ABORTED'
  `;
  if (row === undefined) throw new Error("تعذّرَ عدُّ الصفوفِ");
  return row.n;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const seedDriver = async (
    telegramId: number,
    name: string,
    phone: string,
  ): Promise<{ userId: string; driverId: string }> => {
    const [user] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${telegramId}, 'driver', ${name}, ${phone})
      returning id
    `;
    if (user === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
    const [driver] = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (
        ${cityId}, ${user.id}, 'verified'::verification_status, 'سيدان',
        ${`م ه ط ${telegramId % 10_000}`}
      )
      returning id
    `;
    if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
    await sql`
      insert into driver_availability (driver_id, city_id, is_available)
      values (${driver.id}, ${cityId}, true)
      on conflict (driver_id) do update set is_available = true
    `;
    return { userId: user.id, driverId: driver.id };
  };

  const main = await seedDriver(DRIVER_TELEGRAM_ID, "سائقُ القطعِ", "+966500000381");
  driverUserId = main.userId;
  driverId = main.driverId;
  const rival = await seedDriver(RIVAL_TELEGRAM_ID, "سائقٌ آخرُ", "+966500000382");
  rivalUserId = rival.userId;
  rivalDriverId = rival.driverId;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone, language_code)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'هندُ القرشيّةُ', '+966500000383', 'ar')
    returning id
  `;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ الراكبةِ");
  riderUserId = riderUser.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبةِ");
  riderId = rider.id;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (riderId !== "") await clearOrders();
  for (const id of [driverId, rivalDriverId]) {
    if (id === "") continue;
    await sql`delete from notification_outbox where driver_id = ${id}`;
    await sql`delete from order_offers where driver_id = ${id}`;
    await sql`delete from driver_availability where driver_id = ${id}`;
    await sql`delete from driver_documents where driver_id = ${id}`;
  }
  if (riderId !== "") await sql`delete from riders where id = ${riderId}`;
  for (const id of [driverId, rivalDriverId]) {
    if (id !== "") await sql`delete from drivers where id = ${id}`;
  }
  for (const id of [driverUserId, rivalUserId, riderUserId]) {
    if (id === "") continue;
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("قطعُ الرحلةِ من سطحِ السائقِ (WR-31)", () => {
  it("١) قطعٌ من `matched`: انتقالٌ ذرّيٌّ وإخطارُ الراكبِ صندوقَ صادرٍ واحدًا", async () => {
    await clearOrders();
    const orderId = await seedOrder("matched");
    // السائقُ متاحٌ قبلَ القطعِ (أنهى عملًا سابقًا) — القطعُ لا يغيّرُ توافرَهُ سلبًا.
    const result = await abortRide(DRIVER_TELEGRAM_ID, orderId, "راكبٌ مزعجٌ");
    expect(result.ok).toBe(true);

    const [order] = await sql<{ status: string }[]>`
      select status from orders where id = ${orderId}
    `;
    expect(order?.status).toBe("cancelled");
    expect(await riderNoticeFor(orderId)).toBe(1);
  });

  it("٢) قطعٌ من `in_progress` (بدأتِ الرحلةُ): تُلغى والسائقُ يعودُ متاحًا", async () => {
    await clearOrders();
    const orderId = await seedOrder("in_progress");

    // البدءُ يُشغِلُ السائقَ؛ القطعُ يُعيدُهُ متاحًا كما يفعلُ الإكمالُ.
    const result = await abortRide(DRIVER_TELEGRAM_ID, orderId, null);
    expect(result.ok).toBe(true);

    const [order] = await sql<{ status: string }[]>`
      select status from orders where id = ${orderId}
    `;
    expect(order?.status).toBe("cancelled");
    const [availability] = await sql<{ is_available: boolean }[]>`
      select is_available from driver_availability where driver_id = ${driverId}
    `;
    expect(availability?.is_available).toBe(true);
  });

  it("٣) المِلكيّةُ قيدُ استعلامٍ: قطعُ مهمّةِ غيرِهِ ومعرِّفٌ معدومٌ `ORDER_NOT_ABORTABLE`", async () => {
    await clearOrders();
    const orderId = await seedOrder("matched");
    expect(await abortRide(RIVAL_TELEGRAM_ID, orderId, null)).toEqual({
      ok: false,
      error: "ORDER_NOT_ABORTABLE",
    });
    const [absent] = await sql<{ id: string }[]>`
      select gen_random_uuid()::text as id
    `;
    expect(await abortRide(DRIVER_TELEGRAM_ID, absent?.id ?? "", null)).toEqual({
      ok: false,
      error: "ORDER_NOT_ABORTABLE",
    });
  });

  it("٤) قطعُ المقطوعِ مرّتينِ يُرَدُّ — لا انتقالَ ثانيًا ولا إخطارَ مكرَّرًا", async () => {
    await clearOrders();
    const orderId = await seedOrder("matched");
    await abortRide(DRIVER_TELEGRAM_ID, orderId, "أولًا");
    const second = await abortRide(DRIVER_TELEGRAM_ID, orderId, "ثانيًا");
    expect(second).toEqual({ ok: false, error: "ORDER_NOT_ABORTABLE" });
    expect(await riderNoticeFor(orderId)).toBe(1);
  });

  it("٥) الاكتملُ لا يُقطَعُ: `completed` خارجُ نطاقِ القطعِ تمامًا", async () => {
    await clearOrders();
    const orderId = await seedOrder("in_progress");
    const completed = await callJson(sql<{ result: Payload }[]>`
      select driver_complete_ride(${DRIVER_TELEGRAM_ID}::bigint, ${orderId}::uuid) as result
    `);
    expect(completed.ok).toBe(true);
    expect(await abortRide(DRIVER_TELEGRAM_ID, orderId, null)).toEqual({
      ok: false,
      error: "ORDER_NOT_ABORTABLE",
    });
  });

  it("٦) تقييمُ السائقِ للراكبِ على المقطوعةِ يُقبلُ ويُثمِرُ في سمعتِها", async () => {
    await clearOrders();
    const orderId = await seedOrder("in_progress");
    await abortRide(DRIVER_TELEGRAM_ID, orderId, "سلوكٌ سيّئٌ");

    const rating = await submitRating(DRIVER_TELEGRAM_ID, orderId, 2, "راكبةٌ مزعجةٌ");
    expect(rating.ok).toBe(true);

    const [riderRow] = await sql<{ rating_average: number | null; rating_count: number }[]>`
      select rating_average, rating_count from riders where id = ${riderId}
    `;
    expect(Number(riderRow?.rating_average)).toBe(2);
    expect(riderRow?.rating_count).toBe(1);
  });

  it("٧) التقييمُ مرةً واحدةً: الثانيةُ `ALREADY_RATED` بالقيدِ لا بالفحصِ", async () => {
    await clearOrders();
    const orderId = await seedOrder("in_progress");
    await abortRide(DRIVER_TELEGRAM_ID, orderId, null);
    await submitRating(DRIVER_TELEGRAM_ID, orderId, 3, null);
    expect(await submitRating(DRIVER_TELEGRAM_ID, orderId, 4, null)).toEqual({
      ok: false,
      error: "ALREADY_RATED",
    });
  });

  it("٨) الراكبُ لا يُقيِّمُ مقطوعةً: `ORDER_NOT_COMPLETED` — بابُهُ الإكمالُ", async () => {
    await clearOrders();
    const orderId = await seedOrder("in_progress");
    await abortRide(DRIVER_TELEGRAM_ID, orderId, null);
    expect(await submitRating(RIDER_TELEGRAM_ID, orderId, 1, null)).toEqual({
      ok: false,
      error: "ORDER_NOT_COMPLETED",
    });
  });

  it("٩) سببٌ أطولَ منَ الحدِّ يُرَدُّ قبلَ أيِّ كتابةٍ", async () => {
    await clearOrders();
    const orderId = await seedOrder("matched");
    const longReason = "س".repeat(501);
    expect(await abortRide(DRIVER_TELEGRAM_ID, orderId, longReason)).toEqual({
      ok: false,
      error: "REASON_TOO_LONG",
    });
    const [order] = await sql<{ status: string }[]>`
      select status from orders where id = ${orderId}
    `;
    expect(order?.status).not.toBe("cancelled");
  });

  it("١٠) أثرُ القطعِ في السجلِّ: `order.aborted_by_driver` بالسببِ والطورِ السابقِ", async () => {
    await clearOrders();
    const orderId = await seedOrder("in_progress");
    await abortRide(DRIVER_TELEGRAM_ID, orderId, "طارئٌ");
    const [entry] = await sql<{ action: string; reason: string | null; was: string }[]>`
      select action,
             payload->>'reason' as reason,
             payload->>'was_status' as was
        from audit_log
       where entity_type = 'order' and entity_id = ${orderId}
         and action = 'order.aborted_by_driver'
    `;
    expect(entry?.action).toBe("order.aborted_by_driver");
    expect(entry?.reason).toBe("طارئٌ");
    expect(entry?.was).toBe("in_progress");
  });

  it("١١) ملخَّصُ المقطوعةِ: السائقُ يرى بطاقةَ الراكبِ وبابَ التقييمِ مفتوحًا، والراكبُ لا", async () => {
    await clearOrders();
    const orderId = await seedOrder("in_progress");
    await abortRide(DRIVER_TELEGRAM_ID, orderId, null);

    const driverView = await callJson(sql<{ result: Record<string, unknown> }[]>`
      select completed_ride_summary(${DRIVER_TELEGRAM_ID}::bigint, ${orderId}::uuid) as result
    `);
    expect(driverView.ok).toBe(true);
    expect(driverView.status).toBe("cancelled");
    // بطاقةُ الراكبِ حاضرةٌ — السائقُ يرى من قطعَ عليهِ الرحلةَ ليُقيِّمَه.
    expect(driverView.rider).not.toBeNull();
    const driverRating = driverView.rating as {
      direction: string;
      can_rate: boolean;
      window_closed: boolean;
    };
    expect(driverRating.direction).toBe("driver_to_rider");
    expect(driverRating.can_rate).toBe(true);
    expect(driverRating.window_closed).toBe(false);

    const riderView = await callJson(sql<{ result: Record<string, unknown> }[]>`
      select completed_ride_summary(${RIDER_TELEGRAM_ID}::bigint, ${orderId}::uuid) as result
    `);
    expect(riderView.ok).toBe(true);
    // الراكبُ لا يرى بطاقةَ سائقٍ في رحلةٍ ملغاةً ولا بابَ تقييمٍ.
    expect(riderView.driver).toBeNull();
    const riderRating = riderView.rating as { direction: string; can_rate: boolean };
    expect(riderRating.can_rate).toBe(false);
  });
});
