/**
 * الغرض: اختبارات مزوّد OSRM — واجهة وهمية للتحقق من البنية.
 *   لا يختبر خادم OSRM الحقيقي بل يتحقق من صحة التحويلات والأنواع.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import type { LatLng } from "../../packages/maps/core/types.ts";
import { createOsrmProvider } from "../../packages/maps/providers/osrm/osrm-provider.ts";
import { haversineMeters } from "../../packages/tracking/location-validator.ts";

describe("maps: OSRM provider", () => {
  it("ينشئ مزوّداً صحيحاً", () => {
    const provider = createOsrmProvider({ baseUrl: "http://localhost:5000" });
    expect(provider.name).toBe("osrm");
  });

  it("يفشل بأمان عند عدم توفّر الخادم", async () => {
    const provider = createOsrmProvider({ baseUrl: "http://localhost:9999" });
    const result = await provider.route({
      origin: { lat: 21.5, lng: 39.2 },
      destination: { lat: 21.6, lng: 39.3 },
    });
    expect(result.ok).toBe(false);
  });

  it("يفشل في nearest عند عدم توفّر الخادم", async () => {
    const provider = createOsrmProvider({ baseUrl: "http://localhost:9999" });
    const result = await provider.nearest({
      point: { lat: 21.5, lng: 39.2 },
      count: 3,
    });
    expect(result.ok).toBe(false);
  });
});

describe("maps: distance calculation", () => {
  it("جدة إلى الرياض ≈ 850 كم", () => {
    const jeddah: LatLng = { lat: 21.4858, lng: 39.1925 };
    const riyadh: LatLng = { lat: 24.7136, lng: 46.6753 };
    const dist = haversineMeters(jeddah, riyadh);
    expect(dist).toBeGreaterThan(800000);
    expect(dist).toBeLessThan(900000);
  });

  it("المدينة إلى مكة ≈ 350 كم", () => {
    const madinah: LatLng = { lat: 24.5247, lng: 39.5692 };
    const makkah: LatLng = { lat: 21.3891, lng: 39.8579 };
    const dist = haversineMeters(madinah, makkah);
    expect(dist).toBeGreaterThan(330000);
    expect(dist).toBeLessThan(380000);
  });
});
