/**
 * الغرض: اختبارات طبقة التتبّع — التحقّق من GPS، خدمة التتبّع، الأحداث.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { haversineKm } from "../../packages/domain/geo/index.ts";
import type { LatLng } from "../../packages/maps/core/types.ts";
import {
  type Clock,
  DEFAULT_TRACKING_CONFIG,
  type GpsUpdate,
  type LocationStore,
  type TrackingEvent,
  type TrackingEventPublisher,
  TrackingService,
} from "../../packages/tracking/index.ts";

const fixedClock: Clock = { now: () => new Date("2026-08-11T12:00:00Z") };
const NOW_MS = new Date("2026-08-11T12:00:00Z").getTime();

/** ساعة متحرّكة: سلوك التحقّق عند حدود الزمن يُختبر بلا انتظار حقيقي. */
function movableClock(startMs: number): Clock & { advance(ms: number): void } {
  let current = startMs;
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms;
    },
  };
}

/** جسر للاختبارات: المجال يحسب بالكيلومتر وهذه الحالات بالمتر. */
const haversineMeters = (a: LatLng, b: LatLng): number =>
  haversineKm({ latitude: a.lat, longitude: a.lng }, { latitude: b.lat, longitude: b.lng }) * 1000;

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

function makeUpdate(
  driverId: string,
  lat: number,
  lng: number,
  overrides: Partial<GpsUpdate> = {},
): GpsUpdate {
  return {
    driverId,
    tripId: "trip-1",
    position: { lat, lng },
    timestamp: NOW_MS,
    ...overrides,
  };
}

