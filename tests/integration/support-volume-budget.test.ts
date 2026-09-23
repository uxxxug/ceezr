/**
 * الغرض: قياسُ **تذاكرِ الدعمِ النظاميّةِ** التي يُنشِئُها مسارُ رحلةٍ واحدةٍ على
 *   السِلكِ — البندُ `ECO-006` (شقُّ قياسٍ أوّليٌّ مملوكٌ للمستودَعِ). ويُحاكَمُ
 *   الناتجُ بحَكَمِ `scripts/lib/support-volume-budget.ts`.
 *
 *   **المسارُ المقيسُ كما هوَ** (ADR 0180):
 *     ١) اقتباسٌ وإنشاءُ رحلةٍ عبرَ بوّابةٍ من `buildContainer`؛
 *     ٢) عرضٌ `pending` يُزرَعُ صفّاً — كما في `driver-job.test.ts` — فلا تُقاسُ جولةُ الإرسالِ؛
 *     ٣) `claim_ride` ← `driver_mark_arrived` ← `driver_start_ride` — دوالُّ النظامِ لا تحديثُ
 *        حالةٍ يدويٌّ؛
 *     ٤) نبضاتُ موقعٍ وقراءاتٌ نشطةٌ عبرَ البوّابةِ أثناءَ `in_progress`؛
 *     ٥) `driver_complete_ride`.
 *   **ولا يُشغَّلُ** التقييمُ ولا الإلغاءُ ولا التصعيدُ ولا النزاعُ.
 *
 *   والمقيسُ: `support_tickets` المنسوبةُ إلى الطلبِ أو راكبِه أو سائقِه قبلَ وبعدُ —
 *   **الفرقُ خاماً** بلا تطهيرٍ (الحَكَمُ يكشفُ الشذوذَ بـ`counts.sane`)؛ وانتقالاتُ
 *   الحالةِ **معدودةً من `audit_log`** للطلبِ لا منسوخةً من الثابتِ.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقَّع أن يستخدمه لاحقاً: CI (وظيفةُ «تكامل على PostgreSQL حقيقي») ·
 *   `scripts/check-support-volume-budget.ts`
 * يحرسُه: `scripts/check-support-volume-budget.ts` في سلسلةِ `ci`
 * الحاكم: `docs/adr/0179-support-tickets-per-ride-are-counted-not-estimated.md` · `docs/adr/0180-eco-006-measures-system-tickets-only-not-support-rate.md`
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ — ويُعلَنُ في الدليلِ ═══
 * ــ **معدَّلُ التذاكرِ التي يفتحُها المستخدمونَ لكلِّ ١٠٠٠ رحلةٍ**: سلوكُ مستخدمينَ لا شيفرةٍ.
 * ــ **سعرُ تذكرةِ الدعمِ**: خارجيٌّ، ولا قرارَ مالكٍ موثَّقٌ يُحدِّدُه بعدُ.
 * ــ **مساراتُ التقييمِ والإلغاءِ والتصعيدِ والنزاعِ**: خارجَ المسارِ المقيسِ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { SUPPORT_TICKET_TYPES } from "../../packages/domain/support/ticket-types.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { createViewerAccountReader } from "../../packages/infrastructure/identity/viewer-account.ts";
import { createQuoteJudge } from "../../packages/infrastructure/quote/quote-store.ts";
import type { RedisClient, RedisFailure } from "../../packages/infrastructure/redis/upstash.ts";
import { createActiveRideReader } from "../../packages/infrastructure/transport/active-ride-store.ts";
import {
  createRideRequestCommand,
  createRideSearchReader,
} from "../../packages/infrastructure/transport/ride-request-store.ts";
import type { Result } from "../../packages/shared/result/index.ts";
import { RIDE_RESOURCE_PROFILE } from "../../scripts/lib/resource-usage-budget.ts";
import {
  judgeSupportVolume,
  MEASURED_TRANSITION_ACTIONS,
  type SupportVolumeFacts,
  summarizeSupportVolume,
  supportTicketBudget,
} from "../../scripts/lib/support-volume-budget.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SESSION_SECRET = "support-volume-budget-secret-اثنان-وثلاثون-حرفاً-على-الأقلِّ";
const WEBHOOK_SECRET = "support-volume-webhook-secret";
const RIDER_TELEGRAM_ID = 490_001;
const DRIVER_TELEGRAM_ID = 490_002;
const PICKUP = { lat: 21.5471, lng: 39.1751 };
const DROPOFF = { lat: 21.5601, lng: 39.1901 };
const MOVE_STEP_DEGREES = 0.001;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("ECO-006: TEST_DATABASE_URL غير مضبوطٍ — اختبارُ تكاملِ عدِّ تذاكرِ الدعمِ لن يُشغَّلَ ههنا.");
}

function tokenFor(telegramUserId: string, bot: "rider" | "driver"): string {
  const issued = createMiniAppSessionIssuer({ secret: SESSION_SECRET }).issue(
    { telegramUserId, bot, authDateSeconds: Math.floor(Date.now() / 1000) },
    Date.now(),
  );
  if (!issued.ok) throw new Error("إصدارُ الجلسةِ فاشلٌ");
  return issued.value.accessToken;
}

const noOpRedis: RedisClient = {
  command: async (_args: readonly (string | number)[]): Promise<Result<unknown, RedisFailure>> => {
    return { ok: false, error: { kind: "network", detail: "no-op" } };
  },
};

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderUserId = "";
let riderId = "";
let driverUserId = "";
let driverId = "";

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكب تذاكر الدعم', '+966500000991')
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
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائق تذاكر الدعم', '+966500000992')
    returning id
  `;
  if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = driverUser.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ت ذ د 4902')
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
    await sql`delete from support_tickets where rider_id = ${riderId} or driver_id = ${driverId}`;
    await sql`
      delete from notification_outbox
       where order_id in (select id from orders where rider_id = ${riderId})
    `;
    await sql`
      delete from audit_log
       where entity_type = 'order'
         and entity_id in (select id from orders where rider_id = ${riderId})
    `;
    await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId})`;
    await sql`delete from orders where rider_id = ${riderId}`;
    await sql`delete from riders where id = ${riderId}`;
  }
  if (riderUserId !== "") {
    await sql`delete from users where id = ${riderUserId}`;
  }
  if (driverId !== "") {
    await sql`delete from driver_location_history where driver_id = ${driverId}`;
    await sql`delete from driver_availability where driver_id = ${driverId}`;
    await sql`delete from driver_capabilities where driver_id = ${driverId}`;
    await sql`delete from subscriptions where driver_id = ${driverId}`;
    await sql`delete from drivers where id = ${driverId}`;
  }
  if (driverUserId !== "") {
    await sql`delete from users where id = ${driverUserId}`;
  }
  if (cityHandle) await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

/**
 * تذاكرُ الدعمِ المنسوبةُ إلى هذه الرحلةِ أو طرفَيها — لا الجدولُ كلُّه، كي لا
 * يُحسَبَ على الرحلةِ ما يكتبُه ملفٌّ آخرُ.
 */
