/**
 * الغرض: اختبارات حقيقية لحساب المسافة ودالة القرب.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: المسافات المرجعية أدناه لمدن حقيقية، فأي انحراف كبير يكشف خطأ في المعادلة.
 */
import { describe, expect, it } from "bun:test";
import {
  haversineKm,
  isWithinRadiusKm,
  makeCoordinates,
  makeDistanceKm,
  proximityFactor,
} from "../../packages/domain/geo/index.ts";
import { isErr, isOk } from "../../packages/shared/result/index.ts";

const JEDDAH = { latitude: 21.4858, longitude: 39.1925 };
const MAKKAH = { latitude: 21.3891, longitude: 39.8579 };
const RIYADH = { latitude: 24.7136, longitude: 46.6753 };

describe("makeCoordinates", () => {
  it("يقبل إحداثيات صحيحة", () => {
    expect(isOk(makeCoordinates(21.4858, 39.1925))).toBe(true);
  });

  it("يرفض خط عرض خارج المدى", () => {
    const r = makeCoordinates(91, 39);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.reason).toBe("LATITUDE_OUT_OF_RANGE");
  });

  it("يرفض خط طول خارج المدى", () => {
    const r = makeCoordinates(21, 181);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.reason).toBe("LONGITUDE_OUT_OF_RANGE");
  });

  it("يرفض NaN", () => {
    expect(isErr(makeCoordinates(Number.NaN, 39))).toBe(true);
  });
});

describe("makeDistanceKm", () => {
  it("يرفض المسافة السالبة", () => {
    expect(isErr(makeDistanceKm(-1))).toBe(true);
  });
  it("يقبل الصفر", () => {
    expect(isOk(makeDistanceKm(0))).toBe(true);
  });
});

describe("haversineKm", () => {
  it("صفر لنفس النقطة", () => {
    expect(haversineKm(JEDDAH, JEDDAH)).toBe(0);
  });

  it("جدة إلى مكة نحو 69 كم", () => {
    const d = haversineKm(JEDDAH, MAKKAH);
    expect(d).toBeGreaterThan(65);
    expect(d).toBeLessThan(73);
  });

  it("جدة إلى الرياض نحو 850 كم", () => {
    const d = haversineKm(JEDDAH, RIYADH);
    expect(d).toBeGreaterThan(820);
    expect(d).toBeLessThan(880);
  });

  it("متماثل في الاتجاهين", () => {
    expect(haversineKm(JEDDAH, RIYADH)).toBeCloseTo(haversineKm(RIYADH, JEDDAH), 6);
  });
});

describe("isWithinRadiusKm", () => {
  it("مكة خارج نصف قطر 10 كم من جدة", () => {
    expect(isWithinRadiusKm(JEDDAH, MAKKAH, 10)).toBe(false);
  });
  it("مكة داخل نصف قطر 100 كم من جدة", () => {
    expect(isWithinRadiusKm(JEDDAH, MAKKAH, 100)).toBe(true);
  });
});

describe("proximityFactor", () => {
  it("واحد عند المسافة صفر", () => {
    expect(proximityFactor(0, 10)).toBe(1);
  });
  it("صفر عند حدّ نصف القطر", () => {
    expect(proximityFactor(10, 10)).toBe(0);
  });
  it("صفر خارج نصف القطر", () => {
    expect(proximityFactor(25, 10)).toBe(0);
  });
  it("نصف عند منتصف المسافة", () => {
    expect(proximityFactor(5, 10)).toBeCloseTo(0.5, 10);
  });
  it("صفر عند نصف قطر غير صالح", () => {
    expect(proximityFactor(5, 0)).toBe(0);
  });
});
