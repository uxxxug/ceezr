/**
 * الغرض: **حقنُ عطلِ مزوّدِ الخرائطِ على السِلكِ** (`F11-06` — الشقُّ المملوكُ
 *   للمستودَعِ): خادمُ `OSRM` حقيقيٌّ على منفذٍ حقيقيٍّ يُطفَأُ ويُعلَّقُ ويُعطَبُ،
 *   تحتَ بوّابةٍ مُركَّبةٍ من `buildContainer` (`ROUTING_PROVIDER=osrm`) ورحلةٍ
 *   `in_progress` في PostgreSQL حقيقيّةٍ — ويُحاكَمُ كلُّ طورٍ بحَكَمٍ خالصٍ
 *   (`scripts/lib/routing-outage.ts`) مقيسٍ بسالباتٍ مبذورةٍ.
 *   وما يُقاسُ ههنا لا يقدرُ عليه اختبارُ وحدةٍ بمزوّدٍ مُزيَّفٍ:
 *     ــ أنَّ **رفضَ الاتصالِ الحقيقيَّ** و**التعليقَ الحقيقيَّ** يمرّانِ بمسارِ
 *        `fetch` ومهلتِه وإعادةِ محاولتِه كما في الإنتاجِ، لا بـ`Result` مصنوعٍ.
 *     ــ أنَّ القراءةَ **مقيَّدةٌ بميزانيّةِ المزوّدِ** (`OSRM_TIMEOUT_MS` مستوردةً).
 *     ــ أنَّ **التعافيَ** يعيدُ المدّةَ من السِلكِ — فالفشلُ لا يُخزَّنُ.
 *     ــ أنَّ الحصّةَ المُعلَنةَ (`ROUTING_RATE_LIMIT` · `ADR 0190`) حينَ تُستنفَدُ
 *        تُخفي المدّةَ بالسببِ عينِه **بلا طلبٍ على السِلكِ**.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (وظيفةُ «تكامل على PostgreSQL حقيقي»)
 * الحاكم: docs/adr/0192-routing-outage-is-injected-on-the-wire.md
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ ═══
 * ــ **لا حِملَ ولا بيئةَ شبيهةً بالإنتاجِ**: البندُ يبقى `[ ]`/`[~]` لا `[x]` (`ح-4` · `ح-5`).
 * ــ **لا انقطاعَ شبكةٍ على مستوى الحزمِ** (فقدانُ حزمٍ · DNS): المحقونُ رفضُ اتصالٍ
 *    وتعليقُ ردٍّ وخطأُ خادمٍ وحمولةٌ فاسدةٌ — أصنافُ `RoutingErrorKind` التي يصلُها السِلكُ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { createViewerAccountReader } from "../../packages/infrastructure/identity/viewer-account.ts";
import { createQuoteJudge } from "../../packages/infrastructure/quote/quote-store.ts";
import { createActiveRideReader } from "../../packages/infrastructure/transport/active-ride-store.ts";
import {
  createRideRequestCommand,
  createRideSearchReader,
} from "../../packages/infrastructure/transport/ride-request-store.ts";
import { OSRM_TIMEOUT_MS } from "../../packages/maps/providers/osrm/osrm-provider.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { DEPENDENCY_BUDGETS } from "../../packages/shared/resilience/dependency-guard.ts";
import {
  judgeOutageRead,
  judgeRecovery,
  type OutageViolation,
  type RideSnapshot,
} from "../../scripts/lib/routing-outage.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** سرُّ جلسةٍ محليٌّ لا قيمةَ له خارجَ هذا الملفِّ. */
const SESSION_SECRET = "routing-outage-secret-اثنان-وثلاثون-حرفاً-على-الأقلِّ-للجلسة";
const WEBHOOK_SECRET = "routing-outage-webhook-secret";

const RIDER_TELEGRAM_ID = 900_000_983;
const DRIVER_TELEGRAM_ID = 900_000_984;

const PICKUP = { lat: 21.4858, lng: 39.1925 } as const;
const DROPOFF = { lat: 21.5591, lng: 39.1553 } as const;

