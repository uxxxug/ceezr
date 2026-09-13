/**
 * الغرض: قياسُ مسارَي `GET /v1/rides/:id/summary` و`POST /v1/rides/:id/rating` —
 *   الحمولةُ المنشورةُ، و**غيابُ المالِ وغيابُ الموقعِ في السلكِ**، والفرقُ بينَ
 *   الرفضِ `200` وعطبِ الطلبِ `4xx`، وتمريرُ الجلسةِ إلى المخزنِ (البند `F2-07`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-07`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 *
 * ولماذا يُقاسُ **غيابُ الحقلِ** لا وجودُ رايةٍ: عميلٌ يقرأُ حقلاً لا يقرأُ
 * رايةً. فالمقيسُ ههنا أنَّ الأجرةَ والموقعَ **لا يُغادرانِ الخادمَ** في هذا
 * المسارِ — لا أنَّ العميلَ مؤتمَنٌ على إخفائِهما.
 *
 * وما لا يفعلُه عن قصدٍ: لا يقيسُ حكمَ القاعدةِ (النافذةُ والتكرارُ والملكيّةُ)
 * — ذاكَ في `tests/integration/ride-summary.test.ts` على قاعدةٍ حقيقيّةٍ. وههنا
 * المخزنُ مُصنَّعٌ، فما يُقاسُ هوَ **ترجمةُ حكمِه إلى سلكٍ** لا الحكمُ نفسُه.
 */

import { describe, expect, it } from "bun:test";
import { createServer } from "../../apps/gateway/src/server.ts";
import type { RideStoreFailureReason } from "../../packages/application/transport/ride-request-ports.ts";
import type {
  RideRatingCommand,
  RideRatingRefusal,
  RideSummaryReader,
  RideSummaryState,
} from "../../packages/application/transport/ride-summary-ports.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const SESSION_SECRET = "test-only-session-signing-secret-0123456789";
const WEBHOOK_SECRET = "test-webhook-secret-value";
const NOW = new Date("2027-03-01T09:30:00.000Z");
const TELEGRAM_ID = "5550001";
const ORDER_ID = "3f1c9a02-4b7e-4d21-9f88-0a1b2c3d4e5f";
const RATING_ID = "6b2d4e10-9c33-4a77-8f01-2d5e7a9b1c33";

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

function state(over: Partial<RideSummaryState> = {}): RideSummaryState {
  return {
    orderId: ORDER_ID,
    status: "completed",
    service: "transport",
    pickupLabel: "البلد",
    dropoffLabel: null,
    createdAtMs: NOW.getTime() - 1_800_000,
    matchedAtMs: NOW.getTime() - 1_710_000,
    startedAtMs: NOW.getTime() - 1_560_000,
    completedAtMs: NOW.getTime() - 806_000,
    durationSeconds: 754,
    straightLineMeters: 4210.5,
    driver: {
      firstName: "خالد",
      vehicleType: "سيدان",
      plateNumber: "ABC 1234",
      ratingAverage: 4.7,
      ratingCount: 31,
    },
    rating: { alreadyRated: false, windowHours: 48, windowClosed: false, canRate: true },
    ...over,
  };
}

interface Seen {
  readonly reads: { telegramUserId: string; orderId: string }[];
  readonly submits: Record<string, unknown>[];
}

interface HarnessOptions {
  readonly state?: RideSummaryState;
  readonly refusal?: "INVALID_ORDER_ID" | "ORDER_NOT_FOUND";
  readonly failure?: RideStoreFailureReason;
  readonly ratingRefusal?: RideRatingRefusal;
  readonly ratingFailure?: RideStoreFailureReason;
  readonly mounted?: boolean;
}

function buildHarness(options: HarnessOptions = {}): {
  app: ReturnType<typeof createServer>;
  seen: Seen;
} {
  const seen: Seen = { reads: [], submits: [] };
  const summaryReader: RideSummaryReader = {
    read: async (input) => {
      seen.reads.push({ telegramUserId: input.telegramUserId, orderId: input.orderId });
      if (options.failure !== undefined) return err({ reason: options.failure });
      if (options.refusal !== undefined) return ok({ found: false, refusal: options.refusal });
      return ok({ found: true, state: options.state ?? state() });
    },
  };
  const ratingCommand: RideRatingCommand = {
    submit: async (input) => {
      seen.submits.push({ ...input });
      if (options.ratingFailure !== undefined) return err({ reason: options.ratingFailure });
      if (options.ratingRefusal !== undefined) {
        return ok({ accepted: false, refusal: options.ratingRefusal });
      }
      return ok({
        accepted: true,
        rating: {
          ratingId: RATING_ID,
          direction: "rider_to_driver",
          stars: input.stars,
          tags: input.tags,
        },
      });
    },
  };

  const sessions = createMiniAppSessionReader(SESSION_SECRET);
  const app = createServer({
    health: { now: () => NOW, startedAt: NOW, env: FULL_ENV },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    ...(options.mounted === false
      ? { rides: {} }
      : {
          rides: {
            summary: { sessions, rides: summaryReader, now: () => NOW },
            rating: { sessions, ratings: ratingCommand, now: () => NOW },
          },
        }),
  });
  return { app, seen };
}

