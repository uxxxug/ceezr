/**
 * الغرض: اختبارُ تكاملٍ يُثبتُ أنَّ عطلَ Bot API لتيليجرام لا يُسقِطُ مساراتِ Mini App
 *   بعدَ المصادقةِ (`F11-05` — الشقُّ المملوكُ للمستودَعِ). العطلُ مُحقَنٌ على السِلكِ
 *   عبرَ `fetchImpl` ترفُضُ فورًا، فيمرُّ عبرَ grammY ← الحاجز ← القاطع.
 * الحالة: منفّذ فعلياً — `ح-7`.
 * ينتمي إلى: tests/integration
 * الحاكم: docs/adr/0198-telegram-bot-api-outage-does-not-block-miniapp.md
 *
 * ## الفرضيّةُ المُختبَرةُ
 *
 * «جلسةُ Waslah الداخليّةُ القائمةُ تستمرُّ، ومساراتُ Mini App بعدَ المصادقةِ لا تنتظرُ
 * Bot API، وفشلُ الإشعارِ معزولٌ ومرئيٌّ.» لا يحلُّ `TG-004`/`ARCH-014` — تلك تتطلّبُ
 * مصادقةً بديلةً ونشراً حيًّا.
 *
 * ## الحقنُ على السِلكِ
 *
 * المُرسِلُ الفاشلُ يُنشَأُ عبرَ `createTelegramApi(token, { fetchImpl: deadFetch })`
 * ثمَّ يُغلَّفُ بـ`withOutboundResilience` بذاكرةٍ محلّيّةٍ وتراجعٍ سريعٍ. والعطلُ يمرُّ
 * عبرَ المسارِ كاملِه: grammY ← `createGuardedFetch` ← `deadFetch` ← رفضٌ فوريٌّ ←
 * القاطعُ يسجِّلُ الإخفاقَ ← بعدَ عشرةِ إخفاقاتٍ يُفتَحُ القاطعُ.
 *
 * ## ما لا يُختبَرُ هنا
 *
 * ــ **لا يُحلَّ `TG-004`/`ARCH-014`**: عزلُ عطلِ Bot API عن مساراتِ Mini App فقط.
 * ــ **لا تُنتَجُ الإشعاراتُ عبرَ `outbox`**: المُرسِلُ يُستدعى مباشرةً على السِلكِ.
 * ــ **لا تُقاسُ الإنتاجيّةُ**: رحلةٌ واحدةٌ تحتَ عطلٍ محقونٍ، لا حملٌ ولا نشرٌ حيٌّ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { buildContainer, type Container } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { createViewerAccountReader } from "../../packages/infrastructure/identity/viewer-account.ts";
import { createOutboundResilience } from "../../packages/infrastructure/notification/outbound-resilience.ts";
import { withOutboundResilience } from "../../packages/infrastructure/notification/rate-aware-telegram-sender.ts";
import type { TelegramSender } from "../../packages/infrastructure/notification/telegram-api-sender.ts";
import {
  createTelegramApi,
  resetTelegramGuardForTests,
  telegramGuard,
} from "../../packages/infrastructure/notification/telegram-client.ts";
import { createTriggerSosPort } from "../../packages/infrastructure/safety/safety-adapters.ts";
import { createSosSurfaceReader } from "../../packages/infrastructure/safety/sos-surface-store.ts";
import { createActiveRideReader } from "../../packages/infrastructure/transport/active-ride-store.ts";
import { createRideHistoryReader } from "../../packages/infrastructure/transport/ride-history-store.ts";
import {
  createRideRequestCommand,
  createRideSearchReader,
} from "../../packages/infrastructure/transport/ride-request-store.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import {
  type CommercialSnapshot,
  judgeTelegramOutage,
  type MiniAppCallFacts,
  type TelegramOutageFacts,
  type TelegramSenderState,
} from "../../scripts/lib/telegram-outage.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

const PICKUP = { lat: 21.5471, lng: 39.1751 };
const DROPOFF = { lat: 21.5526, lng: 39.1853 };

const RIDER_TELEGRAM_ID = 89_050_011;
const DRIVER_TELEGRAM_ID = 89_050_012;
const SESSION_SECRET = "test-session-secret-0123456789abcdef0123456789abcdef";
const BOT_TOKEN = "0000000000:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const WEBHOOK_SECRET = "test-webhook-secret";

let sql: Sql;
let orderId = "";

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await sql.end();
});

/** `fetch` ميتةٌ ترفُضُ فورًا بعطلِ اتصالٍ — هذا هو حقنُ العطلِ على السِلكِ. */
const deadFetch = (() =>
  Promise.reject(new TypeError("fetch failed: Connection refused"))) as unknown as typeof fetch;

