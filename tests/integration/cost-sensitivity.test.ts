/**
 * الغرض: قياسُ **حسّاسيّةِ شكلِ التكلفةِ عندَ ١٠x من حجمِ الرحلاتِ** على السِلكِ —
 *   البندُ `ECO-008` (الشقُّ المملوكُ للمستودَعِ). لا يُقدَّرُ الشكلُ ولا يُستنبَطُ من
 *   قراءةِ شيفرةٍ: تُدارُ **عشرُ رحلاتٍ متتابعةٍ** — كلُّ واحدةٍ بالشكلِ المُعلَنِ
 *   نفسِهِ الذي قاسَهُ `ECO-004` (اقتباسٌ ← إنشاءٌ ← إسنادٌ ← ستّونَ نبضةً ← ثماني
 *   قراءاتٍ) — في حاويةٍ واحدةٍ وبوّابةٍ واحدةٍ على قاعدةِ PostgreSQL حقيقيّةٍ
 *   وعميلِ `Redis` مُحقونٍ معدودٍ، ثمَّ تُقاسُ الأسطحُ الخمسةُ **مجمعةً على النافذةِ
 *   كلِّها** ويُحاكَمُ الناتجُ بحَكَمِ `scripts/lib/cost-sensitivity.ts` بسقوفٍ حجميّةٍ
 *   مُشتقّةٍ من سقوفِ الرحلةِ الواحدةِ المستوردةِ من `ECO-004` عينِهِ.
 *
 *   والسؤالُ الذي يجيبُ عنهُ: هل تبقى مقاديرُ المواردِ لكلِّ رحلةٍ ثابتةً حينَ
 *   تتوالى الرحلاتُ (نموٌّ خطّيٌّ معَ الحجمِ)؟ أم يتضخَّمُ نصيبُ الرحلةِ معَ كلِّ
 *   رحلةٍ جديدةٍ (استعلامٌ يمسحُ جدولاً ينمو · حالةٌ تُجمَّعُ ولا تُفكُّ)؟
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقَّع أن يستخدمه لاحقاً: CI (وظيفةُ «تكامل على PostgreSQL حقيقي») ·
 *   `scripts/check-cost-sensitivity.ts`
 * يحرسُه: `scripts/check-cost-sensitivity.ts` في سلسلةِ `ci`
 * الحاكم: `docs/adr/0156-cost-shape-sensitivity-at-10x-volume-is-measured-not-assumed.md`
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ — ويُعلَنُ في الدليلِ ═══
 * ــ **لا يُدَّعى قياسُ حملٍ أو سعةٍ أو تزامنٍ**: الرحلاتُ العشرُ **متتابعةٌ** لا
 *   متزامنةٌ، ولا يُدَّعى إشباعُ `F9`/`F10`/`F11` ولا بوابةِ السعةِ — فذاكَ عملُ
 *   مختبرِ النشرِ المحجوزِ بنيويّاً (`DEC-17`). المقيسُ **شكلُ العددِ** لا قدرةُ النظامِ.
 * ــ **لا تُحسَبُ تكلفةٌ بالمالِ**: السعرُ في فاتورةِ مزوّدِ سحابةٍ (`REQ-09`).
 * ــ **لا تُقاسُ النسخُ (Replication)**: `WAL`/`LSN` غيرُ مستقرٍّ في CI.
 * ــ **لا يُقاسُ سلوكُ مستخدمينَ حقيقيّينَ**: شكلُ النافذةِ مُعلَنٌ (`ADR 0099`).
 * ــ **لا يُقاسُ `CDN` ولا `WAF` ولا `TLS`**: خارجُ نطاقِ الشيفرةِ.
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
import {
  type CostSensitivityFacts,
  judgeCostSensitivity,
  SENSITIVITY_VOLUME_MULTIPLIER,
  summarizeCostSensitivity,
  volumeBudgets,
} from "../../scripts/lib/cost-sensitivity.ts";
import { RIDE_RESOURCE_PROFILE } from "../../scripts/lib/resource-usage-budget.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SESSION_SECRET = "cost-sensitivity-secret-اثنان-وثلاثون-حرفاً-على-الأقلِّ";
const WEBHOOK_SECRET = "cost-sensitivity-webhook-secret";
const RIDER_TELEGRAM_ID = 480_011;
const DRIVER_TELEGRAM_ID = 480_012;
const PICKUP = { lat: 21.5471, lng: 39.1751 };
const DROPOFF = { lat: 21.5601, lng: 39.1901 };
const MOVE_STEP_DEGREES = 0.001;
const GATEWAY_PORT = 4010;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderUserId = "";
let riderId = "";
let driverUserId = "";
let driverId = "";

/**
 * عميلُ `Redis` يَعُدُّ أوامرَه — عينُ آليّةِ `ECO-004`: العدُّ على ما يصلُ
 * المُعتمَدَ لا على ما يخرجُ من الشبكةِ. و`null` الصامتُ يعني أنَّ القياسَ لم يجرِ.
 */
