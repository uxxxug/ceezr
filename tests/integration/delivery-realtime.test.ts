/**
 * الغرض: اختبارُ قناةِ Realtime للتوصيلِ على قاعدةِ PostgreSQL حقيقية:
 *   قناةُ Socket.IO المشتركة — هل تعملُ لطلبِ `service="delivery"`؟
 *   يتضمَّنُ: session auth، room isolation، event delivery،
 *   reconnect/rejoin، snapshot أولي، وعزلَ راكبٍ آخر.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وأي تعديل على قناة Realtime
 * ملاحظات مستقبلية: عند إضافة ordering/dedup في العميل يُضاف اختبار هنا.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createServer as createHttpServer } from "node:http";
import { Server as IoServer } from "socket.io";
import { io as IoClient, type Socket as IoClientSocket } from "socket.io-client";
import {
  createActiveRideResolver,
  createSessionVerifier,
} from "../../apps/gateway/src/realtime/adapters.ts";
import {
  createRideChannel,
  type RideChannel,
} from "../../apps/gateway/src/realtime/ride-channel.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createMiniAppSessionIssuer } from "../../packages/infrastructure/identity/miniapp-session.ts";
import { createTrackingEventBus } from "../../packages/infrastructure/tracking/event-bus.ts";
import type { TrackingEvent } from "../../packages/tracking/types.ts";
import { createTestRevocationStore } from "../helpers/revocation-store.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SESSION_SECRET = "delivery-realtime-secret-اثنان-وثلاثون-حرفاً-على-الأقلِّ";

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

const RIDER_CHAT = 140_001;
const DRIVER_CHAT = 140_002;
const OTHER_RIDER_CHAT = 140_003;
const PICKUP = { lat: 21.5433, lng: 39.1728 };
const DROPOFF = { lat: 21.5551, lng: 39.1902 };
const COURIER_AT = { lat: 21.5471, lng: 39.1751 };

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderId = "";
let driverId = "";
let orderId = "";

function tokenFor(telegramUserId: string, bot: "rider" | "driver"): string {
  const issued = createMiniAppSessionIssuer({ secret: SESSION_SECRET }).issue(
    { telegramUserId, bot, authDateSeconds: Math.floor(Date.now() / 1000) },
    Date.now(),
  );
  if (!issued.ok) throw new Error("إصدارُ الجلسةِ فاشلٌ");
  return issued.value.accessToken;
}

async function setupRiderAndDriver(): Promise<void> {
  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_CHAT}, 'rider', 'راكب القناة', '+966500000001')
    returning id
  `;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ الراكبِ");
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUser.id}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبِ");
  riderId = rider.id;

  const [driverUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${DRIVER_CHAT}, 'driver', 'سائق توصيل', '+966500000002')
    returning id
  `;
  if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number,
                         last_location, last_location_at)
    values (${cityId}, ${driverUser.id}, 'verified'::verification_status, 'سيدان', 'ر س ب 1234',
            st_setsrid(st_makepoint(${COURIER_AT.lng}, ${COURIER_AT.lat}), 4326)::geography, now())
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;
  await sql`
    insert into subscriptions (city_id, driver_id, plan, status)
    values (${cityId}, ${driverId}, 'delivery'::subscription_plan, 'active'::subscription_status)
  `;
  await sql`
    insert into driver_capabilities (city_id, driver_id, service, is_enabled)
    values (${cityId}, ${driverId}, 'delivery'::service_type, true)
  `;

  // راكبٌ آخر لا يملكُ رحلةً
  const [otherUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${OTHER_RIDER_CHAT}, 'rider', 'راكب آخر', '+966500000003')
    returning id
  `;
  if (otherUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ الراكبِ الآخر");
  await sql`insert into riders (city_id, user_id) values (${cityId}, ${otherUser.id})`;
}

async function createDeliveryOrder(): Promise<void> {
  const [order] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, dropoff, notes,
                        broadcast_round, created_at, matched_at, assigned_driver_id)
    values (
      ${cityId}, ${riderId}, 'delivery'::service_type, 'matched'::order_status,
      st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
      st_setsrid(st_makepoint(${DROPOFF.lng}, ${DROPOFF.lat}), 4326)::geography,
      ${"صندوق كتب متوسط الحجم"}, 1, now(), now(), ${driverId}
    )
    returning id
  `;
  if (order === undefined) throw new Error("تعذّر زرعُ طلبِ التوصيل");
  orderId = order.id;
}

/** يُنشئ قناةَ Socket.IO على منفذٍ حرٍّ ويُرجِعُ المقبض. */
async function startChannel(): Promise<{
  io: IoServer;
  channel: RideChannel;
  port: number;
  httpServer: ReturnType<typeof createHttpServer>;
  bus: ReturnType<typeof createTrackingEventBus>;
}> {
  const httpServer = createHttpServer((_request, response) => {
    response.writeHead(404).end();
  });
  const io = new IoServer(httpServer);
  const bus = createTrackingEventBus();
  const channel = createRideChannel({
    io,
    eventBus: bus,
    rides: createActiveRideResolver(sql),
    sessions: createSessionVerifier(
      sql,
      SESSION_SECRET,
      () => Date.now(),
      createTestRevocationStore(),
    ),
  });
  channel.start();
  const port = await new Promise<number>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      const address = httpServer.address();
      if (address === null || typeof address === "string") {
        reject(new Error("لا منفذَ من الخادمِ"));
        return;
      }
      resolve(address.port);
    });
  });
  return { io, channel, port, httpServer, bus };
}

