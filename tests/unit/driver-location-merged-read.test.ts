/**
 * الغرض: LOAD-01 · `driver/location` — إثباتُ أنَّ القراءةَ المدمجةَ (`findViewerAndDriver`)
 *   لا تغيّرُ سلوكَ المسارِ في أيِّ حالة: كلُّ «عالَمٍ» (حسابٌ/ملفٌّ/عطلٌ/حجبٌ/حدٌّ/رمزٌ)
 *   يُشغَّلُ على المسارِ القديمِ (قارئُ الحسابِ ثمّ `findByTelegramId`) وعلى المدمجِ، فيلزمُ
 *   أن يتطابقَ الرمزُ والجسمُ حرفيًا، وأن يُنادى القارئُ المدمجُ مرّةً واحدةً على الأكثرِ،
 *   ولا يُنادى القارئانِ المنفصلانِ معه أبدًا، ولا تُقرأُ القاعدةُ لرمزٍ لم يُثبَت.
 * الحالة: اختبار فعلي — Hono في العمليّةِ نفسِها بلا شبكةٍ ولا قاعدة. عقدُ الجملةِ على
 *   PostgreSQL الحقيقيِّ في `tests/integration/driver-viewer-merged-read.test.ts`.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 */

import { describe, expect, it } from "bun:test";
import { createServer } from "../../apps/gateway/src/server.ts";
import type { DriverProfile } from "../../packages/application/bots/types.ts";
import type { UpdateDriverLocationDeps } from "../../packages/application/geo/update-driver-location.ts";
import type {
  ViewerAccount,
  ViewerLookupFailure,
} from "../../packages/application/identity/ports.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";
import { err, ok, type Result } from "../../packages/shared/result/index.ts";

const SESSION_SECRET = "test-only-session-signing-secret-0123456789";
const WEBHOOK_SECRET = "test-webhook-secret-value";
const NOW = new Date("2027-03-01T09:00:00.000Z");
const TELEGRAM_ID = "5550001";
const CITY = "11111111-1111-4111-8111-111111111111" as CityId;
const DRIVER = "22222222-2222-4222-8222-222222222222" as DriverId;
const BODY = { latitude: 21.5471, longitude: 39.1751, accuracyMeters: 9 } as const;

const FULL_ENV: Record<string, string> = {
  SUPABASE_URL: "https://example.supabase.co",
  DATABASE_URL: "postgres://user:pass@localhost:5432/postgres",
  SUPABASE_SERVICE_ROLE_KEY: "x",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "x",
  DRIVER_BOT_TOKEN: "x",
  RIDER_BOT_TOKEN: "x",
  TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
  BOOTSTRAP_ADMIN_TELEGRAM_ID: "900000",
};

function profile(overrides: Partial<DriverProfile> = {}): DriverProfile {
  return {
    id: DRIVER,
    cityId: CITY,
    telegramUserId: TELEGRAM_ID,
    fullName: "سائقٌ مُختبَرٌ",
    phone: "+966500000000",
    isVerified: true,
    isAvailable: true,
    hasLocation: true,
    lastFix: { latitude: 21.547, longitude: 39.175, recordedAtMs: NOW.getTime() - 60_000 },
    ...overrides,
  };
}

const DRIVER_ACCOUNT: ViewerAccount = { role: "driver", isBlocked: false, languageCode: "ar" };
const READER_DOWN: ViewerLookupFailure = { code: "VIEWER_LOOKUP_FAILED", reason: "READER_ERROR" };
const DRIVERS_DOWN = new PortFailureError("drivers", "عطلٌ مُصطنَعٌ");

/** حقيقةُ القاعدةِ في الحالةِ الواحدة — يقرؤها المساران كلٌّ بطريقتِه. */
interface World {
  readonly name: string;
  readonly account: Result<ViewerAccount | null, ViewerLookupFailure>;
  readonly driver: Result<DriverProfile | null, PortFailureError>;
  readonly write?: "accepted" | "stale" | "failure";
  readonly limited?: boolean;
  readonly authorization?: string | null;
  readonly raw?: string;
}

interface Calls {
  account: number;
  driver: number;
  combined: number;
  wrote: number;
}

function harness(world: World, merged: boolean) {
  const calls: Calls = { account: 0, driver: 0, combined: 0, wrote: 0 };
  const log = () => {};
  const drivers = {
    findByTelegramId: async (telegramUserId: string) => {
      calls.driver += 1;
      expect(telegramUserId).toBe(TELEGRAM_ID);
      return world.driver;
    },
    ...(merged
      ? {
          findViewerAndDriver: async (telegramUserId: string) => {
            calls.combined += 1;
            expect(telegramUserId).toBe(TELEGRAM_ID);
            // تعذّرُ القاعدةِ في الجملةِ الواحدةِ يُسقِطُ النتيجتَينِ معًا — كما يفعلُ المنفذُ.
            return { account: world.account, driver: world.driver };
          },
        }
      : {}),
  };
  const ingest: UpdateDriverLocationDeps = {
    drivers: {
      updateLocation: async () => {
        calls.wrote += 1;
        if (world.write === "failure") return err(new PortFailureError("drivers", "عطلُ كتابة"));
        return ok({ kind: world.write ?? "accepted" });
      },
    },
    clock: { now: () => NOW },
  };
  const app = createServer({
    health: { now: () => NOW, startedAt: NOW, env: FULL_ENV },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    driverLocation: {
      viewer: {
        sessions: createMiniAppSessionReader(SESSION_SECRET),
        accounts: {
          findByTelegramUserId: async () => {
            calls.account += 1;
            return world.account;
          },
        },
        now: () => NOW,
        log,
      },
      drivers,
      ingest,
      ...(world.limited === true
        ? {
            limits: {
              perDriver: { hit: async () => ({ allowed: false, remaining: 0, resetSeconds: 7 }) },
            },
          }
        : {}),
      log,
    },
  });
  return { app, calls };
}

