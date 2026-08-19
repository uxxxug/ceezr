/**
 * الغرض: إثبات أن مشهد رحلة السائق يقول الحقيقة في كل حالة — بمقصدٍ وبلا مقصد،
 *   بموقعٍ للسائق وبلا موقع، وفي كلتا المرحلتين — وأن الدبّوس لا يُختلَق أبداً.
 * الحالة: منفّذ فعلياً — المرحلة ١٢.
 * ينتمي إلى: tests/unit
 *
 * ولماذا هذا الملف موجود: العيب الذي أسقط أربعة اختبارات تكامل في هذه المرحلة لم
 * يكن في المنطق بل في **نموذجٍ ألزم المقصد** والقاعدة تُجيز فراغه. فتُثبَّت هنا
 * الحالة المُجازة صراحةً كي لا يعود الإلزام خِلسةً في تعديلٍ لاحق.
 */

import { describe, expect, it } from "bun:test";
import {
  driverTripPin,
  driverTripText,
} from "../../packages/application/bots/driver-trip-reply.ts";
import type { EtaVerdict } from "../../packages/domain/eta/index.ts";
import {
  type DriverTripFacts,
  driverTripView,
  legOf,
  type TripWaypoint,
} from "../../packages/domain/tracking/driver-trip-view.ts";
import { translate } from "../../packages/shared/i18n/index.ts";

const tr = (key: string, params?: Record<string, string | number>) =>
  translate("ar", key, params ?? {});

const HARAM: TripWaypoint = {
  coordinates: { latitude: 21.5471, longitude: 39.1751 },
  label: "الحرم",
};
const AIRPORT: TripWaypoint = {
  coordinates: { latitude: 21.5601, longitude: 39.1901 },
  label: "المطار",
};
const UNNAMED: TripWaypoint = {
  coordinates: { latitude: 21.5534, longitude: 39.1751 },
  label: null,
};

const facts = (over: Partial<DriverTripFacts> = {}): DriverTripFacts => ({
  tripId: "trip-1",
  status: "matched",
  pickup: HARAM,
  destination: AIRPORT,
  ...over,
});

/**
 * المرحلة ١٥ — هذه الاختبارات تقيس **النصّ** لا زمنَ الوصول. وحُكمُ الامتناع
 * `NOT_CONFIGURED` هو ما يُسكت سطرَ الزمن كلّياً، فتبقى هذه التوكيدات تقيس ما
 * كانت تقيسه بحرفه: منصّةٌ بلا مزوّد توجيهٍ تعرض بطاقةً كما كانت قبل المرحلة.
 */
const NO_ETA: EtaVerdict = { kind: "UNAVAILABLE", reason: "NOT_CONFIGURED" };

describe("مرحلة السائق تُشتقّ من حالة الطلب", () => {
  it("matched يعني في الطريق إلى الانطلاق، وin_progress يعني إلى المقصد", () => {
    expect(legOf("matched")).toBe("TO_PICKUP");
    expect(legOf("in_progress")).toBe("TO_DESTINATION");
  });

  it("الوجهة الآن هي الانطلاق قبل الصعود والمقصد بعده — لا نقطة ثالثة", () => {
    const before = driverTripView(facts({ status: "matched" }), null);
    expect(before.target).toEqual(HARAM);
    const after = driverTripView(facts({ status: "in_progress" }), null);
    expect(after.target).toEqual(AIRPORT);
  });
});

