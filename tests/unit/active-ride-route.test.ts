/**
 * الغرض: قياسُ مسارِ `GET /v1/rides/:id` — الحمولةُ المنشورةُ، وحجبُ الموقعِ
 *   **في السلكِ**، والرفضُ `200` والعطبُ `4xx/5xx`، وغيابُ المالِ ومساراتِ
 *   `F2-09`/`F2-10` (البند `F2-06` · `SR-06`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-06`.
 * ينتمي إلى: tests/unit
 *
 * ولماذا يُقاسُ الحجبُ بفحصِ **غيابِ الحقلِ** لا بفحصِ `show:false` وحدَه: عميلٌ
 * يقرأُ `lat` ولا يقرأُ `show` يرسمُ نقطةً ميتةً. فالمقيسُ ههنا أنَّ الإحداثيّةَ
 * **لا تُغادرُ الخادمَ** متى حُجِبَت — لا أنَّ العميلَ مؤتمَنٌ.
 */

import { describe, expect, it } from "bun:test";
import { createServer } from "../../apps/gateway/src/server.ts";
import type {
  ActiveRideReader,
  ActiveRideState,
} from "../../packages/application/transport/active-ride-ports.ts";
import type { RideStoreFailureReason } from "../../packages/application/transport/ride-request-ports.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { RoutingError, type RoutingProvider } from "../../packages/maps/core/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const SESSION_SECRET = "test-only-session-signing-secret-0123456789";
const WEBHOOK_SECRET = "test-webhook-secret-value";
const NOW = new Date("2027-03-01T09:05:00.000Z");
const TELEGRAM_ID = "5550001";
const ORDER_ID = "3f1c9a02-4b7e-4d21-9f88-0a1b2c3d4e5f";

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

function state(over: Partial<ActiveRideState> = {}): ActiveRideState {
  return {
    orderId: ORDER_ID,
    status: "matched",
    service: "transport",
    pickup: { lat: 21.4858, lng: 39.1925, label: "البلد" },
    dropoff: { lat: 21.5591, lng: 39.1553, label: null },
    createdAtMs: NOW.getTime() - 300_000,
    matchedAtMs: NOW.getTime() - 240_000,
    startedAtMs: null,
    completedAtMs: null,
    arrivedAtMs: null,
    driver: {
      firstName: "خالد",
      vehicleType: "سيدان",
      plateNumber: "ABC 1234",
      ratingAverage: 4.7,
      ratingCount: 31,
      position: { lat: 21.49, lng: 39.19, ageSeconds: 6 },
    },
    ...over,
  };
}

function routingProvider(
  reply: () => Awaited<ReturnType<RoutingProvider["route"]>>,
): RoutingProvider {
  return {
    name: "fake",
    route: async () => reply(),
    table: async () => err(new RoutingError("osrm", "لا يُستخدَم", "protocol")),
    nearest: async () => err(new RoutingError("osrm", "لا يُستخدَم", "protocol")),
  } as unknown as RoutingProvider;
}

const ROUTED = () =>
  ok({
    distanceMeters: 4210.5,
    durationSeconds: 420,
    geometry: { points: [] },
    snap: { known: true as const, originMeters: 6, destinationMeters: 6 },
  }) as Awaited<ReturnType<RoutingProvider["route"]>>;

interface Seen {
  readonly reads: { telegramUserId: string; orderId: string }[];
}