function createCountingRedis(): RedisClient & { commandCount: number } {
  let commandCount = 0;
  const counter: RedisClient & { commandCount: number } = {
    commandCount: 0,
    command: async (
      _args: readonly (string | number)[],
    ): Promise<Result<unknown, RedisFailure>> => {
      commandCount += 1;
      counter.commandCount = commandCount;
      return { ok: true, value: "OK" };
    },
  };
  return counter;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكب حساسية التكلفة', '+966500000991')
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
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائق حساسية التكلفة', '+966500000992')
    returning id
  `;
  if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = driverUser.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'م و ر 4322')
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

interface PgStatRow {
  readonly tup_returned: number;
  readonly tup_fetched: number;
  readonly blks_read: number;
  readonly blks_hit: number;
}

/**
 * قراءةٌ موثوقةٌ لعدّاداتِ `pg_stat_database` — عينُ آليّةِ `ECO-004`: تُخلي اللقطةَ
 * الجلسيّةَ أوّلاً ثمّ تنتظرُ استقرارَ العدّاداتِ بثلاثِ قراءاتٍ متتاليةٍ، لأنَّ
 * خادمَ الإحصاءِ الخلفيَّ يُفرِغُ إحصاءَه كلَّ ثانيةٍ تقريباً فقراءتانِ متطابقتانِ
 * خلالَها سكونٌ كاذبٌ لا سكونُ عملٍ. والقياسُ ههنا يستعملُ وحدّةَ القياسِ نفسَها
 * وآليّةَ الاستقرارِ نفسَها — وإلّا كانَ الفرقُ بينَ قراءتَينِ حاصلَ توقيتٍ لا
 * حاصلَ عملٍ.
 */
const PGSTAT_SETTLE_GRACE_MS = 2_500;
const PGSTAT_SETTLE_TIMEOUT_MS = 20_000;
const PGSTAT_SETTLE_INTERVAL_MS = 500;
const PGSTAT_SETTLE_STABLE_READS = 3;

async function readPgStat(): Promise<PgStatRow> {
  await sql`select pg_stat_clear_snapshot()`;
  const rows = await sql<PgStatRow[]>`
    select tup_returned, tup_fetched, blks_read, blks_hit
      from pg_stat_database
     where datname = current_database()
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("pg_stat_database لا يُرجِعُ صفّاً");
  return row;
}

async function settlePgStat(): Promise<PgStatRow> {
  await Bun.sleep(PGSTAT_SETTLE_GRACE_MS);
  const deadline = Date.now() + PGSTAT_SETTLE_TIMEOUT_MS;
  let last: PgStatRow | null = null;
  let stable = 0;
  while (Date.now() < deadline) {
    const current = await readPgStat();
    if (
      last !== null &&
      current.tup_returned === last.tup_returned &&
      current.tup_fetched === last.tup_fetched &&
      current.blks_read === last.blks_read &&
      current.blks_hit === last.blks_hit
    ) {
      stable += 1;
      if (stable >= PGSTAT_SETTLE_STABLE_READS) return current;
    } else {
      stable = 0;
    }
    last = current;
    await Bun.sleep(PGSTAT_SETTLE_INTERVAL_MS);
  }
  if (last === null) throw new Error("pg_stat_database لم يستقرّ");
  return last;
}

/** عدُّ صفوفِ جدولٍ — يُرجِعُ صفراً لا `undefined`. */
async function countRows(table: string): Promise<number> {
  const rows = await sql<{ count: number }[]>`select count(*)::int as count from ${sql(table)}`;
  return rows[0]?.count ?? 0;
}

