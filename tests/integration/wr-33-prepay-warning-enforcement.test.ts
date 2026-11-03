/**
 * الغرض: `WR-33` — حارسُ «تنبيهِ التحويلاتِ الماليّةِ المسبقة» على **المسارِ المكوَّنِ الفعلي**
 *   (جلسةٌ موقَّعةٌ ← مسارُ HTTP ← الحارس ← دالّةُ القاعدة `request_ride_with_offer`)، ويُقاسُ الردُّ
 *   **وأثرُ القاعدةِ معًا** (هل كُتِبَ صفٌّ في `orders`)، لأنَّ الردَّ وحدَه قد يكذب:
 *   - `POST /v1/rides` (نقلٌ) و`POST /v1/deliveries` بلا إقرارٍ ← `400 PREPAY_WARNING_ACK_REQUIRED` بلا صفّ.
 *   - بالإقرارِ ← صفٌّ واحد؛ وإعادةُ المحاولةِ بالمفتاحِ نفسِه (متابعةُ الطلبِ نفسِه) ← الصفُّ نفسُه.
 *   - طلبٌ جديدٌ (مفتاحٌ جديد) بلا إقرارٍ ← مرفوضٌ ولو سبقَه إقرارٌ لطلبٍ آخر.
 *   - مسارُ البوتِ (المنفذُ نفسُه الملفوفُ كما في `container.ts`) يخضعُ للحكمِ نفسِه.
 * المرجع: `docs/work-packets/WR-33-prepay-warning.md`
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createServer } from "../../apps/gateway/src/server.ts";
import { requirePrepayWarningAck } from "../../packages/application/transport/prepay-warning-guard.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createMemorySessionRevocationStore } from "../../packages/infrastructure/identity/memory-session-revocation-store.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { createRevocableSessionReader } from "../../packages/infrastructure/identity/revocable-session-reader.ts";
import { createRideRequestCommand } from "../../packages/infrastructure/transport/ride-request-store.ts";
import { PREPAY_WARNING_ACK_VERSION } from "../../packages/shared/prepay-warning/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️ عيّن TEST_DATABASE_URL");
}

const SESSION_SECRET = "wr-33-prepay-warning-secret-بادئةٌ-طويلةٌ-كفايةً";
const WEBHOOK_SECRET = "wr-33-prepay-warning-webhook-secret";
const RIDER_TELEGRAM_ID = 910_003_301;
const DRIVER_TELEGRAM_ID = 910_003_302;

const PICKUP = { lat: 21.5433, lng: 39.1728 };
const DROPOFF = { lat: 21.5551, lng: 39.1902 };

let sql: Sql;
let app: ReturnType<typeof createServer>;
let cityHandle: ActiveCityHandle | undefined;
let riderUserId = "";
let driverUserId = "";
let riderId = "";
let accessToken = "";

async function post(
  path: string,
  key: string,
  body: Record<string, unknown>,
): Promise<{ readonly status: number; readonly json: Record<string, unknown> }> {
  const response = await app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        "Idempotency-Key": key,
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

const RIDE = {
  service: "transport",
  originLat: PICKUP.lat,
  originLng: PICKUP.lng,
  destinationLat: DROPOFF.lat,
  destinationLng: DROPOFF.lng,
};
const DELIVERY = { ...RIDE, service: "delivery", notes: "صندوق كتب" };

async function countRiderOrders(): Promise<number> {
  const rows = await sql<{ n: string }[]>`
    select count(*)::text as n from orders where rider_id = ${riderId}::uuid`;
  return Number(rows[0]?.n);
}

async function closeOpenOrders(): Promise<void> {
  await sql`
    update orders set status = 'cancelled'::order_status
    where rider_id = ${riderId}::uuid and status in ('searching'::order_status, 'scheduled'::order_status)`;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  const city = await ensureActiveCity(sql);
  cityHandle = city;
  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (telegram_id, language_code, role, city_id)
    values (${RIDER_TELEGRAM_ID}::bigint, 'ar', 'rider', ${city.cityId}::uuid)
    returning id`;
  if (riderUser === undefined) throw new Error("لم يُنشَأ راكبُ الاختبار");
  riderUserId = riderUser.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (user_id, city_id) values (${riderUserId}::uuid, ${city.cityId}::uuid)
    returning id`;
  if (rider === undefined) throw new Error("لم يُنشَأ صفُّ الراكب");
  riderId = rider.id;

  // حكمُ `SERVICE_NOT_AVAILABLE_IN_CITY` يشترطُ سائقًا موثَّقًا مشترِكًا قادرًا على الخدمتَين.
  const [driverUser] = await sql<{ id: string }[]>`
    insert into users (telegram_id, language_code, role, city_id)
    values (${DRIVER_TELEGRAM_ID}::bigint, 'ar', 'driver', ${city.cityId}::uuid)
    returning id`;
  if (driverUser === undefined) throw new Error("لم يُنشَأ سائقُ الاختبار");
  driverUserId = driverUser.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status)
    values (${city.cityId}::uuid, ${driverUserId}::uuid, 'verified'::verification_status)
    returning id`;
  if (driver === undefined) throw new Error("لم يُنشَأ صفُّ السائق");
  for (const service of ["transport", "delivery"]) {
    await sql`
      insert into driver_capabilities (city_id, driver_id, service, is_enabled)
      values (${city.cityId}::uuid, ${driver.id}::uuid, ${service}::service_type, true)`;
  }
  await sql`
    insert into subscriptions (city_id, driver_id, plan, status, current_period_end)
    values (${city.cityId}::uuid, ${driver.id}::uuid, 'both'::subscription_plan,
            'active'::subscription_status, now() + interval '30 days')`;

  const sessions = createRevocableSessionReader(
    createMiniAppSessionReader(SESSION_SECRET),
    createMemorySessionRevocationStore(),
  );
  const now = (): Date => new Date();
  // التركيبُ نفسُه الذي في `apps/gateway/src/index.ts` (بلا لفافةِ البثِّ التي لا تمسُّ الحكم).
  const rides = requirePrepayWarningAck(createRideRequestCommand(sql));
  app = createServer({
    health: { now, startedAt: now(), env: process.env },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    rides: { request: { sessions, rides, now } },
    deliveries: { request: { sessions, rides, now } } as never,
  });
  const issued = createMiniAppSessionIssuer({ secret: SESSION_SECRET }).issue(
    {
      telegramUserId: String(RIDER_TELEGRAM_ID),
      bot: "rider",
      authDateSeconds: Math.floor(Date.now() / 1000),
    },
    Date.now(),
  );
  if (!issued.ok) throw new Error("إصدارُ الجلسةِ فشل");
  accessToken = issued.value.accessToken;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (riderId !== "") {
    await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId}::uuid)`;
    await sql`delete from orders where rider_id = ${riderId}::uuid`;
    await sql`delete from riders where id = ${riderId}::uuid`;
  }
  if (driverUserId !== "") {
    await sql`delete from driver_capabilities where driver_id in (select id from drivers where user_id = ${driverUserId}::uuid)`;
    await sql`delete from subscriptions where driver_id in (select id from drivers where user_id = ${driverUserId}::uuid)`;
    await sql`delete from drivers where user_id = ${driverUserId}::uuid`;
  }
  for (const id of [riderUserId, driverUserId]) {
    if (id === "") continue;
    await sql`delete from audit_log where actor_user_id = ${id}::uuid`;
    await sql`delete from users where id = ${id}::uuid`;
  }
  if (cityHandle) await restoreCityBaseline(sql, cityHandle);
  await sql.end({ timeout: 5 });
});

describeIf("WR-33: لا طلبَ بلا إقرارِ تنبيهِ التحويلاتِ المسبقة — عبرَ المسارِ المكوَّن", () => {
  it("١) بلا إقرارٍ أو بإقرارٍ مزيّف: مشوارٌ وتوصيلٌ عبرَ المسارَين ← 400 ولا صفَّ في `orders`", async () => {
    const before = await countRiderOrders();
    for (const [path, body] of [
      ["/v1/rides", RIDE],
      ["/v1/rides", { ...RIDE, prepayWarningAck: true }],
      ["/v1/rides", DELIVERY],
      ["/v1/deliveries", DELIVERY],
      ["/v1/deliveries", { ...DELIVERY, prepayWarningAck: "prepay-warning-v0" }],
    ] as const) {
      const attempt = await post(path, `wr33-bypass:${crypto.randomUUID()}`, body);
      expect(attempt.status).toBe(400);
      expect(attempt.json).toMatchObject({ ok: false, error: "PREPAY_WARNING_ACK_REQUIRED" });
    }
    expect(await countRiderOrders()).toBe(before);
  });

  it("٢) بالإقرار: صفٌّ واحد؛ وإعادةُ المحاولةِ بالمفتاحِ نفسِه تُعيدُ الطلبَ نفسَه بلا صفٍّ ثانٍ", async () => {
    const key = `wr33-ride:${crypto.randomUUID()}`;
    const body = { ...RIDE, prepayWarningAck: PREPAY_WARNING_ACK_VERSION };
    const first = await post("/v1/rides", key, body);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ ok: true, accepted: true, reused: false });
    const again = await post("/v1/rides", key, body);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ accepted: true, reused: true, orderId: first.json.orderId });
    expect(await countRiderOrders()).toBe(1);
    await closeOpenOrders();
  });

  it("٣) طلبٌ جديدٌ بعدَ طلبٍ مُقَرٍّ: بلا إقرارٍ جديدٍ مرفوض — الإقرارُ لا يُورَثُ بين الطلبات", async () => {
    const before = await countRiderOrders();
    const refused = await post("/v1/rides", `wr33-ride:${crypto.randomUUID()}`, RIDE);
    expect(refused.status).toBe(400);
    expect(await countRiderOrders()).toBe(before);
  });

  it("٤) توصيلٌ بالإقرارِ عبرَ `/v1/deliveries` يُكتَبُ فعلًا بخدمةِ التوصيل", async () => {
    const created = await post("/v1/deliveries", `wr33-delivery:${crypto.randomUUID()}`, {
      ...DELIVERY,
      prepayWarningAck: PREPAY_WARNING_ACK_VERSION,
    });
    expect(created.status).toBe(200);
    expect(created.json).toMatchObject({ accepted: true });
    const rows = await sql<{ service: string }[]>`
      select service::text as service from orders where id = ${String(created.json.orderId)}::uuid`;
    expect(rows[0]?.service).toBe("delivery");
    await closeOpenOrders();
  });

  it("٥) منفذُ البوتِ (الملفوفُ كما في `container.ts`) يخضعُ للحكمِ نفسِه على القاعدة", async () => {
    const command = requirePrepayWarningAck(createRideRequestCommand(sql));
    const input = {
      telegramUserId: String(RIDER_TELEGRAM_ID),
      service: "transport" as const,
      origin: PICKUP,
      destination: DROPOFF,
      notes: null,
    };
    const before = await countRiderOrders();
    const refused = await command.create({
      ...input,
      idempotencyKey: `telegram-update:${RIDER_TELEGRAM_ID}:1`,
    });
    expect(refused).toEqual({ ok: false, error: { reason: "PREPAY_WARNING_NOT_ACKNOWLEDGED" } });
    expect(await countRiderOrders()).toBe(before);
    const created = await command.create({
      ...input,
      idempotencyKey: `telegram-update:${RIDER_TELEGRAM_ID}:2`,
      prepayWarningAck: PREPAY_WARNING_ACK_VERSION,
    });
    expect(created.ok && created.value.accepted).toBe(true);
    expect(await countRiderOrders()).toBe(before + 1);
    await closeOpenOrders();
  });
});