function buildHarness(
  options: {
    readonly state?: ActiveRideState;
    readonly refusal?: "INVALID_ORDER_ID" | "ORDER_NOT_FOUND";
    readonly failure?: RideStoreFailureReason;
    readonly routing?: RoutingProvider | null;
    readonly mounted?: boolean;
  } = {},
): { app: ReturnType<typeof createServer>; seen: Seen } {
  const seen: Seen = { reads: [] };
  const rides: ActiveRideReader = {
    read: async (input) => {
      seen.reads.push({ telegramUserId: input.telegramUserId, orderId: input.orderId });
      if (options.failure !== undefined) return err({ reason: options.failure });
      if (options.refusal !== undefined) return ok({ found: false, refusal: options.refusal });
      return ok({ found: true, state: options.state ?? state() });
    },
  };

  const sessions = createMiniAppSessionReader(SESSION_SECRET);
  const active = {
    sessions,
    rides,
    now: () => NOW,
    routing: {
      routing: options.routing === undefined ? routingProvider(ROUTED) : options.routing,
    },
  };

  const app = createServer({
    health: { now: () => NOW, startedAt: NOW, env: FULL_ENV },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    ...(options.mounted === false ? { rides: {} } : { rides: { active } }),
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

async function get(
  harness: { app: ReturnType<typeof createServer> },
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await harness.app.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "application/json", ...headers } }),
  );
  const text = await response.text();
  return { status: response.status, json: JSON.parse(text) as Record<string, unknown> };
}

function authed(): Record<string, string> {
  return { authorization: `Bearer ${tokenFor()}` };
}

describe("لقطةُ الرحلةِ النشطةِ — الحمولةُ", () => {
  it("تُنشَرُ الحالةُ والطَّورُ والأختامُ والمدّةُ المنقضيةُ", async () => {
    const harness = buildHarness();
    const { status, json } = await get(harness, `/v1/rides/${ORDER_ID}`, authed());
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.found).toBe(true);
    expect(json.orderId).toBe(ORDER_ID);
    expect(json.status).toBe("matched");
    expect(json.phase).toBe("driver_assigned");
    expect(json.createdAt).toBe(new Date(NOW.getTime() - 300_000).toISOString());
    expect(json.matchedAt).toBe(new Date(NOW.getTime() - 240_000).toISOString());
    expect(json.startedAt).toBeNull();
    expect(json.completedAt).toBeNull();
    expect(json.elapsedSeconds).toBe(300);
    expect(json.cancelPolicy).toBe("AFTER_ASSIGNMENT_UNDECIDED");
    expect(harness.seen.reads).toEqual([{ telegramUserId: TELEGRAM_ID, orderId: ORDER_ID }]);
  });

  it("بطاقةُ السائقِ تُنشَرُ بلا هاتفٍ ولا صورةٍ ولا باركودٍ", async () => {
    const { json } = await get(buildHarness(), `/v1/rides/${ORDER_ID}`, authed());
    expect(json.driver).toEqual({
      firstName: "خالد",
      vehicleType: "سيدان",
      plateNumber: "ABC 1234",
      ratingAverage: 4.7,
      ratingCount: 31,
    });
  });

  it("لا حقلَ مالٍ ولا مشاركةٍ ولا طوارئَ في الردِّ — وعدٌ لا عقدٌ", async () => {
    const { json } = await get(buildHarness(), `/v1/rides/${ORDER_ID}`, authed());
    const wire = JSON.stringify(json).toLowerCase();
    for (const token of [
      "fare",
      "price",
      "amount",
      "currency",
      "penalty",
      "payment",
      "share",
      "sos",
      "emergency",
      "phone",
      "tel:",
      "barcode",
      "photo",
    ]) {
      expect(wire.includes(token)).toBe(false);
    }
  });

  it("سائقٌ غائبٌ يُنشَرُ عَدَماً، ولا موقعَ معهُ، ولا مدّةَ وصولٍ", async () => {
    const { json } = await get(
      buildHarness({ state: state({ driver: null }) }),
      `/v1/rides/${ORDER_ID}`,
      authed(),
    );
    expect(json.driver).toBeNull();
    expect(json.position).toBeNull();
    expect(json.eta).toBeNull();
    expect(json.phase).toBe("searching");
  });
});

