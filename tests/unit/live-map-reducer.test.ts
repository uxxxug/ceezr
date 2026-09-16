/**
 * الغرض: اختبار وحدة اختزال حالة خريطة العمليات الحيّة من مجرى SSE.
 * الحالة: مُضافة في المرحلة ١٣ — F4-06.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import {
  applySnapshot,
  applyTrackingDelta,
  EMPTY_LIVE_MAP_STATE,
  type SnapshotRow,
  type TrackingDelta,
} from "../../packages/maps/live-map-reducer.ts";

const SESSION_ID = "session-001";
const OTHER_SESSION_ID = "session-002";

function row(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    driverId: "driver-1",
    driverName: "سائق ١",
    cityCode: "JED",
    status: "AVAILABLE",
    lat: 21.5,
    lng: 39.2,
    quality: "ACCEPT",
    accuracyMeters: 10,
    lastFixAt: "2026-09-16T00:00:00.000Z",
    sessionStartedAt: "2026-09-16T00:00:00.000Z",
    tripId: null,
    tripStatus: null,
    isAvailable: true,
    sessionSequence: 5,
    sessionId: SESSION_ID,
    ...overrides,
  };
}

function delta(overrides: Partial<TrackingDelta> = {}): TrackingDelta {
  return {
    type: "location_updated",
    driverId: "driver-1",
    tripId: null,
    sessionId: SESSION_ID,
    sequence: 6,
    cityId: null,
    position: { lat: 21.6, lng: 39.3 },
    at: "2026-09-16T00:00:01.000Z",
    ...overrides,
  };
}

describe("اختزال اللقطة (snapshot)", () => {
  it("لقطةٌ فارغةٌ تُنتج حالةً فارغة", () => {
    const state = applySnapshot(EMPTY_LIVE_MAP_STATE, "2026-09-16T00:00:00.000Z", []);
    expect(state.rows).toHaveLength(0);
    expect(state.lastSeq).toBeNull();
    expect(state.lastSnapshotAt).toBe("2026-09-16T00:00:00.000Z");
  });

  it("لقطةٌ كاملةٌ تستبدل الصفوف السابقة", () => {
    const first = applySnapshot(EMPTY_LIVE_MAP_STATE, "t1", [row({ driverId: "d1" })]);
    const second = applySnapshot(first, "t2", [row({ driverId: "d2" })]);
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]?.driverId).toBe("d2");
    expect(second.lastSnapshotAt).toBe("t2");
  });

  it("أحدثُ تسلسلٍ في اللقطة يُضبَط كمرساة", () => {
    const rows = [
      row({ driverId: "d1", sessionSequence: 3 }),
      row({ driverId: "d2", sessionSequence: 8 }),
      row({ driverId: "d3", sessionSequence: 1 }),
    ];
    const state = applySnapshot(EMPTY_LIVE_MAP_STATE, "t", rows);
    expect(state.lastSeq).toBe(8);
  });
});

describe("اختزال الدلتا (tracking)", () => {
  it("دلتا أحدثُ من اللقطة تُحدّث الموضع", () => {
    const state = applySnapshot(EMPTY_LIVE_MAP_STATE, "t", [row({ sessionSequence: 5 })]);
    const next = applyTrackingDelta(
      state,
      delta({ sequence: 6, position: { lat: 21.7, lng: 39.4 } }),
    );
    expect(next.rows[0]?.lat).toBe(21.7);
    expect(next.rows[0]?.lng).toBe(39.4);
    expect(next.lastSeq).toBe(6);
  });

  it("دلتا بتسلسلٍ أقلَّ تُسقَط — لا تراجع", () => {
    const state = applySnapshot(EMPTY_LIVE_MAP_STATE, "t", [row({ sessionSequence: 5 })]);
    const next = applyTrackingDelta(state, delta({ sequence: 4, position: { lat: 99, lng: 99 } }));
    expect(next.rows[0]?.lat).toBe(21.5);
    expect(next.lastSeq).toBe(5);
  });

  it("دلتا بتسلسلٍ مساوٍ تُسقَط", () => {
    const state = applySnapshot(EMPTY_LIVE_MAP_STATE, "t", [row({ sessionSequence: 5 })]);
    const next = applyTrackingDelta(state, delta({ sequence: 5, position: { lat: 99, lng: 99 } }));
    expect(next.rows[0]?.lat).toBe(21.5);
  });

  it("دلتا من جلسةٍ مختلفة تُؤجَّل — لا تُطبَّق", () => {
    const state = applySnapshot(EMPTY_LIVE_MAP_STATE, "t", [row({ sessionSequence: 5 })]);
    const next = applyTrackingDelta(
      state,
      delta({ sequence: 10, sessionId: OTHER_SESSION_ID, position: { lat: 99, lng: 99 } }),
    );
    expect(next.rows[0]?.lat).toBe(21.5);
    expect(next.lastSeq).toBe(5);
  });

  it("دلتا بموضعٍ null لا تحرّك الدبوس لكنها تُحدّث التسلسل", () => {
    const state = applySnapshot(EMPTY_LIVE_MAP_STATE, "t", [row({ sessionSequence: 5 })]);
    const next = applyTrackingDelta(state, delta({ sequence: 6, position: null }));
    expect(next.rows[0]?.lat).toBe(21.5);
    expect(next.lastSeq).toBe(6);
  });

  it("دلتا لسائقٍ غير موجود في اللقطة لا تُسقط الحالة", () => {
    const state = applySnapshot(EMPTY_LIVE_MAP_STATE, "t", [row({ driverId: "d1" })]);
    const next = applyTrackingDelta(state, delta({ driverId: "unknown", sequence: 6 }));
    expect(next.rows).toHaveLength(1);
    expect(next.lastSeq).toBe(6);
  });
});
