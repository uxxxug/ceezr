/**
 * الغرض: إثباتُ أن الحالاتِ العشر التشغيلية تُشتَقّ صحيحةً من الوقائع، وأن ترتيبَ
 *   الأولويات هو المقصود لا نتيجةَ ترتيبِ الشروط في الشيفرة.
 * الحالة: منفّذ فعلياً — المرحلة ١٣.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import type { Coordinates } from "../../packages/domain/geo/value-objects.ts";
import {
  DEFAULT_OPERATIONS_POLICY,
  needsAttention,
  type OperationsFacts,
  type OperationsStatus,
  operationsStatusOf,
} from "../../packages/domain/tracking/operations-status.ts";
import { DEFAULT_SESSION_POLICY } from "../../packages/domain/tracking/session.ts";

const NOW = Date.UTC(2026, 7, 12, 10, 0, 0);
const MINUTE = 60_000;
/**
 * `DEFAULT_SESSION_POLICY.staleAfterSeconds` = ٣٠ ثانية (سياسةٌ قائمةٌ منذ
 * المرحلة ٥ ويستعملها التوزيع أيضاً — ADR 0017). فإصلاحةٌ عمرُها دقيقةٌ **منقطعة**
 * لا حديثة، وتجهيزُ «الجلسة الحيّة» يجب أن يكون أحدثَ من ذلك.
 */
const FRESH_MS = 5_000;

const PICKUP: Coordinates = { latitude: 21.5471, longitude: 39.1751 };
/** نحو ٩٠ متراً شمالَ الانطلاق — داخل نصف قطر الوصول (١٥٠م). */
const NEAR_PICKUP: Coordinates = { latitude: 21.5479, longitude: 39.1751 };
/** نحو ١.٩ كم — خارجه بيقين. */
const FAR: Coordinates = { latitude: 21.564, longitude: 39.1751 };
const DEST: Coordinates = { latitude: 21.5601, longitude: 39.1901 };

function openSession(overrides: Partial<OperationsFacts["session"]> = {}) {
  return {
    driverId: "d1",
    tripId: null,
    startedAtMs: NOW - 10 * MINUTE,
    lastFixAtMs: NOW - FRESH_MS,
    endedAtMs: null,
    endReason: null,
    ...overrides,
  };
}

function facts(overrides: Partial<OperationsFacts> = {}): OperationsFacts {
  return {
    session: openSession(),
    isAvailable: true,
    driverLocation: PICKUP,
    trip: null,
    ...overrides,
  };
}

const statusOf = (o: Partial<OperationsFacts> = {}): OperationsStatus =>
  operationsStatusOf(facts(o), NOW);

describe("الحالة التشغيلية للسائق — الحالات العشر", () => {
  it("في الخدمة بلا رحلة ⇒ AVAILABLE", () => {
    expect(statusOf({ isAvailable: true, trip: null })).toBe("AVAILABLE");
  });

  it("لا جلسة ولا رحلة ولا إتاحة ⇒ OFFLINE", () => {
    expect(statusOf({ session: null, isAvailable: false })).toBe("OFFLINE");
  });

  it("جلسةٌ مفتوحةٌ لكن خارج الخدمة وبلا رحلة ⇒ OFFLINE لا AVAILABLE", () => {
    // الإتاحة المُعلنة هي الحاكم، لا مجرّد وجود جلسة: جلسةٌ متأخّرةُ الإغلاق
    // (الخطر R-45) لا يجوز أن تُعرض السائقَ متاحاً فيُسنَد إليه طلب.
    expect(statusOf({ isAvailable: false, trip: null })).toBe("OFFLINE");
  });

  it("جلسةٌ فُتحت ولم تصل إصلاحةٌ بعد ورحلةٌ مُسنَدة ⇒ ASSIGNED", () => {
    expect(
      statusOf({
        session: openSession({ lastFixAtMs: null, startedAtMs: NOW - FRESH_MS }),
        trip: { status: "matched", pickup: PICKUP, destination: DEST },
      }),
    ).toBe("ASSIGNED");
  });

  it("مُسنَدٌ بلا موقعٍ معروف ⇒ ASSIGNED لا TO_PICKUP", () => {
    expect(
      statusOf({
        driverLocation: null,
        trip: { status: "matched", pickup: PICKUP, destination: DEST },
      }),
    ).toBe("ASSIGNED");
  });

  it("مُسنَدٌ ونقطةُ الانطلاق مجهولة ⇒ ASSIGNED", () => {
    expect(statusOf({ trip: { status: "matched", pickup: null, destination: DEST } })).toBe(
      "ASSIGNED",
    );
  });

  it("مُسنَدٌ وبعيدٌ عن الانطلاق ⇒ TO_PICKUP", () => {
    expect(
      statusOf({
        driverLocation: FAR,
        trip: { status: "matched", pickup: PICKUP, destination: DEST },
      }),
    ).toBe("TO_PICKUP");
  });

  it("مُسنَدٌ وعند الانطلاق ⇒ AT_PICKUP", () => {
    expect(
      statusOf({
        driverLocation: NEAR_PICKUP,
        trip: { status: "matched", pickup: PICKUP, destination: DEST },
      }),
    ).toBe("AT_PICKUP");
  });

  it("رحلةٌ جارية والسائق ما زال عند الانطلاق ⇒ PICKED_UP", () => {
    expect(
      statusOf({
        driverLocation: NEAR_PICKUP,
        trip: { status: "in_progress", pickup: PICKUP, destination: DEST },
      }),
    ).toBe("PICKED_UP");
  });

  it("رحلةٌ جارية وابتعد عن الانطلاق ⇒ TO_CUSTOMER", () => {
    expect(
      statusOf({
        driverLocation: FAR,
        trip: { status: "in_progress", pickup: PICKUP, destination: DEST },
      }),
    ).toBe("TO_CUSTOMER");
  });

  it("رحلةٌ جارية والسائق عند المقصد ⇒ ARRIVED", () => {
    expect(
      statusOf({
        driverLocation: DEST,
        trip: { status: "in_progress", pickup: PICKUP, destination: DEST },
      }),
    ).toBe("ARRIVED");
  });

  it("رحلةٌ اكتملت والجلسةُ ما زالت مفتوحة ⇒ COMPLETED", () => {
    expect(statusOf({ trip: { status: "completed", pickup: PICKUP, destination: DEST } })).toBe(
      "COMPLETED",
    );
  });

  it("جلسةٌ انقطعت إصلاحاتُها ⇒ STALE", () => {
    const stalePastSeconds = DEFAULT_SESSION_POLICY.staleAfterSeconds + 5;
    expect(statusOf({ session: openSession({ lastFixAtMs: NOW - stalePastSeconds * 1000 }) })).toBe(
      "STALE",
    );
  });
});