/**
 * خُطوةُ الحركةِ بينَ قراءةٍ وقراءةٍ: مفتاحُ التخزينِ يُقرَّبُ إلى ثلاثِ خاناتٍ،
 * فـ0.002° مفتاحٌ جديدٌ يقيناً — كي يُسألَ المزوّدُ فعلاً في كلِّ طورٍ لا المخزنُ.
 */
const MOVE_STEP_DEGREES = 0.002;

/** حمولةُ `OSRM` صحيحةُ الشكلِ. */
const ROUTE_BODY = {
  code: "Ok",
  routes: [{ distance: 1731.4, duration: 714.9, geometry: { coordinates: [[39.1751, 21.5534]] } }],
  waypoints: [{ distance: 12.3 }, { distance: 27.4 }],
};

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderUserId = "";
let riderId = "";
let driverUserId = "";
let driverId = "";
let orderId = "";

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكب عطل المزوّد', '+966500000983')
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
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائق عطل المزوّد', '+966500000984')
    returning id
  `;
  if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = driverUser.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ر ن ب 4322')
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;

  // القدرةُ والاشتراكُ والتوفُّرُ شروطٌ في القاعدةِ: البذرُ يستوفيها ولا يُخفِّفُها.
  await sql`
    insert into subscriptions (city_id, driver_id, plan, status)
    values (${cityId}, ${driverId}, 'both'::subscription_plan, 'active'::subscription_status)
  `;
  await sql`
    insert into driver_capabilities (city_id, driver_id, service, is_enabled)
    values (${cityId}, ${driverId}, 'transport'::service_type, true)
  `;
  await sql`
    insert into driver_availability (city_id, driver_id, is_available)
    values (${cityId}, ${driverId}, true)
  `;
  await sql`
    update drivers set
      last_location = st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
      last_location_at = now()
    where id = ${driverId}
  `;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (riderId !== "") {
    await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId})`;
    await sql`delete from orders where rider_id = ${riderId}`;
    await sql`delete from riders where id = ${riderId}`;
  }
  if (driverId !== "") {
    await sql`delete from driver_location_history where driver_id = ${driverId}`;
    await sql`delete from driver_availability where driver_id = ${driverId}`;
    await sql`delete from driver_capabilities where driver_id = ${driverId}`;
    await sql`delete from subscriptions where driver_id = ${driverId}`;
    await sql`delete from drivers where id = ${driverId}`;
  }
  for (const id of [riderUserId, driverUserId]) {
    if (id === "") continue;
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

function tokenFor(telegramUserId: string, bot: "rider" | "driver"): string {
  const issued = createMiniAppSessionIssuer({ secret: SESSION_SECRET }).issue(
    { telegramUserId, bot, authDateSeconds: Math.floor(Date.now() / 1000) },
    Date.now(),
  );
  if (!issued.ok) throw new Error("إصدارُ الجلسةِ فاشلٌ");
  return issued.value.accessToken;
}

type WireMode = "healthy" | "hanging" | "server_error" | "malformed";

/**
 * خادمُ توجيهٍ حقيقيٌّ بطورٍ قابلٍ للتبديلِ. و«مُطفَأٌ» ليسَ طوراً فيه بل **إيقافُه**:
 * رفضُ اتصالٍ حقيقيٌّ من نواةِ النظامِ، لا ردٌّ مصنوعٌ.
 */
interface FakeOsrm {
  mode: WireMode;
  calls: number;
  readonly port: number;
  stop(): void;
  start(): void;
}

function fakeOsrm(): FakeOsrm {
  const handle: FakeOsrm = {
    mode: "healthy",
    calls: 0,
    port: 0,
    stop: () => {},
    start: () => {},
  };
  const serve = (port: number) =>
    Bun.serve({
      port,
      fetch: () => {
        handle.calls += 1;
        switch (handle.mode) {
          case "hanging":
            // لا ردَّ ألبتّةَ: المهلةُ في المزوّدِ هيَ وحدَها ما يُنهي الانتظارَ.
            return new Promise<Response>(() => {});
          case "server_error":
            return new Response("upstream exploded", { status: 503 });
          case "malformed":
            return new Response("{not json", {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          default:
            return new Response(JSON.stringify(ROUTE_BODY), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
        }
      },
    });
  let server = serve(0);
  const port = server.port ?? 0;
  Object.assign(handle, {
    port,
    stop: () => server.stop(true),
    start: () => {
      server = serve(port);
    },
  });
  return handle;
}

interface RideRead {
  readonly httpStatus: number;
  readonly snapshot: RideSnapshot | null;
  readonly etaKind: string | null;
  readonly etaReason: string | null;
  readonly elapsedMs: number;
}

interface Harness {
  readonly app: ReturnType<typeof createServer>;
  close(): Promise<void>;
}

function harness(config: AppConfig): Harness {
  const driverSent: SentMessage[] = [];
  const riderSent: SentMessage[] = [];
  const container = buildContainer(config, {
    driverSender: capturing(driverSent),
    riderSender: capturing(riderSent),
  });
  // التركيبُ إن لم يصلِ المزوّدَ صارَ كلُّ «إخفاءٍ صادقٍ» بعدَه `NOT_CONFIGURED` كذباً.
  expect(container.routing).not.toBeNull();
  const sessions = createMiniAppSessionReader(SESSION_SECRET);
  const now = (): Date => new Date();
  const app = createServer({
    health: { now, startedAt: now(), env: process.env },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    quote: { quote: { sessions, judge: createQuoteJudge(sql), routing: container.routing, now } },
    driverLocation: {
      viewer: { sessions, accounts: createViewerAccountReader(sql), now },
      drivers: container.driverLocation.drivers,
      ingest: container.driverLocation.ingest,
    },
    rides: {
      request: { sessions, rides: createRideRequestCommand(sql), now },
      search: { sessions, search: createRideSearchReader(sql), now },
      active: {
        sessions,
        rides: createActiveRideReader(sql),
        now,
        routing: { routing: container.routing },
      },
    },
  });
  return { app, close: () => container.close() };
}

let moves = 0;

/** يحرّكُ السائقَ خطوةً ويختمُ الموقعَ الآنَ — مفتاحُ توجيهٍ جديدٌ وموقعٌ صالحٌ. */
async function moveDriver(): Promise<void> {
  moves += 1;
  await sql`
    update drivers set
      last_location = st_setsrid(st_makepoint(
        ${PICKUP.lng + moves * MOVE_STEP_DEGREES},
        ${PICKUP.lat + moves * MOVE_STEP_DEGREES}
      ), 4326)::geography,
      last_location_at = now()
    where id = ${driverId}
  `;
}

async function readRide(app: Harness["app"], token: string): Promise<RideRead> {
  const began = performance.now();
  const response = await app.fetch(
    new Request(`http://localhost/v1/rides/${orderId}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  const elapsedMs = performance.now() - began;
  const text = await response.text();
  if (response.status !== 200) {
    return {
      httpStatus: response.status,
      snapshot: null,
      etaKind: null,
      etaReason: null,
      elapsedMs,
    };
  }
  const body = JSON.parse(text) as {
    found?: boolean;
    orderId?: string;
    status?: string;
    phase?: string;
    driver?: unknown;
    position?: { show?: boolean } | null;
    eta?: { kind?: string; reason?: string } | null;
  };
  const snapshot: RideSnapshot | null =
    body.found === true
      ? {
          orderId: body.orderId ?? "",
          status: body.status ?? "",
          phase: body.phase ?? "",
          driverPresent: body.driver !== null && body.driver !== undefined,
          positionShown: body.position?.show === true,
        }
      : null;
  return {
    httpStatus: response.status,
    snapshot,
    etaKind: body.eta?.kind ?? null,
    etaReason: body.eta?.reason ?? null,
    elapsedMs,
  };
}

async function storedStatus(): Promise<string> {
  const [row] = await sql<
    { status: string }[]
  >`select status::text as status from orders where id = ${orderId}`;
  return row?.status ?? "<مفقود>";
}

function report(violations: readonly OutageViolation[]): void {
  for (const violation of violations) {
    console.error(`✗ [${violation.rule}] (${violation.mode}) ${violation.detail}`);
  }
}

/** يُنشِئُ الرحلةَ عبرَ المسارِ الحقيقيِّ ثمَّ يُسنِدُها (الإسنادُ عملُ `F3` لا موضوعُ القياسِ). */
async function ensureRide(app: Harness["app"], riderToken: string): Promise<void> {
  if (orderId !== "") return;
  const created = await app.fetch(
    new Request("http://localhost/v1/rides", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${riderToken}`,
        "Idempotency-Key": `routing-outage:${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        service: "transport",
        originLat: PICKUP.lat,
        originLng: PICKUP.lng,
        destinationLat: DROPOFF.lat,
        destinationLng: DROPOFF.lng,
      }),
    }),
  );
  const createdText = await created.text();
  const rideBody = JSON.parse(createdText) as { accepted?: boolean; orderId?: string };
  if (rideBody.accepted !== true) throw new Error(`الإنشاءُ مرفوضٌ: ${createdText}`);
  orderId = rideBody.orderId ?? "";
  await sql`
    update orders set status = 'in_progress'::order_status, assigned_driver_id = ${driverId},
                      matched_at = now(), started_at = now()
     where id = ${orderId}
  `;
}

function osrmConfig(osrm: FakeOsrm, overrides: Partial<AppConfig> = {}): AppConfig {
  return testConfig({
    port: 3993,
    telegramWebhookSecret: WEBHOOK_SECRET,
    routingProvider: "osrm",
    osrmBaseUrl: `http://127.0.0.1:${osrm.port}`,
    ...overrides,
  });
}

/** خطُّ الأساسِ: المزوّدُ سليمٌ والمدّةُ `ROUTED` — وإلّا فلا معنى لـ«أُخفيَت». */
async function baselineRide(app: Harness["app"], riderToken: string): Promise<RideSnapshot> {
  await moveDriver();
  const baseline = await readRide(app, riderToken);
  expect(baseline.httpStatus).toBe(200);
  expect(baseline.etaKind).toBe("ROUTED");
  expect(baseline.snapshot?.positionShown).toBe(true);
  if (baseline.snapshot === null) throw new Error("الرحلةُ غائبةٌ والمزوّدُ سليمٌ");
  return baseline.snapshot;
}

describeIf("F11-06 — توقُّفُ مزوّدِ الخرائطِ محقوناً على السِلكِ", () => {
  /**
   * **كلُّ طورٍ في تركيبٍ جديدٍ**: قاطعُ الدائرةِ (`DEPENDENCY_BUDGETS.maps`) يُفتَحُ
   * بعدَ خمسةِ إخفاقاتٍ، فطورٌ يلي آخرَ في التركيبِ عينِه **لا يصلُ السِلكَ** —
   * يُرفَضُ عندَ القاطعِ فيُقرأُ «أُخفيَت» وهوَ لم يُحقَنْ. وقد قيسَ ذلكَ فعلاً في
   * أوّلِ تشغيلٍ: `malformed` بصفرِ طلباتٍ. فالحَكَمُ يشترطُ الوصولَ (`outage.injected`).
   */
  for (const mode of ["stopped", "hanging", "server_error", "malformed"] as const) {
    it(`${mode}: الرحلةُ عينُها، والمدّةُ \`PROVIDER_DOWN\`، والقراءةُ مقيَّدةٌ، والاقتباسُ صادقٌ`, async () => {
      const osrm = fakeOsrm();
      const h = harness(osrmConfig(osrm));
      const riderToken = tokenFor(String(RIDER_TELEGRAM_ID), "rider");
      const driverToken = tokenFor(String(DRIVER_TELEGRAM_ID), "driver");
      try {
        await ensureRide(h.app, riderToken);
        const before = await baselineRide(h.app, riderToken);

        if (mode === "stopped") osrm.stop();
        else osrm.mode = mode;
        await moveDriver();
        const callsBefore = osrm.calls;
        const read = await readRide(h.app, riderToken);
        const wireCalls = osrm.calls - callsBefore;
        const violations = judgeOutageRead({
          mode,
          httpStatus: read.httpStatus,
          before,
          during: read.snapshot,
          storedStatus: await storedStatus(),
          etaKind: read.etaKind,
          etaReason: read.etaReason,
          elapsedMs: read.elapsedMs,
          providerBudgetMs: OSRM_TIMEOUT_MS,
          wireCalls,
        });

        // الاقتباسُ أثناءَ العطلِ: يُقبَلُ والمدّةُ فيه مُخفاةٌ بالسببِ عينِه.
        const quoted = await h.app.fetch(
          new Request("http://localhost/v1/quote/ride", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${riderToken}` },
            body: JSON.stringify({
              originLat: PICKUP.lat + moves * MOVE_STEP_DEGREES,
              originLng: PICKUP.lng,
              destinationLat: DROPOFF.lat,
              destinationLng: DROPOFF.lng,
            }),
          }),
        );
        const quoteBody = JSON.parse(await quoted.text()) as {
          accepted?: boolean;
          eta?: { kind?: string; reason?: string };
        };

        // نبضةُ السائقِ أثناءَ العطلِ: مسارُ الموقعِ لا يعرفُ المزوّدَ أصلاً.
        const beat = await h.app.fetch(
          new Request("http://localhost/v1/driver/location", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${driverToken}` },
            body: JSON.stringify({
              latitude: PICKUP.lat + moves * MOVE_STEP_DEGREES,
              longitude: PICKUP.lng + moves * MOVE_STEP_DEGREES,
              accuracyMeters: 8,
              recordedAtMs: Date.now(),
            }),
          }),
        );

        console.log(
          `── F11-06 · ${mode}: ${String(read.httpStatus)} · ${String(read.etaKind)}/${String(read.etaReason)} · ` +
            `${String(Math.round(read.elapsedMs))}ms (سقفٌ ${String(OSRM_TIMEOUT_MS)}ms+هامشٌ) · ` +
            `${String(wireCalls)} طلباً على السِلكِ · اقتباسٌ ${String(quoted.status)} ` +
            `${String(quoteBody.eta?.kind)}/${String(quoteBody.eta?.reason)} · نبضةٌ ${String(beat.status)}`,
        );
        report(violations);
        expect(violations).toEqual([]);
        expect(quoted.status).toBe(200);
        expect(quoteBody.accepted).toBe(true);
        expect(quoteBody.eta?.kind).toBe("UNAVAILABLE");
        expect(quoteBody.eta?.reason).toBe("PROVIDER_DOWN");
        expect(beat.status).toBe(200);
      } finally {
        osrm.stop();
        await h.close();
      }
    }, 60_000);
  }

  it("التعافي: القاطعُ المفتوحُ يُخفي بصدقٍ، ثمَّ تعودُ المدّةُ من السِلكِ بعدَ مهلتِه", async () => {
    const osrm = fakeOsrm();
    const h = harness(osrmConfig(osrm));
    const riderToken = tokenFor(String(RIDER_TELEGRAM_ID), "rider");
    const violations: OutageViolation[] = [];
    try {
      await ensureRide(h.app, riderToken);
      const before = await baselineRide(h.app, riderToken);

      // عطلٌ متكرِّرٌ حتّى يُفتَحَ القاطعُ: قراءةٌ بلا طلبٍ على السِلكِ هيَ علامتُه.
      osrm.mode = "server_error";
      let opened = false;
      for (let attempt = 0; attempt < DEPENDENCY_BUDGETS.maps.failureThreshold + 2; attempt += 1) {
        await moveDriver();
        const callsBefore = osrm.calls;
        const read = await readRide(h.app, riderToken);
        expect(read.etaReason).toBe("PROVIDER_DOWN");
        if (osrm.calls === callsBefore) {
          opened = true;
          break;
        }
      }
      expect(opened).toBe(true);

      // المزوّدُ عادَ والقاطعُ ما زالَ مفتوحاً: المدّةُ مُخفاةٌ بالسببِ عينِه — لا رقمٌ.
      osrm.mode = "healthy";
      await moveDriver();
      const callsWhileOpen = osrm.calls;
      const stillOpen = await readRide(h.app, riderToken);
      const wireWhileOpen = osrm.calls - callsWhileOpen;
      // القاطعُ المفتوحُ لا يُرسِلُ: لو وصلَ طلبٌ لكانَ «الإخفاءُ» هنا عطلاً آخرَ لا القاطعَ.
      expect(wireWhileOpen).toBe(0);
      violations.push(
        ...judgeOutageRead({
          mode: "stopped",
          httpStatus: stillOpen.httpStatus,
          before,
          during: stillOpen.snapshot,
          storedStatus: await storedStatus(),
          etaKind: stillOpen.etaKind,
          etaReason: stillOpen.etaReason,
          elapsedMs: stillOpen.elapsedMs,
          providerBudgetMs: OSRM_TIMEOUT_MS,
          wireCalls: wireWhileOpen,
        }),
      );

      // بعدَ مهلةِ القاطعِ المستوردةِ: مِسبارُ نصفِ الفتحِ يصلُ السِلكَ فتعودُ المدّةُ.
      const openedAt = performance.now();
      await Bun.sleep(DEPENDENCY_BUDGETS.maps.cooldownMs + 250);
      await moveDriver();
      const callsBeforeRecovery = osrm.calls;
      const recovered = await readRide(h.app, riderToken);
      violations.push(
        ...judgeRecovery({
          httpStatus: recovered.httpStatus,
          etaKind: recovered.etaKind,
          wireCalls: osrm.calls - callsBeforeRecovery,
        }),
      );
      console.log(
        `── F11-06 · تعافٍ: قاطعٌ مفتوحٌ ⇒ ${String(stillOpen.etaKind)}/${String(stillOpen.etaReason)} ` +
          `بـ${String(wireWhileOpen)} طلباً · بعدَ ${String(Math.round(performance.now() - openedAt))}ms ⇒ ` +
          `${String(recovered.etaKind)} بـ${String(osrm.calls - callsBeforeRecovery)} طلباً`,
      );
      report(violations);
      expect(violations).toEqual([]);
    } finally {
      osrm.stop();
      await h.close();
    }
  }, 60_000);

  it("الحصّةُ المُعلَنةُ مستنفَدةٌ: المدّةُ `PROVIDER_DOWN` بلا طلبٍ على السِلكِ (`ADR 0190`)", async () => {
    const osrm = fakeOsrm();
    const h = harness(osrmConfig(osrm, { routingRateLimit: { calls: 1, windowSeconds: 60 } }));
    const riderToken = tokenFor(String(RIDER_TELEGRAM_ID), "rider");
    try {
      await ensureRide(h.app, riderToken);
      await moveDriver();
      const first = await readRide(h.app, riderToken);
      expect(first.etaKind).toBe("ROUTED");
      const before = first.snapshot;
      if (before === null) throw new Error("الرحلةُ غائبةٌ والحصّةُ لم تُستنفَدْ");

      await moveDriver();
      const callsBefore = osrm.calls;
      const read = await readRide(h.app, riderToken);
      const violations = judgeOutageRead({
        mode: "quota_exhausted",
        httpStatus: read.httpStatus,
        before,
        during: read.snapshot,
        storedStatus: await storedStatus(),
        etaKind: read.etaKind,
        etaReason: read.etaReason,
        elapsedMs: read.elapsedMs,
        providerBudgetMs: OSRM_TIMEOUT_MS,
        wireCalls: osrm.calls - callsBefore,
      });
      console.log(
        `── F11-06 · quota_exhausted: ${String(read.httpStatus)} · ` +
          `${String(read.etaKind)}/${String(read.etaReason)} · ${String(osrm.calls - callsBefore)} طلباً على السِلكِ`,
      );
      report(violations);
      expect(violations).toEqual([]);
    } finally {
      osrm.stop();
      await h.close();
    }
  }, 60_000);
});
