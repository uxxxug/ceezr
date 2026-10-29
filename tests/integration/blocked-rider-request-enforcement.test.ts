/**
 * الغرض: اختبارُ تراجعيٍّ لأمنِ الحسابِ (`SEC-22`) عبرَ **المسارِ المكوَّنِ الفعلي**
 *   (جلسةٌ موقَّعةٌ ← مسارُ HTTP ← دالّةُ القاعدة) لا نداءٌ مباشرٌ للدوالّ: حجبُ
 *   المستخدمِ (`users.is_blocked`) يمنعُ **إنشاءَ طلبِ رحلةٍ جديدٍ**. يُقاسُ الردُّ
 *   **وأثرُ القاعدةِ معًا** (هل أُنشئَ صفٌّ فعلًا) — لأنَّ الردَّ وحدَهُ قد يكذبُ.
 *   ويُغطّي المسارَانِ: تطبيقُ `POST /v1/rides` ومسارُ البوتِ (الدالّةُ الأمُّ
 *   `request_ride` نفسُها).
 * المرجع: `supabase/migrations/20261029090000_sec_22_blocked_rider_cannot_request_ride.sql`
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createServer } from "../../apps/gateway/src/server.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createMemorySessionRevocationStore } from "../../packages/infrastructure/identity/memory-session-revocation-store.ts";
import { createMiniAppRefreshTokens } from "../../packages/infrastructure/identity/miniapp-refresh.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { createRevocableSessionReader } from "../../packages/infrastructure/identity/revocable-session-reader.ts";
import { createTelegramInitDataVerifier } from "../../packages/infrastructure/identity/telegram-init-data.ts";
import { createRideRequestCommand } from "../../packages/infrastructure/transport/ride-request-store.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { buildInitData, FAKE_RIDER_BOT_TOKEN } from "../support/telegram-init-data.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️ عيّن TEST_DATABASE_URL");
}

const SESSION_SECRET = "blocked-rider-enforcement-secret-بادئةٌ-طويلةٌ-كفايةً";
const WEBHOOK_SECRET = "blocked-rider-enforcement-webhook-secret";

const RIDER_TELEGRAM_ID = 910_000_771;
const ADMIN_TELEGRAM_ID = 910_000_772;
const DRIVER_TELEGRAM_ID = 910_000_773;

const PICKUP = { lat: 21.5433, lng: 39.1728 };
const DROPOFF = { lat: 21.5551, lng: 39.1902 };

let sql: Sql;
let app: ReturnType<typeof createServer>;
let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let riderUserId = "";
let adminUserId = "";
let driverUserId = "";
let riderId = "";
let accessToken = "";

async function call(
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
  return { status: response.status, text: await response.text() };
}

function postRide(key: string) {
  return call("/v1/rides", {
    method: "POST",
    body: JSON.stringify({
      service: "transport",
      originLat: PICKUP.lat,
      originLng: PICKUP.lng,
      destinationLat: DROPOFF.lat,
      destinationLng: DROPOFF.lng,
      notes: "فحصُ الحجبِ",
    }),
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": key,
    },
  });
}

async function countRiderOrders(): Promise<number> {
  const rows = await sql<{ n: string }[]>`
    select count(*)::text as n from orders
    where rider_id in (select id from riders where user_id = ${riderUserId}::uuid)`;
  return Number(rows[0]?.n);
}

async function setUserBlocked(blocked: boolean): Promise<void> {
  const rows = await sql<{ result: unknown }[]>`
    select admin_set_user_blocked(
      ${adminUserId}::uuid, ${riderUserId}::uuid, ${blocked}) as result`;
  const row = rows[0]?.result as { ok: boolean } | undefined;
  expect(row?.ok).toBe(true);
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  const city = await ensureActiveCity(sql);
  cityId = city.cityId;
  cityHandle = city;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (telegram_id, language_code, role, city_id)
    values (${RIDER_TELEGRAM_ID}::bigint, 'ar', 'rider', ${cityId}::uuid)
    returning id`;
  if (riderUser === undefined) throw new Error("لم يُنشَأ راكبُ الاختبار");
  riderUserId = riderUser.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (user_id, city_id)
    values (${riderUserId}::uuid, ${cityId}::uuid)
    returning id`;
  if (rider === undefined) throw new Error("لم يُنشَأ صفُّ الراكب");
  riderId = rider.id;

  const [adminUser] = await sql<{ id: string }[]>`
    insert into users (telegram_id, language_code, role, city_id)
    values (${ADMIN_TELEGRAM_ID}::bigint, 'ar', 'admin', ${cityId}::uuid)
    returning id`;
  if (adminUser === undefined) throw new Error("لم يُنشَأ مشرفُ الحجب");
  adminUserId = adminUser.id;

  const [driverUser] = await sql<{ id: string }[]>`
    insert into users (telegram_id, language_code, role, city_id)
    values (${DRIVER_TELEGRAM_ID}::bigint, 'ar', 'driver', ${cityId}::uuid)
    returning id`;
  if (driverUser === undefined) throw new Error("لم يُنشَأ سائقُ الاختبار");
  driverUserId = driverUser.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status)
    values (${cityId}::uuid, ${driverUserId}::uuid, 'verified'::verification_status)
    returning id`;
  if (driver === undefined) throw new Error("لم يُنشَأ صفُّ السائق");
  await sql`
    insert into driver_capabilities (city_id, driver_id, service, is_enabled)
    values (${cityId}::uuid, ${driver.id}::uuid, 'transport'::service_type, true)`;
  await sql`
    insert into subscriptions (city_id, driver_id, plan, status, current_period_end)
    values (${cityId}::uuid, ${driver.id}::uuid, 'both'::subscription_plan,
            'active'::subscription_status, now() + interval '30 days')`;

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
    rides: {
      request: {
        sessions: createRevocableSessionReader(sessions, createMemorySessionRevocationStore()),
        rides: createRideRequestCommand(sql),
        now,
      },
    },
  });
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  // التنظيفُ يبدأُ بمن يُشيرُ إلى الباقين (audit_log) وإلا ماتَ الوجهُ بالقيدِ الأجنبيّ.
  for (const id of [riderUserId, adminUserId, driverUserId]) {
    if (id !== "") await sql`delete from audit_log where actor_user_id = ${id}::uuid`;
  }
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
  for (const id of [riderUserId, adminUserId, driverUserId]) {
    if (id !== "") await sql`delete from users where id = ${id}::uuid`;
  }
  if (cityHandle) await restoreCityBaseline(sql, cityHandle);
  await sql.end({ timeout: 5 });
});

describeIf("SEC-22: المحجوبُ لا يطلبُ — عبرَ المسارِ المكوَّنِ", () => {
  it("١) ضابطٌ إيجابيٌّ: جلسةٌ موقَّعةٌ ثمَّ إنشاءٌ ناجحٌ قبلَ الحجب", async () => {
    const initData = buildInitData({
      botToken: FAKE_RIDER_BOT_TOKEN,
      authDateSeconds: Math.floor(Date.now() / 1000),
      user: { id: RIDER_TELEGRAM_ID, first_name: "راكب", language_code: "ar" },
    });
    const session = await call("/v1/session/telegram", {
      method: "POST",
      body: JSON.stringify({ initData }),
      headers: { "content-type": "application/json" },
    });
    expect(session.status).toBe(201);
    const issued = JSON.parse(session.text) as { accessToken?: string };
    accessToken = issued.accessToken ?? "";
    expect(accessToken).not.toBe("");

    const created = await postRide(`blocked-rider-before:${crypto.randomUUID()}`);
    expect(created.status).toBe(200);
    const body = JSON.parse(created.text) as { accepted?: boolean };
    if (body.accepted !== true) throw new Error(`الإنشاءُ مرفوضٌ قبلَ الحجب: ${created.text}`);
    expect(await countRiderOrders()).toBe(1);
  });

  it("٢) المحجوبُ يُرفَضُ بـ403 ورمزِ ACCOUNT_BLOCKED ولا يُنشَأُ صفٌّ", async () => {
    await setUserBlocked(true);
    const row = await sql<{ is_blocked: boolean }[]>`
      select is_blocked from users where id = ${riderUserId}::uuid`;
    expect(row[0]?.is_blocked).toBe(true);

    // إنهاءُ الرحلةِ القائمةِ أولًا حتى لا يحجبَ ACTIVE_RIDE_EXISTS القياسَ.
    await sql`
      update orders set status = 'cancelled'::order_status
      where rider_id = ${riderId}::uuid and status = 'searching'::order_status`;

    const before = await countRiderOrders();
    const attempt = await postRide(`blocked-rider-after:${crypto.randomUUID()}`);
    const after = await countRiderOrders();

    // الردُّ: رفضٌ بصفةِ الحسابِ لا بعطبِ الخدمةِ ولا برفضِ منتجٍ.
    expect(attempt.status).toBe(403);
    const body = JSON.parse(attempt.text) as { ok?: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("ACCOUNT_BLOCKED");
    // الأثرُ: لا صفَّ طلبٍ جديدًا — الرفضُ بلا كتابةٍ.
    expect(after).toBe(before);
  });

  it("٣) عقدُ الإعادةِ باقٍٍ للموقوفِ: جوابُ الأمرِ المنفَّذِ بلا أثرٍ جديد", async () => {
    // SEC-22: الحارسُ بعدَ فحصِ الإعادةِ عمدًا — عقدُ «من أعادَ أمرَه يستحقُّ
    // جوابَهُ الأوّلَ» لا يُنقضُ بالحجبِ: إعادةُ أمرٍ نُفِّذَ تُعيدُ جوابَهُ
    // (لا أثرَ جديدَ ولا إنشاءَ)، والمنعُ للأمرِ الجديدِ وحدهُ.
    const replayKey = (
      await sql<{ k: string }[]>`
      select idempotency_key as k from orders
      where rider_id = ${riderId}::uuid limit 1`
    )[0]?.k;
    if (replayKey === undefined) throw new Error("لا مفتاحَ إعادةٍ لاختبارِ العقدِ");
    // بصمةُ الأمرِ الأصليِّ قبلَ الإعادةِ: هو نفسُهُ من يجبَ أن يعودَ — لا أمرٌ جديدٌ
    // ولا تغييرُ بياناتٍ (الإنشاءُ والتعدادُ لا يتطرقانِ للمُعادِ).
    const original = (
      await sql<{ id: string; created_at: string; status: string }[]>`
      select id, created_at::text as created_at, status from orders
      where rider_id = ${riderId}::uuid and idempotency_key = ${replayKey}`
    )[0];
    if (original === undefined) throw new Error("لا أمرَ أصليًّا لاختبارِ العقدِ");
    const before = await countRiderOrders();
    const replay = await postRide(replayKey);
    const after = await countRiderOrders();

    expect(replay.status).toBe(200);
    const body = JSON.parse(replay.text) as {
      ok?: boolean;
      reused?: boolean;
      orderId?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.reused).toBe(true);
    // جوابُ الإعادةِ يعيدُ معرّفَ الأمرِ الأصليِّ نفسِهِ لا غيرَهُ.
    expect(body.orderId).toBe(original.id);
    const replayed = (
      await sql<{ created_at: string; status: string }[]>`
      select created_at::text as created_at, status from orders
      where rider_id = ${riderId}::uuid and idempotency_key = ${replayKey}`
    )[0];
    expect(replayed?.created_at).toBe(original.created_at);
    expect(replayed?.status).toBe(original.status);
    expect(after).toBe(before);
  });

  it("٤) رفعُ الحجبِ يعيدُ القدرةَ على الطلبِ — الحارسُ حالةٌ لا حكمٌ مؤبَّدٌ", async () => {
    await setUserBlocked(false);
    const before = await countRiderOrders();
    const restored = await postRide(`blocked-rider-unblocked:${crypto.randomUUID()}`);
    const after = await countRiderOrders();

    expect(restored.status).toBe(200);
    const body = JSON.parse(restored.text) as { accepted?: boolean };
    if (body.accepted !== true) throw new Error(`الطلبُ مرفوضٌ بعدَ رفعِ الحجبِ: ${restored.text}`);
    expect(after).toBe(before + 1);
  });
});
