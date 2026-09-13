/**
 * الغرض: قياسُ مساراتِ الرحلةِ على خادمِ البوابةِ الحقيقيِّ نفسِه (`F2-05`):
 *   أنَّ ترويسةَ `Idempotency-Key` **إلزاميّةٌ** ولا يختلقُها الخادمُ
 *   (`ARCH-006`)، وأنَّ المفتاحَ يُسافِرُ إلى الأمرِ حرفاً، وأنَّ الرفضَ المشروعَ
 *   `200` بـ`accepted:false` والعطبَ برمزِه ورقمِه، وأنَّ `reused` يُنشَرُ
 *   للعميلِ، وأنَّ الهويّةَ **لا تُقرأُ من الجسمِ**، وأنَّ حالةَ البحثِ تُنشرُ
 *   العددَ صفراً كما هوَ (`ADR 0023`) والطورَ مشتقّاً لا مُختلَقاً، وأنَّ رحلةً
 *   ليستْ لصاحبِ الجلسةِ تُقالُ «غيرُ موجودةٍ» لا «ممنوعةٌ» كي لا يصيرَ المسارُ
 *   عدَّادَ معرّفاتٍ.
 * الحالة: اختبار فعلي — Hono يعالجُ الطلبَ في العمليةِ نفسِها بلا شبكةٍ ولا قاعدةٍ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI
 * يُتوقع أن يستخدمه لاحقاً: `F2-06` يُضيفُ مسارَ الرحلةِ النشطةِ بالعُرفِ نفسِه.
 * ملاحظات مستقبلية: الحاكمُ ههنا مُصنَّعٌ عن قصدٍ — المُتحقَّقُ منه **الناقلُ
 *   والترجمةُ** لا صدقُ الحكمِ؛ وصدقُ الحكمِ يُقاسُ على PostgreSQL حقيقيٍّ في
 *   `tests/integration/ride-request.test.ts` بسباقٍ فعليٍّ.
 *
 * وما لا يفعلُه: لا يزعمُ أنَّ راكباً طلبَ رحلةً من جهازٍ — لا نشرَ حيَّ
 * (`ADR 0099`)، وبوّابةُ `F2` غيرُ مُدَّعاةٍ.
 */

import { describe, expect, it } from "bun:test";
import { createServer } from "../../apps/gateway/src/server.ts";
import type {
  RideCancelCommand,
  RideCancelVerdict,
  RideRequestCommand,
  RideRequestRefusal,
  RideRequestVerdict,
  RideSearchReader,
  RideSearchState,
  RideStoreFailureReason,
} from "../../packages/application/transport/ride-request-ports.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const SESSION_SECRET = "test-only-session-signing-secret-0123456789";
const WEBHOOK_SECRET = "test-webhook-secret-value";
const NOW = new Date("2027-03-01T09:00:00.000Z");
const TELEGRAM_ID = "5550001";
const ORDER_ID = "3f1c9a02-4b7e-4d21-9f88-0a1b2c3d4e5f";
const KEY = "ride:6f2a1c48-8b0e-4e65-9d8a-2b1c3d4e5f60";

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

/** أُنشِئَت قبلَ القراءةِ بتسعينَ ثانيةً، وأُخطِرَ سائقانِ. */
const SEARCHING: RideSearchState = {
  orderId: ORDER_ID,
  status: "searching",
  service: "transport",
  broadcastRound: 1,
  createdAtMs: NOW.getTime() - 90_000,
  notifiedDriverCount: 2,
  cancellableWithoutPenalty: true,
};

const CREATED: RideRequestVerdict = {
  accepted: true,
  ride: { orderId: ORDER_ID, createdAtMs: NOW.getTime(), reused: false },
};

interface Seen {
  readonly creates: {
    telegramUserId: string;
    idempotencyKey: string;
    service: string;
    notes: string | null;
  }[];
  readonly reads: { telegramUserId: string; orderId: string }[];
  readonly cancels: { telegramUserId: string; orderId: string }[];
}

