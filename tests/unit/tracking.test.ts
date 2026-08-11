/**
 * الغرض: اختبارات طبقة التتبّع — التحقّق من GPS، خدمة التتبّع، الأحداث.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import {
  validateGpsUpdate,
  haversineMeters,
  TrackingService,
  DEFAULT_TRACKING_CONFIG,
  type LocationStore,
  type TrackingEventPublisher,
  type GpsUpdate,
  type TrackingEvent,
  type Clock,
} from "../../packages/tracking/index.ts";
import type { LatLng } from "../../packages/maps/core/types.ts";

const fixedClock: Clock = { now: () => new Date("2026-08-11T12:00:00Z") };

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
  return {
    events,
    publish: async (e) => { events.push(e); },
  };
}

function makeUpdate(driverId: string, lat: number, lng: number, overrides: Partial<GpsUpdate> = {}): GpsUpdate {
  return {
    driverId,
    tripId: "trip-1",
    position: { lat, lng },
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("tracking: location validator", () => {
  it("يقبل موقعاً صحيحاً بلا موقع سابق", () => {
    const result = validateGpsUpdate(makeUpdate("d1", 21.5, 39.2), null, DEFAULT_TRACKING_CONFIG.validator);
    expect(result.valid).toBe(true);
  });

  it("يرفض دقة GPS منخفضة جداً", () => {
    const result = validateGpsUpdate(
      makeUpdate("d1", 21.5, 39.2, { accuracy: 200 }),
      null,
      DEFAULT_TRACKING_CONFIG.validator,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("accuracy");
  });

  it("يرفض الانتقال اللحظي (teleportation)", () => {
    const now = Date.now();
    const previous = { position: { lat: 21.5, lng: 39.2 } as LatLng, timestamp: now };
    // 100km في ثانية واحدة
    const result = validateGpsUpdate(
      makeUpdate("d1", 22.4, 40.1, { timestamp: now + 1000 }),
      previous,
      DEFAULT_TRACKING_CONFIG.validator,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Teleport");
  });

  it("يرفض سرعة غير معقولة", () => {
    const now = Date.now();
    const previous = { position: { lat: 21.5, lng: 39.2 } as LatLng, timestamp: now };
    // ~2km في ثانية = 7200 كم/سا
    const result = validateGpsUpdate(
      makeUpdate("d1", 21.51, 39.22, { timestamp: now + 1000 }),
      previous,
      { ...DEFAULT_TRACKING_CONFIG.validator, teleportThresholdMeters: 100000 },
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("speed");
  });

  it("يقبل حركة طبيعية (10م في 3 ثوانٍ)", () => {
    const now = Date.now();
    const previous = { position: { lat: 21.5, lng: 39.2 } as LatLng, timestamp: now };
    // ~10 أمتار
    const result = validateGpsUpdate(
      makeUpdate("d1", 21.50009, 39.2, { timestamp: now + 3000 }),
      previous,
      DEFAULT_TRACKING_CONFIG.validator,
    );
    expect(result.valid).toBe(true);
  });
});

describe("tracking: haversine", () => {
  it("المسافة بين نفس النقطة = 0", () => {
    expect(haversineMeters({ lat: 21.5, lng: 39.2 }, { lat: 21.5, lng: 39.2 })).toBe(0);
  });

  it("المسافة بين نقطتين معروفتين صحيحة", () => {
    // جدة → مكة ≈ 79 كم تقريباً
    const jeddah: LatLng = { lat: 21.4858, lng: 39.1925 };
    const makkah: LatLng = { lat: 21.3891, lng: 39.8579 };
    const dist = haversineMeters(jeddah, makkah);
    expect(dist).toBeGreaterThan(60000);
    expect(dist).toBeLessThan(90000);
  });
});

describe("tracking: service", () => {
  it("يقبل تحديثاً صحيحاً ويخزّنه وينشر حدثاً", async () => {
    const store = fakeStore();
    const pub = fakePublisher();
    const svc = new TrackingService({ store, publisher: pub, clock: fixedClock, config: DEFAULT_TRACKING_CONFIG });

    const result = await svc.handleGpsUpdate(makeUpdate("d1", 21.5, 39.2));
    expect(result.accepted).toBe(true);
    expect(store.data.has("d1")).toBe(true);
    expect(pub.events.length).toBe(1);
    expect(pub.events[0]!.type).toBe("location_updated");
  });

  it("يرفض تحديثاً فاسداً ولا يخزّنه", async () => {
    const store = fakeStore();
    const pub = fakePublisher();
    const svc = new TrackingService({ store, publisher: pub, clock: fixedClock, config: DEFAULT_TRACKING_CONFIG });

    // تحديث صحيح أولاً
    await svc.handleGpsUpdate(makeUpdate("d1", 21.5, 39.2));

    // ثم تحديث بانتقال لحظي
    const now = Date.now();
    const result = await svc.handleGpsUpdate(
      makeUpdate("d1", 25.0, 45.0, { timestamp: now + 1000 }),
    );
    expect(result.accepted).toBe(false);
    // حدث تنبيه منشور
    const alertEvent = pub.events.find((e) => e.type === "teleport_detected");
    expect(alertEvent).toBeDefined();
  });

  it("يبدا وينهي جلسة تتبّع", async () => {
    const store = fakeStore();
    const pub = fakePublisher();
    const svc = new TrackingService({ store, publisher: pub, clock: fixedClock, config: DEFAULT_TRACKING_CONFIG });

    await svc.startSession("d1", "trip-1");
    expect(pub.events[0]!.type).toBe("session_started");

    await svc.handleGpsUpdate(makeUpdate("d1", 21.5, 39.2));
    expect(store.data.has("d1")).toBe(true);

    await svc.endSession("d1", "trip-1");
    expect(store.data.has("d1")).toBe(false);
    const endEvent = pub.events.find((e) => e.type === "session_ended");
    expect(endEvent).toBeDefined();
  });
});