function makeClient(port: number, token: string): IoClientSocket {
  return IoClient(`http://127.0.0.1:${port}`, {
    transports: ["websocket"],
    auth: { sessionToken: token },
    forceNew: true,
    timeout: 5000,
  });
}

describeIf("قناة Realtime للتوصيل على قاعدة حقيقية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
    cityId = cityHandle.cityId;
  });

  afterEach(async () => {
    // لا يُترَكُ صفٌّ بينَ الاختبارات
    if (orderId !== "") {
      await sql`delete from order_offers where order_id = ${orderId}`;
      await sql`delete from orders where id = ${orderId}`;
      orderId = "";
    }
  });

  afterAll(async () => {
    if (driverId !== "") {
      await sql`delete from driver_capabilities where driver_id = ${driverId}`;
      await sql`delete from subscriptions where driver_id = ${driverId}`;
      await sql`delete from drivers where id = ${driverId}`;
    }
    if (riderId !== "") {
      await sql`delete from riders where id = ${riderId}`;
    }
    for (const chat of [RIDER_CHAT, DRIVER_CHAT, OTHER_RIDER_CHAT]) {
      await sql`delete from users where telegram_id = ${chat}`;
    }
    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table order_offers, orders, driver_capabilities, subscriptions,
                             driver_availability, drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: -1001, escalation: -1002, unsubscribed: -1003 },
      prior: cityHandle,
    });
    cityId = cityHandle.cityId;
    riderId = "";
    driverId = "";
    orderId = "";
    await setupRiderAndDriver();
    await createDeliveryOrder();
  });

  // ═══════════════════════════════════════════════════════════════════
  // ١) الانضمام إلى غرفة الرحلة: snapshot أولي
  // ═══════════════════════════════════════════════════════════════════
  it("الراكب ينضمُّ إلى غرفةِ طلبِ التوصيل ويستقبلُ snapshot أولي", async () => {
    const { channel, port, httpServer, io } = await startChannel();
    const token = tokenFor(String(RIDER_CHAT), "rider");

    try {
      const client = makeClient(port, token);
      try {
        await new Promise<void>((resolve, reject) => {
          client.on("connect", () => resolve());
          client.on("connect_error", () => reject(new Error("connect_error")));
          setTimeout(() => reject(new Error("مهلةُ الاتصالِ")), 5000);
        });

        const joined = new Promise<{
          tripId: string;
          driverId: string;
          status: string;
        }>((resolve, reject) => {
          client.on(
            "ride:joined",
            (payload: { tripId: string; driverId: string; status: string }) => resolve(payload),
          );
          client.on("ride:error", (payload: { code?: string }) =>
            reject(new Error(`القناةُ رفضَت الانضمامَ: ${payload?.code ?? "?"}`)),
          );
          setTimeout(() => reject(new Error("مهلةُ الانضمامِ")), 5000);
        });

        client.emit("ride:join", { tripId: orderId });
        const snapshot = await joined;

        expect(snapshot.tripId).toBe(orderId);
        expect(snapshot.driverId).toBe(driverId);
        expect(snapshot.status).toBe("matched");
      } finally {
        client.close();
      }
    } finally {
      channel.stop();
      io.close();
      httpServer.close();
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // ٢) حدثُ تتبُّعٍ يصلُ الراكبَ في غرفتِه
  // ═══════════════════════════════════════════════════════════════════
  it("حدثُ location_updated يصلُ الراكبَ في غرفةِ طلبِ التوصيل", async () => {
    const { channel, port, httpServer, io, bus } = await startChannel();
    const token = tokenFor(String(RIDER_CHAT), "rider");

    try {
      const client = makeClient(port, token);
      try {
        await new Promise<void>((resolve, reject) => {
          client.on("connect", () => resolve());
          setTimeout(() => reject(new Error("مهلةُ الاتصالِ")), 5000);
        });

        await new Promise<void>((resolve, reject) => {
          client.on("ride:joined", () => resolve());
          client.on("ride:error", (payload: { code?: string }) =>
            reject(new Error(`القناةُ رفضَت الانضمامَ: ${payload?.code ?? "?"}`)),
          );
          client.emit("ride:join", { tripId: orderId });
          setTimeout(() => reject(new Error("مهلةُ الانضمامِ")), 5000);
        });

        const received = new Promise<{ type: string; tripId: string; sequence: number }>(
          (resolve, reject) => {
            client.on("ride:event", (event: { type: string; tripId: string; sequence: number }) =>
              resolve(event),
            );
            setTimeout(() => reject(new Error("مهلةُ الحدثِ")), 5000);
          },
        );

        const event: TrackingEvent = {
          type: "location_updated",
          driverId,
          tripId: orderId,
          sessionId: crypto.randomUUID(),
          sequence: 1,
          position: { lat: PICKUP.lat, lng: PICKUP.lng },
          cityId,
          timestamp: new Date(),
        };
        await bus.publish(event);
        const result = await received;

        expect(result.type).toBe("location_updated");
        expect(result.tripId).toBe(orderId);
        expect(result.sequence).toBe(1);
      } finally {
        client.close();
      }
    } finally {
      channel.stop();
      io.close();
      httpServer.close();
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // ٣) راكبٌ آخر لا يستطيعُ الانضمامَ إلى غرفةِ طلبِ التوصيل
  // ═══════════════════════════════════════════════════════════════════
  it("راكبٌ آخر لا يستطيعُ الانضمامَ إلى غرفةِ طلبِ التوصيل: NO_ACTIVE_RIDE", async () => {
    const { channel, port, httpServer, io } = await startChannel();
    const token = tokenFor(String(RIDER_CHAT), "rider");
    const otherToken = tokenFor(String(OTHER_RIDER_CHAT), "rider");

    try {
      // الراكبُ الآخر يحاولُ الانضمامَ
      const otherClient = makeClient(port, otherToken);
      try {
        await new Promise<void>((resolve, reject) => {
          otherClient.on("connect", () => resolve());
          setTimeout(() => reject(new Error("مهلةُ الاتصالِ")), 5000);
        });

        const error = new Promise<string>((resolve, reject) => {
          otherClient.on("ride:error", (payload: { code?: string }) =>
            resolve(payload?.code ?? "?"),
          );
          setTimeout(() => reject(new Error("مهلةُ الرفضِ")), 5000);
        });

        otherClient.emit("ride:join", { tripId: orderId });
        const code = await error;
        expect(code).toBe("NO_ACTIVE_RIDE");
      } finally {
        otherClient.close();
      }

      // الراكبُ الأصليُّ يستطيعُ الانضمامَ
      const client = makeClient(port, token);
      try {
        await new Promise<void>((resolve, reject) => {
          client.on("connect", () => resolve());
          setTimeout(() => reject(new Error("مهلةُ الاتصالِ")), 5000);
        });

        const joined = new Promise<void>((resolve, reject) => {
          client.on("ride:joined", () => resolve());
          client.on("ride:error", (payload: { code?: string }) =>
            reject(new Error(`القناةُ رفضَت الانضمامَ: ${payload?.code ?? "?"}`)),
          );
          client.emit("ride:join", { tripId: orderId });
          setTimeout(() => reject(new Error("مهلةُ الانضمامِ")), 5000);
        });
        await joined;
      } finally {
        client.close();
      }
    } finally {
      channel.stop();
      io.close();
      httpServer.close();
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // ٤) إعادة الاتصال وإعادة الانضمام
  // ═══════════════════════════════════════════════════════════════════
  it("إعادةُ الاتصالِ وإعادةُ الانضمامِ: snapshot يُسترجَعُ بعدَ reconnect", async () => {
    const { channel, port, httpServer, io } = await startChannel();
    const token = tokenFor(String(RIDER_CHAT), "rider");

    try {
      // الاتصالُ الأوّلُ والانضمامُ
      const client1 = makeClient(port, token);
      try {
        await new Promise<void>((resolve, reject) => {
          client1.on("connect", () => resolve());
          setTimeout(() => reject(new Error("مهلةُ الاتصالِ")), 5000);
        });
        await new Promise<void>((resolve, reject) => {
          client1.on("ride:joined", () => resolve());
          client1.on("ride:error", (payload: { code?: string }) =>
            reject(new Error(`القناةُ رفضَت الانضمامَ: ${payload?.code ?? "?"}`)),
          );
          client1.emit("ride:join", { tripId: orderId });
          setTimeout(() => reject(new Error("مهلةُ الانضمامِ")), 5000);
        });
      } finally {
        client1.close();
      }

      // انتظارُ الانفصالِ
      await new Promise((resolve) => setTimeout(resolve, 500));

      // الاتصالُ الثاني وإعادةُ الانضمامِ
      const client2 = makeClient(port, token);
      try {
        await new Promise<void>((resolve, reject) => {
          client2.on("connect", () => resolve());
          setTimeout(() => reject(new Error("مهلةُ الاتصالِ")), 5000);
        });

        const snapshot = new Promise<{ tripId: string; status: string }>((resolve, reject) => {
          client2.on("ride:joined", (payload: { tripId: string; status: string }) =>
            resolve(payload),
          );
          client2.on("ride:error", (payload: { code?: string }) =>
            reject(new Error(`القناةُ رفضَت الانضمامَ: ${payload?.code ?? "?"}`)),
          );
          client2.emit("ride:join", { tripId: orderId });
          setTimeout(() => reject(new Error("مهلةُ الانضمامِ")), 5000);
        });
        const result = await snapshot;
        expect(result.tripId).toBe(orderId);
        expect(result.status).toBe("matched");
      } finally {
        client2.close();
      }
    } finally {
      channel.stop();
      io.close();
      httpServer.close();
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // ٥) لا يقبلُ انضماماً بلا جلسة
  // ═══════════════════════════════════════════════════════════════════
  it("يرفضُ الانضمامَ بلا جلسة: NO_SESSION", async () => {
    const { channel, port, httpServer, io } = await startChannel();

    try {
      const client = IoClient(`http://127.0.0.1:${port}`, {
        transports: ["websocket"],
        auth: {},
        forceNew: true,
        timeout: 5000,
      });
      try {
        await new Promise<void>((resolve, reject) => {
          client.on("connect", () => resolve());
          setTimeout(() => reject(new Error("مهلةُ الاتصالِ")), 5000);
        });

        const error = new Promise<string>((resolve, reject) => {
          client.on("ride:error", (payload: { code?: string }) => resolve(payload?.code ?? "?"));
          setTimeout(() => reject(new Error("مهلةُ الرفضِ")), 5000);
        });

        client.emit("ride:join", { tripId: orderId });
        const code = await error;
        expect(code).toBe("NO_SESSION");
      } finally {
        client.close();
      }
    } finally {
      channel.stop();
      io.close();
      httpServer.close();
    }
  });
});
