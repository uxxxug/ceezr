/**
 * الغرض: اختبارات مزوّد OSRM — واجهة وهمية للتحقق من البنية.
 *   لا يختبر خادم OSRM الحقيقي بل يتحقق من صحة التحويلات والأنواع.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { haversineKm } from "../../packages/domain/geo/index.ts";
import type { LatLng } from "../../packages/maps/core/types.ts";
import { createOsrmProvider } from "../../packages/maps/providers/osrm/osrm-provider.ts";

/** جسر للاختبارات: الدوال الجغرافية بالكيلومتر في المجال، وهذه الحالات بالمتر. */
const haversineMeters = (a: LatLng, b: LatLng): number =>
  haversineKm({ latitude: a.lat, longitude: a.lng }, { latitude: b.lat, longitude: b.lng }) * 1000;

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

/**
 * المرحلة ٨ — البند P1-9 من خط الأساس: `nearest` كان يُصنّع `driverId: nearest-i`.
 *
 * الاختبار يشغّل خادماً حقيقياً يردّ باستجابة OSRM كما هي في وثائقها، لأن العطب
 * كان في **التحويل** لا في الشبكة: أي اختبارٍ يفشل عند تعذّر الاتصال (كالحالتين
 * أعلاه) لا يمرّ على سطر التحويل أصلاً، ولذلك عاش الاختلاق فيه بلا أن يُرى.
 */
describe("maps: nearest لا يختلق سائقين", () => {
  async function withServer<T>(body: unknown, fn: (baseUrl: string) => Promise<T>): Promise<T> {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
    });
    try {
      return await fn(`http://localhost:${server.port}`);
    } finally {
      server.stop(true);
    }
  }

  const OSRM_NEAREST = {
    code: "Ok",
    waypoints: [
      { location: [39.1931, 21.4861], distance: 12.5, name: "طريق الملك عبد الله" },
      { location: [39.1944, 21.4872], distance: 40.25, name: "" },
    ],
  };

  it("يُعيد نقاطاً مُلتصقة بالطريق بلا أيّ معرّف سائق", async () => {
    await withServer(OSRM_NEAREST, async (baseUrl) => {
      const provider = createOsrmProvider({ baseUrl });
      const result = await provider.nearest({ point: { lat: 21.4858, lng: 39.1925 }, count: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.points).toHaveLength(2);
      const first = result.value.points[0];
      expect(first?.position).toEqual({ lat: 21.4861, lng: 39.1931 });
      // المسافة هي بُعد النقطة عن الطريق، لا مسافة قيادةٍ إلى أحد
      expect(first?.offsetMeters).toBe(12.5);
      expect(first?.roadName).toBe("طريق الملك عبد الله");

      // الحرَس الفعلي: لا حقل باسم driverId في أي نقطة، بأي قيمة
      const serialized = JSON.stringify(result.value);
      expect(serialized).not.toContain("driverId");
      expect(serialized).not.toContain("nearest-");
      expect(serialized).not.toContain("durationSeconds");
      for (const point of result.value.points) {
        expect(Object.keys(point)).not.toContain("driverId");
      }
    });
  });

  it("طريقٌ بلا اسم يُترك غائباً لا يُملأ بنصٍّ فارغ", async () => {
    await withServer(OSRM_NEAREST, async (baseUrl) => {
      const provider = createOsrmProvider({ baseUrl });
      const result = await provider.nearest({ point: { lat: 21.4858, lng: 39.1925 }, count: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // "" من OSRM تعني «لا اسم»، وتمريرُها كاسمٍ يجعل الواجهة تعرض سطراً فارغاً
      expect(result.value.points[1]?.roadName).toBeUndefined();
      expect(Object.keys(result.value.points[1] ?? {})).not.toContain("roadName");
    });
  });
});