async function countRideTickets(orderId: string | null): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    select count(*)::int as count from support_tickets
     where rider_id = ${riderId}
        or driver_id = ${driverId}
        or (${orderId}::uuid is not null and order_id = ${orderId}::uuid)
  `;
  const count = rows[0]?.count;
  if (count === undefined) throw new Error("تعذّر عدُّ support_tickets");
  return count;
}

/** انتقالاتُ الحالةِ المرصودةُ في `audit_log` للطلبِ — ما كتبَته دوالُّ النظامِ نفسُها. */
async function countAuditedTransitions(orderId: string): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    select count(*)::int as count from audit_log
     where entity_type = 'order' and entity_id = ${orderId}::uuid
       and action in ${sql([...MEASURED_TRANSITION_ACTIONS])}
  `;
  const count = rows[0]?.count;
  if (count === undefined) throw new Error("تعذّر عدُّ audit_log");
  return count;
}

type Payload = Record<string, unknown>;

async function callJson(query: Promise<{ result: Payload }[]>): Promise<Payload> {
  const [row] = await query;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

describeIf("ECO-006 — تذاكرُ الدعمِ لكلِّ رحلةٍ، معدودةً على السِلكِ", () => {
  it("المسارُ المقيسُ (إيكالٌ ← وصولٌ ← بدءٌ ← إنهاءٌ بدوالِّ النظامِ): تذاكرُ نظاميّةٌ ضمنَ السقفِ المُشتَقِّ", async () => {
    const driverSent: SentMessage[] = [];
    const riderSent: SentMessage[] = [];

    const container = buildContainer(
      testConfig({
        port: 3995,
        telegramWebhookSecret: WEBHOOK_SECRET,
      }),
      {
        driverSender: capturing(driverSent),
        riderSender: capturing(riderSent),
        redis: noOpRedis,
      },
    );

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

    try {
      // ═══ قراءةُ خطِّ الأساسِ قبلَ الرحلةِ ═══
      const ticketsBefore = await countRideTickets(null);

      // ═══ ١) الاقتباسُ ═══
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
      if (quoted.status !== 200) throw new Error(`الاقتباسُ مرفوضٌ: ${await quoted.text()}`);

      // ═══ ٢) إنشاءُ الرحلةِ ═══
      const created = await app.fetch(
        new Request("http://localhost/v1/rides", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${riderToken}`,
            "Idempotency-Key": `support-volume:${crypto.randomUUID()}`,
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
      const orderId = rideBody.orderId ?? "";
      expect(orderId).not.toBe("");

      // ═══ ٣) الإيكالُ والوصولُ والبدءُ — بدوالِّ النظامِ لا بتحديثٍ يدويٍّ ═══
      // العرضُ يُزرَعُ صفّاً (كما في `driver-job.test.ts`): جولةُ الإرسالِ خارجَ المسارِ المقيسِ.
      await sql`
        insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
        values (${cityId}, ${orderId}, ${driverId}, 1, 'pending'::offer_status,
                now() + make_interval(secs => 120))
      `;
      const claim = await callJson(sql<{ result: Payload }[]>`
        select claim_ride(${orderId}::uuid, ${driverId}::uuid) as result
      `);
      if (claim.ok !== true) throw new Error(`claim_ride مرفوضٌ: ${String(claim.error)}`);
      const arrived = await callJson(sql<{ result: Payload }[]>`
        select driver_mark_arrived(${DRIVER_TELEGRAM_ID}::bigint, ${orderId}::uuid) as result
      `);
      if (arrived.ok !== true)
        throw new Error(`driver_mark_arrived مرفوضٌ: ${String(arrived.error)}`);
      const started = await callJson(sql<{ result: Payload }[]>`
        select driver_start_ride(${DRIVER_TELEGRAM_ID}::bigint, ${orderId}::uuid) as result
      `);
      if (started.ok !== true) throw new Error(`driver_start_ride مرفوضٌ: ${String(started.error)}`);

      // ═══ ٤) نبضاتُ موقعِ السائقِ ═══
      for (let index = 0; index < RIDE_RESOURCE_PROFILE.heartbeatCount; index += 1) {
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
              recordedAtMs: Date.now() - (RIDE_RESOURCE_PROFILE.heartbeatCount - index) * 1_000,
            }),
          }),
        );
        if (response.status !== 200) {
          throw new Error(`نبضةٌ مرفوضةٌ (${response.status}): ${await response.text()}`);
        }
      }

      // ═══ ٥) قراءاتُ الراكبِ ═══
      for (let index = 0; index < RIDE_RESOURCE_PROFILE.activeReadCount; index += 1) {
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

      // ═══ ٦) الإنهاءُ بدالّةِ النظامِ ═══
      const completed = await callJson(sql<{ result: Payload }[]>`
        select driver_complete_ride(${DRIVER_TELEGRAM_ID}::bigint, ${orderId}::uuid) as result
      `);
      if (completed.ok !== true) {
        throw new Error(`driver_complete_ride مرفوضٌ: ${String(completed.error)}`);
      }
      const [finalOrder] = await sql<{ status: string }[]>`
        select status::text as status from orders where id = ${orderId}
      `;
      expect(finalOrder?.status).toBe("completed");

      // ═══ قراءةُ القياسِ بعدَ الرحلةِ — الفرقُ خاماً، والشذوذُ للحَكَمِ ═══
      const ticketsAfter = await countRideTickets(orderId);
      const supportTicketsCreated = ticketsAfter - ticketsBefore;
      const lifecycleTransitions = await countAuditedTransitions(orderId);
      expect(lifecycleTransitions).toBe(MEASURED_TRANSITION_ACTIONS.length);

      // الأصنافُ من المصدرِ الواحدِ — لا تُنسَخُ ولا تُعادُ تعريفُها.
      expect(SUPPORT_TICKET_TYPES.length).toBeGreaterThan(0);

      const facts: SupportVolumeFacts = {
        measured: true,
        supportTicketsCreated,
        lifecycleTransitions,
      };

      const violations = judgeSupportVolume({
        facts,
        profile: RIDE_RESOURCE_PROFILE,
        supportTicketsBudget: supportTicketBudget(RIDE_RESOURCE_PROFILE),
      });

      console.log(`\n── ECO-006 ──\n${summarizeSupportVolume(facts)}\n`);
      for (const violation of violations) {
        console.error(`✗ ${violation.rule}: ${violation.detail}`);
      }
      expect(violations).toEqual([]);
    } finally {
      await container.close();
    }
  }, 120_000);
});
