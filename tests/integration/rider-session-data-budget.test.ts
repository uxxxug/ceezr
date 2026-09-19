/**
 * الغرض: **قياسُ** استهلاكِ بياناتِ جلسةِ راكبٍ في نافذةِ عشرِ دقائقَ على بوّابةٍ
 *   حقيقيّةٍ وقاعدةٍ حقيقيّةٍ وقناةٍ آنيّةٍ حقيقيّةٍ، ثمَّ الحكمُ عليها بحدِّ
 *   الصفِّ السابعِ من القسمِ 9.9 (`F1-09`): **≤ 1.5 MB**.
 *
 *   والذي يُقاسُ ههنا لا يقدرُ عليه حاجزٌ ساكنٌ ولا ملفُّ بناءٍ:
 *     ــ **طولُ جسدِ كلِّ ردٍّ** كما يُرسَلُه `hono` من صفوفٍ في `PostgreSQL` —
 *        لا من كائنٍ مُصنَّعٍ في اختبارِ وحدةٍ، ولا تقديراً «بحسبِ الحقولِ».
 *     ــ **طولُ إطارِ `ride:event` المُشفَّرِ** كما يستقبلُه عميلُ `socket.io`
 *        الحقيقيُّ من خادمٍ حقيقيٍّ على منفذٍ حقيقيٍّ — لا `JSON.stringify` يدويّاً.
 *     ــ **عددُ الإطاراتِ في النافذةِ** مشتقّاً من `DEFAULT_RELAY_MIN_INTERVAL_MS`
 *        **المستوردةِ** من `customer-live-relay.ts`: مَن خفَّفَ المهلةَ رأى الحدَّ
 *        يسقطُ، ولا رقمَ مكتوباً ههنا يُنسى تحديثُه.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (وظيفةُ «تكامل على PostgreSQL حقيقي») · `scripts/check-session-data-budget.ts`
 * يحرسُه: `scripts/check-session-data-budget.ts` في سلسلةِ `ci`
 * الحاكم: `docs/adr/0149-a-session-data-budget-is-measured-not-declared.md`
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ — ويُعلَنُ في الدليلِ ═══
 * ــ **بايتاتُ التطبيقِ لا بايتاتُ السِلكِ**: لا ضغطَ نقلٍ (`gzip`/`br`) ولا
 *    ترويساتِ `HTTP` ولا تأطيرَ `WebSocket` ولا `TCP/TLS` ولا إعادةَ اتّصالٍ.
 *    وكلُّها **تزيدُ** الرقمَ ولا تُنقِصُه إلّا الضغطَ، فالقياسُ ليسَ سقفاً
 *    للسِلكِ — وهذا مكتوبٌ في `docs/evidence/architecture/F1-09-20260920.md`.
 * ــ **أعدادُ النداءاتِ مُعلَنةٌ لا مقيسةٌ** (`RIDER_SESSION_PROFILE`): لا نشرَ
 *    حيَّ فلا توزيعَ سلوكٍ (`ADR 0099`). والمقيسُ **حجمُ** كلِّ نداءٍ.
 * ــ **لا يُدَّعى قياسُ الصفوفِ الخمسةِ الأُخرى** من القسمِ 9.9 (`FCP`/`LCP`/`TTI`
 *    ورسمُ الخريطةِ): تلكَ تحتاجُ متصفّحاً وشبكةً مُقيَّدةً، والبندُ يبقى `[~]`.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createServer as createHttpServer } from "node:http";
import { Server as IoServer } from "socket.io";
import { io as IoClient, type Socket as IoClientSocket } from "socket.io-client";
import {
  createActiveRideResolver,
  createSessionVerifier,
} from "../../apps/gateway/src/realtime/adapters.ts";
import { createRideChannel } from "../../apps/gateway/src/realtime/ride-channel.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { DEFAULT_RELAY_MIN_INTERVAL_MS } from "../../packages/application/tracking/customer-live-relay.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createDestinationResolver,
  createDestinationSearcher,
} from "../../packages/infrastructure/destinations/destinations-store.ts";
import { createMiniAppRefreshTokens } from "../../packages/infrastructure/identity/miniapp-refresh.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { createTelegramInitDataVerifier } from "../../packages/infrastructure/identity/telegram-init-data.ts";
import { createViewerAccountReader } from "../../packages/infrastructure/identity/viewer-account.ts";
import {
  createRecentDestinationReader,
  createSavedPlaceReader,
  createSavedPlaceWriter,
} from "../../packages/infrastructure/places/places-store.ts";
import { createTrackingEventBus } from "../../packages/infrastructure/tracking/event-bus.ts";
import { createActiveRideReader } from "../../packages/infrastructure/transport/active-ride-store.ts";
import {
  createRideRequestCommand,
  createRideSearchReader,
} from "../../packages/infrastructure/transport/ride-request-store.ts";
import { createRideSummaryReader } from "../../packages/infrastructure/transport/ride-summary-store.ts";
import type { TrackingEvent } from "../../packages/tracking/types.ts";
import { BUDGET } from "../../scripts/lib/performance-budget.ts";
import {
  composeHttpCalls,
  describeSessionData,
  judgeSessionData,
  RIDER_SESSION_PROFILE,
  SESSION_DATA_BUDGET_BYTES,
  type SessionDataFacts,
} from "../../scripts/lib/session-data-budget.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { buildInitData, FAKE_RIDER_BOT_TOKEN } from "../support/telegram-init-data.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** سرُّ جلسةٍ محليٌّ — طولُه يفي بالحدِّ الأدنى ولا قيمةَ له خارجَ هذا الملفِّ. */
const SESSION_SECRET = "session-data-budget-secret-اثنان-وثلاثون-حرفاً-على-الأقلِّ";
const WEBHOOK_SECRET = "session-data-budget-webhook-secret";