/** يُنشِئُ مُرسِلًا فاشلًا يمرُّ عبرَ المسارِ كاملِه: grammY ← الحاجز ← `deadFetch`. */
function failingTelegramSender(): TelegramSender {
  const api = createTelegramApi(BOT_TOKEN, { fetchImpl: deadFetch });
  return {
    sendMessage: async (chatId, text, markup) => {
      const sent = await api.sendMessage(
        chatId,
        text,
        markup === undefined ? {} : { reply_markup: markup as never },
      );
      return String(sent.message_id);
    },
    sendPhoto: async (chatId, fileId, caption, markup) => {
      const sent = await api.sendPhoto(chatId, fileId, {
        caption,
        ...(markup === undefined ? {} : { reply_markup: markup as never }),
      });
      return String(sent.message_id);
    },
    sendLocation: async (chatId, latitude, longitude) => {
      const sent = await api.sendLocation(chatId, latitude, longitude);
      return String(sent.message_id);
    },
  };
}

type App = ReturnType<typeof createServer>;

interface Harness {
  readonly app: App;
  readonly container: Container;
  readonly close: () => void;
  readonly failingSender: TelegramSender;
}

function tokenFor(telegramUserId: number, bot: "rider" | "driver"): string {
  const issued = createMiniAppSessionIssuer({ secret: SESSION_SECRET }).issue(
    { telegramUserId: String(telegramUserId), bot, authDateSeconds: Math.floor(Date.now() / 1000) },
    Date.now(),
  );
  if (!issued.ok) throw new Error("إصدارُ الجلسةِ فاشلٌ");
  return issued.value.accessToken;
}

function harness(config: AppConfig): Harness {
  resetTelegramGuardForTests();

  const resilience = createOutboundResilience({ redis: null });
  const failingBase = failingTelegramSender();
  const failingSender = withOutboundResilience(failingBase, {
    ...resilience.options,
    baseBackoffMs: 1,
    maxBackoffMs: 10,
    callTimeoutMs: 2_000,
    criticalMaxAttempts: 12,
    informationalMaxAttempts: 12,
  });

  const container = buildContainer(config, {
    driverSender: failingSender,
    riderSender: failingSender,
  });

  const sessions = createMiniAppSessionReader(SESSION_SECRET);
  const viewerAccounts = createViewerAccountReader(sql);
  const now = (): Date => new Date();

  const app = createServer({
    health: { now, startedAt: now(), env: process.env },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    me: {
      viewer: { sessions, accounts: viewerAccounts, now },
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
      history: {
        sessions,
        history: createRideHistoryReader(sql),
        now,
      },
    },
    safety: {
      surface: {
        sessions,
        surface: createSosSurfaceReader(sql),
        role: "rider" as const,
        now,
      },
      trigger: {
        sessions,
        incidents: createTriggerSosPort(sql),
        role: "rider" as const,
        now,
      },
    },
  });

  return {
    app,
    container,
    failingSender,
    close: () => container.close(),
  };
}

