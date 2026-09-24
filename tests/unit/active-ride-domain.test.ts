/**
 * الغرض: قياسُ نطاقِ الرحلةِ النشطةِ — الطَّورُ، وحكمُ نقطةِ السائقِ بعُمرِها،
 *   وسياسةُ الإلغاءِ (البند `F2-06`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-06`.
 * ينتمي إلى: tests/unit
 *
 * ولماذا تُقاسُ الحدودُ بالثانيةِ الواحدةِ: حدُّ العُمرِ قرارٌ، ومن قاسَ «قديمٌ
 * جدّاً» بلا حدٍّ مكتوبٍ قاسَ مزاجَه. فالتسعونَ تُقبَلُ والحاديةُ والتسعونَ تُرفَضُ،
 * ولو انقلبَ الحكمُ لَسقطَ هذا الاختبارُ ولم يسقطْ راكبٌ في انتظارِ نقطةٍ ميتةٍ.
 */

import { describe, expect, it } from "bun:test";
import {
  activeRidePhaseOf,
  cancelPolicyOf,
  DRIVER_POSITION_MAX_AGE_SECONDS,
  driverPositionVerdict,
  isActivePhase,
} from "../../packages/domain/transport/active-ride.ts";

describe("طَورُ الرحلةِ", () => {
  it("`matched` معَ سائقٍ ⇒ إسنادٌ", () => {
    expect(
      activeRidePhaseOf({
        status: "matched",
        hasDriver: true,
        arrivedAtMs: null,
        startedAtMs: null,
      }),
    ).toBe("driver_assigned");
  });

  it("`matched` بلا سائقٍ ⇒ بحثٌ لا إسنادٌ: بطاقةٌ غائبةٌ ليسَت سائقاً", () => {
    expect(
      activeRidePhaseOf({
        status: "matched",
        hasDriver: false,
        arrivedAtMs: null,
        startedAtMs: null,
      }),
    ).toBe("searching");
  });

  it("`in_progress` معَ سائقٍ ⇒ رحلةٌ جارِيةٌ", () => {
    expect(
      activeRidePhaseOf({
        status: "in_progress",
        hasDriver: true,
        arrivedAtMs: null,
        startedAtMs: null,
      }),
    ).toBe("on_trip");
  });

  it("`in_progress` بلا سائقٍ ⇒ مُغلَقٌ: حالةٌ لا تُرسَمُ رحلةً جارِيةً", () => {
    expect(
      activeRidePhaseOf({
        status: "in_progress",
        hasDriver: false,
        arrivedAtMs: null,
        startedAtMs: null,
      }),
    ).toBe("closed");
  });

  it("`completed` ⇒ انتهَت، و`cancelled`/`failed` ⇒ مُغلَقةٌ", () => {
    expect(
      activeRidePhaseOf({
        status: "completed",
        hasDriver: true,
        arrivedAtMs: null,
        startedAtMs: null,
      }),
    ).toBe("completed");
    expect(
      activeRidePhaseOf({
        status: "cancelled",
        hasDriver: false,
        arrivedAtMs: null,
        startedAtMs: null,
      }),
    ).toBe("closed");
    expect(
      activeRidePhaseOf({
        status: "failed",
        hasDriver: false,
        arrivedAtMs: null,
        startedAtMs: null,
      }),
    ).toBe("closed");
  });

  it("`searching` ⇒ بحثٌ", () => {
    expect(
      activeRidePhaseOf({
        status: "searching",
        hasDriver: false,
        arrivedAtMs: null,
        startedAtMs: null,
      }),
    ).toBe("searching");
  });

  it("النشطُ هما الإسنادُ والرحلةُ وحدَهما", () => {
    expect(isActivePhase("driver_assigned")).toBe(true);
    expect(isActivePhase("on_trip")).toBe(true);
    expect(isActivePhase("searching")).toBe(false);
    expect(isActivePhase("completed")).toBe(false);
    expect(isActivePhase("closed")).toBe(false);
  });
});

describe("حكمُ نقطةِ السائقِ", () => {
  it("لا نقطةَ أصلاً ⇒ لم يُبلِّغْ بعدُ", () => {
    expect(driverPositionVerdict(null)).toEqual({ show: false, reason: "NEVER_REPORTED" });
  });

  it("نقطةٌ بلا ختمٍ ⇒ لا تُرسَمُ، ولا تُقرأُ عُمراً صفراً", () => {
    expect(driverPositionVerdict({ lat: 21.5, lng: 39.2, ageSeconds: null })).toEqual({
      show: false,
      reason: "NO_TIMESTAMP",
    });
  });

  it("عُمرٌ على الحدِّ تماماً يُعرَضُ", () => {
    const verdict = driverPositionVerdict({
      lat: 21.5,
      lng: 39.2,
      ageSeconds: DRIVER_POSITION_MAX_AGE_SECONDS,
    });
    expect(verdict.show).toBe(true);
    if (verdict.show) expect(verdict.ageSeconds).toBe(DRIVER_POSITION_MAX_AGE_SECONDS);
  });

  it("ثانيةٌ فوقَ الحدِّ تُحجَبُ **بعُمرِها مُعلَناً** لا بصمتٍ", () => {
    const verdict = driverPositionVerdict({
      lat: 21.5,
      lng: 39.2,
      ageSeconds: DRIVER_POSITION_MAX_AGE_SECONDS + 1,
    });
    expect(verdict).toEqual({
      show: false,
      reason: "TOO_OLD",
      ageSeconds: DRIVER_POSITION_MAX_AGE_SECONDS + 1,
    });
  });

  it("نقطةٌ طازجةٌ تُعرَضُ بإحداثيَّتِها كما هيَ", () => {
    const verdict = driverPositionVerdict({ lat: 21.4858, lng: 39.1925, ageSeconds: 4 });
    expect(verdict).toEqual({
      show: true,
      position: { lat: 21.4858, lng: 39.1925, ageSeconds: 4 },
      ageSeconds: 4,
    });
  });
});

describe("سياسةُ الإلغاءِ", () => {
  it("قبلَ الإسنادِ حرٌّ، وبعدَه غيرُ مُقرَّرٍ، وسواهما لا يُلغى", () => {
    expect(cancelPolicyOf("searching")).toBe("FREE_BEFORE_ASSIGNMENT");
    expect(cancelPolicyOf("driver_assigned")).toBe("AFTER_ASSIGNMENT_UNDECIDED");
    expect(cancelPolicyOf("on_trip")).toBe("NOT_CANCELLABLE");
    expect(cancelPolicyOf("completed")).toBe("NOT_CANCELLABLE");
    expect(cancelPolicyOf("closed")).toBe("NOT_CANCELLABLE");
  });
});
