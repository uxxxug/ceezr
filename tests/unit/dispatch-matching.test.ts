/**
 * الغرض: اختبار محرك المطابقة — الفلترة، معادلة النقاط، وأثر تغيير الأوزان على الترتيب.
 * الحالة: اختبار فعلي. يغطي البند 4 من قائمة اختبارات المرحلة 2.1:
 *   "ترتيب المرشحين يتغيّر فعلياً عند تغيير الوزنين في platform_settings بلا نشر كود".
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: عند تفعيل التقييم الحقيقي (2.5) تُضاف حالة تعادل نقاط بفروق تقييم دقيقة.
 */
import { describe, expect, it } from "bun:test";
import {
  type DriverCandidate,
  evaluateCandidates,
  type MatchingParameters,
  type OrderContext,
  rejectionReasonFor,
  scoreCandidate,
  selectBroadcastBatch,
} from "../../packages/domain/dispatch/entity.ts";
import type { Subscription } from "../../packages/domain/subscription/entity.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";

const JED = "city-jed" as CityId;
const MKK = "city-mkk" as CityId;
const NOW = new Date("2026-08-06T12:00:00Z");
const FUTURE = new Date("2026-09-06T12:00:00Z");
const PAST = new Date("2026-07-06T12:00:00Z");

const PICKUP = { latitude: 21.4858, longitude: 39.1925 };

/** نفس القيم المبذورة في platform_settings للمدن الأربع. */
const PARAMS: MatchingParameters = {
  searchRadiusKm: 10,
  weightProximity: 0.7,
  weightRating: 0.3,
  broadcastBatchSize: 5,
  defaultRating: 4.5,
};

function liveSub(cityId: CityId, plan: Subscription["plan"] = "both"): Subscription {
  return {
    driverId: D("d"),
    cityId,
    plan,
    status: "active",
    trialEndsAt: null,
    currentPeriodEnd: FUTURE,
  };
}

/** معرّف موسوم — الاختبار يلتزم بنفس أنواع الإنتاج. */
function D(value: string): DriverId {
  return value as DriverId;
}

function candidate(over: Partial<DriverCandidate> & { driverId: DriverId }): DriverCandidate {
  const id = over.driverId;
  return {
    cityId: JED,
    location: PICKUP,
    isAvailable: true,
    isVerified: true,
    ratingAverage: null,
    subscription: liveSub(JED),
    ...over,
    driverId: id,
    capabilities: over.capabilities ?? [
      { driverId: id, cityId: JED, service: "transport", isEnabled: true },
    ],
  };
}

const ORDER: OrderContext = {
  cityId: JED,
  service: "transport",
  pickup: PICKUP,
  excludedDriverIds: [],
};

/** يبعد نحو 4.4 كم شمال نقطة الانطلاق. */
const NEAR = { latitude: 21.5258, longitude: 39.1925 };
/** يبعد نحو 8.9 كم. */
const FAR = { latitude: 21.5658, longitude: 39.1925 };

describe("rejectionReasonFor", () => {
  it("يستبعد سائق مدينة أخرى", () => {
    const c = candidate({ driverId: D("d1"), cityId: MKK });
    expect(rejectionReasonFor(c, ORDER, PARAMS, NOW)).toBe("CITY_MISMATCH");
  });

  it("يستبعد غير الموثَّق", () => {
    expect(
      rejectionReasonFor(candidate({ driverId: D("d2"), isVerified: false }), ORDER, PARAMS, NOW),
    ).toBe("NOT_VERIFIED");
  });

  it("يستبعد غير المتاح", () => {
    expect(
      rejectionReasonFor(candidate({ driverId: D("d3"), isAvailable: false }), ORDER, PARAMS, NOW),
    ).toBe("NOT_AVAILABLE");
  });

  it("يستبعد من لم يفعّل نوع الخدمة", () => {
    const c = candidate({
      driverId: D("d4"),
      capabilities: [{ driverId: D("d4"), cityId: JED, service: "delivery", isEnabled: true }],
    });
    expect(rejectionReasonFor(c, ORDER, PARAMS, NOW)).toBe("SERVICE_NOT_ENABLED");
  });

  it("يستبعد من لا اشتراك له", () => {
    expect(
      rejectionReasonFor(candidate({ driverId: D("d5"), subscription: null }), ORDER, PARAMS, NOW),
    ).toBe("NO_LIVE_SUBSCRIPTION");
  });

  it("يستبعد منتهي الاشتراك", () => {
    const c = candidate({
      driverId: D("d6"),
      subscription: { ...liveSub(JED), currentPeriodEnd: PAST },
    });
    expect(rejectionReasonFor(c, ORDER, PARAMS, NOW)).toBe("NO_LIVE_SUBSCRIPTION");
  });

  it("يستبعد من خطته لا تغطي الخدمة", () => {
    const c = candidate({ driverId: D("d7"), subscription: liveSub(JED, "delivery") });
    expect(rejectionReasonFor(c, ORDER, PARAMS, NOW)).toBe("NO_LIVE_SUBSCRIPTION");
  });

  it("يستبعد من هو خارج نصف القطر", () => {
    const c = candidate({ driverId: D("d8"), location: { latitude: 21.3891, longitude: 39.8579 } });
    expect(rejectionReasonFor(c, ORDER, PARAMS, NOW)).toBe("OUT_OF_RADIUS");
  });

  it("يستبعد المستبعدين في هذه الدورة", () => {
    const order: OrderContext = { ...ORDER, excludedDriverIds: [D("d9")] };
    expect(rejectionReasonFor(candidate({ driverId: D("d9") }), order, PARAMS, NOW)).toBe(
      "EXCLUDED_THIS_ROUND",
    );
  });

  it("يقبل المرشح المؤهل", () => {
    expect(rejectionReasonFor(candidate({ driverId: D("d10") }), ORDER, PARAMS, NOW)).toBeNull();
  });
});

