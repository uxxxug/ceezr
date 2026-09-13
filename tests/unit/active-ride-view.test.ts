/**
 * الغرض: قياسُ نموذجِ عرضِ الرحلةِ النشطةِ — مفاتيحُ وأعدادٌ، ولا نصَّ معروضاً
 *   ولا مالاً (البند `F2-06` · القسم 9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-06`.
 * ينتمي إلى: tests/unit
 *
 * ولماذا يُقاسُ **إعادةُ الاستعمالِ** صريحاً: مصدرُ حقيقةٍ واحدٌ لحالةِ الرحلةِ
 * ومدّتِها بينَ شاشتَينِ. ولو نُسِخَ الجدولُ لَاختلفَ النصّانِ عندَ أوّلِ تعديلٍ.
 */

import { describe, expect, it } from "bun:test";
import {
  activeErrorKey,
  activePhaseKey,
  activeRefusalKey,
  cancelPolicyKey,
  driverIdentityLine,
  etaLine,
  isFreshPosition,
  positionLine,
  rideStatusKey,
  showsCancelButton,
} from "../../apps/miniapp/src/surfaces/rider/active/active-ride-view.ts";
import { rideStatusKey as searchStatusKey } from "../../apps/miniapp/src/surfaces/rider/search/search-view.ts";
import { DRIVER_POSITION_MAX_AGE_SECONDS } from "../../packages/domain/transport/active-ride.ts";

describe("مفاتيحُ الطَّورِ", () => {
  it("كلُّ طَورٍ معروفٍ مفتاحُه الخاصُّ", () => {
    expect(activePhaseKey("driver_assigned")).toBe("rider.active.phase.driverAssigned");
    expect(activePhaseKey("on_trip")).toBe("rider.active.phase.onTrip");
    expect(activePhaseKey("completed")).toBe("rider.active.phase.completed");
    expect(activePhaseKey("closed")).toBe("rider.active.phase.closed");
    expect(activePhaseKey("searching")).toBe("rider.active.phase.searching");
  });

  it("طَورٌ لا يُعرَفُ يُقالُ عامّاً لا رمزاً خاماً", () => {
    expect(activePhaseKey("teleported")).toBe("rider.active.phase.unknown");
  });

  it("حالةُ الرحلةِ تُقرأُ من مصدرِ `SR-05` نفسِه لا من نسخةٍ", () => {
    expect(rideStatusKey).toBe(searchStatusKey);
    expect(rideStatusKey("matched")).toBe("rider.search.status.matched");
  });
});

describe("سطرُ الموقعِ", () => {
  it("لا موقعَ أصلاً ⇒ لا سطرَ: لا صندوقَ فارغٌ ينتظرُ", () => {
    expect(positionLine(null)).toBeNull();
  });

  it("موقعٌ طازجٌ يُرسَمُ **بعُمرِه** في السطرِ نفسِه", () => {
    const line = positionLine({ show: true, lat: 21.4858, lng: 39.1925, ageSeconds: 12 });
    expect(line).toEqual({
      show: true,
      lat: 21.4858,
      lng: 39.1925,
      ageKey: "rider.active.position.ageSeconds",
      ageSeconds: 12,
      ageMinutes: 0,
    });
  });

  it("عُمرٌ فوقَ الدقيقةِ يُقالُ بدقائقِه وثوانيه", () => {
    const line = positionLine({ show: true, lat: 21.4, lng: 39.1, ageSeconds: 83 });
    expect(line).toEqual({
      show: true,
      lat: 21.4,
      lng: 39.1,
      ageKey: "rider.active.position.ageMinutes",
      ageSeconds: 23,
      ageMinutes: 1,
    });
  });

  it("كلُّ سببِ حجبٍ مفتاحُه، وما لا يُعرَفُ عامٌّ", () => {
    expect(positionLine({ show: false, reason: "NEVER_REPORTED" })).toEqual({
      show: false,
      key: "rider.active.position.neverReported",
    });
    expect(positionLine({ show: false, reason: "NO_TIMESTAMP" })).toEqual({
      show: false,
      key: "rider.active.position.noTimestamp",
    });
    expect(positionLine({ show: false, reason: "TOO_OLD" })).toEqual({
      show: false,
      key: "rider.active.position.tooOld",
    });
    expect(positionLine({ show: false, reason: "MOON" })).toEqual({
      show: false,
      key: "rider.active.position.unknown",
    });
  });

  it("حدُّ الطزاجةِ من النطاقِ لا من رقمٍ مكتوبٍ في الشاشةِ", () => {
    expect(isFreshPosition(DRIVER_POSITION_MAX_AGE_SECONDS)).toBe(true);
    expect(isFreshPosition(DRIVER_POSITION_MAX_AGE_SECONDS + 1)).toBe(false);
    expect(isFreshPosition(-1)).toBe(false);
  });
});