function tokenFor(telegramUserId: string = TELEGRAM_ID): string {
  const issued = createMiniAppSessionIssuer({ secret: SESSION_SECRET }).issue(
    { telegramUserId, bot: "rider", authDateSeconds: Math.floor(NOW.getTime() / 1000) },
    NOW.getTime(),
  );
  if (!issued.ok) throw new Error("إصدار فاشل");
  return issued.value.accessToken;
}

function authed(): Record<string, string> {
  return { authorization: `Bearer ${tokenFor()}` };
}

async function get(
  harness: { app: ReturnType<typeof createServer> },
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  const response = await harness.app.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "application/json", ...headers } }),
  );
  const text = await response.text();
  return { status: response.status, json: JSON.parse(text) as Record<string, unknown>, text };
}

async function post(
  harness: { app: ReturnType<typeof createServer> },
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await harness.app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    json: JSON.parse(await response.text()) as Record<string, unknown>,
  };
}

describe("ملخَّصُ الرحلةِ — الحمولةُ", () => {
  it("الأختامُ الأربعةُ والمدّةُ والوترُ والأهليّةُ تُنشَرُ", async () => {
    const harness = buildHarness();
    const { status, json } = await get(harness, `/v1/rides/${ORDER_ID}/summary`, authed());
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.found).toBe(true);
    expect(json.orderId).toBe(ORDER_ID);
    expect(json.status).toBe("completed");
    expect(json.completedAt).toBe(new Date(NOW.getTime() - 806_000).toISOString());
    expect(json.duration).toEqual({ known: true, totalSeconds: 754, minutes: 12, seconds: 34 });
    expect(json.straightLine).toEqual({ known: true, meters: 4210.5 });
    expect(json.rating).toEqual({
      eligibility: "CAN_RATE",
      canRate: true,
      alreadyRated: false,
      windowHours: 48,
      windowClosed: false,
    });
    expect(harness.seen.reads).toEqual([{ telegramUserId: TELEGRAM_ID, orderId: ORDER_ID }]);
  });

  it("**لا لفظَ مالٍ في السلكِ**: الأجرةُ مُجمَّدةٌ ولا حقلَ لها", async () => {
    const { text } = await get(buildHarness(), `/v1/rides/${ORDER_ID}/summary`, authed());
    const lowered = text.toLowerCase();
    for (const token of ["fare", "price", "amount", "receipt", "currency", "sar", "tip"]) {
      expect(lowered.includes(token)).toBe(false);
    }
  });

  it("**لا موقعَ سائقٍ في السلكِ**: الرحلةُ انتهَت فلا أثرَ يُتتبَّعُ", async () => {
    const { json, text } = await get(buildHarness(), `/v1/rides/${ORDER_ID}/summary`, authed());
    expect(json.driver).toEqual({
      firstName: "خالد",
      vehicleType: "سيدان",
      plateNumber: "ABC 1234",
      ratingAverage: 4.7,
      ratingCount: 31,
    });
    expect(text.includes("position")).toBe(false);
    // مفاتيحُ JSON بأقواسِها: «lat» عارياً يقعُ داخلَ «plateNumber»، فيُقاسُ
    // المفتاحُ لا الحرفُ — وإلّا كانَ القياسُ يفشلُ لسببٍ ليسَ هوَ المقصودَ.
    expect(text.includes('"lat"')).toBe(false);
    expect(text.includes('"lng"')).toBe(false);
  });

  it("العَدَمُ يُنشَرُ عَدَماً بسببِه المُصنَّفِ **لا صفراً**", async () => {
    const harness = buildHarness({
      state: state({ startedAtMs: null, durationSeconds: null, straightLineMeters: null }),
    });
    const { json } = await get(harness, `/v1/rides/${ORDER_ID}/summary`, authed());
    expect(json.startedAt).toBeNull();
    expect(json.duration).toEqual({ known: false, reason: "MISSING_STAMP" });
    expect(json.straightLine).toEqual({ known: false, reason: "NO_DROPOFF" });
  });

  it("رحلةٌ لم تنتهِ ⇒ أهليّةٌ مُصنَّفةٌ ولا نموذجَ يُرسَمُ", async () => {
    const harness = buildHarness({
      state: state({
        status: "in_progress",
        rating: { alreadyRated: false, windowHours: 48, windowClosed: false, canRate: false },
      }),
    });
    const { json } = await get(harness, `/v1/rides/${ORDER_ID}/summary`, authed());
    expect((json.rating as Record<string, unknown>).eligibility).toBe("RIDE_NOT_COMPLETED");
    expect((json.rating as Record<string, unknown>).canRate).toBe(false);
  });
});

