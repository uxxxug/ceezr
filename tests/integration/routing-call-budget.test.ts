/**
 * الغرض: **قياسُ** عددِ نداءاتِ مزوّدِ التوجيهِ في رحلةٍ واحدةٍ على **السِلكِ**
 *   (`ECO-002` — الشقُّ المملوكُ للمستودَعِ): طلباتُ `HTTP` تُعَدُّ في خادمِ
 *   توجيهٍ حقيقيٍّ يُصغي على منفذٍ حقيقيٍّ، والبوّابةُ بوّابةٌ حقيقيّةٌ مُركَّبةٌ
 *   من `buildContainer` بضبطِ `ROUTING_PROVIDER=osrm`، والقاعدةُ `PostgreSQL`
 *   حقيقيّةٌ — ثمَّ يُحاكَمُ العددُ بسقفٍ **مُشتَقٍّ** لا مكتوبٍ.
 *
 *   والذي يُقاسُ ههنا لا يقدرُ عليه حاجزٌ ساكنٌ ولا اختبارُ وحدةٍ بمزوّدٍ مُزيَّفٍ:
 *     ــ **أنَّ نبضةَ موقعِ سائقٍ لا تُنادي مزوّداً ألبتّةَ**: ستّونَ نبضةً
 *        تمرُّ من `POST /v1/driver/location` إلى الصفِّ القانونيِّ، والعدّادُ على
 *        المنفذِ يجبُ أن يبقى كما هوَ. وهذه هيَ الدعوى الاقتصاديّةُ عينُها:
 *        **الفاتورةُ تنمو بقراءاتِ الراكبِ لا بترددِ النبضةِ**.
 *     ــ **أنَّ طبقةَ التخزينِ (CAP-012) تمنعُ نداءً فعلاً**: قراءاتٌ مكرَّرةٌ
 *        بموضعٍ لم يتغيَّرْ داخلَ مدّةِ الصلاحيّةِ لا تُضيفُ طلباً على السِلكِ.
 *        وحاجزُ `scripts/check-route-cache-policy.ts` يقولُ في وثيقتِه إنَّه «لا
 *        يُثبتُ أنَّ التخزينَ يعملُ» — وهذا الملفُّ هوَ الذي يُثبتُه بعددٍ.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (وظيفةُ «تكامل على PostgreSQL حقيقي») ·
 *   `scripts/check-routing-call-budget.ts`
 * يحرسُه: `scripts/check-routing-call-budget.ts` في سلسلةِ `ci`
 * الحاكم: `docs/adr/0151-routing-calls-per-ride-are-counted-not-estimated.md`
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ — ويُعلَنُ في الدليلِ ═══
 * ــ **لا تُقاسُ تكلفةٌ بالمالِ**: السعرُ في فاتورةِ مزوّدٍ لا يملكُها المستودَعُ
 *    (`REQ-09` · `[!]` · القاعدةُ 0-9). فالمقيسُ **العددُ**، ومن ضربَه في سعرٍ
 *    حقيقيٍّ حصلَ على الفاتورةِ — ولا رقمَ ماليّاً في هذا الملفِّ ولا في حَكَمِه.
 * ــ **أعدادُ النبضاتِ والقراءاتِ مُعلَنةٌ لا مقيسةٌ من نشرٍ حيٍّ**
 *    (`RIDE_ROUTING_PROFILE`): لا مستخدمينَ في الإنتاجِ (`ADR 0099`). والمقيسُ
 *    **نصيبُ كلِّ صنفٍ من النداءاتِ**، وهوَ ما لا يتغيَّرُ بتغيُّرِ الشكلِ:
 *    نصيبُ النبضاتِ صفرٌ كم كانَت.
 * ــ **لا يُقاسُ سلوكُ `OSRM` حقيقيٍّ**: الخادمُ ههنا يردُّ حمولةً ثابتةً صحيحةَ
 *    الشكلِ. والمقيسُ **كم طلباً وصلَه**، لا صوابُ المسافةِ التي يردُّها.
 * ــ **لا تُقاسُ مساراتٌ غيرُ `route`**: `nearest` و`table` غيرُ مخزَّنتَينِ في
 *    `CachedRoutingProvider` ولا يستدعيهما سطحُ الراكبِ اليومَ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { DEFAULT_ROUTE_CACHE_THRESHOLDS } from "../../packages/application/tracking/route-cache.ts";
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
import {
  judgeRoutingCalls,
  RIDE_ROUTING_PROFILE,
  type RoutingCallFacts,
  routingCallBudget,
  summarizeRoutingCalls,
} from "../../scripts/lib/routing-call-budget.ts";
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
const SESSION_SECRET = "routing-call-budget-secret-اثنان-وثلاثون-حرفاً-على-الأقلِّ";
const WEBHOOK_SECRET = "routing-call-budget-webhook-secret";

const RIDER_TELEGRAM_ID = 900_000_981;
const DRIVER_TELEGRAM_ID = 900_000_982;

const PICKUP = { lat: 21.4858, lng: 39.1925 } as const;
const DROPOFF = { lat: 21.5591, lng: 39.1553 } as const;

/**
 * خُطوةُ الحركةِ بينَ قراءةٍ وقراءةٍ بالدرجاتِ.
 *
 * ومفتاحُ التخزينِ في `CachedRoutingProvider` يُقرَّبُ إلى ثلاثِ خاناتٍ عشريّةٍ،
 * فخطوةٌ 0.002° (زُهاءَ 222 متراً في العرضِ) تُنتِجُ مفتاحاً جديداً **يقيناً**
 * وتتجاوزُ عتبةَ `minChangeMeters` المستوردةَ. والرقمُ ههنا **خطوةُ بذرٍ** لا
 * عتبةُ سياسةٍ: العتبةُ تُقرأُ من مصدرِها ولا تُنسَخُ.
 */
