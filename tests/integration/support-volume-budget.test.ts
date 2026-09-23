/**
 * الغرض: قياسُ **تذاكرِ الدعمِ لكلِّ رحلةٍ** على السِلكِ — البندُ `ECO-006`
 *   (الشقُّ المملوكُ للمستودَعِ). لا يُقدَّرُ العددُ ولا يُستنبَطُ من قراءةِ
 *   شيفرةٍ: تُدارُ رحلةٌ كاملةٌ من الاقتباسِ إلى القراءاتِ المتكرَّرةِ عبرَ
 *   بوّابةٍ من `buildContainer` وقاعدةِ PostgreSQL حقيقيّةٍ، وتُعدُّ تذاكرُ
 *   الدعمِ المُنشَأةُ في دورةِ الحياةِ، ثمَّ يُحاكَمُ الناتجُ بحَكَمِ
 *   `scripts/lib/support-volume-budget.ts`.
 *
 *   والمقيسُ: تذاكرُ الدعمِ في جدولِ `support_tickets` — عدّاً لا تقديراً.
 *   ودورةُ الحياةِ نفسُها لا تُنشِئُ تذاكرَ دعمٍ: التذاكرُ فعلُ مستخدمٍ.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقَّع أن يستخدمه لاحقاً: CI (وظيفةُ «تكامل على PostgreSQL حقيقي») ·
 *   `scripts/check-support-volume-budget.ts`
 * يحرسُه: `scripts/check-support-volume-budget.ts` في سلسلةِ `ci`
 * الحاكم: `docs/adr/0179-support-tickets-per-ride-are-counted-not-estimated.md`
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ — ويُعلَنُ في الدليلِ ═══
 * ــ **لا تُحسَبُ تكلفةٌ بالمالِ**: السعرُ بيدِ المالكِ (`REQ-09`).
 * ــ **لا يُقاسُ سلوكُ مستخدمينَ حقيقيّينَ**: شكلُ النافذةِ مُعلَنٌ (`ADR 0099`).
 * ــ **لا يُقاسُ معدَّلُ التذاكرِ في الإنتاجِ**: ذاكَ قراءةٌ ميدانيّةٌ.
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
import type { RedisClient, RedisFailure } from "../../packages/infrastructure/redis/upstash.ts";
import { createActiveRideReader } from "../../packages/infrastructure/transport/active-ride-store.ts";
import {
  createRideRequestCommand,
  createRideSearchReader,
} from "../../packages/infrastructure/transport/ride-request-store.ts";
import type { Result } from "../../packages/shared/result/index.ts";
import { SUPPORT_TICKET_TYPES } from "../../packages/domain/support/ticket-types.ts";
import { RIDE_RESOURCE_PROFILE } from "../../scripts/lib/resource-usage-budget.ts";
import {
  judgeSupportVolume,
  type SupportVolumeFacts,
  supportTicketBudget,
  summarizeSupportVolume,
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
  console.warn(
    "ECO-006: TEST_DATABASE_URL غير مضبوطٍ — اختبارُ تكاملِ عدِّ تذاكرِ الدعمِ لن يُشغَّلَ ههنا.",
  );
}

function tokenFor(telegramId: string, kind: "rider" | "driver"): string {
  const issuer = createMiniAppSessionIssuer(SESSION_SECRET);
  const result = issuer.issue({ telegramId, kind, displayName: `ECO-006 ${kind} ${telegramId}` });
  if (!result.ok) throw new Error(`فشلَ إصدارُ جلسةٍ: ${result.error}`);
  return result.token;
}

const noOpRedis: RedisClient = {
  async send(_command: string[]): Promise<Result<unknown, RedisFailure>> {
    return { ok: false, error: { kind: "unavailable", reason: "no-op" } };
  },
  async sendMany(_commands: string[][]): Promise<Result<unknown[], RedisFailure>> {
    return { ok: false, error: { kind: "unavailable", reason: "no-op" } };
  },
  async ping(): Promise<Result<boolean, RedisFailure>> {
    return { ok: false, error: { kind: "unavailable", reason: "no-op" } };
  },
  async close(): Promise<void> {
    /* no-op */
  },
};

let sql: Sql;
let cityHandle: ActiveCityHandle;
let riderId = "";
let driverId = "";

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL, max: 4 });
  cityHandle = await ensureActiveCity(sql);
  await sql`
    insert into riders (telegram_id, first_name, last_name, phone_number)
    values (${RIDER_TELEGRAM_ID}, 'ECO-006', 'Rider', '+966500000016')
    on conflict (telegram_id) do update set first_name = excluded.first_name
    returning id
  `.then(([row]) => {
    riderId = String((row as { id: string }).id);
  });
  await sql`
    insert into drivers (telegram_id, first_name, last_name, phone_number, vehicle_plate, vehicle_kind, status)
    values (${DRIVER_TELEGRAM_ID}, 'ECO-006', 'Driver', '+966500000017', 'ECO-006', 'sedan', 'approved')
    on conflict (telegram_id) do update set first_name = excluded.first_name, status = 'approved'
    returning id
  `.then(([row]) => {
    driverId = String((row as { id: string }).id);
  });
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (riderId !== "") {
    await sql`delete from support_tickets where rider_id = ${riderId}`;
    await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId})`;
    await sql`delete from orders where rider_id = ${riderId}`;
    await sql`delete from riders where id = ${riderId}`;
  }
  if (driverId !== "") {
    await sql`delete from driver_location_history where driver_id = ${driverId}`;
    await sql`delete from drivers where id = ${driverId}`;
  }
  if (cityHandle) await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

/** عدُّ صفوفِ جدولٍ — يُرجِعُ صفراً لا `undefined`. */
async function countRows(table: string): Promise<number> {
  const rows = await sql<{ count: number }[]>`select count(*)::int as count from ${sql(table)}`;
  return rows[0]?.count ?? 0;
}

describeIf("ECO-006 — تذاكرُ الدعمِ لكلِّ رحلةٍ، معدودةً على السِلكِ", () => {
  it("رحلةٌ واحدةٌ: دورةُ الحياةِ لا تُنشِئُ تذاكرَ دعمٍ ضمنَ السقفِ المُشتَقِّ", async () => {
    const driverSent: SentMessage[] = [];
    const riderSent: SentMessage[] = [];
    const { bot: driverBot } = capturing(driverSent);
    const { bot: riderBot } = capturing(riderSent);
    const container = buildContainer({
      config: testConfig,
      sql,
      redis: noOpRedis,
      driverBot,
      riderBot,
    });

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
      const ticketsBefore = await countRows("support_tickets");

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

      await sql`
        update orders set status = 'in_progress'::order_status, assigned_driver_id = ${driverId},
                          matched_at = now(), started_at = now()
         where id = ${orderId}
      `;

      // ═══ ٣) نبضاتُ موقعِ السائقِ ═══
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

      // ═══ ٤) قراءاتُ الراكبِ ═══
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

      // ═══ قراءةُ القياسِ بعدَ الرحلةِ ═══
      const ticketsAfter = await countRows("support_tickets");
      const supportTicketsCreated = Math.max(0, ticketsAfter - ticketsBefore);

      // الأصنافُ من المصدرِ الواحدِ — لا تُنسَخُ ولا تُعادُ تعريفُها.
      expect(SUPPORT_TICKET_TYPES.length).toBeGreaterThan(0);

      const facts: SupportVolumeFacts = {
        measured: true,
        supportTicketsCreated,
        lifecycleTransitions: RIDE_RESOURCE_PROFILE.lifecycleTransitionCount,
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