describe("ترتيب الأولويات مقصود", () => {
  it("STALE تتقدّم على وصف المرحلة: لا يُقال TO_CUSTOMER لسائقٍ انقطع", () => {
    const stalePastSeconds = DEFAULT_SESSION_POLICY.staleAfterSeconds + 5;
    expect(
      statusOf({
        session: openSession({ lastFixAtMs: NOW - stalePastSeconds * 1000 }),
        driverLocation: FAR,
        trip: { status: "in_progress", pickup: PICKUP, destination: DEST },
      }),
    ).toBe("STALE");
  });

  it("رحلةٌ حيّةٌ وجلستُها أُغلقت ⇒ STALE لا OFFLINE: السائق يبقى مرئياً", () => {
    // هذا هو العيب P0 المقيس في المرحلة ١٣: راكبٌ في سيّارةٍ والمشغّل لا يرى
    // سائقها ألبتّة. الرحلةُ الحيّة أقوى سببٍ للإبقاء على الرؤية.
    expect(
      statusOf({
        session: null,
        isAvailable: false,
        driverLocation: FAR,
        trip: { status: "in_progress", pickup: PICKUP, destination: DEST },
      }),
    ).toBe("STALE");
  });

  it("رحلةٌ اكتملت والجلسةُ أُغلقت ⇒ يعود إلى وصف دوامه لا COMPLETED للأبد", () => {
    expect(
      statusOf({
        session: null,
        isAvailable: true,
        trip: { status: "completed", pickup: PICKUP, destination: DEST },
      }),
    ).toBe("AVAILABLE");
  });

  it("رحلةٌ ملغاةٌ لا تُلزم بشيء ⇒ وصفُ الدوام", () => {
    expect(
      statusOf({
        isAvailable: true,
        trip: { status: "cancelled", pickup: PICKUP, destination: DEST },
      }),
    ).toBe("AVAILABLE");
  });

  it("جلسةٌ تجاوزت سقفَها الزمني ⇒ تُحسب منتهية", () => {
    const overCapMs = (DEFAULT_SESSION_POLICY.maxSessionSeconds + 60) * 1000;
    expect(
      statusOf({
        session: openSession({ startedAtMs: NOW - overCapMs, lastFixAtMs: NOW - FRESH_MS }),
        isAvailable: false,
        trip: null,
      }),
    ).toBe("OFFLINE");
  });
});

describe("نصف قطر الوصول", () => {
  it("مئةٌ وخمسون متراً هي السياسة الافتراضية", () => {
    expect(DEFAULT_OPERATIONS_POLICY.arrivalRadiusKm).toBe(0.15);
  });

  it("نصفُ قطرٍ أوسع يُحوّل TO_PICKUP إلى AT_PICKUP — فالسياسة هي الحاكم", () => {
    const f = facts({
      driverLocation: FAR,
      trip: { status: "matched", pickup: PICKUP, destination: DEST },
    });
    expect(operationsStatusOf(f, NOW)).toBe("TO_PICKUP");
    expect(operationsStatusOf(f, NOW, { arrivalRadiusKm: 5 })).toBe("AT_PICKUP");
  });

  it("المقصدُ المجهول لا يُنتج ARRIVED", () => {
    expect(
      statusOf({
        driverLocation: FAR,
        trip: { status: "in_progress", pickup: PICKUP, destination: null },
      }),
    ).toBe("TO_CUSTOMER");
  });
});

describe("ما يستدعي تدخّلاً", () => {
  it("STALE وASSIGNED وحدهما", () => {
    expect(needsAttention("STALE")).toBe(true);
    expect(needsAttention("ASSIGNED")).toBe(true);
    expect(needsAttention("TO_PICKUP")).toBe(false);
    expect(needsAttention("AVAILABLE")).toBe(false);
    expect(needsAttention("OFFLINE")).toBe(false);
  });
});
