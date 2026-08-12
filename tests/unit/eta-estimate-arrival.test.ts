/**
 * الغرض: إثبات أن الوصلةَ بين المجال ومحرّك التوجيه لا تكسر شيئاً في الطريق —
 *   لا شكلَ الإحداثية، ولا تصنيفَ الخطأ، ولا عقدَ «لا ترفع استثناءً».
 * الحالة: منفّذ فعلياً — المرحلة ١٥.
 * ينتمي إلى: tests/unit
 *
 * ولماذا هذا الملف موجود: في المستودع شكلان للإحداثية — `{latitude, longitude}`
 * في المجال و`{lat, lng}` في الخرائط. وقياسُ المرحلة ١٥ أثبت أن تمرير الشكل
 * الخطأ **لا يرفع خطأً**: يُنتج `NaN` بصمت، لأنّ Bun يشغّل TypeScript بلا
 * تحقّقٍ من الأنواع. فالجسرُ يُختبَر هنا كوحدةٍ مستقلّة لا كأثرٍ جانبيّ.
 */

import { describe, expect, it } from "bun:test";
import { estimateArrival, toLatLng } from "../../packages/application/tracking/estimate-arrival.ts";
import {
  type RouteResult,
  RoutingError,
  type RoutingProvider,
} from "../../packages/maps/core/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const BALAD = { latitude: 21.4858, longitude: 39.1925 };
const RAWDAH = { latitude: 21.5591, longitude: 39.1553 };

/** محرّكُ توجيهٍ مُزيَّفٌ يردّ ما يُطلَب منه ويسجّل ما استُدعي به. */
function fakeRouting(reply: () => Awaited<ReturnType<RoutingProvider["route"]>>): {
  provider: RoutingProvider;
  seen: { origin: unknown; destination: unknown }[];
} {
  const seen: { origin: unknown; destination: unknown }[] = [];
  const provider = {
    name: "fake",
    route: async (input: { origin: unknown; destination: unknown }) => {
      seen.push({ origin: input.origin, destination: input.destination });
      return reply();
    },
    table: async () => err(new RoutingError("osrm", "لا يُستخدَم", "protocol")),
    nearest: async () => err(new RoutingError("osrm", "لا يُستخدَم", "protocol")),
  } as unknown as RoutingProvider;
  return { provider, seen };
}

const route = (over: Partial<RouteResult> = {}): RouteResult => ({
  distanceMeters: 11671.7,
  durationSeconds: 714.9,
  geometry: { points: [] },
  snap: { known: true, originMeters: 6, destinationMeters: 6 },
  ...over,
});

describe("جسر الإحداثيات", () => {
  it("يُبدّل الأسماء ولا يقلب القيم", () => {
    expect(toLatLng(BALAD)).toEqual({ lat: 21.4858, lng: 39.1925 });
  });

  it("خطُّ العرض لا يصير خطَّ الطول — الخطأ الذي لا يظهر إلاّ في مدينةٍ أخرى", () => {
    expect(toLatLng(BALAD).lat).not.toBe(BALAD.longitude);
  });

  it("الإحداثيةُ السالبة تُنقَل بإشارتها", () => {
    expect(toLatLng({ latitude: -33.9, longitude: -70.6 })).toEqual({ lat: -33.9, lng: -70.6 });
  });
});

describe("الوصلة: ما يُرسَل إلى المحرّك", () => {
  it("يُرسِل الشكلَ الذي تفهمه الخرائط لا شكلَ المجال", async () => {
    const { provider, seen } = fakeRouting(() => ok(route()));
    await estimateArrival({ from: BALAD, to: RAWDAH }, { routing: provider });
    expect(seen[0]?.origin).toEqual({ lat: 21.4858, lng: 39.1925 });
    expect(seen[0]?.destination).toEqual({ lat: 21.5591, lng: 39.1553 });
  });

  it("لا يسأل المحرّكَ أصلاً إذا غاب أحدُ الطرفين", async () => {
    const { provider, seen } = fakeRouting(() => ok(route()));
    await estimateArrival({ from: BALAD, to: null }, { routing: provider });
    expect(seen.length).toBe(0);
  });
});