describe("scoreCandidate", () => {
  it("أقصى نقاط عند مسافة صفر وتقييم كامل", () => {
    expect(scoreCandidate(0, 5, PARAMS)).toBeCloseTo(1, 10);
  });

  it("مكوّن التقييم وحده عند حدّ نصف القطر", () => {
    // القرب = 0، فالنتيجة = وزن التقييم × (4/5)
    expect(scoreCandidate(10, 4, PARAMS)).toBeCloseTo(0.3 * 0.8, 10);
  });

  it("يستخدم التقييم الافتراضي للسائق الجديد", () => {
    expect(scoreCandidate(10, null, PARAMS)).toBeCloseTo(0.3 * (4.5 / 5), 10);
  });

  it("يحصر التقييم الشاذ داخل المدى", () => {
    expect(scoreCandidate(0, 99, PARAMS)).toBeCloseTo(1, 10);
  });
});

describe("evaluateCandidates", () => {
  const near = candidate({ driverId: D("near"), location: NEAR, ratingAverage: 3.0 });
  const far = candidate({ driverId: D("far"), location: FAR, ratingAverage: 5.0 });

  it("يرتّب الأقرب أولاً عندما يغلب وزن القرب", () => {
    const result = evaluateCandidates([far, near], ORDER, PARAMS, NOW);
    expect(result.eligible.map((c) => String(c.driverId))).toEqual(["near", "far"]);
  });

  it("ينقلب الترتيب فعلياً عند تغيير الوزنين وحدهما — بلا تعديل كود", () => {
    const ratingHeavy: MatchingParameters = {
      ...PARAMS,
      weightProximity: 0.1,
      weightRating: 0.9,
    };
    const result = evaluateCandidates([far, near], ORDER, ratingHeavy, NOW);
    expect(result.eligible.map((c) => String(c.driverId))).toEqual(["far", "near"]);
  });

  it("يسجّل سبب استبعاد كل مرشح غير مؤهل", () => {
    const blocked = candidate({ driverId: D("blocked"), isAvailable: false });
    const result = evaluateCandidates([near, blocked], ORDER, PARAMS, NOW);
    expect(result.eligible).toHaveLength(1);
    expect(result.rejected).toEqual([{ driverId: D("blocked"), reason: "NOT_AVAILABLE" }]);
  });

  it("ترتيب حتمي عند تعادل النقاط والمسافة", () => {
    const a = candidate({ driverId: D("aaa"), ratingAverage: 4 });
    const b = candidate({ driverId: D("bbb"), ratingAverage: 4 });
    const first = evaluateCandidates([b, a], ORDER, PARAMS, NOW).eligible.map((c) =>
      String(c.driverId),
    );
    const second = evaluateCandidates([a, b], ORDER, PARAMS, NOW).eligible.map((c) =>
      String(c.driverId),
    );
    expect(first).toEqual(second);
    expect(first).toEqual(["aaa", "bbb"]);
  });

  it("يحسب المسافة لكل مرشح مؤهل", () => {
    const result = evaluateCandidates([near], ORDER, PARAMS, NOW);
    expect(result.eligible[0]?.distanceKm).toBeGreaterThan(4);
    expect(result.eligible[0]?.distanceKm).toBeLessThan(5);
  });
});

describe("selectBroadcastBatch", () => {
  const many = Array.from({ length: 9 }, (_, i) =>
    candidate({
      driverId: D(`d${i}`),
      location: { latitude: 21.4858 + i * 0.002, longitude: 39.1925 },
    }),
  );

  it("يبثّ لأفضل خمسة فقط بحجم الدفعة المبذور", () => {
    const evaluation = evaluateCandidates(many, ORDER, PARAMS, NOW);
    expect(evaluation.eligible).toHaveLength(9);
    expect(selectBroadcastBatch(evaluation, PARAMS)).toHaveLength(5);
  });

  it("حجم الدفعة يُقرأ من المعاملات فعلياً", () => {
    const evaluation = evaluateCandidates(many, ORDER, PARAMS, NOW);
    expect(selectBroadcastBatch(evaluation, { ...PARAMS, broadcastBatchSize: 3 })).toHaveLength(3);
  });

  it("دفعة صفرية لا تبثّ لأحد", () => {
    const evaluation = evaluateCandidates(many, ORDER, PARAMS, NOW);
    expect(selectBroadcastBatch(evaluation, { ...PARAMS, broadcastBatchSize: 0 })).toHaveLength(0);
  });

  it("الدفعة هي رأس القائمة المرتَّبة نفسها", () => {
    const evaluation = evaluateCandidates(many, ORDER, PARAMS, NOW);
    const batch = selectBroadcastBatch(evaluation, PARAMS);
    expect(batch.map((c) => String(c.driverId))).toEqual(
      evaluation.eligible.slice(0, 5).map((c) => String(c.driverId)),
    );
  });
});