describe("حجبُ الموقعِ في السلكِ", () => {
  it("موقعٌ طازجٌ يُنشَرُ بإحداثيَّتِه **وعُمرِه معهُ**", async () => {
    const { json } = await get(buildHarness(), `/v1/rides/${ORDER_ID}`, authed());
    expect(json.position).toEqual({ show: true, lat: 21.49, lng: 39.19, ageSeconds: 6 });
  });

  it("موقعٌ قديمٌ: لا `lat` ولا `lng` في السلكِ — سببٌ وعُمرٌ فقط", async () => {
    const { json } = await get(
      buildHarness({
        state: state({
          driver: {
            firstName: "خالد",
            vehicleType: null,
            plateNumber: null,
            ratingAverage: null,
            ratingCount: 0,
            position: { lat: 21.49, lng: 39.19, ageSeconds: 600 },
          },
        }),
      }),
      `/v1/rides/${ORDER_ID}`,
      authed(),
    );
    expect(json.position).toEqual({ show: false, reason: "TOO_OLD", ageSeconds: 600 });
    expect(JSON.stringify(json).includes("21.49")).toBe(false);
  });

  it("موقعٌ بلا ختمٍ يُحجَبُ بسببِه وعُمرُه عَدَمٌ", async () => {
    const { json } = await get(
      buildHarness({
        state: state({
          driver: {
            firstName: null,
            vehicleType: null,
            plateNumber: null,
            ratingAverage: null,
            ratingCount: 0,
            position: { lat: 21.49, lng: 39.19, ageSeconds: null },
          },
        }),
      }),
      `/v1/rides/${ORDER_ID}`,
      authed(),
    );
    expect(json.position).toEqual({ show: false, reason: "NO_TIMESTAMP", ageSeconds: null });
  });

  it("سائقٌ مُسنَدٌ لم يُبلِّغْ موقعاً: حجبٌ مُصنَّفٌ لا صمتٌ", async () => {
    const { json } = await get(
      buildHarness({
        state: state({
          driver: {
            firstName: "خالد",
            vehicleType: null,
            plateNumber: null,
            ratingAverage: null,
            ratingCount: 0,
            position: null,
          },
        }),
      }),
      `/v1/rides/${ORDER_ID}`,
      authed(),
    );
    expect(json.position).toEqual({ show: false, reason: "NEVER_REPORTED", ageSeconds: null });
    expect(json.eta).toBeNull();
  });
});

describe("مدّةُ الوصولِ", () => {
  it("مزوِّدٌ يُجيبُ ⇒ `ROUTED` بدقائقِها ومصدرِها", async () => {
    const { json } = await get(buildHarness(), `/v1/rides/${ORDER_ID}`, authed());
    expect(json.eta).toEqual({ kind: "ROUTED", minutes: 7, source: "ROUTING" });
  });

  it("لا مزوِّدَ مضبوطٌ ⇒ امتناعٌ مُصنَّفٌ لا صفرٌ ولا شَرطةٌ", async () => {
    const { json } = await get(buildHarness({ routing: null }), `/v1/rides/${ORDER_ID}`, authed());
    expect(json.eta).toEqual({ kind: "UNAVAILABLE", reason: "NOT_CONFIGURED" });
  });

  it("سقوطُ المزوِّدِ لا يُسقِطُ اللقطةَ: الحالةُ تُنشَرُ والمدّةُ تمتنعُ", async () => {
    const { status, json } = await get(
      buildHarness({
        routing: routingProvider(() => {
          throw new Error("انقطاعٌ مُصنَّع");
        }),
      }),
      `/v1/rides/${ORDER_ID}`,
      authed(),
    );
    expect(status).toBe(200);
    expect(json.status).toBe("matched");
    expect(json.eta).toEqual({ kind: "UNAVAILABLE", reason: "PROVIDER_DOWN" });
  });

  it("طَورُ الرحلةِ الجارِيةِ يقيسُ إلى الوجهةِ، وغيابُها يُبطِلُ السؤالَ", async () => {
    const running = state({ status: "in_progress", startedAtMs: NOW.getTime() - 120_000 });
    const withDestination = await get(
      buildHarness({ state: running }),
      `/v1/rides/${ORDER_ID}`,
      authed(),
    );
    expect(withDestination.json.phase).toBe("on_trip");
    expect(withDestination.json.eta).toEqual({ kind: "ROUTED", minutes: 7, source: "ROUTING" });

    const withoutDestination = await get(
      buildHarness({ state: state({ ...running, dropoff: null }) }),
      `/v1/rides/${ORDER_ID}`,
      authed(),
    );
    expect(withoutDestination.json.dropoff).toBeNull();
    expect(withoutDestination.json.eta).toBeNull();
  });

  it("طَورٌ غيرُ نشطٍ لا يُسألُ عن مدّةٍ أصلاً", async () => {
    const { json } = await get(
      buildHarness({ state: state({ status: "completed", completedAtMs: NOW.getTime() }) }),
      `/v1/rides/${ORDER_ID}`,
      authed(),
    );
    expect(json.phase).toBe("completed");
    expect(json.eta).toBeNull();
    expect(json.cancelPolicy).toBe("NOT_CANCELLABLE");
  });
});

