/**
 * الغرض: اختبارُ مسارِ الاقتباسِ على خادمِ البوابةِ الحقيقيِّ نفسِه (`F2-04`):
 *   القبولُ، والرفضُ المقيسُ بـ`200`، وكلُّ عطبٍ برمزِه ورقمِه، وأنَّ الهويّةَ
 *   **لا تُقرأُ من الطلبِ**، وأنَّ الحمولةَ **لا تحملُ أجرةً ولا وسيلةَ دفعٍ ولا
 *   حقلاً مُعَدّاً لهما** (`ADR 0039` §٤ · `م13-7`)، وأنَّ الوسمَ يُسافِرُ معَ
 *   المسافةِ على السلكِ، وأنَّ التعطيلَ مُعلَنٌ (`503`) لا جسمٌ فارغٌ (`200`).
 * الحالة: اختبار فعلي — Hono يعالجُ الطلبَ في العمليةِ نفسِها بلا شبكةٍ ولا قاعدةٍ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI
 * يُتوقع أن يستخدمه لاحقاً: `F2-05` يُضيفُ مسارَ الإنشاءِ بالعُرفِ نفسِه.
 * ملاحظات مستقبلية: حكمُ القاعدةِ نفسُه (المسافةُ والحدودُ والخدماتُ) يُقاسُ على
 *   PostgreSQL حقيقيٍّ في `tests/integration/quote.test.ts` — والحاكمُ ههنا
 *   مُصنَّعٌ عن قصدٍ: المُتحقَّقُ منه **الناقلُ والترجمةُ** لا صدقُ الحكمِ.
 *
 * وما لا يفعلُه: لا يزعمُ أنَّ مستخدماً فتحَ هذا المسارَ — لا نشرَ حيَّ (`ADR 0099`).
 */

import { describe, expect, it } from "bun:test";
import { createServer } from "../../apps/gateway/src/server.ts";
import type {
  QuoteJudge,
  QuoteRefusal,
  QuoteStoreFailureReason,
  QuoteVerdict,
} from "../../packages/application/quote/ports.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import { createTestRevocationStore } from "../helpers/revocation-store.ts";

const SESSION_SECRET = "test-only-session-signing-secret-0123456789";
const WEBHOOK_SECRET = "test-webhook-secret-value";
const NOW = new Date("2027-03-01T09:00:00.000Z");
const TELEGRAM_ID = "5550001";

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

const CITY = { code: "JED", nameAr: "جدة", nameEn: "Jeddah" } as const;

const ACCEPTED: QuoteVerdict = {
  accepted: true,
  quote: {
    city: CITY,
    areaVersion: "jed-envelope-v1",
    distance: { kind: "STRAIGHT_LINE", meters: 7581.8 },
    servedServices: ["transport"],
  },
};

interface Harness {
  readonly app: ReturnType<typeof createServer>;
  readonly seenIds: string[];
  readonly seenPoints: { origin: unknown; destination: unknown }[];
}

function buildHarness(
  options: {
    readonly verdict?: QuoteVerdict;
    readonly refusal?: QuoteRefusal;
    readonly failure?: QuoteStoreFailureReason;
    readonly mounted?: boolean;
    readonly configured?: boolean;
  } = {},
): Harness {
  const seenIds: string[] = [];
  const seenPoints: { origin: unknown; destination: unknown }[] = [];

  const judge: QuoteJudge = {
    judge: async (input) => {
      seenIds.push(input.telegramUserId);
      seenPoints.push({ origin: input.origin, destination: input.destination });
      if (options.failure !== undefined) return err({ reason: options.failure });
      if (options.refusal !== undefined) {
        return ok({ accepted: false, refusal: options.refusal, city: CITY });
      }
      return ok(options.verdict ?? ACCEPTED);
    },
  };

  const quote = {
    sessions: createMiniAppSessionReader(SESSION_SECRET),
    revocation: createTestRevocationStore(),
    judge,
    // لا محرِّكَ توجيهٍ: وهوَ الحالُ في كلِّ البيئاتِ اليومَ (`ADR 0024`).
    routing: null,
    now: () => NOW,
  };
  const mounted =
    options.mounted === false ? undefined : { ...(options.configured === false ? {} : { quote }) };

  const app = createServer({
    health: { now: () => NOW, startedAt: NOW, env: FULL_ENV },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    ...(mounted === undefined ? {} : { quote: mounted }),
  });
  return { app, seenIds, seenPoints };
}

