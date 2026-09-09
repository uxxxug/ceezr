/**
 * الغرض: اختبارُ مسارِ `POST /v1/driver/location` (`F4-01`) على خادمِ البوابةِ
 *   الحقيقيِّ نفسِه: القبولُ، وجوابُ `stale` الصادقُ، وكلُّ صنفِ رفضٍ برمزِه
 *   ورقمِه، وأنَّ **الهويّةَ لا تُقبَلُ من الطلبِ** بأيِّ وجهٍ، وأنَّ التعطيلَ
 *   مُعلَنٌ عندَ غيابِ التبعياتِ، وأنَّ الردَّ لا يحملُ رمزاً ولا معرّفَ تيليجرام.
 * الحالة: اختبار فعلي — Hono يعالجُ الطلبَ في العمليّةِ نفسِها بلا شبكةٍ ولا قاعدة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 *
 * **وحدُّ هذا الملفِّ مُعلَنٌ:** الكاتبُ ههنا **مُصطنَعٌ**، فما يُثبَتُ هوَ الترجمةُ
 * إلى HTTP وحدَها. أنَّ الحارسَ يرفضُ الأقدمَ فعلاً في القاعدةِ — وأنَّ نبضاتٍ
 * مختلطةَ الترتيبِ لا تُرجِعُ الموضعَ إلى الوراءِ — في
 * `tests/integration/driver-location-intake.test.ts` على قاعدةٍ حقيقيّةٍ.
 */

import { describe, expect, it } from "bun:test";
import { parseDriverFix } from "../../apps/gateway/src/routes/driver-location.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import type { DriverProfile } from "../../packages/application/bots/types.ts";
import type { UpdateDriverLocationDeps } from "../../packages/application/geo/update-driver-location.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const SESSION_SECRET = "test-only-session-signing-secret-0123456789";
const WEBHOOK_SECRET = "test-webhook-secret-value";
const NOW = new Date("2027-03-01T09:00:00.000Z");
const TELEGRAM_ID = "5550001";
const CITY = "11111111-1111-4111-8111-111111111111" as CityId;
const DRIVER = "22222222-2222-4222-8222-222222222222" as DriverId;

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

const BODY = { latitude: 21.5471, longitude: 39.1751, accuracyMeters: 9 } as const;

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

/** ما رآهُ المنفذانِ فعلاً — بهِ يُثبَتُ أنَّ الهويّةَ من الرمزِ لا من الطلبِ. */
interface Seen {
  readonly lookedUp: string[];
  readonly wroteFor: string[];
}

interface Options {
  readonly mounted?: boolean;
  readonly configured?: boolean;
  readonly blocked?: boolean;
  readonly registered?: boolean;
  readonly lookupFails?: boolean;
  readonly write?: "accepted" | "stale" | "no_driver" | "failure";
  readonly limited?: boolean;
  readonly driver?: Partial<DriverProfile>;
}

function buildHarness(options: Options = {}) {
  const seen: Seen = { lookedUp: [], wroteFor: [] };
  const log = () => {};
  const viewer = {
    sessions: createMiniAppSessionReader(SESSION_SECRET),
    accounts: {
      findByTelegramUserId: async () =>
        ok({ role: "driver" as const, isBlocked: options.blocked === true }),
    },
    now: () => NOW,
    log,
  };
  const drivers = {
    findByTelegramId: async (telegramUserId: string) => {
      seen.lookedUp.push(telegramUserId);
      if (options.lookupFails === true) {
        return err(new PortFailureError("drivers", "عطلٌ مُصطنَعٌ"));
      }
      if (options.registered === false) return ok(null);
      return ok(profile(options.driver ?? {}));
    },
  };
  const ingest: UpdateDriverLocationDeps = {
    drivers: {
      updateLocation: async (driverId) => {
        seen.wroteFor.push(driverId);
        if (options.write === "failure") {
          return err(new PortFailureError("drivers", "عطلُ كتابةٍ مُصطنَعٌ"));
        }
        return ok({ kind: options.write ?? "accepted" });
      },
    },
    clock: { now: () => NOW },
  };
  const driverLocation =
    options.mounted === false
      ? undefined
      : {
          ...(options.configured === false ? {} : { viewer, drivers, ingest }),
          ...(options.limited === true
            ? {
                limits: {
                  perDriver: { hit: async () => ({ allowed: false, remaining: 0, resetSeconds: 7 }) },
                },
              }
            : {}),
          log,
        };

  const app = createServer({
    health: { now: () => NOW, startedAt: NOW, env: FULL_ENV },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    ...(driverLocation === undefined ? {} : { driverLocation }),
  });
  return { app, seen };
}