describe("مشهد رحلة السائق يفصح عمّا لا يعرفه", () => {
  it("بلا موقعٍ للسائق: لا مسافة، ولا رقم مختلَق", () => {
    const view = driverTripView(facts(), null);
    expect(view.driverLocation).toBeNull();
    expect(view.distanceToTargetKm).toBeNull();
    expect(view.distanceKind).toBe("STRAIGHT_LINE");
  });

  it("بموقعٍ للسائق: مسافةٌ مستقيمة بمنزلةٍ واحدة، موسومةٌ بأنها مستقيمة", () => {
    // ‏JEDDAH ثم JEDDAH_MOVED شمالاً نحو ٧٠٠ متر
    const view = driverTripView(facts(), { latitude: 21.5534, longitude: 39.1751 });
    const km = view.distanceToTargetKm;
    expect(km).toBeCloseTo(0.7, 1);
    // منزلةٌ عشريةٌ واحدة لا أكثر: التقريب في المجال لا في طبقة العرض
    expect(Number.isInteger((km ?? 0) * 10)).toBe(true);
    expect(view.distanceKind).toBe("STRAIGHT_LINE");
  });

  it("مرحلته إلى مقصدٍ غير محدَّد: لا وجهة ولا مسافة — لا نقطة صفرية", () => {
    const view = driverTripView(
      facts({ status: "in_progress", destination: null }),
      HARAM.coordinates,
    );
    expect(view.destination).toBeNull();
    expect(view.target).toBeNull();
    expect(view.distanceToTargetKm).toBeNull();
  });

  it("مرحلته إلى الانطلاق تعمل ولو غاب المقصد: البطاقة لا تُكتَم بسببه", () => {
    const view = driverTripView(facts({ status: "matched", destination: null }), null);
    expect(view.target).toEqual(HARAM);
  });
});

describe("نصّ البطاقة ودبّوسها", () => {
  it("يذكر المرحلة والنقطتين بأسمائهما، ويوسم المسافة بأنها مستقيمة", () => {
    const view = driverTripView(facts(), { latitude: 21.5534, longitude: 39.1751 });
    const text = driverTripText(view, NO_ETA, tr);
    expect(text).toContain(tr("driver.trip_header"));
    expect(text).toContain(tr("driver.trip_leg_to_pickup"));
    expect(text).toContain("الحرم");
    expect(text).toContain("المطار");
    expect(text).toContain(tr("driver.trip_distance_straight", { km: 0.7 }));
    // لا مفاتيح خام تصل السائق
    expect(text).not.toContain("driver.trip_");
    expect(text).not.toContain("{");
  });

  it("النقطة بلا اسم تُذكَر بإحداثيتها لا بنصٍّ مبهم يتكرّر", () => {
    const view = driverTripView(facts({ pickup: UNNAMED, destination: UNNAMED }), null);
    const text = driverTripText(view, NO_ETA, tr);
    expect(text).toContain("21.5534");
    expect(text).toContain("39.1751");
    expect(text).not.toContain("null");
  });

  it("المقصد غير المحدَّد يُقال صراحةً، ويُحذف سطر المسافة فلا يتكرّر الخبر", () => {
    const view = driverTripView(
      facts({ status: "in_progress", destination: null }),
      HARAM.coordinates,
    );
    const text = driverTripText(view, NO_ETA, tr);
    expect(text).toContain(tr("driver.trip_destination_unset"));
    expect(text).toContain(tr("driver.trip_target_unset"));
    expect(text).not.toContain(tr("driver.trip_distance_unknown"));
  });

  it("الدبّوس على الانطلاق في المرحلة الأولى وعلى المقصد في الثانية", () => {
    const toPickup = driverTripPin(driverTripView(facts({ status: "matched" }), null), tr);
    expect(toPickup).toEqual({
      latitude: HARAM.coordinates.latitude,
      longitude: HARAM.coordinates.longitude,
      label: tr("driver.trip_pin_pickup"),
    });
    const toDest = driverTripPin(driverTripView(facts({ status: "in_progress" }), null), tr);
    expect(toDest).toEqual({
      latitude: AIRPORT.coordinates.latitude,
      longitude: AIRPORT.coordinates.longitude,
      label: tr("driver.trip_pin_destination"),
    });
  });

  it("لا دبّوس بلا وجهة: undefined لا إحداثيةٌ صفرية في خليج غينيا", () => {
    const view = driverTripView(facts({ status: "in_progress", destination: null }), null);
    expect(driverTripPin(view, tr)).toBeUndefined();
  });
});