const RIDER_TELEGRAM_ID = 900_000_971;
const DRIVER_TELEGRAM_ID = 900_000_972;

/**
 * عددُ الأماكنِ المحفوظةِ في الحالةِ المقيسةِ. والمخطَّطُ **لا يحدُّ** عددَها
 * (`20260913050000_f2_02_saved_places.sql`)، فهذا **شكلٌ مُعلَنٌ سخيٌّ** لا سقفٌ
 * تفرضُه القاعدةُ — وذاكَ حدُّ القياسِ، مكتوبٌ في الدليلِ.
 */
const SAVED_PLACE_COUNT = 25;
/** سقفُ البحثِ الذي **تفرضُه الشيفرةُ** (`MAX_SEARCH_LIMIT`) — أسوأُ ردٍّ ممكنٍ. */
const SEARCH_LIMIT = 25;
/** استفسارٌ يُطابِقُ كلَّ الأماكنِ المزروعةِ: كلُّها تبدأُ بهذهِ الكلمةِ. */
const SEARCH_QUERY = "وجهة";

const PICKUP = { lat: 21.4858, lng: 39.1925 } as const;
const DROPOFF = { lat: 21.5591, lng: 39.1553 } as const;

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderUserId = "";
let riderId = "";
let driverUserId = "";
let driverId = "";
let app: ReturnType<typeof createServer>;
let accessToken = "";
let orderId = "";

/** بايتاتُ نصٍّ — `UTF-8` لا محارفُ: العربيّةُ حرفانِ أو ثلاثةٌ لكلِّ محرفٍ. */
function bytesOf(text: string): number {
  return new TextEncoder().encode(text).length;
}

const measured: Record<string, number> = {};

/**
 * نداءٌ على البوّابةِ يُقاسُ جسدُ ردِّه. والجسدُ يُقرأُ مرّةً واحدةً ويُعادُ نصّاً:
 * قراءتُه مرّتَينِ تُلقي، وقياسُ `content-length` وحدَه يكذبُ في الردِّ المُقسَّمِ.
 */