describe("ملخَّصُ الرحلةِ — الرفضُ والعطبُ", () => {
  it("«لا طلبَ» رفضٌ منشورٌ `200` — والملكيّةُ قيدُ استعلامٍ في القاعدةِ", async () => {
    const { status, json } = await get(
      buildHarness({ refusal: "ORDER_NOT_FOUND" }),
      `/v1/rides/${ORDER_ID}/summary`,
      authed(),
    );
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, found: false, refusal: "ORDER_NOT_FOUND" });
  });

  it("بلا جلسةٍ `401`، وبلا مخزنٍ `503`، وبلا حسابٍ `404`", async () => {
    const anonymous = await get(buildHarness(), `/v1/rides/${ORDER_ID}/summary`);
    expect(anonymous.status).toBe(401);
    expect(anonymous.json.error).toBe("SESSION_REQUIRED");

    const unmounted = await get(
      buildHarness({ mounted: false }),
      `/v1/rides/${ORDER_ID}/summary`,
      authed(),
    );
    expect(unmounted.status).toBe(503);

    const missing = await get(
      buildHarness({ failure: "USER_NOT_FOUND" }),
      `/v1/rides/${ORDER_ID}/summary`,
      authed(),
    );
    expect(missing.status).toBe(404);
    expect(missing.json.error).toBe("ACCOUNT_NOT_FOUND");
  });

  it("عطبُ المخزنِ `503` **ولا يُنشَرُ ملخَّصٌ فارغٌ** `200`", async () => {
    const { status, json } = await get(
      buildHarness({ failure: "STORE_ERROR" }),
      `/v1/rides/${ORDER_ID}/summary`,
      authed(),
    );
    expect(status).toBe(503);
    expect(json.ok).toBe(false);
  });
});

describe("التقييمُ — القبولُ", () => {
  it("النجومُ والوسومُ والملاحظةُ تُمرَّرُ كما وردَت، والقبولُ يُنشَرُ بمعرِّفِه", async () => {
    const harness = buildHarness();
    const { status, json } = await post(
      harness,
      `/v1/rides/${ORDER_ID}/rating`,
      { stars: 5, comment: "شكراً", tags: ["cleanliness", "punctuality"] },
      authed(),
    );
    expect(status).toBe(200);
    expect(json).toEqual({
      ok: true,
      accepted: true,
      ratingId: RATING_ID,
      stars: 5,
      tags: ["cleanliness", "punctuality"],
    });
    expect(harness.seen.submits).toHaveLength(1);
    expect(harness.seen.submits[0]?.telegramUserId).toBe(TELEGRAM_ID);
    expect(harness.seen.submits[0]?.orderId).toBe(ORDER_ID);
    expect(harness.seen.submits[0]?.tags).toEqual(["cleanliness", "punctuality"]);
  });

  it("تقييمٌ بلا وسومٍ ولا ملاحظةٍ مقبولٌ — الوسومُ زيادةُ بيانٍ لا شرطُ صحّةٍ", async () => {
    const harness = buildHarness();
    const { status, json } = await post(
      harness,
      `/v1/rides/${ORDER_ID}/rating`,
      { stars: 4 },
      authed(),
    );
    expect(status).toBe(200);
    expect(json.accepted).toBe(true);
    expect(harness.seen.submits[0]?.tags).toEqual([]);
    expect(harness.seen.submits[0]?.comment).toBeNull();
  });

  it("**ولا ترويسةَ مفتاحِ تكرارٍ تُطلَبُ**: القيدُ الفريدُ هوَ الحاجزُ", async () => {
    const { status } = await post(
      buildHarness(),
      `/v1/rides/${ORDER_ID}/rating`,
      { stars: 3 },
      authed(),
    );
    expect(status).toBe(200);
  });
});

