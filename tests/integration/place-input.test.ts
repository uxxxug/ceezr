/**
 * الغرض: قياسُ `LOC-TRUST-01` (ADR 0247) على PostgreSQL حقيقيٍّ: أنَّ `request_ride_with_places`
 *   تحفظُ ما أدخلَه الراكبُ عن المكانين (المصدر · الدقّة · وقت الالتقاط · الرابط الأصليّ حرفاً ·
 *   الملاحظات) في الطلبِ نفسِه وفي المعاملةِ نفسِها، وأنَّ قارئَ بطاقةِ السائق يقرؤه كما هو،
 *   وأنَّ حمولةً غيرَ صالحةٍ تُرفَضُ **قبلَ** إنشاءِ أيِّ طلب، وأنَّ الضغطةَ الثانيةَ لا تُعيدُ الكتابة.
 * الحالة: اختبار تكاملٍ — يُتخطّى بلا `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { readOrderPlaceExtras } from "../../packages/infrastructure/transport/order-place-extras.ts";
import { createRideRequestCommand } from "../../packages/infrastructure/transport/ride-request-store.ts";
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

const RIDER_TELEGRAM_ID = 900_002_471;

let cityHandle: ActiveCityHandle | undefined;
let riderUserId = "";
let riderId = "";

const ORIGIN = { lat: 21.4858, lng: 39.1925 } as const;
const DESTINATION = { lat: 21.5433, lng: 39.1728 } as const;
const SHORT_LINK = "https://maps.app.goo.gl/AbCdEf12345";
const GOOGLE_LINK = `https://www.google.com/maps/place/x/@21.54,39.17,17z/data=!3d${DESTINATION.lat}!4d${DESTINATION.lng}`;

/** نوعٌ مجهولٌ — كائنٌ صحيحُ الترميزِ (`::text::jsonb`) كي يُقاسَ الحكمُ لا عطبُ الترميز. */
const INVALID_PLACE = JSON.stringify({ point_source: "NOPE" });