describe("tracking: haversine (من المجال)", () => {
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
    const svc = new TrackingService({
      store,
      publisher: pub,
      clock: fixedClock,
      config: DEFAULT_TRACKING_CONFIG,
    });

    // المرحلة ٥: الإصلاحة تحتاج جلسةً مفتوحة. كانت هذه الاختبارات تُرسل بلا جلسة
    // وتنجح — وهو ما كشف أن `startSession` لم تكن تُنشئ شيئاً يُشترط وجوده.
    await svc.startSession("d1", "trip-1");
    const result = await svc.handleGpsUpdate(makeUpdate("d1", 21.5, 39.2));
    expect(result.accepted).toBe(true);
    expect(store.data.has("d1")).toBe(true);
    expect(pub.events.map((e) => e.type)).toEqual(["session_started", "location_updated"]);
  });

  function service() {
    const store = fakeStore();
    const pub = fakePublisher();
    const svc = new TrackingService({
      store,
      publisher: pub,
      clock: fixedClock,
      config: DEFAULT_TRACKING_CONFIG,
    });
    return { store, pub, svc };
  }

  async function startedService() {
    const s = service();
    await s.svc.startSession("d1", "trip-1");
    s.pub.events.length = 0;
    return s;
  }

  it("يرفض إحداثيات غير صالحة فلا يخزّنها ولا ينشر عنها حدثاً", async () => {
    const { store, pub, svc } = await startedService();
    const result = await svc.handleGpsUpdate(makeUpdate("d1", Number.NaN, 39.2));
    expect(result.accepted).toBe(false);
    expect(store.data.has("d1")).toBe(false);
    // البيانات الفاسدة ليست إشارة تشغيلية: إغراق العمليات بها يدفن التنبيه الحقيقي.
    expect(pub.events.length).toBe(0);
  });

  it("القفزة تُقبل وتُنشر كتنبيه — لا تُطرح", async () => {
    const { store, pub, svc } = await startedService();
    await svc.handleGpsUpdate(makeUpdate("d1", 21.5, 39.2));
    const jump = await svc.handleGpsUpdate(
      makeUpdate("d1", 25.0, 45.0, { timestamp: NOW_MS + 1000 }),
    );

    expect(jump.accepted).toBe(true);
    if (!jump.accepted) return;
    expect(jump.assessment.verdict).toBe("ALERT");
    expect(pub.events.some((e) => e.type === "teleport_detected")).toBe(true);
    // الموقع الأحدث هو أفضل ما نعرف عن السائق، فلا يُهمَل لصالح موقع ميت.
    expect((store.data.get("d1") as { position: LatLng }).position).toEqual({
      lat: 25.0,
      lng: 45.0,
    });
  });

  /**
   * انحدار مثبت في الطبقة القديمة: كانت ترفض القفزة **ولا تُقدّم** المؤشّر السابق،
   * فتُقاس كل إصلاحة تالية على نقطة ميتة فتُرفض هي الأخرى — التتبّع يموت إلى آخر
   * الجلسة والعمليات ترى السائق واقفاً حيث لم يعد. هذا الاختبار يمنع عودتها.
   */
  it("لا يُقفل التتبّع بعد قفزة: الخطوة الطبيعية التالية تُقبل بلا تنبيه", async () => {
    const store = fakeStore();
    const pub = fakePublisher();
    const clock = movableClock(NOW_MS);
    const svc = new TrackingService({
      store,
      publisher: pub,
      clock,
      config: DEFAULT_TRACKING_CONFIG,
    });

    await svc.startSession("d1", "trip-1");
    await svc.handleGpsUpdate(makeUpdate("d1", 21.4858, 39.1925, { timestamp: NOW_MS }));

    // خروج من نفق: الجهاز يستعيد الإشارة على بُعد ٨ كم — قفزة حقيقية لا احتيال.
    clock.advance(60_000);
    await svc.handleGpsUpdate(makeUpdate("d1", 21.558, 39.1925, { timestamp: NOW_MS + 60_000 }));

    // ثم يسير طبيعياً ١١٠ أمتار في دقيقة.
    clock.advance(60_000);
    const after = await svc.handleGpsUpdate(
      makeUpdate("d1", 21.559, 39.1925, { timestamp: NOW_MS + 120_000 }),
    );

    expect(after.accepted).toBe(true);
    if (!after.accepted) return;
    expect(after.assessment.verdict).toBe("ACCEPT");
    expect(pub.events.filter((e) => e.type === "teleport_detected").length).toBe(1);
  });

  it("يبدا وينهي جلسة تتبّع", async () => {
    const store = fakeStore();
    const pub = fakePublisher();
    const svc = new TrackingService({
      store,
      publisher: pub,
      clock: fixedClock,
      config: DEFAULT_TRACKING_CONFIG,
    });

    await svc.startSession("d1", "trip-1");
    expect(pub.events[0]!.type).toBe("session_started");

    await svc.handleGpsUpdate(makeUpdate("d1", 21.5, 39.2));
    expect(store.data.has("d1")).toBe(true);

    await svc.endSession("d1", "trip-1");
    expect(store.data.has("d1")).toBe(false);
    const endEvent = pub.events.find((e) => e.type === "session_ended");
    expect(endEvent).toBeDefined();
  });

  it("أحداث الجلسة لا تحمل إحداثية صفرية — «جزيرة الصفر» ليست موقعاً", async () => {
    const { pub, svc } = service();
    await svc.startSession("d1", "trip-1");
    await svc.endSession("d1", "trip-1", "TRIP_COMPLETED");

    // {lat:0,lng:0} نقطةٌ حقيقية في خليج غينيا تمرّ من كل تحقّق، فترسم السائق
    // قبالة سواحل أفريقيا وتُنتج آلاف الكيلومترات في أي حساب مسافة.
    for (const e of pub.events) expect(e.position).toBeNull();
    expect(pub.events.find((e) => e.type === "session_ended")?.metadata).toEqual({
      reason: "TRIP_COMPLETED",
    });
  });

  it("إصلاحة بلا جلسة تُرفض برمز الجلسة لا برمز البيانات الفاسدة", async () => {
    const { store, pub, svc } = service();
    const result = await svc.handleGpsUpdate(makeUpdate("d1", 21.5, 39.2));

    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.rejection).toBe("NO_ACTIVE_SESSION");
    expect(store.data.has("d1")).toBe(false);
    expect(pub.events.length).toBe(0);
  });

  it("إصلاحة متأخّرة بعد الإنهاء لا تُعيد السائق إلى الخريطة", async () => {
    const { store, pub, svc } = service();
    await svc.startSession("d1", "trip-1");
    await svc.handleGpsUpdate(makeUpdate("d1", 21.5, 39.2));
    await svc.endSession("d1", "trip-1", "TRIP_COMPLETED");
    pub.events.length = 0;

    const late = await svc.handleGpsUpdate(makeUpdate("d1", 21.51, 39.21));

    expect(late.accepted).toBe(false);
    if (late.accepted) return;
    if (late.rejection !== "NO_ACTIVE_SESSION") return;
    expect(late.sessionState).toBe("ENDED");
    // وهذا هو الأثر الذي يهمّ العمليات: من أغلق تطبيقه لا يعود متاحاً.
    expect(store.data.has("d1")).toBe(false);
    expect(pub.events.length).toBe(0);
  });

  it("حالة الجلسة تُحسب من الزمن: ACTIVE ثم STALE بلا أي كتابة", async () => {
    const store = fakeStore();
    const pub = fakePublisher();
    const clock = movableClock(NOW_MS);
    const svc = new TrackingService({
      store,
      publisher: pub,
      clock,
      config: DEFAULT_TRACKING_CONFIG,
    });

    expect(svc.sessionState("d1")).toBeNull();
    await svc.startSession("d1", "trip-1");
    expect(svc.sessionState("d1")).toBe("CREATED");

    await svc.handleGpsUpdate(makeUpdate("d1", 21.5, 39.2));
    expect(svc.sessionState("d1")).toBe("ACTIVE");

    clock.advance(31_000);
    expect(svc.sessionState("d1")).toBe("STALE");

    // والجلسة المنقطعة ما تزال تقبل: الانقطاع ليس إنهاءً.
    const back = await svc.handleGpsUpdate(
      makeUpdate("d1", 21.5005, 39.2005, { timestamp: NOW_MS + 31_000 }),
    );
    expect(back.accepted).toBe(true);
    expect(svc.sessionState("d1")).toBe("ACTIVE");
  });

  it("بدء جلسة جديدة يُبطل سابقة الجلسة الماضية فلا تُقاس إزاحة عبر الفجوة", async () => {
    const store = fakeStore();
    const pub = fakePublisher();
    const clock = movableClock(NOW_MS);
    const svc = new TrackingService({
      store,
      publisher: pub,
      clock,
      config: DEFAULT_TRACKING_CONFIG,
    });

    await svc.startSession("d1", "trip-1");
    await svc.handleGpsUpdate(makeUpdate("d1", 21.4858, 39.1925, { timestamp: NOW_MS }));
    await svc.endSession("d1", "trip-1", "TRIP_COMPLETED");

    // اليوم التالي، والسائق يبدأ من مكة لا من جدة.
    clock.advance(20 * 60 * 60 * 1000);
    const t2 = NOW_MS + 20 * 60 * 60 * 1000;
    await svc.startSession("d1", "trip-2");
    pub.events.length = 0;
    const first = await svc.handleGpsUpdate(
      makeUpdate("d1", 21.3891, 39.8579, { timestamp: t2, tripId: "trip-2" }),
    );

    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    // بلا إبطال السابقة كانت ٧٩ كم بين جلستين تُقرأ «انتقالاً لحظياً» وهمياً.
    expect(first.assessment.verdict).toBe("ACCEPT");
    expect(pub.events.some((e) => e.type === "teleport_detected")).toBe(false);
  });
});