describe("التقييمُ — الرفضُ حكماً `200` والعطبُ طلباً `4xx`", () => {
  it("رفضُ القاعدةِ يُنشَرُ `200` بـ`accepted:false` وسببِه", async () => {
    for (const refusal of [
      "ALREADY_RATED",
      "RATING_WINDOW_CLOSED",
      "ORDER_NOT_COMPLETED",
      "RATER_NOT_PARTY_TO_ORDER",
    ] as const) {
      const { status, json } = await post(
        buildHarness({ ratingRefusal: refusal }),
        `/v1/rides/${ORDER_ID}/rating`,
        { stars: 5 },
        authed(),
      );
      expect(status).toBe(200);
      expect(json).toEqual({ ok: true, accepted: false, refusal });
    }
  });

  it("عطبُ الطلبِ `400` **ولا يبلغُ المخزنَ أصلاً**", async () => {
    const cases: { body: unknown; error: string }[] = [
      { body: { stars: 0 }, error: "STARS_OUT_OF_RANGE" },
      { body: { stars: 6 }, error: "STARS_OUT_OF_RANGE" },
      { body: { stars: 4.5 }, error: "STARS_OUT_OF_RANGE" },
      { body: { stars: "5" }, error: "STARS_OUT_OF_RANGE" },
      { body: {}, error: "STARS_OUT_OF_RANGE" },
      { body: { stars: 5, comment: "م".repeat(1001) }, error: "COMMENT_TOO_LONG" },
      { body: { stars: 5, comment: 7 }, error: "MALFORMED" },
      { body: { stars: 5, tags: ["friendly"] }, error: "UNKNOWN_RATING_TAG" },
      {
        body: { stars: 5, tags: ["cleanliness", "politeness", "punctuality", "driving_safety"] },
        error: "TOO_MANY_RATING_TAGS",
      },
      { body: { stars: 5, tags: ["cleanliness", "cleanliness"] }, error: "DUPLICATE_RATING_TAG" },
      { body: { stars: 5, tags: "cleanliness" }, error: "UNKNOWN_RATING_TAG" },
    ];
    for (const item of cases) {
      const harness = buildHarness();
      const { status, json } = await post(
        harness,
        `/v1/rides/${ORDER_ID}/rating`,
        item.body,
        authed(),
      );
      expect(status).toBe(400);
      expect(json.error).toBe(item.error);
      expect(harness.seen.submits).toHaveLength(0);
    }
  });

  it("جسمٌ ليسَ كائناً أو ليسَ JSON عطبُ طلبٍ لا عطبُ خادمٍ", async () => {
    const broken = await post(buildHarness(), `/v1/rides/${ORDER_ID}/rating`, "{", authed());
    expect(broken.status).toBe(400);
    expect(broken.json.error).toBe("INVALID_JSON");

    const listed = await post(buildHarness(), `/v1/rides/${ORDER_ID}/rating`, [5], authed());
    expect(listed.status).toBe(400);
    expect(listed.json.error).toBe("MALFORMED");
  });

  it("جسمٌ فوقَ الحدِّ `413` ولا يُقرأُ كلُّه", async () => {
    const { status, json } = await post(
      buildHarness(),
      `/v1/rides/${ORDER_ID}/rating`,
      { stars: 5, comment: "م".repeat(9000) },
      authed(),
    );
    expect(status).toBe(413);
    expect(json.error).toBe("PAYLOAD_TOO_LARGE");
  });

  it("بلا جلسةٍ `401`، وبلا مخزنٍ `503`، وعطبُ مخزنٍ `503`", async () => {
    const anonymous = await post(buildHarness(), `/v1/rides/${ORDER_ID}/rating`, { stars: 5 });
    expect(anonymous.status).toBe(401);

    const unmounted = await post(
      buildHarness({ mounted: false }),
      `/v1/rides/${ORDER_ID}/rating`,
      { stars: 5 },
      authed(),
    );
    expect(unmounted.status).toBe(503);

    const broken = await post(
      buildHarness({ ratingFailure: "STORE_ERROR" }),
      `/v1/rides/${ORDER_ID}/rating`,
      { stars: 5 },
      authed(),
    );
    expect(broken.status).toBe(503);
    expect(broken.json.ok).toBe(false);
  });
});
