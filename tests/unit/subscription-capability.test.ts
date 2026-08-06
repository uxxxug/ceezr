/**
 * الغرض: اختبارات أهلية الاشتراك ونوع الخدمة المفعَّلة — الشرطان اللذان يحكمان من يستقبل عرضاً.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: يقابل هذين الاختبارين قيدان في القاعدة، فالحماية مزدوجة.
 */
import { describe, expect, it } from "bun:test";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";
import {
  coversService,
  isSubscriptionLive,
  servicesCoveredByPlan,
  type Subscription,
} from "../../packages/domain/subscription/entity.ts";
import {
  canServe,
  enabledServices,
  type DriverCapability,
} from "../../packages/domain/capability/entity.ts";

const CITY = "city-jed" as CityId;
const DRIVER = "driver-1" as DriverId;
const NOW = new Date("2026-08-06T12:00:00Z");
const TOMORROW = new Date("2026-08-07T12:00:00Z");
const YESTERDAY = new Date("2026-08-05T12:00:00Z");

function sub(partial: Partial<Subscription>): Subscription {
  return {
    driverId: DRIVER,
    cityId: CITY,
    plan: "transport",
    status: "active",
    trialEndsAt: null,
    currentPeriodEnd: TOMORROW,
    ...partial,
  };
}

describe("servicesCoveredByPlan", () => {
  it("both يغطي الخدمتين", () => {
    expect(servicesCoveredByPlan("both")).toEqual(["transport", "delivery"]);
  });
  it("transport يغطي المشاوير فقط", () => {
    expect(servicesCoveredByPlan("transport")).toEqual(["transport"]);
  });
});

describe("isSubscriptionLive", () => {
  it("الشهر المجاني الساري = فعّال", () => {
    expect(isSubscriptionLive(sub({ status: "trialing", trialEndsAt: TOMORROW }), NOW)).toBe(true);
  });

  it("الشهر المجاني المنتهي = غير فعّال", () => {
    expect(isSubscriptionLive(sub({ status: "trialing", trialEndsAt: YESTERDAY }), NOW)).toBe(false);
  });

  it("المدفوع الساري = فعّال", () => {
    expect(isSubscriptionLive(sub({ status: "active", currentPeriodEnd: TOMORROW }), NOW)).toBe(true);
  });

  it("المدفوع المنتهي زمنياً = غير فعّال", () => {
    expect(isSubscriptionLive(sub({ status: "active", currentPeriodEnd: YESTERDAY }), NOW)).toBe(false);
  });

  it("الملغى غير فعّال حتى لو تاريخه في المستقبل", () => {
    expect(isSubscriptionLive(sub({ status: "cancelled", currentPeriodEnd: TOMORROW }), NOW)).toBe(false);
  });

  it("حالة trialing بلا تاريخ انتهاء = غير فعّال", () => {
    expect(isSubscriptionLive(sub({ status: "trialing", trialEndsAt: null }), NOW)).toBe(false);
  });
});

describe("coversService", () => {
  it("سائق مشاوير فقط لا يغطي التوصيل", () => {
    expect(coversService(sub({ plan: "transport" }), "delivery", NOW)).toBe(false);
  });
  it("خطة both تغطي التوصيل", () => {
    expect(coversService(sub({ plan: "both" }), "delivery", NOW)).toBe(true);
  });
  it("خطة both منتهية لا تغطي شيئاً", () => {
    expect(coversService(sub({ plan: "both", currentPeriodEnd: YESTERDAY }), "transport", NOW)).toBe(false);
  });
});

describe("capability", () => {
  const caps: DriverCapability[] = [
    { driverId: DRIVER, cityId: CITY, service: "transport", isEnabled: true },
    { driverId: DRIVER, cityId: CITY, service: "delivery", isEnabled: false },
  ];

  it("يخدم المشاوير", () => {
    expect(canServe(caps, "transport")).toBe(true);
  });
  it("لا يخدم التوصيل لأنه معطَّل", () => {
    expect(canServe(caps, "delivery")).toBe(false);
  });
  it("الخدمات المفعَّلة هي المشاوير فقط", () => {
    expect(enabledServices(caps)).toEqual(["transport"]);
  });
  it("قائمة فارغة لا تخدم شيئاً", () => {
    expect(canServe([], "transport")).toBe(false);
  });
});