async function call(
  label: string,
  path: string,
  init: RequestInit = {},
): Promise<{ readonly status: number; readonly text: string }> {
  const response = await app.fetch(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        ...(accessToken === "" ? {} : { authorization: `Bearer ${accessToken}` }),
      },
    }),
  );
  const text = await response.text();
  measured[label] = bytesOf(text);
  return { status: response.status, text };
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  // `OPS-019`: الشرطُ يُصنَعُ ههنا ويُردُّ في `afterAll` — لا يُستعارُ من ملفٍّ سبقَ.
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكب قياس البيانات', '+966500000971')
    returning id
  `;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ الراكبِ");
  riderUserId = riderUser.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبِ");
  riderId = rider.id;

  const [driverUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'خالد أحمد الغامدي', '+966500000972')
    returning id
  `;
  if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = driverUser.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ر س ب 1234')
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;
  /**
   * القدرةُ والاشتراكُ شرطانِ في القاعدةِ لا في التطبيقِ: `city_served_services`
   * لا ترى سائقاً بلا `driver_capabilities` مفعَّلةٍ واشتراكٍ سارٍ، و`request_ride`
   * تردُّ `SERVICE_NOT_AVAILABLE_IN_CITY`. فالبذرُ يستوفي القيدَ ولا يُخفِّفُه.
   */
  await sql`
    insert into subscriptions (city_id, driver_id, plan, status)
    values (${cityId}, ${driverId}, 'both'::subscription_plan, 'active'::subscription_status)
  `;
  await sql`
    insert into driver_capabilities (city_id, driver_id, service, is_enabled)
    values (${cityId}, ${driverId}, 'transport'::service_type, true)
  `;
  await sql`
    update drivers set
      last_location = st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
      last_location_at = now()
    where id = ${driverId}
  `;

  // أماكنُ محفوظةٌ بأسماءَ طويلةٍ عربيّةٍ: القياسُ يجبُ أن يرى أسوأَ ما يُعرَضُ.
  for (let index = 0; index < SAVED_PLACE_COUNT; index += 1) {
    const kind = index === 0 ? "home" : index === 1 ? "work" : "other";
    await sql`
      insert into saved_places (city_id, user_id, kind, label, point)
      values (
        ${cityId}, ${riderUserId}, ${kind},
        ${`${SEARCH_QUERY} محفوظةٌ رقمُ ${index + 1} — حيُّ الروضةِ، شارعُ الأميرِ سلطانَ`},
        st_setsrid(st_makepoint(${DROPOFF.lng + index * 0.0005}, ${DROPOFF.lat}), 4326)::geography
      )
    `;
  }

  const sessions = createMiniAppSessionReader(SESSION_SECRET);
  const issuer = createMiniAppSessionIssuer({ secret: SESSION_SECRET });
  const now = (): Date => new Date();

  app = createServer({
    health: { now, startedAt: now(), env: process.env },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    sessionTelegram: {
      exchange: {
        verifier: createTelegramInitDataVerifier({
          bots: [{ name: "rider", token: FAKE_RIDER_BOT_TOKEN }],
        }),
        issuer,
        refreshChain: {
          refresh: createMiniAppRefreshTokens({ secret: SESSION_SECRET }),
          grantIssuer: issuer,
        },
        now,
      },
    },
    me: { viewer: { sessions, accounts: createViewerAccountReader(sql), now } },
    places: {
      places: {
        sessions,
        reader: createSavedPlaceReader(sql),
        writer: createSavedPlaceWriter(sql),
        recent: createRecentDestinationReader(sql),
        now,
      },
    },
    destinations: {
      destinations: {
        sessions,
        searcher: createDestinationSearcher(sql),
        resolver: createDestinationResolver(sql),
        now,
      },
    },
    rides: {
      request: { sessions, rides: createRideRequestCommand(sql), now },
      search: { sessions, search: createRideSearchReader(sql), now },
      active: { sessions, rides: createActiveRideReader(sql), now, routing: { routing: null } },
      summary: { sessions, rides: createRideSummaryReader(sql), now },
    },
  });
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (riderId !== "") {
    await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId})`;
    await sql`delete from orders where rider_id = ${riderId}`;
    await sql`delete from riders where id = ${riderId}`;
  }
  if (driverId !== "") {
    await sql`delete from driver_capabilities where driver_id = ${driverId}`;
    await sql`delete from subscriptions where driver_id = ${driverId}`;
    await sql`delete from drivers where id = ${driverId}`;
  }
  if (riderUserId !== "") await sql`delete from saved_places where user_id = ${riderUserId}`;
  for (const id of [riderUserId, driverUserId]) {
    if (id === "") continue;
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("F1-09 — بياناتُ جلسةِ راكبٍ في عشرِ دقائقَ، مقيسةً لا مُقدَّرةً", () => {
  it("جلسةٌ واحدةٌ تُقاسُ ردّاً ردّاً وإطاراً إطاراً ثمَّ تُحاكَمُ بالحدِّ", async () => {
    const initData = buildInitData({
      botToken: FAKE_RIDER_BOT_TOKEN,
      authDateSeconds: Math.floor(Date.now() / 1000),
      user: { id: RIDER_TELEGRAM_ID, first_name: "راكب", language_code: "ar" },
    });
    const session = await call("POST /v1/session/telegram", "/v1/session/telegram", {
      method: "POST",
      body: JSON.stringify({ initData }),
      headers: { "content-type": "application/json" },
    });
    // الإصدارُ ينشئُ جلسةً: `201` لا `200` — والرقمُ يُقرأُ من المسارِ لا يُفترَضُ.
    expect(session.status).toBe(201);
    const issued = JSON.parse(session.text) as { accessToken?: string };
    expect(typeof issued.accessToken).toBe("string");
    accessToken = issued.accessToken ?? "";

    const me = await call("GET /v1/me", "/v1/me");
    expect(me.status).toBe(200);

    const places = await call("GET /v1/me/places", "/v1/me/places");
    expect(places.status).toBe(200);
    expect((JSON.parse(places.text) as { places: unknown[] }).places.length).toBe(
      SAVED_PLACE_COUNT,
    );

    const search = await call(
      "GET /v1/destinations/search",
      `/v1/destinations/search?q=${encodeURIComponent(SEARCH_QUERY)}&limit=${SEARCH_LIMIT}`,
    );
    expect(search.status).toBe(200);
    expect(
      (JSON.parse(search.text) as { suggestions: unknown[] }).suggestions.length,
    ).toBeGreaterThan(0);

    const created = await call("POST /v1/rides", "/v1/rides", {
      method: "POST",
      body: JSON.stringify({
        service: "transport",
        originLat: PICKUP.lat,
        originLng: PICKUP.lng,
        destinationLat: DROPOFF.lat,
        destinationLng: DROPOFF.lng,
        notes: "أمامَ البوّابةِ الشماليّةِ",
      }),
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": `session-budget:${crypto.randomUUID()}`,
      },
    });
    expect(created.status).toBe(200);
    const rideBody = JSON.parse(created.text) as { accepted?: boolean; orderId?: string };
    // رفضٌ يُقرأُ بنصِّه لا بـ`false` صامتٍ: سببُ الرفضِ هوَ ما يُصلَحُ.
    if (rideBody.accepted !== true) throw new Error(`الإنشاءُ مرفوضٌ: ${created.text}`);
    orderId = rideBody.orderId ?? "";
    expect(orderId).not.toBe("");

    const searchState = await call("GET /v1/rides/:id/search", `/v1/rides/${orderId}/search`);
    expect(searchState.status).toBe(200);

    // الإسنادُ يُزرَعُ مباشرةً: المقيسُ **حجمُ لقطةِ الرحلةِ النشطةِ**، وطريقُ
    // الإسنادِ عملُ `F3` لا موضوعُ هذا القياسِ.
    await sql`
      update orders set status = 'in_progress'::order_status, assigned_driver_id = ${driverId},
                        matched_at = now(), started_at = now()
       where id = ${orderId}
    `;
    const active = await call("GET /v1/rides/:id", `/v1/rides/${orderId}`);
    expect(active.status).toBe(200);

    // ═══ القناةُ الآنيّةُ: إطارٌ حقيقيٌّ من خادمٍ حقيقيٍّ إلى عميلٍ حقيقيٍّ ═══

    const httpServer = createHttpServer((_request, response) => {
      response.writeHead(404).end();
    });
    const io = new IoServer(httpServer);
    const bus = createTrackingEventBus();
    const channel = createRideChannel({
      io,
      eventBus: bus,
      rides: createActiveRideResolver(sql),
      sessions: createSessionVerifier(sql, SESSION_SECRET, () => Date.now()),
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

    /**
     * الإطاراتُ تُقاسُ من **مُحرِّكِ** العميلِ لا من حمولةٍ مُفكَّكةٍ: `data`
     * هوَ نصُّ `socket.io` المُشفَّرُ كما عبرَ السِلكَ، ويُزادُ عليه محرفُ نوعِ
     * حزمةِ `engine.io` (`4` = رسالةٌ). وتأطيرُ `WebSocket` نفسُه **غيرُ محسوبٍ**
     * وهوَ يزيدُ لا يُنقِصُ — معلَنٌ في الدليلِ.
     */
    const frames: { readonly event: string; readonly bytes: number }[] = [];
    let client: IoClientSocket | undefined;
    try {
      client = IoClient(`http://127.0.0.1:${port}`, {
        transports: ["websocket"],
        auth: { sessionToken: accessToken },
        forceNew: true,
      });
      client.io.engine.on("packet", (packet: { type: string; data?: unknown }) => {
        if (packet.type !== "message" || typeof packet.data !== "string") return;
        const name = /"([a-z:]+)"/.exec(packet.data)?.[1] ?? "unknown";
        frames.push({ event: name, bytes: bytesOf(`4${packet.data}`) });
      });

      const joined = new Promise<void>((resolve, reject) => {
        client?.on("ride:joined", () => resolve());
        client?.on("ride:error", (payload: { code?: string }) =>
          reject(new Error(`القناةُ رفضَت الانضمامَ: ${payload?.code ?? "?"}`)),
        );
        setTimeout(() => reject(new Error("مهلةُ الانضمامِ")), 5000);
      });
      await new Promise<void>((resolve, reject) => {
        client?.on("connect", () => resolve());
        setTimeout(() => reject(new Error("مهلةُ الاتّصالِ")), 5000);
      });
      client.emit("ride:join", { tripId: orderId });
      await joined;

      const received = new Promise<void>((resolve, reject) => {
        client?.on("ride:event", () => resolve());
        setTimeout(() => reject(new Error("مهلةُ الإطارِ")), 5000);
      });
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
      await received;
    } finally {
      client?.close();
      channel.stop();
      io.close();
      httpServer.close();
    }

    const rideEvent = frames.find((frame) => frame.event === "ride:event");
    const rideJoined = frames.find((frame) => frame.event === "ride:joined");
    expect(rideEvent).toBeDefined();
    expect(rideJoined).toBeDefined();
    measured["ride:event"] = rideEvent?.bytes ?? 0;
    measured["ride:joined"] = rideJoined?.bytes ?? 0;

    // ═══ الملخَّصُ بعدَ الإكمالِ ═══
    await sql`
      update orders set status = 'completed'::order_status, completed_at = now()
       where id = ${orderId}
    `;
    const summary = await call("GET /v1/rides/:id/summary", `/v1/rides/${orderId}/summary`);
    expect(summary.status).toBe(200);

    // ═══ الحكمُ: مجموعُ النافذةِ لا يتجاوزُ حدَّ الصفِّ السابعِ ═══
    const facts: SessionDataFacts = {
      // الحملُ الأوّلُ بسقفِه المفروضِ آلياً لا ببناءٍ يُقاسُ ههنا (تعليلُه في المكتبةِ).
      firstLoadBytes: BUDGET.eagerGzipBytes,
      httpCalls: composeHttpCalls(measured),
      liveFrameBytes: measured["ride:event"] ?? 0,
      liveFrameIntervalMs: DEFAULT_RELAY_MIN_INTERVAL_MS,
      channelOpenBytes: measured["ride:joined"] ?? 0,
    };
    const verdict = judgeSessionData(facts);

    // الأرقامُ تُطبَعُ دائماً: دليلٌ بلا رقمٍ لا يُراجَعُ، وأخضرٌ صامتٌ لا يُصدَّقُ.
    console.log(describeSessionData(facts, verdict));

    // حقائقُ غيرُ فارغةٍ شرطٌ قبلَ الحدِّ: صفرٌ يمرُّ تحتَ كلِّ حدٍّ.
    expect(facts.httpCalls.length).toBe(RIDER_SESSION_PROFILE.length);
    for (const httpCall of facts.httpCalls) {
      expect(httpCall.bytes).toBeGreaterThan(0);
    }
    expect(facts.liveFrameBytes).toBeGreaterThan(0);
    expect(facts.channelOpenBytes).toBeGreaterThan(0);
    expect(verdict.totalBytes).toBeGreaterThan(0);

    expect(verdict.violations).toEqual([]);
    expect(verdict.totalBytes).toBeLessThanOrEqual(SESSION_DATA_BUDGET_BYTES);
  });
});
