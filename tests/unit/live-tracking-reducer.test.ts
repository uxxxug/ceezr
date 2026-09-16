/**
 * اختباراتُ محوّلِ التتبُّعِ الحيِّ — حارسُ التسلسلِ ودمجُ الأحداثِ (البندانِ
 * `F2-06` و`F4-04`).
 */

import { describe, expect, it } from "bun:test";
import {
  applyTrackingEvent,
  INITIAL_TRACKING_STATE,
  shouldRefreshFromHttp,
} from "../../apps/miniapp/src/services/live-tracking-reducer.ts";
import type { RideChannelEvent } from "../../apps/miniapp/src/services/ride-channel-client.ts";

function event(overrides: Partial<RideChannelEvent> = {}): RideChannelEvent {
  return {
    type: "location_updated",
    driverId: "drv-1",
    tripId: "trip-1",
    sessionId: "sess-1",
    sequence: 1,
    position: { lat: 21.5, lng: 39.2 },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("live-tracking-reducer", () => {
  it("الحالةُ الابتدائيّةُ: لا موقعَ ولا تسلسلَ", () => {
    expect(INITIAL_TRACKING_STATE.position).toBeNull();
    expect(INITIAL_TRACKING_STATE.sequence).toBe(0);
    expect(INITIAL_TRACKING_STATE.sessionId).toBeNull();
  });

  it("حدثٌ أوّلُ يُطبَّقُ على الحالةِ الفارغةِ", () => {
    const next = applyTrackingEvent(INITIAL_TRACKING_STATE, event({ sequence: 1 }));
    expect(next.position).toEqual({ lat: 21.5, lng: 39.2 });
    expect(next.sequence).toBe(1);
    expect(next.sessionId).toBe("sess-1");
  });

  it("حدثٌ أحدثُ يُحدِّثُ الموقعَ والتسلسلَ", () => {
    const prev = applyTrackingEvent(INITIAL_TRACKING_STATE, event({ sequence: 1 }));
    const next = applyTrackingEvent(
      prev,
      event({ sequence: 2, position: { lat: 21.6, lng: 39.3 } }),
    );
    expect(next.position).toEqual({ lat: 21.6, lng: 39.3 });
    expect(next.sequence).toBe(2);
  });

  it("حدثٌ مساوٍ يُسقَطُ (BUG-009)", () => {
    const prev = applyTrackingEvent(INITIAL_TRACKING_STATE, event({ sequence: 5 }));
    const next = applyTrackingEvent(prev, event({ sequence: 5 }));
    expect(next).toBe(prev);
  });

  it("حدثٌ أقدمُ يُسقَطُ", () => {
    const prev = applyTrackingEvent(INITIAL_TRACKING_STATE, event({ sequence: 5 }));
    const next = applyTrackingEvent(prev, event({ sequence: 3 }));
    expect(next).toBe(prev);
  });

  it("sessionId مختلفٌ يُعيدُ الضبطَ ثمَّ يطبِّقُ", () => {
    const prev = applyTrackingEvent(INITIAL_TRACKING_STATE, event({ sequence: 10 }));
    const next = applyTrackingEvent(prev, event({ sequence: 1, sessionId: "sess-2" }));
    expect(next.sequence).toBe(1);
    expect(next.sessionId).toBe("sess-2");
  });

  it("position === null يُسقِطُ الموقعَ لكن يُحدِّثُ التسلسلَ", () => {
    const prev = applyTrackingEvent(INITIAL_TRACKING_STATE, event({ sequence: 1 }));
    const next = applyTrackingEvent(prev, event({ sequence: 2, position: null }));
    expect(next.position).toBeNull();
    expect(next.sequence).toBe(2);
  });

  it("shouldRefreshFromHttp: true متى تبدَّلَت الجلسةُ", () => {
    const prev = applyTrackingEvent(INITIAL_TRACKING_STATE, event({ sequence: 1 }));
    const next = applyTrackingEvent(prev, event({ sequence: 1, sessionId: "sess-2" }));
    expect(shouldRefreshFromHttp(prev, next)).toBe(true);
  });

  it("shouldRefreshFromHttp: false متى لم تتبدَّل الجلسةُ", () => {
    const prev = applyTrackingEvent(INITIAL_TRACKING_STATE, event({ sequence: 1 }));
    const next = applyTrackingEvent(prev, event({ sequence: 2 }));
    expect(shouldRefreshFromHttp(prev, next)).toBe(false);
  });
});