describe("الرفضُ والعطبُ", () => {
  it("«ليسَ لك» و«لا يوجدُ» جوابٌ واحدٌ بـ200 — لا عدَّادَ معرّفاتٍ", async () => {
    const { status, json } = await get(
      buildHarness({ refusal: "ORDER_NOT_FOUND" }),
      `/v1/rides/${ORDER_ID}`,
      authed(),
    );
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, found: false, refusal: "ORDER_NOT_FOUND" });
  });

  it("معرِّفٌ ليسَ `uuid` رفضٌ مُصنَّفٌ بـ200", async () => {
    const { status, json } = await get(
      buildHarness({ refusal: "INVALID_ORDER_ID" }),
      "/v1/rides/not-a-uuid",
      authed(),
    );
    expect(status).toBe(200);
    expect(json.refusal).toBe("INVALID_ORDER_ID");
  });

  it("بلا ترويسةِ هويّةٍ ⇒ 401 ولا تُلمَسُ القاعدةُ", async () => {
    const harness = buildHarness();
    const { status, json } = await get(harness, `/v1/rides/${ORDER_ID}`);
    expect(status).toBe(401);
    expect(json).toEqual({ ok: false, error: "SESSION_REQUIRED" });
    expect(harness.seen.reads).toHaveLength(0);
  });

  it("رمزٌ مُحرَّفٌ ⇒ 401 ولا تُلمَسُ القاعدةُ", async () => {
    const harness = buildHarness();
    const { status, json } = await get(harness, `/v1/rides/${ORDER_ID}`, {
      authorization: "Bearer not.a.token",
    });
    expect(status).toBe(401);
    expect(json.error).toBe("SESSION_INVALID");
    expect(harness.seen.reads).toHaveLength(0);
  });

  it("حسابٌ غائبٌ ⇒ 404، وراكبٌ غيرُ مُسجَّلٍ ⇒ 404، والمخزنُ ساقطٌ ⇒ 503", async () => {
    for (const [failure, expected, code] of [
      ["USER_NOT_FOUND", 404, "ACCOUNT_NOT_FOUND"],
      ["RIDER_NOT_REGISTERED", 404, "RIDER_NOT_REGISTERED"],
      ["STORE_ERROR", 503, "RIDE_STORE_NOT_AVAILABLE"],
    ] as const) {
      const { status, json } = await get(
        buildHarness({ failure }),
        `/v1/rides/${ORDER_ID}`,
        authed(),
      );
      expect(status).toBe(expected);
      expect(json.error).toBe(code);
    }
  });

  it("غيابُ القارئِ يُعطِّلُ المسارَ بـ503 صادقاً ولا يُجيبُ لقطةً فارغةً", async () => {
    const { status, json } = await get(
      buildHarness({ mounted: false }),
      `/v1/rides/${ORDER_ID}`,
      authed(),
    );
    expect(status).toBe(503);
    expect(json).toEqual({ ok: false, error: "RIDE_STORE_NOT_AVAILABLE" });
  });
});
