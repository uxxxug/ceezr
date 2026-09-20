/**
 * الغرض: قياسُ **مواردِ رحلةٍ واحدةٍ** على السِلكِ — البندُ `ECO-004` (الزيادةُ
 *   الأولى، الشقُّ المملوكُ للمستودَعِ). لا يُقدَّرُ العددُ ولا يُستنبَطُ من قراءةِ
 *   شيفرةٍ: تُدارُ رحلةٌ كاملةٌ من الاقتباسِ إلى القراءاتِ المتكرَّرةِ عبرَ
 *   بوّابةٍ من `buildContainer` وقاعدةِ PostgreSQL حقيقيّةٍ وعميلِ `Redis`
 *   مُحقونٍ معدودٍ، وتُقاسُ خمسةُ أسطحِ مواردَ، ثمَّ يُحاكَمُ الناتجُ بحَكَمِ
 *   `scripts/lib/resource-usage-budget.ts`.
 *
 *   والأسطحُ الخمسةُ المقيسةُ:
 *     ١) القاعدةُ: `pg_stat_database` يُقرأُ قبلَ الرحلةِ وبعدَها — الصفوفُ
 *        الممسوحةُ (`tup_returned + tup_fetched`) والكُتَلُ الملموسةُ
 *        (`blks_read + blks_hit`). وحدّةُ القياسِ عينُها التي اختارها `DEC-18`.
 *     ٢) الطابورُ: `notification_outbox` و`order_offers` يُعَدَّانِ.
 *     ٣) Redis: عميلٌ مُحقونٌ يَعُدُّ كلَّ أمرٍ.
 *     ٤) النقلُ الشبكيُّ: بايتاتُ أجسامِ ردودِ `HTTP`.
 *     ٥) التخزينُ: صفوفٌ مُدخَلةٌ في جداولِ الرحلةِ الرئيسةِ.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقَّع أن يستخدمه لاحقاً: CI (وظيفةُ «تكامل على PostgreSQL حقيقي») ·
 *   `scripts/check-resource-usage-budget.ts`
 * يحرسُه: `scripts/check-resource-usage-budget.ts` في سلسلةِ `ci`
 * الحاكم: `docs/adr/0153-resource-quantities-per-ride-are-counted-not-estimated.md`
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ — ويُعلَنُ في الدليلِ ═══
 * ــ **لا تُقاسُ النسخُ (Replication)**: `WAL`/`LSN` غيرُ مستقرٍّ في CI.
 * ــ **لا تُحسَبُ تكلفةٌ بالمالِ**: السعرُ في فاتورةِ مزوّدِ سحابةٍ (`REQ-09`).
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
  databaseBlockBudget,
  databaseRowBudget,
  judgeResourceUsage,
  networkByteBudget,
  queueMessageBudget,
  type ResourceUsageFacts,
  RIDE_RESOURCE_PROFILE,
  redisCommandBudget,
  storageRowBudget,
  summarizeResourceUsage,
} from "../../scripts/lib/resource-usage-budget.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SESSION_SECRET = "resource-usage-budget-secret-اثنان-وثلاثون-حرفاً-على-الأقلِّ";
const WEBHOOK_SECRET = "resource-usage-webhook-secret";
const RIDER_TELEGRAM_ID = 480_001;
const DRIVER_TELEGRAM_ID = 480_002;
const PICKUP = { lat: 21.5471, lng: 39.1751 };
const DROPOFF = { lat: 21.5601, lng: 39.1901 };
const MOVE_STEP_DEGREES = 0.001;

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
 * عميلُ `Redis` يَعُدُّ أوامرَه. ولا يُرسلُ شيئاً إلى شبكةٍ: الاختبارُ في وظيفةِ
 * PostgreSQL الحقيقيِّ بلا خادمِ `Redis`، ووحدّةُ القياسِ عينُها التي قاسَ بها
 * `ECO-002` نداءاتِ التوجيه: العدُّ على ما يصلُ المُعتمَدَ لا على ما يخرجُ من
 * الشبكةِ. و`null` الصامتُ يعني أنَّ القياسَ لم يجرِ.
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
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكب قياس الموارد', '+966500000981')
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
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائق قياس الموارد', '+966500000982')
    returning id
  `;
  if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = driverUser.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'م و ر 4321')
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
 * قراءةٌ موثوقةٌ لعدّاداتِ `pg_stat_database` — تُخلي اللقطةَ الجلسيّةَ أوّلاً
 * (`pg_stat_clear_snapshot`) ثمّ تنتظرُ استقرارَ العدّاداتِ: خادمُ الإحصاءِ
 * الخلفيُّ في PostgreSQL يُفرِغُ إحصاءَه كلَّ ثانيةٍ تقريباً (`PGSTAT_MIN_INTERVAL`)،
 * فقراءتانِ متطابقتانِ خلالَ تلك الثانيةِ **سكونٌ كاذبٌ** لا سكونُ عملٍ. ولذلك
 * تُقرأُ ثلاثُ قراءاتٍ متتاليةٍ مستقرّةٍ قبلَ أن يُعتمَدَ الرقمُ.
 *
 * وهذا عينُ ما يفعلهُ `tests/support/engine-work.ts` لقياسِ `DEC-18` و`F9-06` —
 * فالقياسُ ههنا يستعملُ وحدّةَ القياسِ نفسَها ويجبُ أن يستعملَ آليّةَ الاستقرارِ
 * نفسَها، وإلّا كانَ الفرقُ بينَ قراءتينِ حاصلَ توقيتٍ لا حاصلَ عملٍ.
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

/**
 * قراءةٌ مستقرّةٌ — تنتظرُ أوّلاً مهلةً تتجاوزُ حدَّ الإفراغِ الأدنى، ثمَّ تُعيدُ القراءةَ
 * حتّى تتطابقَ ثلاثُ قراءاتٍ متتاليةٍ. هذا يضمنُ أنَّ ما أفرغَتْهُ الخوادمُ الخلفيّةُ
 * صارَ في العدّادِ — لا أنَّ العدّادَ ساكنٌ لأنَّه لم يُفرَغْ بعدُ.
 */
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
  // انتهى الوقتُ دونَ استقرارٍ تامٍّ — اقبل آخرَ قراءةٍ ولا تُسقِط القياسَ.
  if (last === null) throw new Error("pg_stat_database لم يستقرّ");
  return last;
}