describe("سطرُ مدّةِ الوصولِ", () => {
  it("لا سؤالَ ⇒ لا سطرَ", () => {
    expect(etaLine(null)).toBeNull();
  });

  it("مدّةٌ مُوجَّهةٌ تُعرَضُ بدقائقِها", () => {
    expect(etaLine({ kind: "ROUTED", minutes: 7 })).toEqual({
      kind: "ROUTED",
      key: "rider.active.eta.minutes",
      minutes: 7,
    });
  });

  it("صفرُ دقائقَ لا يُعرَضُ صفراً: صفرٌ يُقرأُ «وصلَ»", () => {
    expect(etaLine({ kind: "ROUTED", minutes: 0 })).toEqual({
      kind: "ROUTED",
      key: "rider.active.eta.minutes",
      minutes: 1,
    });
  });

  it("كلُّ سببِ امتناعٍ مفتاحُه — ولا شَرطةَ تُساويها", () => {
    expect(etaLine({ kind: "UNAVAILABLE", reason: "NOT_CONFIGURED" })?.key).toBe(
      "rider.active.eta.notConfigured",
    );
    expect(etaLine({ kind: "UNAVAILABLE", reason: "PROVIDER_DOWN" })?.key).toBe(
      "rider.active.eta.providerDown",
    );
    expect(etaLine({ kind: "UNAVAILABLE", reason: "NO_ROUTE" })?.key).toBe(
      "rider.active.eta.noRoute",
    );
    expect(etaLine({ kind: "UNAVAILABLE", reason: "OFF_ROAD" })?.key).toBe(
      "rider.active.eta.offRoad",
    );
    expect(etaLine({ kind: "UNAVAILABLE", reason: "SNAP_UNKNOWN" })?.key).toBe(
      "rider.active.eta.snapUnknown",
    );
    expect(etaLine({ kind: "UNAVAILABLE", reason: "IMPLAUSIBLE" })?.key).toBe(
      "rider.active.eta.implausible",
    );
    expect(etaLine({ kind: "UNAVAILABLE", reason: "NO_INPUT" })?.key).toBe(
      "rider.active.eta.noInput",
    );
    expect(etaLine({ kind: "UNAVAILABLE", reason: "WHATEVER" })?.key).toBe(
      "rider.active.eta.unknown",
    );
  });
});

describe("سياسةُ الإلغاءِ والزرُّ", () => {
  it("كلُّ رمزٍ مفتاحُه", () => {
    expect(cancelPolicyKey("FREE_BEFORE_ASSIGNMENT")).toBe("rider.active.cancel.beforeAssignment");
    expect(cancelPolicyKey("AFTER_ASSIGNMENT_UNDECIDED")).toBe(
      "rider.active.cancel.afterAssignment",
    );
    expect(cancelPolicyKey("NOT_CANCELLABLE")).toBe("rider.active.cancel.notCancellable");
    expect(cancelPolicyKey("SOMETHING")).toBe("rider.active.cancel.unknown");
  });

  it("الزرُّ للحرِّ وحدَه: زرٌّ يُرفَضُ حتماً أسوأُ من غيابِه", () => {
    expect(showsCancelButton("FREE_BEFORE_ASSIGNMENT")).toBe(true);
    expect(showsCancelButton("AFTER_ASSIGNMENT_UNDECIDED")).toBe(false);
    expect(showsCancelButton("NOT_CANCELLABLE")).toBe(false);
  });
});

describe("سطرُ هويّةِ السائقِ", () => {
  it("ما عرفَته القاعدةُ يُقالُ كما هوَ", () => {
    const line = driverIdentityLine({
      firstName: "خالد",
      vehicleType: "سيدان",
      plateNumber: "ABC 1234",
      ratingAverage: 4.7,
      ratingCount: 31,
    });
    expect(line.nameKey).toBe("rider.active.driver.name");
    expect(line.name).toBe("خالد");
    expect(line.vehicleKey).toBe("rider.active.driver.vehicle");
    expect(line.plateKey).toBe("rider.active.driver.plate");
    expect(line.ratingKey).toBe("rider.active.driver.rating");
    expect(line.ratingAverage).toBe(4.7);
    expect(line.ratingCount).toBe(31);
  });

  it("ما لم تعرفْه يُقالُ مجهولاً ولا يُلفَّقُ", () => {
    const line = driverIdentityLine({
      firstName: null,
      vehicleType: null,
      plateNumber: null,
      ratingAverage: null,
      ratingCount: 0,
    });
    expect(line.nameKey).toBe("rider.active.driver.nameUnknown");
    expect(line.vehicleKey).toBe("rider.active.driver.vehicleUnknown");
    expect(line.plateKey).toBe("rider.active.driver.plateUnknown");
    expect(line.ratingKey).toBe("rider.active.driver.ratingNone");
  });

  it("تقييمٌ بلا رحلاتٍ ليسَ تقييماً: لا يُعرَضُ رقمٌ بعددٍ صفرٍ", () => {
    const line = driverIdentityLine({
      firstName: "سارة",
      vehicleType: null,
      plateNumber: null,
      ratingAverage: 5,
      ratingCount: 0,
    });
    expect(line.ratingKey).toBe("rider.active.driver.ratingNone");
  });
});

describe("مفاتيحُ الرفضِ والعطبِ", () => {
  it("الرفضُ المعروفُ مفتاحُه، وسواه عامٌّ", () => {
    expect(activeRefusalKey("INVALID_ORDER_ID")).toBe("rider.active.read.invalidId");
    expect(activeRefusalKey("ORDER_NOT_FOUND")).toBe("rider.active.read.notFound");
    expect(activeRefusalKey("X")).toBe("rider.active.read.unknown");
  });

  it("رموزُ الجلسةِ الثلاثةُ نصٌّ واحدٌ: الراكبُ يفعلُ فعلاً واحداً", () => {
    expect(activeErrorKey("SESSION_REQUIRED")).toBe("rider.active.error.session");
    expect(activeErrorKey("SESSION_INVALID")).toBe("rider.active.error.session");
    expect(activeErrorKey("SESSION_EXPIRED")).toBe("rider.active.error.session");
  });

  it("رمزٌ لا يُعرَفُ يُقالُ «غيرُ متاحٍ» ولا يُخترَعُ تشخيصٌ", () => {
    expect(activeErrorKey("SOMETHING_NEW")).toBe("rider.active.error.unavailable");
  });
});