function token(): string {
  const issued = createMiniAppSessionIssuer({ secret: SESSION_SECRET }).issue(
    {
      telegramUserId: TELEGRAM_ID,
      bot: "driver",
      authDateSeconds: Math.floor(NOW.getTime() / 1000),
    },
    NOW.getTime(),
  );
  if (!issued.ok) throw new Error("إصدار فاشل");
  return issued.value.accessToken;
}

async function run(world: World, merged: boolean) {
  const h = harness(world, merged);
  const authorization =
    world.authorization === undefined ? `Bearer ${token()}` : world.authorization;
  const response = await h.app.fetch(
    new Request("http://localhost/v1/driver/location", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorization === null ? {} : { authorization }),
      },
      body: world.raw ?? JSON.stringify(BODY),
    }),
  );
  return {
    status: response.status,
    body: await response.text(),
    retryAfter: response.headers.get("retry-after"),
    calls: h.calls,
  };
}

const WORLDS: readonly World[] = [
  { name: "سائقٌ مسجَّلٌ يُقبَلُ موقعُه", account: ok(DRIVER_ACCOUNT), driver: ok(profile()) },
  {
    name: "أوّلُ موقعٍ يجعلُه قابلًا للإسناد",
    account: ok(DRIVER_ACCOUNT),
    driver: ok(profile({ hasLocation: false, lastFix: null })),
  },
  { name: "نبضةٌ أقدمُ (stale)", account: ok(DRIVER_ACCOUNT), driver: ok(profile()), write: "stale" },
  { name: "عطلُ الكتابة", account: ok(DRIVER_ACCOUNT), driver: ok(profile()), write: "failure" },
  {
    name: "حسابٌ محجوب",
    account: ok({ ...DRIVER_ACCOUNT, isBlocked: true }),
    driver: ok(profile()),
  },
  { name: "غائبٌ عن users", account: ok(null), driver: ok(null) },
  {
    name: "مسجَّلٌ بلا صفِّ سائق",
    account: ok({ role: "rider", isBlocked: false, languageCode: "en" }),
    driver: ok(null),
  },
  { name: "تعذّرُ القاعدة", account: err(READER_DOWN), driver: err(DRIVERS_DOWN) },
  {
    name: "دورٌ لا يعرفُه الكود",
    account: err({ code: "VIEWER_LOOKUP_FAILED", reason: "UNSUPPORTED_ROLE" }),
    driver: ok(profile()),
  },
  {
    name: "تعذّرُ قراءةِ الملفِّ وحدَه",
    account: ok(DRIVER_ACCOUNT),
    driver: err(DRIVERS_DOWN),
  },
  { name: "تجاوزُ الحدّ", account: ok(DRIVER_ACCOUNT), driver: ok(profile()), limited: true },
  { name: "بلا رمز", account: ok(DRIVER_ACCOUNT), driver: ok(profile()), authorization: null },
  {
    name: "رمزٌ مشوَّه",
    account: ok(DRIVER_ACCOUNT),
    driver: ok(profile()),
    authorization: "Bearer not-a-token",
  },
  { name: "جسمٌ غيرُ JSON", account: ok(DRIVER_ACCOUNT), driver: ok(profile()), raw: "{nope" },
  {
    name: "إحداثيّاتٌ خارجَ النطاق",
    account: ok(DRIVER_ACCOUNT),
    driver: ok(profile()),
    raw: JSON.stringify({ latitude: 200, longitude: 39 }),
  },
];

describe("driver/location — القراءةُ المدمجةُ تكافئُ المسارَ القديمَ في كلِّ حالة", () => {
  for (const world of WORLDS) {
    it(world.name, async () => {
      const legacy = await run(world, false);
      const merged = await run(world, true);

      // السلوكُ الظاهرُ: الرمزُ والجسمُ ورأسُ الإعادةِ حرفيًا، وعددُ الكتاباتِ نفسُه.
      expect(merged.status).toBe(legacy.status);
      expect(merged.body).toBe(legacy.body);
      expect(merged.retryAfter).toBe(legacy.retryAfter);
      expect(merged.calls.wrote).toBe(legacy.calls.wrote);

      // المدمجُ لا ينادي القارئَينِ المنفصلَينِ أبدًا، وينادي نفسَه مرّةً على الأكثرِ.
      expect(merged.calls.account).toBe(0);
      expect(merged.calls.driver).toBe(0);
      expect(merged.calls.combined).toBe(legacy.calls.account);
      expect(merged.calls.combined).toBeLessThanOrEqual(1);
    });
  }

  it("لا تُقرأُ القاعدةُ لرمزٍ لم يُثبَت — في المسارَينِ", async () => {
    for (const authorization of [null, "Bearer not-a-token"]) {
      const world: World = {
        name: "x",
        account: ok(DRIVER_ACCOUNT),
        driver: ok(profile()),
        authorization,
      };
      const merged = await run(world, true);
      expect(merged.calls.combined).toBe(0);
    }
  });

  it("الطلبُ المقبولُ: حجزٌ واحدٌ للقراءةِ بدلَ اثنين", async () => {
    const world = WORLDS[0] as World;
    const legacy = await run(world, false);
    const merged = await run(world, true);
    expect(legacy.calls.account + legacy.calls.driver).toBe(2);
    expect(merged.calls.combined).toBe(1);
  });
});
