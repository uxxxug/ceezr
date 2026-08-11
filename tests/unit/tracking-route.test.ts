/**
 * الغرض: اختبارات مسار التتبّع في البوابة مع المصادقة.
 *   يتحقق من: استقبال GPS، رفض الفاسد، قراءة الموقع، بدء/إنهاء الجلسة،
 *   رفض الطلب بلا رمز، رفض انتحال الهوية، رفض قراءة موقع سائق آخر.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createTrackingRoutes } from "../../apps/gateway/src/routes/tracking.ts";
import {
  DEFAULT_TRACKING_CONFIG,
  type LocationStore,
  type TrackingEvent,
  type TrackingEventPublisher,
  type TrackingTokenPayload,
  type TrackingTokenStore,
  TrackingService,
} from "../../packages/tracking/index.ts";

const fixedClock = { now: () => new Date("2026-08-11T12:00:00Z") };

function fakeStore(): LocationStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    setCurrent: async (id, pos, meta) => {
      data.set(id, { position: pos, ...meta });
    },
    getCurrent: async (id) => (data.get(id) as any) ?? null,
    clear: async (id) => {
      data.delete(id);
    },
  };
}

function fakePublisher(): TrackingEventPublisher & { events: TrackingEvent[] } {
  const events: TrackingEvent[] = [];
  return {
    events,
    publish: async (e) => {
      events.push(e);
    },
  };
}

function fakeTokenStore(): TrackingTokenStore & {
  tokens: Map<string, TrackingTokenPayload>;
  revoked: Set<string>;
} {
  const tokens = new Map<string, TrackingTokenPayload>();
  const revoked = new Set<string>();
  let counter = 0;
  return {
    tokens,
    revoked,
    issue: async (driverId, tripId, ttlSeconds) => {
      const token = `tok-${++counter}`;
      tokens.set(token, {
        driverId,
        tripId,
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
      return token;
    },
    verify: async (token) => {
      if (revoked.has(token)) return null;
      return tokens.get(token) ?? null;
    },
    revoke: async (token) => {
      revoked.add(token);
      tokens.delete(token);
    },
  };
}

function setupTestServer() {
  const store = fakeStore();
  const pub = fakePublisher();
  const tokenStore = fakeTokenStore();
  const tracking = new TrackingService({
    store,
    publisher: pub,
    clock: fixedClock,
    config: DEFAULT_TRACKING_CONFIG,
  });
  const app = new Hono();
  app.route("/track", createTrackingRoutes({ tracking, store, tokenStore }));
  return { app, store, pub, tracking, tokenStore };
}

async function issueToken(
  tokenStore: ReturnType<typeof fakeTokenStore>,
  driverId: string,
  tripId: string | null = null,
): Promise<string> {
  return tokenStore.issue(driverId, tripId, 28800);
}

describe("tracking route: authentication", () => {
  it("يرفض طلب GPS بلا رمز", async () => {
    const { app } = setupTestServer();
    const res = await app.request("/track/gps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lat: 21.5, lng: 39.2, timestamp: Date.now() }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe("MISSING_TOKEN");
  });

  it("يرفض طلب GPS برمز غير صالح", async () => {
    const { app } = setupTestServer();
    const res = await app.request("/track/gps", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer invalid-token",
      },
      body: JSON.stringify({ lat: 21.5, lng: 39.2, timestamp: Date.now() }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe("INVALID_TOKEN");
  });

  it("يرفض انتحال الهوية: driverId في body لا يطابق الرمز", async () => {
    const { app, tokenStore } = setupTestServer();
    const token = await issueToken(tokenStore, "driver-A");
    const res = await app.request("/track/gps", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        driverId: "driver-B",
        lat: 21.5,
        lng: 39.2,
        timestamp: Date.now(),
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe("DRIVER_ID_MISMATCH");
  });

  it("يرفض قراءة موقع سائق آخر", async () => {
    const { app, tokenStore } = setupTestServer();
    const token = await issueToken(tokenStore, "driver-A");
    const res = await app.request("/track/driver-B", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe("FORBIDDEN");
  });

  it("يرفض قراءة الموقع بلا رمز", async () => {
    const { app } = setupTestServer();
    const res = await app.request("/track/d1");
    expect(res.status).toBe(401);
  });
});

describe("tracking route: POST /track/gps (authenticated)", () => {
  it("يقبل تحديث GPS صحيح برمز صالح", async () => {
    const { app, tokenStore } = setupTestServer();
    const token = await issueToken(tokenStore, "d1");
    const res = await app.request("/track/gps", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        lat: 21.5,
        lng: 39.2,
        timestamp: Date.now(),
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("يرفض JSON غير صالح", async () => {
    const { app, tokenStore } = setupTestServer();
    const token = await issueToken(tokenStore, "d1");
    const res = await app.request("/track/gps", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("يرفض الحقول الناقصة (lat/lng)", async () => {
    const { app, tokenStore } = setupTestServer();
    const token = await issueToken(tokenStore, "d1");
    const res = await app.request("/track/gps", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("يرفض الانتقال اللحظي (teleport)", async () => {
    const { app, tokenStore } = setupTestServer();
    const token = await issueToken(tokenStore, "d1");

    // موقع صحيح أولاً
    await app.request("/track/gps", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        lat: 21.5,
        lng: 39.2,
        timestamp: Date.now(),
      }),
    });

    // انتقال لحظي
    const res = await app.request("/track/gps", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        lat: 30.0,
        lng: 50.0,
        timestamp: Date.now() + 1000,
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });
});

describe("tracking route: GET /track/:driverId (authenticated)", () => {
  it("يرجع 404 لسائق بلا موقع", async () => {
    const { app, tokenStore } = setupTestServer();
    const token = await issueToken(tokenStore, "d1");
    const res = await app.request("/track/d1", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  it("يرجع الموقع بعد تحديث GPS", async () => {
    const { app, tokenStore } = setupTestServer();
    const token = await issueToken(tokenStore, "d1");
    await app.request("/track/gps", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        lat: 21.5,
        lng: 39.2,
        timestamp: Date.now(),
      }),
    });
    const res = await app.request("/track/d1", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; position: { lat: number; lng: number } };
    expect(body.ok).toBe(true);
    expect(body.position.lat).toBe(21.5);
    expect(body.position.lng).toBe(39.2);
  });
});

describe("tracking route: session start/end (authenticated)", () => {
  it("يبدأ وينهي جلسة تتبّع", async () => {
    const { app, store, pub, tokenStore } = setupTestServer();
    const token = await issueToken(tokenStore, "d1");

    const startRes = await app.request("/track/session/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tripId: "trip-1" }),
    });
    expect(startRes.status).toBe(200);
    const startBody = (await startRes.json()) as { ok: boolean; token: string };
    expect(startBody.ok).toBe(true);
    expect(startBody.token).toBeDefined();
    expect(pub.events.some((e) => e.type === "session_started")).toBe(true);

    // استخدام الرمز الجديد
    const newToken = startBody.token;

    // إرسال موقع
    await app.request("/track/gps", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${newToken}`,
      },
      body: JSON.stringify({
        lat: 21.5,
        lng: 39.2,
        timestamp: Date.now(),
      }),
    });
    expect(store.data.has("d1")).toBe(true);

    // إنهاء الجلسة
    const endRes = await app.request("/track/session/end", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${newToken}`,
      },
    });
    expect(endRes.status).toBe(200);
    expect(store.data.has("d1")).toBe(false);
    expect(pub.events.some((e) => e.type === "session_ended")).toBe(true);
  });

  it("يرفض بدء جلسة بلا رمز", async () => {
    const { app } = setupTestServer();
    const res = await app.request("/track/session/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ driverId: "d1", tripId: "trip-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("يرفض إنهاء جلسة بلا رمز", async () => {
    const { app } = setupTestServer();
    const res = await app.request("/track/session/end", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ driverId: "d1" }),
    });
    expect(res.status).toBe(401);
  });
});