async function ensureRide(h: Harness, riderToken: string): Promise<void> {
  if (orderId !== "") return;
  const created = await h.app.fetch(
    new Request("http://localhost/v1/rides", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${riderToken}`,
        "Idempotency-Key": `tg-outage:${crypto.randomUUID()}`,
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
}

async function callMiniApp(
  app: App,
  token: string,
  endpoint: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<MiniAppCallFacts> {
  const response = await app.fetch(
    new Request(`http://localhost${endpoint}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  return {
    endpoint: `${method} ${endpoint}`,
    httpStatus: response.status,
    sessionValid: response.status === 200,
  };
}

async function readCommercialSnapshot(
  riderUserId: string,
  riderToken: string,
  app: App,
): Promise<CommercialSnapshot> {
  const [ordersRow] = await sql<{ count: number }[]>`
    select count(*)::int as count from orders where rider_id = ${riderUserId}
  `;
  const active = await app.fetch(
    new Request(`http://localhost/v1/rides/${orderId}`, {
      headers: { authorization: `Bearer ${riderToken}` },
    }),
  );
  const activeBody = JSON.parse(await active.text()) as { active?: boolean };
  const [offersRow] = await sql<{ count: number }[]>`
    select count(*)::int as count from order_offers where order_id = ${orderId}
  `;
  return {
    ordersCount: ordersRow?.count ?? 0,
    activeRideExists: activeBody.active === true,
    pendingOffersCount: offersRow?.count ?? 0,
  };
}

async function triggerSenderFailure(sender: TelegramSender): Promise<TelegramSenderState> {
  let failedAttempts = 0;
  let guardRejected = false;
  let failureReason: string | null = null;

  for (let i = 0; i < 3; i++) {
    try {
      await sender.sendMessage("123456789", "test notification during outage", undefined, {
        priority: "critical",
      });
    } catch (error) {
      failedAttempts += 1;
      if (error instanceof Error && error.name === "TelegramGuardRejection") {
        guardRejected = true;
      }
      if (failureReason === null) {
        failureReason = error instanceof Error ? error.message : String(error);
      }
    }
  }

  const snapshot = telegramGuard().snapshot();
  return {
    breakerState: snapshot.breaker.state,
    failedAttempts,
    guardRejected,
    failureReason,
  };
}

function report(violations: readonly { rule: string; detail: string }[]): void {
  for (const violation of violations) {
    console.error(`✗ [${violation.rule}] ${violation.detail}`);
  }
}

describeIf("F11-05 — عطلُ Bot API لتيليجرام لا يُسقِطُ مساراتِ Mini App", () => {
  let cityHandle: ActiveCityHandle | undefined;
  let cityId: string;
  let riderUserId: string;
  let driverUserId: string;
  let driverId: string;

  beforeAll(async () => {
    if (DATABASE_URL === undefined) return;
    cityHandle = await ensureActiveCity(sql);
    cityId = cityHandle.cityId;

    // تنظيفُ بقايا التشغيلِ السابقِ قبلَ البذرِ.
    await sql`delete from driver_availability where driver_id in (select id from drivers where user_id in (select id from users where telegram_id in (${RIDER_TELEGRAM_ID}, ${DRIVER_TELEGRAM_ID})))`;
    await sql`delete from driver_capabilities where driver_id in (select id from drivers where user_id in (select id from users where telegram_id in (${RIDER_TELEGRAM_ID}, ${DRIVER_TELEGRAM_ID})))`;
    await sql`delete from subscriptions where driver_id in (select id from drivers where user_id in (select id from users where telegram_id in (${RIDER_TELEGRAM_ID}, ${DRIVER_TELEGRAM_ID})))`;
    await sql`delete from drivers where user_id in (select id from users where telegram_id in (${RIDER_TELEGRAM_ID}, ${DRIVER_TELEGRAM_ID}))`;
    await sql`delete from riders where user_id in (select id from users where telegram_id in (${RIDER_TELEGRAM_ID}, ${DRIVER_TELEGRAM_ID}))`;
    await sql`delete from users where telegram_id in (${RIDER_TELEGRAM_ID}, ${DRIVER_TELEGRAM_ID})`;

    // كلُّ البذرِ في معاملةٍ واحدةٍ: قاعدةٌ بعيدةٌ والوقتُ ثمينٌ.
    const seeded = await sql.begin(async (tx) => {
      const [riderUser] = await tx<{ id: string }[]>`
        insert into users (city_id, telegram_id, role, full_name, phone)
        values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكب عطل تيليجرام', '+966500000983')
        returning id
      `;
      if (riderUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ الراكبِ");
      riderUserId = riderUser.id;
      await tx`
        insert into riders (city_id, user_id) values (${cityId}, ${riderUserId})
      `;

      const [driverUser] = await tx<{ id: string }[]>`
        insert into users (city_id, telegram_id, role, full_name, phone)
        values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائق عطل تيليجرام', '+966500000984')
        returning id
      `;
      if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
      driverUserId = driverUser.id;
      const [driver] = await tx<{ id: string }[]>`
        insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
        values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ر ن ب 4322')
        returning id
      `;
      if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
      driverId = driver.id;

      await tx`
        insert into subscriptions (city_id, driver_id, plan, status)
        values (${cityId}, ${driverId}, 'both'::subscription_plan, 'active'::subscription_status)
      `;
      await tx`
        insert into driver_capabilities (city_id, driver_id, service, is_enabled)
        values (${cityId}, ${driverId}, 'transport'::service_type, true)
      `;
      await tx`
        insert into driver_availability (city_id, driver_id, is_available)
        values (${cityId}, ${driverId}, true)
      `;
      return { riderUserId, driverUserId, driverId };
    });
    riderUserId = seeded.riderUserId;
    driverUserId = seeded.driverUserId;
    driverId = seeded.driverId;
  });

  afterAll(async () => {
    if (DATABASE_URL === undefined) return;
    if (orderId !== "") {
      await sql`delete from order_offers where order_id = ${orderId}`;
      await sql`delete from orders where id = ${orderId}`;
      orderId = "";
    }
    if (driverId !== undefined) {
      await sql`delete from driver_availability where driver_id = ${driverId}`;
      await sql`delete from driver_capabilities where driver_id = ${driverId}`;
      await sql`delete from subscriptions where driver_id = ${driverId}`;
      await sql`delete from drivers where id = ${driverId}`;
    }
    if (riderUserId !== undefined) {
      await sql`delete from riders where user_id = ${riderUserId}`;
    }
    if (driverUserId !== undefined) {
      await sql`delete from users where id in (${riderUserId}, ${driverUserId})`;
    }
    await restoreCityBaseline(sql, cityHandle);
  });

  it("مساراتُ Mini App كلُّها تُجيبُ 200 أثناءَ العطلِ، والقاطعُ مفتوحٌ، والحالةُ سليمةٌ", async () => {
    const config = testConfig({
      port: 3995,
      miniappSessionSecret: SESSION_SECRET,
      driverBotToken: BOT_TOKEN,
      riderBotToken: BOT_TOKEN,
      telegramWebhookSecret: WEBHOOK_SECRET,
      routingProvider: "none",
    });

    const h = harness(config);
    try {
      const riderToken = tokenFor(RIDER_TELEGRAM_ID, "rider");
      await ensureRide(h, riderToken);

      // الخطُّ الأساسُ: مساراتُ Mini App كلُّها ناجحةٌ قبلَ العطلِ.
      const baseline: MiniAppCallFacts[] = [
        await callMiniApp(h.app, riderToken, "/v1/me"),
        await callMiniApp(h.app, riderToken, `/v1/rides/${orderId}`),
        await callMiniApp(h.app, riderToken, "/v1/rides"),
      ];

      // الحالةُ التجاريّةُ قبلَ العطلِ.
      const commercialBefore = await readCommercialSnapshot(riderUserId, riderToken, h.app);

      // العطلُ مُحقَنٌ على السِلكِ: المُرسِلُ يرفُضُ فورًا.
      // مساراتُ Mini App لا تستخدمُ المُرسِلَ — تُجيبُ 200.
      const duringOutage: MiniAppCallFacts[] = [
        await callMiniApp(h.app, riderToken, "/v1/me"),
        await callMiniApp(h.app, riderToken, `/v1/rides/${orderId}`),
        await callMiniApp(h.app, riderToken, "/v1/rides"),
      ];

      // محاولةُ الإشعارِ: المُرسِلُ يفشلُ، والقاطعُ يُفتَحُ.
      const senderState = await triggerSenderFailure(h.failingSender);

      // الحالةُ التجاريّةُ بعدَ العطلِ.
      const commercialAfter = await readCommercialSnapshot(riderUserId, riderToken, h.app);

      const facts: TelegramOutageFacts = {
        baseline,
        duringOutage,
        senderState,
        commercialBefore,
        commercialAfter,
      };

      const violations = judgeTelegramOutage(facts);
      report(violations);
      expect(violations).toEqual([]);
    } finally {
      h.close();
    }
  });
});