function tokenFor(telegramUserId: string = TELEGRAM_ID): string {
  const issued = createMiniAppSessionIssuer({ secret: SESSION_SECRET }).issue(
    { telegramUserId, bot: "rider", authDateSeconds: Math.floor(NOW.getTime() / 1000) },
    NOW.getTime(),
  );
  if (!issued.ok) throw new Error("إصدار فاشل");
  return issued.value.accessToken;
}

const RIDE_BODY = {
  originLat: 21.5,
  originLng: 39.15,
  destinationLat: 21.55,
  destinationLng: 39.2,
};

async function call(
  harness: Harness,
  init: {
    readonly headers?: Record<string, string>;
    readonly body?: unknown;
    readonly rawBody?: string;
  } = {},
): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  const response = await harness.app.fetch(
    new Request("http://localhost/v1/quote/ride", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      body: init.rawBody ?? JSON.stringify(init.body ?? RIDE_BODY),
    }),
  );
  const text = await response.text();
  return { status: response.status, json: JSON.parse(text) as Record<string, unknown>, text };
}

function authed(token: string = tokenFor()): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe("POST /v1/quote/ride — الحكمُ المقبولُ", () => {
  it("يُعيدُ مسافةً موسومةً ومدّةً مُصنَّفةً وبطاقاتِ خدماتٍ", async () => {
    const harness = buildHarness();
    const { status, json } = await call(harness, { headers: authed() });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.accepted).toBe(true);
    expect(json.city).toEqual(CITY);
    expect(json.areaVersion).toBe("jed-envelope-v1");
    expect(json.distance).toEqual({ kind: "STRAIGHT_LINE", meters: 7581.8 });
    expect(json.services).toEqual([
      { service: "transport", available: true },
      { service: "delivery", available: false, reason: "NO_CAPABLE_DRIVER_IN_CITY" },
    ]);
  });

  it("المدّةُ امتناعٌ مُصنَّفٌ `NOT_CONFIGURED` لا رقمٌ مخترَعٌ: لا محرِّكَ مُهيَّأً", async () => {
    const harness = buildHarness();
    const { json } = await call(harness, { headers: authed() });
    expect(json.eta).toEqual({ kind: "UNAVAILABLE", reason: "NOT_CONFIGURED" });
  });

  it("الهويّةُ من الرمزِ الموقَّعِ لا من الطلبِ ولا من ترويسةٍ", async () => {
    const harness = buildHarness();
    await call(harness, {
      headers: { ...authed(), "x-telegram-user-id": "999999" },
      body: { ...RIDE_BODY, telegramId: 999_999, cityId: "11111111-1111-1111-1111-111111111111" },
    });
    expect(harness.seenIds).toEqual([TELEGRAM_ID]);
  });

  it("الإحداثيّتانِ تُمرَّرانِ كما قُبِلَتا ولا تُقرَّبانِ في الناقلِ", async () => {
    const harness = buildHarness();
    await call(harness, { headers: authed() });
    expect(harness.seenPoints[0]).toEqual({
      origin: { lat: 21.5, lng: 39.15 },
      destination: { lat: 21.55, lng: 39.2 },
    });
  });

  it("الحمولةُ **بلا أجرةٍ ولا وسيلةِ دفعٍ ولا حقلٍ مُعَدٍّ لهما**", async () => {
    const harness = buildHarness();
    const { json, text } = await call(harness, { headers: authed() });
    for (const forbidden of [
      ["fa", "re"].join(""),
      "price",
      "payment",
      "cash",
      "estimate",
      "total",
    ]) {
      expect(text.toLowerCase()).not.toContain(forbidden);
    }
    expect(Object.keys(json).sort()).toEqual([
      "accepted",
      "areaVersion",
      "city",
      "distance",
      "eta",
      "ok",
      "services",
    ]);
  });
});

