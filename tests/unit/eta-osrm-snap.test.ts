/**
 * الغرض: إثبات أن مزوّدَ OSRM يُبلّغ بعدَ الإلصاق حين يعرفه، ويعترف بالجهل حين
 *   لا يعرفه — ولا يُسكِت الفرق بينهما بصفرٍ افتراضيّ.
 * الحالة: منفّذ فعلياً — المرحلة ١٥.
 * ينتمي إلى: tests/unit
 *
 * ولماذا هذا الملف موجود: OSRM يُلصق الإحداثيةَ بأقرب طريقٍ **بلا حدّ**، ثم يردّ
 * `Ok` بثقة. وقياسُ المرحلة ١٥ أعاد لإحداثيةٍ في البحر الأحمر مساراً كاملاً
 * بإلصاقِ ٥١.٧ كم. وحقلُ `waypoints[].distance` هو الشاهدُ الوحيد على ذلك، وهو
 * **اختياريٌّ** في ردّ الخادم. فحضورُه وغيابُه واختلافُ عددِه يُثبَّت كلٌّ وحده.
 */

import { describe, expect, it } from "bun:test";
import { createOsrmProvider } from "../../packages/maps/providers/osrm/osrm-provider.ts";

const ORIGIN = { lat: 21.4858, lng: 39.1925 };
const DEST = { lat: 21.5591, lng: 39.1553 };

const ROUTE = { distance: 11671.7, duration: 714.9, geometry: { coordinates: [[39.19, 21.48]] } };

/** خادمُ OSRM مُزيَّفٌ يردّ جسماً محدَّداً؛ يُغلَق دائماً في `finally`. */
async function withServer<T>(body: unknown, use: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  try {
    return await use(`http://localhost:${server.port}`);
  } finally {
    server.stop(true);
  }
}

const routeOf = async (body: unknown) =>
  withServer(body, async (baseUrl) =>
    createOsrmProvider({ baseUrl }).route({ origin: ORIGIN, destination: DEST }),
  );

describe("OSRM: بعد الإلصاق حين يُعلَن", () => {
  it("يُقرأ من أوّل نقطةِ طريقٍ وآخرها لا من مجموعها", async () => {
    const r = await routeOf({
      code: "Ok",
      routes: [ROUTE],
      waypoints: [{ distance: 24.8 }, { distance: 51705.4 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.snap).toEqual({ known: true, originMeters: 24.8, destinationMeters: 51705.4 });
  });

  it("الصفرُ المُعلَن يُنقَل صفراً معلوماً لا مجهولاً", async () => {
    const r = await routeOf({
      code: "Ok",
      routes: [ROUTE],
      waypoints: [{ distance: 0 }, { distance: 0 }],
    });
    expect(r.ok && r.value.snap).toEqual({ known: true, originMeters: 0, destinationMeters: 0 });
  });
});

describe("OSRM: الاعتراف بالجهل", () => {
  it("خادمٌ لا يذكر نقاطَ الطريق إطلاقاً يُنتج «لا أعلم» لا صفراً", async () => {
    const r = await routeOf({ code: "Ok", routes: [ROUTE] });
    expect(r.ok && r.value.snap).toEqual({ known: false });
  });

  it("مصفوفةٌ فارغة «لا أعلم»", async () => {
    const r = await routeOf({ code: "Ok", routes: [ROUTE], waypoints: [] });
    expect(r.ok && r.value.snap).toEqual({ known: false });
  });

  /**
   * عددٌ لا يطابق عددَ النقاط المُرسَلة يعني أنّ الترتيب ليس مضموناً، فقراءةُ
   * «الأول والأخير» تصير قراءةَ نقطتين لا نعرف أيَّهما. والجهلُ المُعلَن أسلمُ من
   * رقمٍ في غير موضعه.
   */
  it("عددٌ لا يطابق عددَ النقاط المُرسَلة «لا أعلم»", async () => {
    const r = await routeOf({
      code: "Ok",
      routes: [ROUTE],
      waypoints: [{ distance: 24.8 }, { distance: 30 }, { distance: 51705.4 }],
    });
    expect(r.ok && r.value.snap).toEqual({ known: false });
  });

  it("نقطةٌ بلا حقلِ مسافة «لا أعلم»", async () => {
    const r = await routeOf({ code: "Ok", routes: [ROUTE], waypoints: [{}, { distance: 6 }] });
    expect(r.ok && r.value.snap).toEqual({ known: false });
  });

  it("مسافةٌ غيرُ عدديّة «لا أعلم»", async () => {
    const r = await routeOf({
      code: "Ok",
      routes: [ROUTE],
      waypoints: [{ distance: "قريب" }, { distance: 6 }],
    });
    expect(r.ok && r.value.snap).toEqual({ known: false });
  });
});

describe("OSRM: الإلصاق لا يُبدّل بقيّةَ الجواب", () => {
  it("المسافةُ والمدّة تبقيان كما أعطاهما الخادم", async () => {
    const r = await routeOf({
      code: "Ok",
      routes: [ROUTE],
      waypoints: [{ distance: 6 }, { distance: 6 }],
    });
    expect(r.ok && r.value.distanceMeters).toBe(11671.7);
    expect(r.ok && r.value.durationSeconds).toBe(714.9);
  });
});