const MOVE_STEP_DEGREES = 0.002;

/** حمولةُ `OSRM` صحيحةُ الشكلِ — ثابتةٌ: المقيسُ عددُ الطلباتِ لا صوابُ الردِّ. */
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
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكب قياس النداءات', '+966500000981')
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
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائق قياس النداءات', '+966500000982')
    returning id
  `;
  if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = driverUser.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ر ن ب 4321')
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

describeIf("ECO-002 — نداءاتُ التوجيهِ لكلِّ رحلةٍ، معدودةً على السِلكِ", () => {
  it("رحلةٌ واحدةٌ: نبضاتٌ لا تُنادي، ومكرَّرٌ يُخزَّنُ، والمجموعُ تحتَ سقفٍ مُشتَقٍّ", async () => {
    /**
     * العدّادُ على **السِلكِ**: كلُّ طلبٍ يصلُ هذا الخادمَ نداءٌ مدفوعُ الثمنِ في
     * الإنتاجِ. ولا يُقاسُ بجاسوسٍ على دالّةٍ: جاسوسٌ يُخفي طلباً يُرسِلُه
     * المزوّدُ من وراءِ الواجهةِ.
     */
    let calls = 0;
    const osrm = Bun.serve({
      port: 0,
      fetch: () => {
        calls += 1;
        return new Response(JSON.stringify(ROUTE_BODY), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const driverSent: SentMessage[] = [];
    const riderSent: SentMessage[] = [];
    const container = buildContainer(
      testConfig({
        port: 3992,
        telegramWebhookSecret: WEBHOOK_SECRET,
        routingProvider: "osrm",
        osrmBaseUrl: `http://127.0.0.1:${osrm.port}`,
      }),
      { driverSender: capturing(driverSent), riderSender: capturing(riderSent) },
    );
    // التركيبُ إن لم يصل المزوّدَ صارَ كلُّ ما بعدَه «صفرَ نداءاتٍ» كذباً.
    expect(container.routing).not.toBeNull();

    const sessions = createMiniAppSessionReader(SESSION_SECRET);
    const now = (): Date => new Date();
    const app = createServer({
      health: { now, startedAt: now(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
      quote: {
        quote: { sessions, judge: createQuoteJudge(sql), routing: container.routing, now },
      },
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

    const riderToken = tokenFor(String(RIDER_TELEGRAM_ID), "rider");
    const driverToken = tokenFor(String(DRIVER_TELEGRAM_ID), "driver");

    const windowStartedAt = Date.now();
    try {
      // ═══ ١) الاقتباسُ: نداءٌ واحدٌ لكلِّ رحلةٍ قبلَ أن توجَدَ الرحلةُ ═══
      const quoted = await app.fetch(
        new Request("http://localhost/v1/quote/ride", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${riderToken}`,
          },
          body: JSON.stringify({
            originLat: PICKUP.lat,
            originLng: PICKUP.lng,
            destinationLat: DROPOFF.lat,
            destinationLng: DROPOFF.lng,
          }),
        }),
      );
      const quoteText = await quoted.text();
      if (quoted.status !== 200) throw new Error(`الاقتباسُ مرفوضٌ: ${quoteText}`);
      const callsAfterQuote = calls;
      expect(callsAfterQuote).toBe(RIDE_ROUTING_PROFILE.quoteCallCount);

      // ═══ ٢) الرحلةُ تُنشَأُ ثمَّ تُسنَدُ: الإسنادُ عملُ `F3` لا موضوعُ القياسِ ═══
      const created = await app.fetch(
        new Request("http://localhost/v1/rides", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${riderToken}`,
            "Idempotency-Key": `routing-calls:${crypto.randomUUID()}`,
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
      expect(orderId).not.toBe("");
      await sql`
        update orders set status = 'in_progress'::order_status, assigned_driver_id = ${driverId},
                          matched_at = now(), started_at = now()
         where id = ${orderId}
      `;

      // ═══ ٣) النبضاتُ: مسارٌ ساخنٌ حقيقيٌّ — والمطلوبُ صفرُ نداءاتٍ ═══
      const callsBeforeHeartbeats = calls;
      for (let index = 0; index < RIDE_ROUTING_PROFILE.heartbeatCount; index += 1) {
        const response = await app.fetch(
          new Request("http://localhost/v1/driver/location", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${driverToken}`,
            },
            body: JSON.stringify({
              latitude: PICKUP.lat + index * MOVE_STEP_DEGREES * 0.1,
              longitude: PICKUP.lng,
              accuracyMeters: 8,
              recordedAtMs: windowStartedAt - (RIDE_ROUTING_PROFILE.heartbeatCount - index) * 1_000,
            }),
          }),
        );
        // نبضةٌ مرفوضةٌ لا تُقاسُ «صفرَ نداءاتٍ»: الرفضُ يُقرأُ بنصِّه.
        if (response.status !== 200) {
          throw new Error(`نبضةٌ مرفوضةٌ (${response.status}): ${await response.text()}`);
        }
      }
      const callsDuringHeartbeats = calls - callsBeforeHeartbeats;

      // ═══ ٤) قراءاتُ الراكبِ بمواضعَ متغيّرةٍ: ههنا تنمو الفاتورةُ ═══
      for (let index = 0; index < RIDE_ROUTING_PROFILE.activeReadCount; index += 1) {
        await sql`
          update drivers set
            last_location = st_setsrid(st_makepoint(
              ${PICKUP.lng + (index + 1) * MOVE_STEP_DEGREES},
              ${PICKUP.lat + (index + 1) * MOVE_STEP_DEGREES}
            ), 4326)::geography,
            last_location_at = now()
          where id = ${driverId}
        `;
        const read = await app.fetch(
          new Request(`http://localhost/v1/rides/${orderId}`, {
            headers: { authorization: `Bearer ${riderToken}` },
          }),
        );
        if (read.status !== 200) {
          throw new Error(`قراءةٌ مرفوضةٌ (${read.status}): ${await read.text()}`);
        }
      }
      const callsAfterActiveReads = calls;

      // ═══ ٥) قراءاتٌ مكرَّرةٌ بلا حركةٍ: أثرُ التخزينِ يُقاسُ بما لم يُرسَلْ ═══
      for (let index = 0; index < RIDE_ROUTING_PROFILE.repeatedReadCount; index += 1) {
        const read = await app.fetch(
          new Request(`http://localhost/v1/rides/${orderId}`, {
            headers: { authorization: `Bearer ${riderToken}` },
          }),
        );
        if (read.status !== 200) {
          throw new Error(`قراءةٌ مكرَّرةٌ مرفوضةٌ (${read.status}): ${await read.text()}`);
        }
      }
      const callsDuringRepeatedReads = calls - callsAfterActiveReads;

      const facts: RoutingCallFacts = {
        measured: true,
        heartbeatCount: RIDE_ROUTING_PROFILE.heartbeatCount,
        activeReadCount: RIDE_ROUTING_PROFILE.activeReadCount,
        repeatedReadCount: RIDE_ROUTING_PROFILE.repeatedReadCount,
        callsDuringHeartbeats,
        callsDuringRepeatedReads,
        totalCalls: calls,
        windowMs: RIDE_ROUTING_PROFILE.windowMs,
        thresholds: {
          minChangeMeters: DEFAULT_ROUTE_CACHE_THRESHOLDS.minChangeMeters,
          ttlSeconds: DEFAULT_ROUTE_CACHE_THRESHOLDS.ttlSeconds,
        },
      };
      const budget = routingCallBudget(RIDE_ROUTING_PROFILE);
      const violations = judgeRoutingCalls({
        facts,
        profile: RIDE_ROUTING_PROFILE,
        budget,
        declaredThresholds: DEFAULT_ROUTE_CACHE_THRESHOLDS,
      });

      console.log(`\n── ECO-002 ──\n${summarizeRoutingCalls(facts, budget)}\n`);
      for (const violation of violations) {
        console.error(`✗ ${violation.rule}: ${violation.detail}`);
      }
      expect(violations).toEqual([]);
    } finally {
      osrm.stop(true);
      await container.close();
    }
  }, 120_000);
});