function tokenFor(): string {
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

async function post(
  harness: ReturnType<typeof buildHarness>,
  body: unknown,
  options: { authorization?: string | null; raw?: string } = {},
): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  const authorization =
    options.authorization === undefined ? `Bearer ${tokenFor()}` : options.authorization;
  const response = await harness.app.fetch(
    new Request("http://localhost/v1/driver/location", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorization === null ? {} : { authorization }),
      },
      body: options.raw ?? JSON.stringify(body),
    }),
  );
  const text = await response.text();
  return { status: response.status, json: JSON.parse(text) as Record<string, unknown>, text };
}

describe("POST /v1/driver/location — القبولُ وشكلُ الردِّ", () => {
  it("١) يقبلُ الإصلاحةَ ويعيدُ الحكمَ والطابعَ بحقولٍ محدودةٍ", async () => {
    const harness = buildHarness();
    const { status, json, text } = await post(harness, BODY);

    expect(status).toBe(200);
    expect(json).toEqual({
      ok: true,
      accepted: true,
      verdict: "ACCEPT",
      recordedAtMs: NOW.getTime(),
      dispatchable: false,
    });
    // لا رمزَ ولا معرّفَ تيليجرام في الردِّ بأيِّ صورةٍ.
    expect(text).not.toContain(TELEGRAM_ID);
    expect(text).not.toContain(tokenFor());
  });

  it("٢) صيرورةُ السائقِ قابلاً للإسنادِ تظهرُ في الردِّ مرّةً", async () => {
    const harness = buildHarness({ driver: { hasLocation: false, lastFix: null } });
    const { status, json } = await post(harness, BODY);

    expect(status).toBe(200);
    expect(json.dispatchable).toBe(true);
  });

  it("٣) `stale` جوابٌ صادقٌ بـ200: لم يقعْ عطلٌ ولم تُقبَلْ النبضةُ", async () => {
    const harness = buildHarness({ write: "stale" });
    const { status, json } = await post(harness, BODY);

    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, accepted: false, reason: "STALE" });
  });

  it("٤) الهويّةُ من الرمزِ وحدَه — معرّفٌ في الجسمِ لا يُغيِّرُ شيئاً", async () => {
    const harness = buildHarness();
    const { status } = await post(harness, {
      ...BODY,
      driverId: "99999999-9999-4999-8999-999999999999",
      telegramUserId: "7770007",
      role: "admin",
    });

    expect(status).toBe(200);
    expect(harness.seen.lookedUp).toEqual([TELEGRAM_ID]);
    expect(harness.seen.wroteFor).toEqual([DRIVER]);
  });
});