describe("POST /v1/quote/ride — الرفضُ المقيسُ جوابٌ بـ200", () => {
  const cases: readonly QuoteRefusal[] = [
    "INVALID_POINT",
    "CITY_HAS_NO_SERVICE_AREA",
    "ORIGIN_OUTSIDE_SERVICE_AREA",
    "DESTINATION_OUTSIDE_SERVICE_AREA",
  ];
  for (const refusal of cases) {
    it(`«${refusal}» يُنشَرُ رمزاً مفصولاً بـ200 لا بـ4xx`, async () => {
      const harness = buildHarness({ refusal });
      const { status, json } = await call(harness, { headers: authed() });
      expect(status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.accepted).toBe(false);
      expect(json.refusal).toBe(refusal);
      expect(json.city).toEqual(CITY);
      expect(json.distance).toBeUndefined();
    });
  }
});

describe("POST /v1/quote/ride — العطبُ برمزِه ورقمِه", () => {
  it("بلا رمزٍ: 401 `SESSION_REQUIRED`", async () => {
    const { status, json } = await call(buildHarness());
    expect(status).toBe(401);
    expect(json.error).toBe("SESSION_REQUIRED");
  });

  it("رمزٌ فاسدٌ: 401 `SESSION_INVALID`", async () => {
    const { status, json } = await call(buildHarness(), {
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(status).toBe(401);
    expect(json.error).toBe("SESSION_INVALID");
  });

  it("جسمٌ ليسَ كائناً: 400 `INVALID_BODY`", async () => {
    const { status, json } = await call(buildHarness(), {
      headers: authed(),
      rawBody: "[1,2]",
    });
    expect(status).toBe(400);
    expect(json.error).toBe("INVALID_BODY");
  });

  it("نصٌّ ليسَ JSON: 400 `INVALID_JSON`", async () => {
    const { status, json } = await call(buildHarness(), { headers: authed(), rawBody: "{" });
    expect(status).toBe(400);
    expect(json.error).toBe("INVALID_JSON");
  });

  it("إحداثيّةٌ ناقصةٌ أو غيرُ عدديّةٍ: 400 `MALFORMED` ولا يُستدعى الحاكمُ", async () => {
    for (const body of [
      { originLat: 21.5, originLng: 39.15 },
      { ...RIDE_BODY, destinationLat: "21.5" },
      { ...RIDE_BODY, originLat: Number.NaN },
      { ...RIDE_BODY, originLat: 91 },
    ]) {
      const harness = buildHarness();
      const { status, json } = await call(harness, { headers: authed(), body });
      expect(status).toBe(400);
      expect(json.error).toBe("MALFORMED");
      expect(harness.seenIds).toEqual([]);
    }
  });

  it("لا صفَّ مستخدمٍ: 404 `ACCOUNT_NOT_FOUND` ولا يُنشَأُ صفٌّ (ADR 0035)", async () => {
    const { status, json } = await call(buildHarness({ failure: "USER_NOT_FOUND" }), {
      headers: authed(),
    });
    expect(status).toBe(404);
    expect(json.error).toBe("ACCOUNT_NOT_FOUND");
  });

  it("عطبُ متجرٍ: 503 لا 200 بحكمٍ مخترَعٍ", async () => {
    for (const failure of ["STORE_ERROR", "NOT_CONFIGURED"] as const) {
      const { status, json } = await call(buildHarness({ failure }), { headers: authed() });
      expect(status).toBe(503);
      expect(json.error).toBe("QUOTE_STORE_NOT_AVAILABLE");
    }
  });

  it("حمولةٌ أكبرُ من الحدِّ: 413 قبلَ أيِّ قراءةٍ", async () => {
    const harness = buildHarness();
    const { status, json } = await call(harness, {
      headers: authed(),
      rawBody: JSON.stringify({ ...RIDE_BODY, padding: "x".repeat(1024) }),
    });
    expect(status).toBe(413);
    expect(json.error).toBe("PAYLOAD_TOO_LARGE");
    expect(harness.seenIds).toEqual([]);
  });
});

describe("التعطيلُ مُعلَنٌ لا مضمرٌ", () => {
  it("المسارُ غيرُ مُهيَّأٍ: 503 لا 404 ولا جسمٌ فارغٌ بـ200", async () => {
    const { status, json } = await call(buildHarness({ configured: false }), {
      headers: authed(),
    });
    expect(status).toBe(503);
    expect(json.error).toBe("QUOTE_STORE_NOT_AVAILABLE");
  });

  it("المسارُ غيرُ مركَّبٍ أصلاً: 404 من الخادمِ نفسِه", async () => {
    const { status } = await call(buildHarness({ mounted: false }), { headers: authed() });
    expect(status).toBe(404);
  });
});
