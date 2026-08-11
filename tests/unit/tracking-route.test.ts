/**
 * الغرض: اختبارات مسار التتبّع في البوابة.
 *   يتحقق من: استقبال GPS، رفض الفاسد، قراءة الموقع، بدء/إنهاء الجلسة.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
  TrackingService,
  DEFAULT_TRACKING_CONFIG,
  type LocationStore,
  type TrackingEventPublisher,
  type TrackingEvent,
} from "../../packages/tracking/index.ts";
import { createTrackingRoutes } from "../../apps/gateway/src/routes/tracking.ts";

const fixedClock = { now: () => new Date("2026-08-11T12:00:00Z") };

function fakeStore(): LocationStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    setCurrent: async (id, pos, meta) => { data.set(id, { position: pos, ...meta }); },
    getCurrent: async (id) => (data.get(id) as any) ?? null,
    clear: async (id) => { data.delete(id); },
  };
}

function fakePublisher(): TrackingEventPublisher & { events: TrackingEvent[] } {
  const events: TrackingEvent[] = [];
  return { events, publish: async (e) => { events.push(e); } };
}

function setupTestServer() {
  const store = fakeStore();
  const pub = fakePublisher();
  const tracking = new TrackingService({
    store,
    publisher: pub,
    clock: fixedClock,
    config: DEFAULT_TRACKING_CONFIG,
  });
  const app = new Hono();
  app.route("/track", createTrackingRoutes({ tracking, store }));
  return { app, store, pub, tracking };
}

describe("tracking route: POST /track/gps", () => {
  it("يقبل تحديث GPS صحيح", async () => {
    const { app } = setupTestServer();
    const res = await app.request("/track/gps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        driverId: "d1",
        lat: 21.5,
        lng: 39.2,
        timestamp: Date.now(),
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("يرفض JSON غير صالح", async () => {
    const { app } = setupTestServer();
    const res = await app.request("/track/gps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("يرفض الحقول الناقصة", async () => {
    const { app } = setupTestServer();
    const res = await app.request("/track/gps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ driverId: "d1" }),
    });
    expect(res.status).toBe(400);
  });

  it("يرفض الانتقال اللحظي (teleport)", async () => {
    const { app } = setupTestServer();
    // إرسال موقع صحيح أولاً
    await app.request("/track/gps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        driverId: "d1",
        lat: 21.5,
        lng: 39.2,
        timestamp: Date.now(),
      }),
    });

    // ثم انتقال لحظي
    const res = await app.request("/track/gps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        driverId: "d1",
        lat: 30.0,
        lng: 50.0,
        timestamp: Date.now() + 1000,
      }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
  });
});

describe("tracking route: GET /track/:driverId", () => {
  it("يرجع 404 لسائق بلا موقع", async () => {
    const { app } = setupTestServer();
    const res = await app.request("/track/d1");
    expect(res.status).toBe(404);
  });

  it("يرجع الموقع بعد تحديث GPS", async () => {
    const { app } = setupTestServer();
    await app.request("/track/gps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        driverId: "d1",
        lat: 21.5,
        lng: 39.2,
        timestamp: Date.now(),
      }),
    });
    const res = await app.request("/track/d1");
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; position: { lat: number; lng: number } };
    expect(body.ok).toBe(true);
    expect(body.position.lat).toBe(21.5);
    expect(body.position.lng).toBe(39.2);
  });
});

describe("tracking route: session start/end", () => {
  it("يبدأ وينهي جلسة تتبّع", async () => {
    const { app, store, pub } = setupTestServer();

    const startRes = await app.request("/track/session/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ driverId: "d1", tripId: "trip-1" }),
    });
    expect(startRes.status).toBe(200);
    expect(pub.events.some((e) => e.type === "session_started")).toBe(true);

    // إرسال موقع
    await app.request("/track/gps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        driverId: "d1",
        lat: 21.5,
        lng: 39.2,
        timestamp: Date.now(),
      }),
    });
    expect(store.data.has("d1")).toBe(true);

    // إنهاء الجلسة
    const endRes = await app.request("/track/session/end", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ driverId: "d1", tripId: "trip-1" }),
    });
    expect(endRes.status).toBe(200);
    expect(store.data.has("d1")).toBe(false);
    expect(pub.events.some((e) => e.type === "session_ended")).toBe(true);
  });
});
