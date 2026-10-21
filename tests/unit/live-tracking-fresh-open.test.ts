/**
 * الغرض: LOAD-01 (الدفعة 30) — `onFix` معَ مخزنٍ يقدّمُ `openOnActiveTrip` (الرحلةُ داخلَ جملةِ الفتح):
 *   يحفظُ عقدَ `live-tracking-open-race.test.ts` نفسَه — (أ) لا إسناد، (ب) قبلَ اللقطة، (ج) بعدَها داخلَ
 *   النافذة، (د) انتهاؤه داخلَ النافذة، وانتهاءُ الجلسة — ولا يقرأُ `activeTripOf` في مسارَي الفتح
 *   (القراءةُ الثانيةُ صارت داخلَ جملةِ الفتح). والمخزنُ بلا الطريقةِ يبقى على القراءتَين (يحرسُه ملفُّ السباق).
 *   الأثرُ على PostgreSQL حقيقيّ: `tests/integration/driver-location-pool-acquisitions.test.ts`.
 * الحالة: اختبار وحدة فعلي — لا يتطلب قاعدة.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, it } from "bun:test";
import {
  createLiveTracking,
  type StoredFix,
} from "../../packages/application/tracking/live-tracking.ts";
import {
  createMemoryTrackingSessionStore,
  type TrackingSessionStore,
} from "../../packages/tracking/session-store.ts";
import type { TrackingEvent } from "../../packages/tracking/types.ts";

const DRIVER = "driver-1";
const TRIP = "trip-1";

const fixAt = (recordedAtMs: number): StoredFix => ({
  driverId: DRIVER,
  cityId: "city-jed",
  latitude: 21.5471,
  longitude: 39.1751,
  recordedAtMs,
  accuracyMeters: 8,
  verdict: "ACCEPT",
  findings: [],
});

function harness(state: { onDuty: boolean; activeTripId: string | null }) {
  const now = { value: 10_000_000 };
  const events: TrackingEvent[] = [];
  const store = createMemoryTrackingSessionStore();
  const window: { hook: (() => void) | null } = { hook: null };
  const calls = { activeTripOf: 0, openOnActiveTrip: 0, open: 0 };
  const sessions: TrackingSessionStore = {
    ...store,
    openSessionOf: async (driverId) => {
      const hook = window.hook;
      window.hook = null;
      hook?.();
      return store.openSessionOf(driverId);
    },
    open: async (...args) => {
      calls.open++;
      return store.open(...args);
    },
    // يمثّلُ جملةَ الإدراجِ ذاتَ القراءةِ الداخلية: الرحلةُ تُقرأُ لحظةَ الفتحِ لا قبلَها.
    openOnActiveTrip: async (driverId, startedAtMs) => {
      calls.openOnActiveTrip++;
      return store.open(driverId, state.activeTripId, startedAtMs);
    },
  };
  const live = createLiveTracking({
    sessions,
    publisher: { publish: async (event) => void events.push(event) },
    trips: {
      activeTripOf: async () => {
        calls.activeTripOf++;
        return state.activeTripId;
      },
    },
    duty: { isOnDuty: async () => state.onDuty },
    dutyAndTrip: {
      dutyAndActiveTrip: async () => ({ onDuty: state.onDuty, activeTripId: state.activeTripId }),
    },
    clock: { now: () => new Date(now.value) },
  });
  const fix = async (inWindow?: () => void) => {
    window.hook = inWindow ?? null;
    await live.onFix(fixAt(now.value));
    now.value += 20_000;
  };
  return { fix, events, store, calls, now };
}

const trips = (events: TrackingEvent[]) => events.map((e) => `${e.type}:${e.tripId}`);

describe("onFix بفتحٍ طازجٍ داخلَ جملةِ الفتح (openOnActiveTrip)", () => {
  it("(ج) إسنادٌ بعدَ اللقطةِ داخلَ النافذة: تُفتحُ الجلسةُ عليه، بلا قراءةِ activeTripOf", async () => {
    const state = { onDuty: true, activeTripId: null as string | null };
    const h = harness(state);
    await h.fix(() => {
      state.activeTripId = TRIP;
    });
    expect((await h.store.openSessionOf(DRIVER))?.facts.tripId).toBe(TRIP);
    expect(trips(h.events)).toEqual([`session_started:${TRIP}`, `location_updated:${TRIP}`]);
    expect(h.calls).toEqual({ activeTripOf: 0, openOnActiveTrip: 1, open: 0 });
  });

  it("(أ) لا إسناد و(ب) إسنادٌ قبلَ اللقطة", async () => {
    const a = harness({ onDuty: true, activeTripId: null });
    await a.fix();
    expect(trips(a.events)).toEqual(["session_started:null", "location_updated:null"]);
    const b = harness({ onDuty: true, activeTripId: TRIP });
    await b.fix();
    expect(trips(b.events)).toEqual([`session_started:${TRIP}`, `location_updated:${TRIP}`]);
    expect(a.calls.activeTripOf + b.calls.activeTripOf).toBe(0);
  });

  it("(د) الإسنادُ في اللقطةِ ينتهي داخلَ النافذة: لا جلسةَ على رحلةٍ منتهية", async () => {
    const state = { onDuty: true, activeTripId: TRIP as string | null };
    const h = harness(state);
    await h.fix(() => {
      state.activeTripId = null;
    });
    expect((await h.store.openSessionOf(DRIVER))?.facts.tripId).toBeNull();
    expect(h.events.filter((e) => e.tripId === TRIP)).toEqual([]);
  });

  it("انتهاءُ الجلسة: الاستبدالُ بالفتحِ الطازج، والجلسةُ القائمةُ لا تُعادُ فتحًا", async () => {
    const state = { onDuty: true, activeTripId: null as string | null };
    const h = harness(state);
    await h.fix();
    await h.fix(); // جلسةٌ قائمة: لا فتح
    expect(h.calls.openOnActiveTrip).toBe(1);
    h.now.value += 13 * 60 * 60 * 1000; // بعدَ السقف (12 ساعة)
    state.activeTripId = TRIP;
    await h.fix();
    expect(h.calls.openOnActiveTrip).toBe(2);
    expect((await h.store.openSessionOf(DRIVER))?.facts.tripId).toBe(TRIP);
    expect(h.calls.open).toBe(0);
  });
});