describe("الوصلة: الامتناع بلا مدخلات وبلا مزوّد", () => {
  it("غيابُ المقصد سببٌ يخصّه: لا مدخلات", async () => {
    const v = await estimateArrival({ from: BALAD, to: null }, { routing: null });
    expect(v).toEqual({ kind: "UNAVAILABLE", reason: "NO_INPUT" });
  });

  it("غيابُ موقعِ السائق سببُ «لا مدخلات» كذلك", async () => {
    const v = await estimateArrival({ from: null, to: RAWDAH }, { routing: null });
    expect(v).toEqual({ kind: "UNAVAILABLE", reason: "NO_INPUT" });
  });

  /**
   * التفريقُ بين «لم يُضبَط محرّك» و«المحرّك ساقط» ليس ترفاً لغويّاً: الأول حالةُ
   * نشرٍ يصلحها المشغّل بمتغيّر بيئة، والثاني عارضٌ يستدعي تنبيهاً. وجمعُهما في
   * سببٍ واحد يُخفي انقطاعاً حقيقيّاً في منصّةٍ لم تُضبَط بعد.
   */
  it("مدخلاتٌ كاملةٌ بلا محرّكٍ مضبوطٍ سببٌ مختلفٌ عن سقوط المحرّك", async () => {
    const v = await estimateArrival({ from: BALAD, to: RAWDAH }, { routing: null });
    expect(v).toEqual({ kind: "UNAVAILABLE", reason: "NOT_CONFIGURED" });
  });
});

describe("الوصلة: تصنيف أخطاء المحرّك", () => {
  it("لا مسار: امتناعٌ يخصّه لا «المحرّك ساقط»", async () => {
    const { provider } = fakeRouting(() => err(new RoutingError("osrm", "NoRoute", "no_route")));
    const v = await estimateArrival({ from: BALAD, to: RAWDAH }, { routing: provider });
    expect(v).toEqual({ kind: "UNAVAILABLE", reason: "NO_ROUTE" });
  });

  for (const kind of [
    "timeout",
    "unreachable",
    "rate_limited",
    "server_error",
    "client_error",
    "protocol",
    "invalid_request",
  ] as const) {
    it(`الصنف ${kind} يُقرأ «المحرّك ساقط»`, async () => {
      const { provider } = fakeRouting(() => err(new RoutingError("osrm", kind, kind)));
      const v = await estimateArrival({ from: BALAD, to: RAWDAH }, { routing: provider });
      expect(v).toEqual({ kind: "UNAVAILABLE", reason: "PROVIDER_DOWN" });
    });
  }
});

describe("الوصلة: الإلصاق المجهول", () => {
  it("محرّكٌ لا يذكر الإلصاق لا يُفترَض عنه أنّه ألصق بإحكام", async () => {
    const { provider } = fakeRouting(() => ok(route({ snap: { known: false } })));
    const v = await estimateArrival({ from: BALAD, to: RAWDAH }, { routing: provider });
    expect(v).toEqual({ kind: "UNAVAILABLE", reason: "SNAP_UNKNOWN" });
  });

  it("وإلصاقٌ معلومٌ قريبٌ يُنتج حُكماً موجباً", async () => {
    const { provider } = fakeRouting(() => ok(route()));
    const v = await estimateArrival({ from: BALAD, to: RAWDAH }, { routing: provider });
    expect(v.kind).toBe("ROUTED");
  });
});

describe("الوصلة: لا استثناء يصعد", () => {
  it("محرّكٌ يرفع استثناءً لا يُعطّل بطاقةَ الرحلة", async () => {
    const provider = {
      name: "throwing",
      route: async () => {
        throw new Error("انهيارٌ غيرُ متوقّع");
      },
    } as unknown as RoutingProvider;
    const v = await estimateArrival({ from: BALAD, to: RAWDAH }, { routing: provider });
    expect(v).toEqual({ kind: "UNAVAILABLE", reason: "PROVIDER_DOWN" });
  });
});