/** عدُّ صفوفِ جدولٍ — يُرجِعُ صفراً لا `undefined`. */
async function countRows(table: string): Promise<number> {
  const rows = await sql<{ count: number }[]>`select count(*)::int as count from ${sql(table)}`;
  return rows[0]?.count ?? 0;
}

describeIf("ECO-004 — مواردُ الرحلةِ في النافذةِ، معدودةً على السِلكِ", () => {
  it("رحلةٌ واحدةٌ: قاعدةٌ وطابورٌ وRedis ونقلٌ وتخزينٌ تحتَ سقوفٍ مُشتَقَّةٍ", async () => {
    const driverSent: SentMessage[] = [];
    const riderSent: SentMessage[] = [];
    const countingRedis = createCountingRedis();

    const container = buildContainer(
      testConfig({
        port: 3993,
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

    try {
      // ═══ قراءةُ خطِّ الأساسِ قبلَ الرحلةِ ═══
      // `settlePgStat` لا `readPgStat`: عدّاداتُ `pg_stat_database` تُحدَّثُ غيرَ متزامنٍ،
      // فقراءةُ خطِّ الأساسِ دونَ استقرارٍ تُدخِلُ ضجيجَ توقيتٍ في الفرقِ.
      const pgBefore = await settlePgStat();
      const outboxBefore = await countRows("notification_outbox");
      const offersBefore = await countRows("order_offers");
      const ordersBefore = await countRows("orders");

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
      const quoteText = await quoted.text();
      if (quoted.status !== 200) throw new Error(`الاقتباسُ مرفوضٌ: ${quoteText}`);
      networkBytes += new TextEncoder().encode(quoteText).byteLength;

      // ═══ ٢) إنشاءُ الرحلةِ ═══
      const created = await app.fetch(
        new Request("http://localhost/v1/rides", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${riderToken}`,
            "Idempotency-Key": `resource-usage:${crypto.randomUUID()}`,
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
        const body = await response.text();
        networkBytes += new TextEncoder().encode(body).byteLength;
        if (response.status !== 200) {
          throw new Error(`نبضةٌ مرفوضةٌ (${response.status}): ${body}`);
        }
      }

      // ═══ ٤) قراءاتُ الراكبِ بمواضعَ متغيّرةٍ ═══
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
        const body = await read.text();
        networkBytes += new TextEncoder().encode(body).byteLength;
        if (read.status !== 200) {
          throw new Error(`قراءةٌ مرفوضةٌ (${read.status}): ${body}`);
        }
      }

      // ═══ قراءةُ القياسِ بعدَ الرحلةِ ═══
      // `settlePgStat` هنا أيضًا: الانتظارُ حتّى تُفرِغَ الخوادمُ الخلفيّةُ ما جمعَتْهُ
      // من استعلاماتِ الرحلةِ، فلا يُقاسَ الفرقُ قبلَ أن يصلَ العملُ الفعليُّ للعدّادِ.
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

      const facts: ResourceUsageFacts = {
        measured: true,
        databaseRowsTouched: Math.max(0, databaseRowsTouched),
        databaseBlocksTouched: Math.max(0, databaseBlocksTouched),
        queueMessagesEnqueued: Math.max(0, queueMessagesEnqueued),
        redisCommandsExecuted: countingRedis.commandCount,
        networkBytesTransferred: networkBytes,
        storageRowsInserted: Math.max(0, storageRowsInserted),
        windowMs: RIDE_RESOURCE_PROFILE.windowMs,
      };

      const violations = judgeResourceUsage({
        facts,
        profile: RIDE_RESOURCE_PROFILE,
        databaseRowsBudget: databaseRowBudget(),
        databaseBlocksBudget: databaseBlockBudget(),
        queueMessagesBudget: queueMessageBudget(),
        redisCommandsBudget: redisCommandBudget(),
        networkBytesBudget: networkByteBudget(),
        storageRowsBudget: storageRowBudget(),
      });

      console.log(`\n── ECO-004 ──\n${summarizeResourceUsage(facts)}\n`);
      for (const violation of violations) {
        console.error(`✗ ${violation.rule}: ${violation.detail}`);
      }
      expect(violations).toEqual([]);
    } finally {
      await container.close();
    }
  }, 120_000);
});
