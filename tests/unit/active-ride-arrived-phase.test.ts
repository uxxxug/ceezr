/**
 * اختباراتُ طورِ الرحلةِ النشطةِ مع ختمِ «وصلَ السائقُ» (البندانِ `F2-06` و`F3-03`).
 */

import { describe, expect, it } from "bun:test";
import {
  type ActiveRideSnapshot,
  activeRideInconsistency,
  activeRidePhaseOf,
  cancelPolicyOf,
  isActivePhase,
} from "../../packages/domain/transport/active-ride.ts";

function snapshot(overrides: Partial<ActiveRideSnapshot> = {}): ActiveRideSnapshot {
  return {
    status: "matched",
    hasDriver: true,
    arrivedAtMs: null,
    startedAtMs: null,
    ...overrides,
  };
}

describe("activeRidePhaseOf مع ختم الوصول", () => {
  it("matched + سائق + لا ختم وصول ⇒ driver_assigned", () => {
    expect(activeRidePhaseOf(snapshot())).toBe("driver_assigned");
  });

  it("matched + سائق + ختم وصول ⇒ driver_arrived", () => {
    expect(activeRidePhaseOf(snapshot({ arrivedAtMs: 1_000 }))).toBe("driver_arrived");
  });

  it("matched + بلا سائق ⇒ searching (حتى لو وُجِدَ ختمٌ)", () => {
    expect(activeRidePhaseOf(snapshot({ hasDriver: false, arrivedAtMs: 1_000 }))).toBe("searching");
  });

  it("in_progress ⇒ on_trip (ختمُ الوصولِ لا يُقدَّمُ على الجريانِ)", () => {
    expect(activeRidePhaseOf(snapshot({ status: "in_progress", arrivedAtMs: 1_000 }))).toBe(
      "on_trip",
    );
  });

  it("completed ⇒ completed", () => {
    expect(activeRidePhaseOf(snapshot({ status: "completed", arrivedAtMs: 1_000 }))).toBe(
      "completed",
    );
  });

  it("cancelled ⇒ closed", () => {
    expect(activeRidePhaseOf(snapshot({ status: "cancelled" }))).toBe("closed");
  });

  it("driver_arrived طورٌ نشطٌ", () => {
    expect(isActivePhase("driver_arrived")).toBe(true);
  });

  it("سياسةُ إلغاءِ طورِ driver_arrived: AFTER_ASSIGNMENT_UNDECIDED", () => {
    expect(cancelPolicyOf("driver_arrived")).toBe("AFTER_ASSIGNMENT_UNDECIDED");
  });
});

describe("activeRideInconsistency — فحصُ الاتّساقِ (الخطوةُ الثانية)", () => {
  it("matched + سائق + لا وصول ⇒ لا خللَ", () => {
    expect(activeRideInconsistency(snapshot())).toBeNull();
  });

  it("matched + سائق + وصول ⇒ لا خللَ", () => {
    expect(activeRideInconsistency(snapshot({ arrivedAtMs: 1_000 }))).toBeNull();
  });

  it("in_progress + سائق + وصول + بدء ⇒ لا خللَ", () => {
    expect(
      activeRideInconsistency(
        snapshot({ status: "in_progress", arrivedAtMs: 1_000, startedAtMs: 2_000 }),
      ),
    ).toBeNull();
  });

  it("arrived_at بلا سائق ⇒ ARRIVED_WITHOUT_DRIVER", () => {
    expect(activeRideInconsistency(snapshot({ hasDriver: false, arrivedAtMs: 1_000 }))).toBe(
      "ARRIVED_WITHOUT_DRIVER",
    );
  });

  it("started_at بلا arrived_at ⇒ STARTED_WITHOUT_ARRIVAL", () => {
    expect(
      activeRideInconsistency(
        snapshot({ status: "in_progress", startedAtMs: 2_000, arrivedAtMs: null }),
      ),
    ).toBe("STARTED_WITHOUT_ARRIVAL");
  });

  it("matched بلا سائق ⇒ MATCHED_WITHOUT_DRIVER", () => {
    expect(activeRideInconsistency(snapshot({ hasDriver: false }))).toBe("MATCHED_WITHOUT_DRIVER");
  });

  it("searching بلا سائق ⇒ لا خللَ", () => {
    expect(
      activeRideInconsistency(
        snapshot({ status: "searching", hasDriver: false, arrivedAtMs: null }),
      ),
    ).toBeNull();
  });

  it("completed ⇒ لا خللَ", () => {
    expect(
      activeRideInconsistency(
        snapshot({ status: "completed", arrivedAtMs: 1_000, startedAtMs: 2_000 }),
      ),
    ).toBeNull();
  });
});