describeIf("ECO-008 — حسّاسيّةُ شكلِ التكلفةِ عندَ ١٠x من حجمِ الرحلاتِ، مقيسةً على السِلكِ", () => {
  it("عشرُ رحلاتٍ متتابعةٍ في حاويةٍ واحدةٍ: الأسطحُ الخمسةُ تحتَ سقوفٍ حجميّةٍ مُشتقّةٍ من سقفِ الرحلةِ الواحدةِ", async () => {
    const driverSent: SentMessage[] = [];
    const riderSent: SentMessage[] = [];
    const countingRedis = createCountingRedis();

    const container = buildContainer(
      testConfig({
        port: GATEWAY_PORT,
        telegramWebhookSecret: WEBHOOK_SECRET,
      }),
      {
        driverSender: capturing(driverSent),
        riderSender: capturing(riderSent),
        redis: countingRedis,
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

    let networkBytes = 0;
    /** عددُ الرحلاتِ التي أتمَّت نافذتَها كاملةً — لا التي بدأت فحسبُ. */
    let completedRides = 0;

    try {
      // ═══ قراءةُ خطِّ الأساسِ قبلَ النافذةِ الحجميّةِ ═══
      const pgBefore = await settlePgStat();
      const outboxBefore = await countRows("notification_outbox");
      const offersBefore = await countRows("order_offers");
      const ordersBefore = await countRows("orders");

      // ═══ النافذةُ الحجميّةُ: عشرُ رحلاتٍ متتابعةٍ، كلُّ واحدةٍ بالشكلِ المُعلَنِ ═══
      // المتتابعةُ لا المتزامنةُ: حسّاسيّةُ الحجمِ سؤالُ «هل ينمو نصيبُ الرحلةِ معَ
      // عددِ الرحلاتِ؟» — أمّا التزامنُ فسؤالُ السعةِ المحجوزُ لمختبرِ النشرِ
      // (`DEC-17`)، ومن أجابهُ هنا بنداءاتٍ متوازيةٍ قاسَ عملَ مُشغِّلِ الاختبارِ
      // لا عملَ النظامِ.
      for (let ride = 0; ride < SENSITIVITY_VOLUME_MULTIPLIER; ride += 1) {
        // ١) الاقتباسُ
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
        if (quoted.status !== 200)
          throw new Error(`الاقتباسُ مرفوضٌ (رحلةٌ ${ride + 1}): ${quoteText}`);
        networkBytes += new TextEncoder().encode(quoteText).byteLength;

        // ٢) إنشاءُ الرحلةِ
        const created = await app.fetch(
          new Request("http://localhost/v1/rides", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${riderToken}`,
              "Idempotency-Key": `cost-sensitivity:${crypto.randomUUID()}`,
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
        networkBytes += new TextEncoder().encode(createdText).byteLength;
        const rideBody = JSON.parse(createdText) as { accepted?: boolean; orderId?: string };
        if (rideBody.accepted !== true) {
          throw new Error(`الإنشاءُ مرفوضٌ (رحلةٌ ${ride + 1}): ${createdText}`);
        }
        const orderId = rideBody.orderId ?? "";
        expect(orderId).not.toBe("");

        await sql`
            update orders set status = 'in_progress'::order_status, assigned_driver_id = ${driverId},
                              matched_at = now(), started_at = now()
             where id = ${orderId}
          `;

        // ٣) نبضاتُ موقعِ السائقِ — ستّونَ نبضةً بالشكلِ المُعلَنِ نفسِهِ
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
          const body = await response.text();
          networkBytes += new TextEncoder().encode(body).byteLength;
          if (response.status !== 200) {
            throw new Error(`نبضةٌ مرفوضةٌ (${response.status} · رحلةٌ ${ride + 1}): ${body}`);
          }
        }

        // ٤) قراءاتُ الراكبِ بمواضعَ متغيّرةٍ — ثماني قراءاتٍ بالشكلِ المُعلَنِ
        for (let index = 0; index < RIDE_RESOURCE_PROFILE.activeReadCount; index += 1) {
          await sql`
              update drivers set
                last_location = st_setsrid(st_makepoint(
                  ${PICKUP.lng + (index + 1) * MOVE_STEP_DEGREES},
                  ${PICKUP.lat + (ride + 1) * MOVE_STEP_DEGREES + (index + 1) * MOVE_STEP_DEGREES}
                ), 4326)::geography,
                last_location_at = now()
              where id = ${driverId}
            `;
          const read = await app.fetch(
            new Request(`http://localhost/v1/rides/${orderId}`, {
              headers: { authorization: `Bearer ${riderToken}` },
            }),
          );
          const body = await read.text();
          networkBytes += new TextEncoder().encode(body).byteLength;
          if (read.status !== 200) {
            throw new Error(`قراءةٌ مرفوضةٌ (${read.status} · رحلةٌ ${ride + 1}): ${body}`);
          }
        }

        // ٥) إقفالُ الرحلةِ كي تُفتَحَ التي تليها — ختمٌ على قاعدةِ الآلةِ نفسِها
        //    (مصدرُ السلطةِ واحدٌ)، لا مسارُ بوّابةٍ جديدٌ يُخرِجُ القياسَ عن
        //    شكلِ `ECO-004` المُعلَنِ.
        await sql`
            update orders set status = 'completed'::order_status, completed_at = now()
             where id = ${orderId} and status = 'in_progress'::order_status
          `;
        completedRides += 1;
      }

      // ═══ قراءةُ القياسِ بعدَ النافذةِ ═══
      // `countingRedis.commandCount` و`networkBytes` يُقرآنِ **قبلَ** `settlePgStat`
      // لا بعدها — عينُ ترتيبِ `ECO-004`: آليّةُ الاستقرارِ تنتظرُ ثوانيَ، فتُقرأُ
      // العدّاداتُ الفوريّةُ قبلَها والعدّاداتُ غيرُ المتزامنةُ بعدها.
      const redisCount = countingRedis.commandCount;
      const netBytes = networkBytes;

      const pgAfter = await settlePgStat();
      const outboxAfter = await countRows("notification_outbox");
      const offersAfter = await countRows("order_offers");
      const ordersAfter = await countRows("orders");

      const databaseRowsTouched =
        pgAfter.tup_returned - pgBefore.tup_returned + (pgAfter.tup_fetched - pgBefore.tup_fetched);
      const databaseBlocksTouched =
        pgAfter.blks_read - pgBefore.blks_read + (pgAfter.blks_hit - pgBefore.blks_hit);
      const queueMessagesEnqueued = outboxAfter - outboxBefore + (offersAfter - offersBefore);
      const storageRowsInserted = ordersAfter - ordersBefore;

      const facts: CostSensitivityFacts = {
        measured: true,
        rideCount: completedRides,
        databaseRowsTouched: Math.max(0, databaseRowsTouched),
        databaseBlocksTouched: Math.max(0, databaseBlocksTouched),
        queueMessagesEnqueued: Math.max(0, queueMessagesEnqueued),
        redisCommandsExecuted: redisCount,
        networkBytesTransferred: netBytes,
        storageRowsInserted: Math.max(0, storageRowsInserted),
        windowMs: RIDE_RESOURCE_PROFILE.windowMs * SENSITIVITY_VOLUME_MULTIPLIER,
      };

      // الحجمُ جزءٌ من القياسِ لا خلفيّتُهُ: توكيدٌ مباشرٌ أنّ النافذةَ حملتْ
      // عشرَ رحلاتٍ مكتملةً — وإلّا كانَ الحكمُ على غيرِ السؤالِ.
      expect(facts.rideCount).toBe(SENSITIVITY_VOLUME_MULTIPLIER);

      const violations = judgeCostSensitivity({
        facts,
        profile: RIDE_RESOURCE_PROFILE,
        multiplier: SENSITIVITY_VOLUME_MULTIPLIER,
        budgets: volumeBudgets(SENSITIVITY_VOLUME_MULTIPLIER, RIDE_RESOURCE_PROFILE),
      });

      console.log(`\n── ECO-008 ──\n${summarizeCostSensitivity(facts)}\n`);
      for (const violation of violations) {
        console.error(`✗ ${violation.rule}: ${violation.detail}`);
      }
      expect(violations).toEqual([]);
    } finally {
      await container.close();
    }
  }, 240_000);
});