describe("POST /v1/driver/location — الرفضُ برمزِه ورقمِه", () => {
  it("٥) بلا رمزِ جلسةٍ: 401", async () => {
    const harness = buildHarness();
    const { status, json } = await post(harness, BODY, { authorization: null });

    expect(status).toBe(401);
    expect(json.error).toBe("SESSION_REQUIRED");
    expect(harness.seen.lookedUp).toHaveLength(0);
  });

  it("٦) رمزٌ مشوَّهٌ: 401 ولا كتابةَ", async () => {
    const harness = buildHarness();
    const { status, json } = await post(harness, BODY, { authorization: "Bearer not-a-token" });

    expect(status).toBe(401);
    expect(json.error).toBe("SESSION_INVALID");
    expect(harness.seen.wroteFor).toHaveLength(0);
  });

  it("٧) حسابٌ محجوبٌ: 403 ولا كتابةَ", async () => {
    const harness = buildHarness({ blocked: true });
    const { status, json } = await post(harness, BODY);

    expect(status).toBe(403);
    expect(json.error).toBe("ACCOUNT_BLOCKED");
    expect(harness.seen.wroteFor).toHaveLength(0);
  });

  it("٨) صاحبُ جلسةٍ بلا صفِّ سائقٍ: 404 — ولا يُنشَأُ له صفٌّ", async () => {
    const harness = buildHarness({ registered: false });
    const { status, json } = await post(harness, BODY);

    expect(status).toBe(404);
    expect(json.error).toBe("DRIVER_NOT_REGISTERED");
    expect(harness.seen.wroteFor).toHaveLength(0);
  });

  it("٩) عطلُ قراءةِ الدليلِ: 503 لا 500 ولا قبولٌ صامتٌ", async () => {
    const harness = buildHarness({ lookupFails: true });
    const { status, json } = await post(harness, BODY);

    expect(status).toBe(503);
    expect(json.error).toBe("DRIVER_LOOKUP_FAILED");
  });

  it("١٠) جسمٌ ليسَ JSON: 400", async () => {
    const harness = buildHarness();
    const { status, json } = await post(harness, null, { raw: "{ليسَ" });

    expect(status).toBe(400);
    expect(json.error).toBe("INVALID_JSON");
    expect(harness.seen.lookedUp).toHaveLength(0);
  });

  it("١١) إحداثيةٌ ناقصةٌ أو ليست رقماً: 400 بتمييزٍ بينَهما", async () => {
    const harness = buildHarness();
    const missing = await post(harness, { longitude: 39.1 });
    const invalid = await post(harness, { latitude: "21.5", longitude: 39.1 });

    expect(missing.status).toBe(400);
    expect(missing.json.error).toBe("COORDINATES_MISSING");
    expect(invalid.status).toBe(400);
    expect(invalid.json.error).toBe("INVALID_COORDINATES");
    expect(harness.seen.wroteFor).toHaveLength(0);
  });

  it("١٢) إحداثيةٌ خارجَ حدِّ المجالِ: 422 لا 400 — ومعَها الملاحظاتُ", async () => {
    const harness = buildHarness();
    const { status, json } = await post(harness, { latitude: 121, longitude: 39.1 });

    expect(status).toBe(422);
    expect(json.error).toBe("FIX_REJECTED");
    expect((json.findings as string[]).length).toBeGreaterThan(0);
    expect(harness.seen.wroteFor).toHaveLength(0);
  });

  it("١٣) طابعٌ فاسدٌ شكلاً: 400 لا تقريبٌ صامتٌ", async () => {
    const harness = buildHarness();
    for (const recordedAtMs of [-1, 0, 1.5, "x", null]) {
      const { status, json } = await post(harness, { ...BODY, recordedAtMs });
      expect(status).toBe(400);
      expect(json.error).toBe("INVALID_RECORDED_AT");
    }
  });

  it("١٤) اختفاءُ الصفِّ عندَ الكتابةِ: 404، وعطلُ الكتابةِ: 503", async () => {
    const gone = await post(buildHarness({ write: "no_driver" }), BODY);
    const broken = await post(buildHarness({ write: "failure" }), BODY);

    expect(gone.status).toBe(404);
    expect(gone.json.error).toBe("DRIVER_NOT_FOUND");
    expect(broken.status).toBe(503);
    expect(broken.json.error).toBe("WRITE_FAILED");
  });

  it("١٥) جسمٌ فاحشُ الحجمِ: 413 قبلَ أيِّ تحليلٍ", async () => {
    const harness = buildHarness();
    const { status, json } = await post(harness, null, {
      raw: JSON.stringify({ ...BODY, pad: "x".repeat(4_096) }),
    });

    expect(status).toBe(413);
    expect(json.error).toBe("PAYLOAD_TOO_LARGE");
    expect(harness.seen.lookedUp).toHaveLength(0);
  });

  it("١٦) تجاوزُ الحدِّ: 429 ولا قراءةَ جسمٍ ولا كتابةَ", async () => {
    const harness = buildHarness({ limited: true });
    const { status, json } = await post(harness, BODY);

    expect(status).toBe(429);
    expect(json.error).toBe("RATE_LIMITED");
    expect(harness.seen.wroteFor).toHaveLength(0);
  });
});

describe("POST /v1/driver/location — التركيبُ والتعطيلُ المُعلَنُ", () => {
  it("١٧) غيرُ مركَّبٍ: 404 لا 500", async () => {
    const harness = buildHarness({ mounted: false });
    const { status, json } = await post(harness, BODY);

    expect(status).toBe(404);
    expect(json.error).toBe("NOT_FOUND");
  });

  it("١٨) مركَّبٌ بلا تبعياتٍ: تعطيلٌ مُعلَنٌ بـ503 لا كتابةٌ بلا تحقّقٍ", async () => {
    const harness = buildHarness({ configured: false });
    const { status, json } = await post(harness, BODY);

    expect(status).toBe(503);
    expect(json.error).toBe("SESSION_NOT_AVAILABLE");
  });
});

describe("F4-01 — تحقُّقُ الشكلِ وحدَه", () => {
  it("١٩) `parseDriverFix` يفصلُ شكلَ المدخلِ عن حكمِ المجالِ", () => {
    expect(parseDriverFix([])).toEqual({ error: "INVALID_BODY" });
    expect(parseDriverFix(null)).toEqual({ error: "INVALID_BODY" });
    expect(parseDriverFix({ latitude: 1, longitude: 2, accuracyMeters: "5" })).toEqual({
      error: "INVALID_ACCURACY",
    });
    expect(parseDriverFix({ latitude: 1, longitude: 2, headingDegrees: Number.NaN })).toEqual({
      error: "INVALID_HEADING",
    });
    // إحداثيةٌ خارجَ الحدِّ **تمرُّ شكلاً**: حكمُها للمجالِ لا للمسارِ.
    expect(parseDriverFix({ latitude: 999, longitude: 999 })).toEqual({
      latitude: 999,
      longitude: 999,
    });
  });
});
