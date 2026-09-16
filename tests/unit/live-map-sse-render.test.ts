/**
 * الغرض: اختبار وحدة تصيير صفحة خريطة العمليات — التحقق من ربط SSE.
 * الحالة: مُضافة في المرحلة ١٣ — F4-06.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import type { CityOption } from "../../apps/admin-dashboard/src/pages/drivers.ts";
import { renderLiveMapPage } from "../../apps/admin-dashboard/src/pages/live-map.ts";

const cities: readonly CityOption[] = [{ id: "jed-id", code: "JED", nameAr: "جدة" }];

const emptyData = {
  now: new Date("2026-09-16T00:00:00.000Z"),
  rows: [],
  cities,
  cityId: null,
  mapPanel: null,
  staleAfterSeconds: 120,
};

describe("تصيير صفحة خريطة العمليات — ربط SSE", () => {
  it("تُضمَّن نصُّ SSE حين تُقدَّم البصمة والرابط", () => {
    const html = renderLiveMapPage({
      ...emptyData,
      cspNonce: "test-nonce-abc",
      sseUrl: "/admin/api/live/drivers",
    });
    expect(html).toContain("EventSource");
    expect(html).toContain("/admin/api/live/drivers");
    expect(html).toContain('nonce="test-nonce-abc"');
    expect(html).toContain("live-map-status");
    expect(html).toContain("fleet-metrics");
  });

  it("لا يُضمَّن نصُّ SSE حين تُغيَّب البصمة أو الرابط", () => {
    const html = renderLiveMapPage({ ...emptyData });
    expect(html).not.toContain("EventSource");
  });

  it("لا يُضمَّن نصُّ SSE حين البصمةُ موجودةٌ والرابطُ غائب", () => {
    const html = renderLiveMapPage({
      ...emptyData,
      cspNonce: "test-nonce-abc",
    });
    expect(html).not.toContain("EventSource");
  });

  it("رابطُ SSE يحمل فلتر المدينة عند تمريره", () => {
    const html = renderLiveMapPage({
      ...emptyData,
      cityId: "jed-id",
      cspNonce: "test-nonce-abc",
      sseUrl: "/admin/api/live/drivers?city=jed-id",
    });
    expect(html).toContain("city=jed-id");
  });

  it("الصفحةُ تعمل بلا SSE: الجدولُ والبطاقاتُ حاضرة", () => {
    const html = renderLiveMapPage({ ...emptyData });
    expect(html).toContain("خريطة العمليات");
    expect(html).toContain("حالة الأسطول");
    expect(html).toContain("لا سائقَ مرئيّاً الآن");
  });
});
