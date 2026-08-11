/**
 * الغرض: اختبار عرض صفحة المدفوعات في لوحة الإدارة — البند 8.
 *   يثبت أن الصفحة تُعرض بلا أخطاء HTML، وتعرض الحالة الصحيحة.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { renderPaymentsPage, type PaymentPageData } from "../../apps/admin-dashboard/src/pages/payments.ts";

function emptyData(overrides: Partial<PaymentPageData> = {}): PaymentPageData {
  return {
    cityOptions: [],
    cityId: "test-city",
    cityName: "—",
    transactions: [],
    providerName: null,
    environment: null,
    driverSubscriptionEnabled: false,
    ...overrides,
  };
}

describe("admin-payments: render", () => {
  it("يُعرض بلا معاملات بلا أخطاء", () => {
    const html = renderPaymentsPage(emptyData());
    expect(html).toContain("المدفوعات والاشتراكات");
    expect(html).toContain("لا معاملات بعد");
  });

  it("يعرض حالة المزوّد والبيئة", () => {
    const html = renderPaymentsPage(emptyData({
      providerName: "tap",
      environment: "sandbox",
      driverSubscriptionEnabled: true,
    }));
    expect(html).toContain("tap");
    expect(html).toContain("sandbox");
    expect(html).toContain("اشتراك السائق مفعّل");
  });

  it("يعرض منتقي المدينة عند توفّر الخيارات", () => {
    const html = renderPaymentsPage(emptyData({
      cityOptions: [
        { id: "c1", code: "JED", nameAr: "جدة" },
        { id: "c2", code: "MKK", nameAr: "مكة" },
      ],
      cityId: "c1",
      cityName: "جدة",
    }));
    expect(html).toContain("المدينة:");
    expect(html).toContain("جدة");
    expect(html).toContain("مكة");
    expect(html).toContain("selected");
  });

  it("يعرض معاملة بنجاح", () => {
    const html = renderPaymentsPage(emptyData({
      providerName: "test-provider",
      environment: "production",
      driverSubscriptionEnabled: true,
      transactions: [{
        id: "tx-1",
        driverName: "أحمد",
        cityName: "جدة",
        purpose: "driver_subscription",
        amountMinor: 25000,
        currency: "SAR",
        provider: "test-provider",
        providerTransactionId: "prov-1",
        status: "active",
        createdAt: new Date("2026-08-11T10:00:00Z"),
      }],
    }));
    expect(html).toContain("أحمد");
    expect(html).toContain("جدة");
    expect(html).toContain("SAR");
    expect(html).toContain("active");
    expect(html).toContain("250.00");
  });

  it("يعرض معاملة فاشلة بشارة خطر", () => {
    const html = renderPaymentsPage(emptyData({
      transactions: [{
        id: "tx-fail",
        driverName: "محمد",
        cityName: "مكة",
        purpose: "driver_subscription",
        amountMinor: 25000,
        currency: "SAR",
        provider: "test-provider",
        providerTransactionId: null,
        status: "failed",
        createdAt: new Date("2026-08-11T10:00:00Z"),
      }],
    }));
    expect(html).toContain("failed");
    expect(html).toContain("bad");
  });
});