function keyFor(label: string): string {
  return `ride:${label}:${crypto.randomUUID()}`;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  const cityId = cityHandle.cityId;
  const [user] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكب اختبار المكان', '+966500002471')
    returning id
  `;
  if (user === undefined) throw new Error("تعذّر زرعُ مستخدمِ الراكبِ");
  riderUserId = user.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبِ");
  riderId = rider.id;
});

afterEach(async () => {
  if (DATABASE_URL === undefined || riderId === "") return;
  await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId})`;
  await sql`delete from orders where rider_id = ${riderId}`;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (riderId !== "") {
    await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId})`;
    await sql`delete from orders where rider_id = ${riderId}`;
    await sql`delete from riders where id = ${riderId}`;
  }
  if (riderUserId !== "") {
    await sql`delete from audit_log where actor_user_id = ${riderUserId}`;
    await sql`delete from users where id = ${riderUserId}`;
  }
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("LOC-TRUST-01 — المكانُ يصلُ القاعدةَ وبطاقةَ السائق كاملاً", () => {
  it("اسمٌ + نقطةٌ + ملاحظاتٌ + رابطٌ مختصرٌ (الالتقاط) ورابطُ Google (الوجهة) يُحفَظانِ حرفاً", async () => {
    const capturedAt = new Date(Date.now() - 2_000).toISOString();
    const result = await createRideRequestCommand(sql).create({
      telegramUserId: String(RIDER_TELEGRAM_ID),
      idempotencyKey: keyFor("full"),
      service: "transport",
      origin: ORIGIN,
      destination: DESTINATION,
      notes: null,
      pickupLabel: "عمارة الريان",
      dropoffLabel: null,
      pickupPlace: {
        source: "DEVICE",
        accuracyM: 8.5,
        capturedAt,
        link: SHORT_LINK,
        notes: "عند البوابة 3",
      },
      dropoffPlace: {
        source: "SHARED_LINK",
        accuracyM: null,
        capturedAt: null,
        link: GOOGLE_LINK,
        notes: "الباب 21",
      },
    });
    expect(result.ok && result.value.accepted).toBe(true);
    if (!result.ok || !result.value.accepted) return;
    const orderId = result.value.ride.orderId;

    const [row] = await sql<Record<string, unknown>[]>`
      select pickup_label, dropoff_label, pickup_link, pickup_notes, pickup_point_source,
             pickup_accuracy_m, pickup_captured_at, dropoff_link, dropoff_notes,
             dropoff_point_source, dropoff_accuracy_m, dropoff_captured_at
        from orders where id = ${orderId}
    `;
    expect(row).toMatchObject({
      pickup_label: "عمارة الريان",
      dropoff_label: null,
      pickup_link: SHORT_LINK,
      pickup_notes: "عند البوابة 3",
      pickup_point_source: "DEVICE",
      pickup_accuracy_m: 8.5,
      dropoff_link: GOOGLE_LINK,
      dropoff_notes: "الباب 21",
      dropoff_point_source: "SHARED_LINK",
      dropoff_accuracy_m: null,
      dropoff_captured_at: null,
    });
    expect(new Date(String(row?.pickup_captured_at)).toISOString()).toBe(capturedAt);

    // بطاقةُ السائق تقرأُ ما حُفِظَ — لا اسمَ يُخترَعُ ولا رابطَ يُعادُ ترميزُه.
    const extras = (await readOrderPlaceExtras(sql, [orderId])).get(orderId);
    expect(extras?.pickup).toEqual({
      link: SHORT_LINK,
      notes: "عند البوابة 3",
      latitude: ORIGIN.lat,
      longitude: ORIGIN.lng,
    });
    expect(extras?.dropoff?.link).toBe(GOOGLE_LINK);
    expect(extras?.dropoff?.notes).toBe("الباب 21");
  });

  it("حمولةٌ غيرُ صالحةٍ تُرفَضُ PLACE_INVALID ولا يُنشَأُ طلب", async () => {
    const key = keyFor("invalid");
    const [row] = await sql<{ result: { ok: boolean; error?: string } }[]>`
      select request_ride_with_places(${RIDER_TELEGRAM_ID}::bigint, ${key}::text,
        'transport'::service_type, ${ORIGIN.lat}::double precision, ${ORIGIN.lng}::double precision,
        ${DESTINATION.lat}::double precision, ${DESTINATION.lng}::double precision,
        null::text, null::text, null::text, null::timestamptz, null::integer,
        ${INVALID_PLACE}::text::jsonb, null::jsonb) as result
    `;
    expect(row?.result).toEqual({ ok: false, error: "PLACE_INVALID" });
    const [count] = await sql<{ n: string }[]>`
      select count(*)::text as n from orders where idempotency_key = ${key}
    `;
    expect(count?.n).toBe("0");
  });

  it("الضغطةُ الثانيةُ بالمفتاحِ نفسِه لا تُعيدُ كتابةَ المكان", async () => {
    const key = keyFor("reuse");
    const base = {
      telegramUserId: String(RIDER_TELEGRAM_ID),
      idempotencyKey: key,
      service: "transport",
      origin: ORIGIN,
      destination: DESTINATION,
      notes: null,
    } as const;
    const first = await createRideRequestCommand(sql).create({
      ...base,
      pickupPlace: {
        source: "MAP_PIN",
        accuracyM: null,
        capturedAt: null,
        link: null,
        notes: "الأولى",
      },
    });
    const second = await createRideRequestCommand(sql).create({
      ...base,
      pickupPlace: {
        source: "MAP_PIN",
        accuracyM: null,
        capturedAt: null,
        link: null,
        notes: "الثانية",
      },
    });
    expect(second.ok && second.value.accepted && second.value.ride.reused).toBe(true);
    if (!first.ok || !first.value.accepted) return;
    const [row] = await sql<{ pickup_notes: string | null }[]>`
      select pickup_notes from orders where id = ${first.value.ride.orderId}
    `;
    expect(row?.pickup_notes).toBe("الأولى");
  });
});