interface Harness {
  readonly app: ReturnType<typeof createServer>;
  readonly seen: Seen;
}

function buildHarness(
  options: {
    readonly verdict?: RideRequestVerdict;
    readonly refusal?: RideRequestRefusal;
    readonly activeRide?: { readonly orderId: string; readonly status: "searching" };
    readonly failure?: RideStoreFailureReason;
    readonly state?: RideSearchState;
    readonly searchRefusal?: "INVALID_ORDER_ID" | "ORDER_NOT_FOUND";
    readonly cancelVerdict?: RideCancelVerdict;
    readonly mounted?: boolean;
    readonly configured?: boolean;
  } = {},
): Harness {
  const seen: Seen = { creates: [], reads: [], cancels: [] };

  const rides: RideRequestCommand = {
    create: async (input) => {
      seen.creates.push({
        telegramUserId: input.telegramUserId,
        idempotencyKey: input.idempotencyKey,
        service: input.service,
        notes: input.notes,
      });
      if (options.failure !== undefined) return err({ reason: options.failure });
      if (options.refusal !== undefined) {
        return ok({
          accepted: false,
          refusal: options.refusal,
          activeRide: options.activeRide ?? null,
        });
      }
      return ok(options.verdict ?? CREATED);
    },
  };

  const search: RideSearchReader = {
    read: async (input) => {
      seen.reads.push({ telegramUserId: input.telegramUserId, orderId: input.orderId });
      if (options.failure !== undefined) return err({ reason: options.failure });
      if (options.searchRefusal !== undefined) {
        return ok({ found: false, refusal: options.searchRefusal });
      }
      return ok({ found: true, state: options.state ?? SEARCHING });
    },
  };

  const canceller: RideCancelCommand = {
    cancel: async (input) => {
      seen.cancels.push({ telegramUserId: input.telegramUserId, orderId: input.orderId });
      if (options.failure !== undefined) return err({ reason: options.failure });
      return ok(options.cancelVerdict ?? { cancelled: true });
    },
  };

  const sessions = createMiniAppSessionReader(SESSION_SECRET);
  const now = () => NOW;
  const configured = options.configured !== false;
  const mounted = {
    ...(configured ? { request: { sessions, rides, now } } : {}),
    ...(configured ? { search: { sessions, search, now } } : {}),
    ...(configured ? { cancel: { sessions, canceller, now } } : {}),
  };

  const app = createServer({
    health: { now, startedAt: NOW, env: FULL_ENV },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    ...(options.mounted === false ? {} : { rides: mounted }),
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

function authed(token: string = tokenFor()): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

const RIDE_BODY = {
  originLat: 21.5,
  originLng: 39.15,
  destinationLat: 21.55,
  destinationLng: 39.2,
  service: "transport",
};

async function post(
  harness: Harness,
  path: string,
  init: {
    readonly headers?: Record<string, string>;
    readonly body?: unknown;
    readonly rawBody?: string;
  } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await harness.app.fetch(
    new Request(`http://localhost${path}`, {
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
  return { status: response.status, json: JSON.parse(text) as Record<string, unknown> };
}

async function get(
  harness: Harness,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await harness.app.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "application/json", ...headers } }),
  );
  const text = await response.text();
  return { status: response.status, json: JSON.parse(text) as Record<string, unknown> };
}

function withKey(key: string = KEY): Record<string, string> {
  return { ...authed(), "idempotency-key": key };
}

describe("POST /v1/rides — الإنشاءُ المقبولُ", () => {
  it("يُعيدُ معرّفاً وختماً و`reused: false`، ولا يُعيدُ حقلاً ماليّاً", async () => {
    const harness = buildHarness();
    const { status, json } = await post(harness, "/v1/rides", { headers: withKey() });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.accepted).toBe(true);
    expect(json.orderId).toBe(ORDER_ID);
    expect(json.createdAt).toBe(NOW.toISOString());
    expect(json.reused).toBe(false);
    for (const forbidden of ["fare", "price", "payment", "amount", "currency"]) {
      expect(Object.hasOwn(json, forbidden)).toBe(false);
    }
  });

  it("المفتاحُ يُسافِرُ من الترويسةِ إلى الأمرِ حرفاً — لا من الجسمِ", async () => {
    const harness = buildHarness();
    await post(harness, "/v1/rides", {
      headers: withKey(),
      body: { ...RIDE_BODY, idempotencyKey: "ride:from-body-must-be-ignored" },
    });
    expect(harness.seen.creates.length).toBe(1);
    expect(harness.seen.creates[0]?.idempotencyKey).toBe(KEY);
  });

  it("الهويّةُ من الرمزِ الموقَّعِ لا من الجسمِ: تمريرُ معرّفٍ آخرَ لا يُغيِّرُ شيئاً", async () => {
    const harness = buildHarness();
    await post(harness, "/v1/rides", {
      headers: withKey(),
      body: { ...RIDE_BODY, telegramUserId: "9999999" },
    });
    expect(harness.seen.creates[0]?.telegramUserId).toBe(TELEGRAM_ID);
  });

  it("`reused: true` يُنشَرُ كما هوَ: الضغطةُ الثانيةُ لم تُنشئْ رحلةً ثانيةً", async () => {
    const harness = buildHarness({
      verdict: {
        accepted: true,
        ride: { orderId: ORDER_ID, createdAtMs: NOW.getTime() - 5_000, reused: true },
      },
    });
    const { json } = await post(harness, "/v1/rides", { headers: withKey() });
    expect(json.reused).toBe(true);
    expect(json.orderId).toBe(ORDER_ID);
  });

  it("الملاحظةُ تُشذَّبُ، والفراغُ يُمرَّرُ `null` لا نصّاً فارغاً (`SR-04`)", async () => {
    const harness = buildHarness();
    await post(harness, "/v1/rides", {
      headers: withKey(),
      body: { ...RIDE_BODY, notes: "  البوّابةُ الشماليّةُ  " },
    });
    expect(harness.seen.creates[0]?.notes).toBe("البوّابةُ الشماليّةُ");
    const empty = buildHarness();
    await post(empty, "/v1/rides", { headers: withKey(), body: { ...RIDE_BODY, notes: "   " } });
    expect(empty.seen.creates[0]?.notes).toBe(null);
  });
});

describe("POST /v1/rides — المفتاحُ إلزاميٌّ ولا يُختلَقُ", () => {
  it("غيابُ الترويسةِ `400` برمزٍ مُعلَنٍ، ولا يُنادى الأمرُ ألبتّةَ", async () => {
    const harness = buildHarness();
    const { status, json } = await post(harness, "/v1/rides", { headers: authed() });
    expect(status).toBe(400);
    expect(json.error).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(harness.seen.creates.length).toBe(0);
  });

  it("مفتاحٌ مشوَّهٌ أو قصيرٌ `400` برمزٍ يفصلُ الشكلَ عن الغيابِ", async () => {
    const harness = buildHarness();
    expect((await post(harness, "/v1/rides", { headers: withKey("short") })).json.error).toBe(
      "IDEMPOTENCY_KEY_INVALID",
    );
    // مسافةٌ **داخلَ** القيمةِ لا ينزعُها النقلُ، والنطاقُ يرفضُها شكلاً.
    expect(
      (await post(harness, "/v1/rides", { headers: withKey("ride:6f2a1c48 8b0e4e65") })).json.error,
    ).toBe("IDEMPOTENCY_KEY_INVALID");
    expect(
      (await post(harness, "/v1/rides", { headers: withKey(`ride:${"9".repeat(240)}`) })).json
        .error,
    ).toBe("IDEMPOTENCY_KEY_INVALID");
    expect(harness.seen.creates.length).toBe(0);
  });

  /**
   * وما لا يُدَّعى: فراغٌ في **طرفَي** قيمةِ الترويسةِ ينزعُه النقلُ
   * نفسُه (RFC 9110 §5.5) قبلَ أن يبلُغَ التطبيقَ، فلا يقدرُ التطبيقُ على رفضِه
   * ولا يُدَّعى أنَّه يفعلُ. ومنعُ الشذبِ في `readIdempotencyKey` يحرسُ
   * **المناديينَ الآخرينَ** (حوارُ البوتِ، وعامِلٌ، وأيُّ ناقلٍ لا يشذِبُ).
   */
  it("فراغُ الطرفَينِ ينزعُه النقلُ: فيُقبَلُ المفتاحُ مشذوباً ويُمرَّرُ كما وصلَ", async () => {
    const harness = buildHarness();
    const { status } = await post(harness, "/v1/rides", { headers: withKey(`  ${KEY}  `) });
    expect(status).toBe(200);
    expect(harness.seen.creates[0]?.idempotencyKey).toBe(KEY);
  });
});

describe("POST /v1/rides — الرفضُ المشروعُ `200`", () => {
  it("خارجَ منطقةِ الخدمةِ جوابٌ صحيحٌ لا عطبٌ، ويُفصَلُ المبدأُ عن المقصدِ", async () => {
    for (const refusal of [
      "ORIGIN_OUTSIDE_SERVICE_AREA",
      "DESTINATION_OUTSIDE_SERVICE_AREA",
    ] as const) {
      const harness = buildHarness({ refusal });
      const { status, json } = await post(harness, "/v1/rides", { headers: withKey() });
      expect(status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.accepted).toBe(false);
      expect(json.refusal).toBe(refusal);
    }
  });

  it("«لديكَ رحلةٌ قائمةٌ» يُنشَرُ معَ طريقِ الخروجِ: رفضٌ بلا طريقٍ شاشةٌ مسدودةٌ", async () => {
    const harness = buildHarness({
      refusal: "ACTIVE_RIDE_EXISTS",
      activeRide: { orderId: ORDER_ID, status: "searching" },
    });
    const { status, json } = await post(harness, "/v1/rides", { headers: withKey() });
    expect(status).toBe(200);
    expect(json.refusal).toBe("ACTIVE_RIDE_EXISTS");
    expect(json.activeRide).toEqual({ orderId: ORDER_ID, status: "searching" });
  });
});

describe("POST /v1/rides — العطبُ برمزِه ورقمِه", () => {
  it("بلا رمزٍ موقَّعٍ `401`، وبرمزٍ مُختلَقٍ `401` — ولا يُنادى الأمرُ", async () => {
    const harness = buildHarness();
    expect((await post(harness, "/v1/rides", { headers: { "idempotency-key": KEY } })).status).toBe(
      401,
    );
    const forged = await post(harness, "/v1/rides", {
      headers: { authorization: "Bearer forged.token.value", "idempotency-key": KEY },
    });
    expect(forged.status).toBe(401);
    expect(harness.seen.creates.length).toBe(0);
  });

  it("جسمٌ غيرُ JSON `400`، وإحداثيّةٌ ناقصةٌ `MALFORMED`، وخدمةٌ مجهولةٌ رمزُها", async () => {
    const harness = buildHarness();
    expect(
      (await post(harness, "/v1/rides", { headers: withKey(), rawBody: "{ليسَ JSON" })).json.error,
    ).toBe("INVALID_JSON");
    expect(
      (
        await post(harness, "/v1/rides", {
          headers: withKey(),
          body: { originLat: 21.5, service: "transport" },
        })
      ).json.error,
    ).toBe("MALFORMED");
    expect(
      (
        await post(harness, "/v1/rides", {
          headers: withKey(),
          body: { ...RIDE_BODY, service: "jet" },
        })
      ).json.error,
    ).toBe("UNKNOWN_SERVICE");
  });

  it("ملاحظةٌ أطولُ من الحدِّ `400` برمزِها لا `500`", async () => {
    const harness = buildHarness();
    const { status, json } = await post(harness, "/v1/rides", {
      headers: withKey(),
      body: { ...RIDE_BODY, notes: "م".repeat(281) },
    });
    expect(status).toBe(400);
    expect(json.error).toBe("NOTES_TOO_LONG");
  });

  it("حسابٌ غائبٌ `404` ولا يُنشَأُ صفٌّ ضمناً (`ADR 0035`)", async () => {
    expect(
      (
        await post(buildHarness({ failure: "USER_NOT_FOUND" }), "/v1/rides", {
          headers: withKey(),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await post(buildHarness({ failure: "RIDER_NOT_REGISTERED" }), "/v1/rides", {
          headers: withKey(),
        })
      ).json.error,
    ).toBe("RIDER_NOT_REGISTERED");
  });

  it("عطبُ مخزنٍ `503` مُعلَنٌ — لا `200` بجسمٍ فارغٍ يُقرأُ نجاحاً", async () => {
    const failed = await post(buildHarness({ failure: "STORE_ERROR" }), "/v1/rides", {
      headers: withKey(),
    });
    expect(failed.status).toBe(503);
    expect(failed.json.error).toBe("RIDE_STORE_NOT_AVAILABLE");
    const unconfigured = await post(buildHarness({ configured: false }), "/v1/rides", {
      headers: withKey(),
    });
    expect(unconfigured.status).toBe(503);
  });

  it("حمولةٌ فوقَ الحدِّ `413` — حدُّ نقلٍ لا قيمةُ منتَجٍ", async () => {
    const harness = buildHarness();
    const { status, json } = await post(harness, "/v1/rides", {
      headers: withKey(),
      rawBody: JSON.stringify({ ...RIDE_BODY, notes: "م".repeat(4_000) }),
    });
    expect(status).toBe(413);
    expect(json.error).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("GET /v1/rides/:id/search — حالةٌ صادقةٌ", () => {
  it("تُنشَرُ الحالةُ والطورُ والمدّةُ والعددُ، والمدّةُ مقيسةٌ من ختمِ الإنشاءِ", async () => {
    const harness = buildHarness();
    const { status, json } = await get(harness, `/v1/rides/${ORDER_ID}/search`, authed());
    expect(status).toBe(200);
    expect(json.found).toBe(true);
    expect(json.status).toBe("searching");
    expect(json.phase).toBe("announced");
    expect(json.notifiedDriverCount).toBe(2);
    expect(json.elapsedSeconds).toBe(90);
    expect(json.cancellableWithoutPenalty).toBe(true);
    expect(json.createdAt).toBe(new Date(SEARCHING.createdAtMs).toISOString());
  });

  it("الصفرُ يُنشَرُ صفراً والطورُ «silent»: الصمتُ ليسَ رفضاً (`ADR 0023`)", async () => {
    const harness = buildHarness({ state: { ...SEARCHING, notifiedDriverCount: 0 } });
    const { json } = await get(harness, `/v1/rides/${ORDER_ID}/search`, authed());
    expect(json.notifiedDriverCount).toBe(0);
    expect(json.phase).toBe("silent");
  });

  it("بعدَ الإسنادِ «assigned» والإلغاءُ بلا عقوبةٍ يُغلَقُ", async () => {
    const harness = buildHarness({
      state: { ...SEARCHING, status: "matched", cancellableWithoutPenalty: false },
    });
    const { json } = await get(harness, `/v1/rides/${ORDER_ID}/search`, authed());
    expect(json.phase).toBe("assigned");
    expect(json.cancellableWithoutPenalty).toBe(false);
  });

  it("رحلةٌ ليستْ لصاحبِ الجلسةِ تُقالُ «غيرُ موجودةٍ» لا «ممنوعةٌ»", async () => {
    const harness = buildHarness({ searchRefusal: "ORDER_NOT_FOUND" });
    const { status, json } = await get(harness, `/v1/rides/${ORDER_ID}/search`, authed());
    expect(status).toBe(200);
    expect(json.found).toBe(false);
    expect(json.refusal).toBe("ORDER_NOT_FOUND");
  });

  it("القراءةُ تُرسِلُ هويّةَ الجلسةِ والمعرّفَ من المسارِ", async () => {
    const harness = buildHarness();
    await get(harness, `/v1/rides/${ORDER_ID}/search`, authed());
    expect(harness.seen.reads).toEqual([{ telegramUserId: TELEGRAM_ID, orderId: ORDER_ID }]);
  });

  it("القراءةُ لا تُشترَطُ فيها ترويسةُ المفتاحِ: القراءةُ لا تُنشئُ شيئاً", async () => {
    const harness = buildHarness();
    expect((await get(harness, `/v1/rides/${ORDER_ID}/search`, authed())).status).toBe(200);
  });

  it("بلا جلسةٍ `401`، وبلا تركيبٍ `503`", async () => {
    expect((await get(buildHarness(), `/v1/rides/${ORDER_ID}/search`)).status).toBe(401);
    const off = await get(
      buildHarness({ configured: false }),
      `/v1/rides/${ORDER_ID}/search`,
      authed(),
    );
    expect(off.status).toBe(503);
  });
});

describe("POST /v1/rides/:id/cancel — إلغاءٌ مُعرَّفٌ بمفتاحِه", () => {
  it("الإلغاءُ الناجحُ يُعلَنُ بلا حقلٍ ماليٍّ ولا عقوبةٍ", async () => {
    const harness = buildHarness();
    const { status, json } = await post(harness, `/v1/rides/${ORDER_ID}/cancel`, {
      headers: withKey(),
      rawBody: "{}",
    });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, cancelled: true });
    expect(harness.seen.cancels).toEqual([{ telegramUserId: TELEGRAM_ID, orderId: ORDER_ID }]);
  });

  it("«فاتَ أوانُ الإلغاءِ» مفصولٌ عن «غيرُ موجودةٍ» — والفرقُ فعلٌ مختلفٌ", async () => {
    const late = buildHarness({
      cancelVerdict: { cancelled: false, refusal: "ORDER_NOT_CANCELLABLE" },
    });
    const lateResponse = await post(late, `/v1/rides/${ORDER_ID}/cancel`, {
      headers: withKey(),
      rawBody: "{}",
    });
    expect(lateResponse.status).toBe(200);
    expect(lateResponse.json.refusal).toBe("ORDER_NOT_CANCELLABLE");

    const absent = buildHarness({
      cancelVerdict: { cancelled: false, refusal: "ORDER_NOT_FOUND" },
    });
    const absentResponse = await post(absent, `/v1/rides/${ORDER_ID}/cancel`, {
      headers: withKey(),
      rawBody: "{}",
    });
    expect(absentResponse.json.refusal).toBe("ORDER_NOT_FOUND");
  });

  it("الإلغاءُ أمرٌ فيلزَمُه مفتاحٌ: غيابُه `400` ولا يُنادى الأمرُ", async () => {
    const harness = buildHarness();
    const { status, json } = await post(harness, `/v1/rides/${ORDER_ID}/cancel`, {
      headers: authed(),
      rawBody: "{}",
    });
    expect(status).toBe(400);
    expect(json.error).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(harness.seen.cancels.length).toBe(0);
  });

  it("بلا جلسةٍ `401`، وبلا تركيبٍ `503`", async () => {
    expect(
      (
        await post(buildHarness(), `/v1/rides/${ORDER_ID}/cancel`, {
          headers: { "idempotency-key": KEY },
          rawBody: "{}",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await post(buildHarness({ configured: false }), `/v1/rides/${ORDER_ID}/cancel`, {
          headers: withKey(),
          rawBody: "{}",
        })
      ).status,
    ).toBe(503);
  });
});

describe("التركيبُ الاختياريُّ — المساراتُ غائبةٌ حينَ لا تُركَّبُ", () => {
  it("بلا تركيبٍ ألبتّةَ يُعيدُ الخادمُ `404` لا `503`: المسارُ غيرُ موجودٍ", async () => {
    const harness = buildHarness({ mounted: false });
    expect((await post(harness, "/v1/rides", { headers: withKey() })).status).toBe(404);
    expect((await get(harness, `/v1/rides/${ORDER_ID}/search`, authed())).status).toBe(404);
  });
});
