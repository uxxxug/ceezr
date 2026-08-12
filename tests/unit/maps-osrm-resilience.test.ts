/**
 * الغرض: تحصين مزوّد OSRM — المهلة، وإعادة المحاولة، والانهيار الآمن (P1-10).
 *   الفكرة الحاكمة: انقطاعُ خدمة توجيهٍ **خارجية** لا يجوز أن يُعلّق طلب عميل،
 *   ولا أن يُخلَف به عقد `Result` باستثناءٍ يصعد إلى المستهلك.
 * الحالة: منفّذ فعلياً — المرحلة ٩.
 * ينتمي إلى: tests/unit
 * ملاحظات مستقبلية: من وصَل ETA (المرحلة ١٥) يلزمه إثباتُ سقوطٍ آمن إلى هافرساين
 *   عند `kind` عابر، وعدمِ السقوط عند `no_route` — والصنف هو ما يُفرِّق.
 */

import { describe, expect, it } from "bun:test";
import { deservesRoutingRetry } from "../../packages/maps/core/routing-provider.ts";
import {
  createOsrmProvider,
  OSRM_TIMEOUT_MS,
} from "../../packages/maps/providers/osrm/osrm-provider.ts";

const ORIGIN = { lat: 21.4858, lng: 39.1925 };
const DEST = { lat: 21.6, lng: 39.15 };

const OK_ROUTE = {
  code: "Ok",
  routes: [{ distance: 12000, duration: 900, geometry: { coordinates: [[39.19, 21.48]] } }],
};

/** بديلُ نومٍ فوري: التراجع يُقاس بعدد النداءات لا بانتظارٍ حقيقي في الاختبار. */
const noSleep = async (): Promise<void> => {};

/** `fetch` مُحقَّق يعدّ النداءات ويردّ بما تحدّده الدالّة. */
function countingFetch(reply: (call: number) => Response | Promise<Response>): {
  impl: typeof fetch;
  calls: () => number;
  urls: string[];
} {
  let calls = 0;
  const urls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    calls += 1;
    urls.push(String(input));
    return await reply(calls);
  }) as unknown as typeof fetch;
  return { impl, calls: () => calls, urls };
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("maps: OSRM — المهلة (P1-10)", () => {
  it("لا يُعلَّق إلى الأبد على خادمٍ لا يردّ", async () => {
    // خادمٌ حقيقي يقبل الاتصال ولا يردّ — أخطرُ من خادمٍ ساقط: الاتصال ينجح
    // ثم ينتظر المستخدمُ بلا سقفٍ. القديم كان `fetch` عارياً بلا `signal`.
    const server = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
    try {
      const provider = createOsrmProvider({
        baseUrl: `http://localhost:${server.port}`,
        timeoutMs: 250,
        sleepImpl: noSleep,
      });
      const startedAt = Date.now();
      const result = await provider.route({ origin: ORIGIN, destination: DEST });
      const elapsed = Date.now() - startedAt;

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("timeout");
      // ميزانيةٌ واحدة للعملية كلّها: محاولتان بمهلة ٢٥٠ لا تُنتجان ٥٠٠
      expect(elapsed).toBeLessThan(450);
    } finally {
      server.stop(true);
    }
  });

  it("المهلة ميزانيةٌ كلّية لا سقفٌ لكل محاولة", async () => {
    // خادمٌ لا يردّ: المحاولة الأولى تستهلك الميزانية، فلا ثانية.
    const server = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
    try {
      let sleeps = 0;
      const provider = createOsrmProvider({
        baseUrl: `http://localhost:${server.port}`,
        timeoutMs: 200,
        sleepImpl: async () => {
          sleeps += 1;
        },
      });
      const result = await provider.route({ origin: ORIGIN, destination: DEST });
      expect(result.ok).toBe(false);
      // لا تراجعَ ولا محاولةَ ثانية: الميزانية نفدت، وتوسيعُها يضاعف انتظار العميل
      expect(sleeps).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  it("المهلة المُعلَنة ثابتٌ مُصدَّر ليُقرأ لا رقمٌ مدفون", () => {
    expect(OSRM_TIMEOUT_MS).toBe(3000);
  });
});

describe("maps: OSRM — سياسة إعادة المحاولة", () => {
  it("يعيد المحاولة مرّةً واحدة على 503 وينجح", async () => {
    const f = countingFetch((call) =>
      call === 1 ? jsonResponse({ error: "down" }, 503) : jsonResponse(OK_ROUTE),
    );
    const provider = createOsrmProvider({
      baseUrl: "http://osrm.invalid",
      fetchImpl: f.impl,
      sleepImpl: noSleep,
    });
    const result = await provider.route({ origin: ORIGIN, destination: DEST });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.durationSeconds).toBe(900);
    expect(f.calls()).toBe(2);
  });

  it("محاولتان لا أكثر: 503 متكرّر يُعاد خطأً لا حلقةً", async () => {
    const f = countingFetch(() => jsonResponse({ error: "down" }, 503));
    const provider = createOsrmProvider({
      baseUrl: "http://osrm.invalid",
      fetchImpl: f.impl,
      sleepImpl: noSleep,
    });
    const result = await provider.route({ origin: ORIGIN, destination: DEST });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("server_error");
    expect(f.calls()).toBe(2);
  });

  it("لا يعيد المحاولة على 400: نتيجةٌ محسومة لن تتغيّر", async () => {
    const f = countingFetch(() => jsonResponse({ code: "InvalidQuery" }, 400));
    const provider = createOsrmProvider({
      baseUrl: "http://osrm.invalid",
      fetchImpl: f.impl,
      sleepImpl: noSleep,
    });
    const result = await provider.route({ origin: ORIGIN, destination: DEST });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("client_error");
    expect(f.calls()).toBe(1);
  });

  it("لا يعيد المحاولة على 429: نداءٌ ثانٍ فوري يُطيل الحظر", async () => {
    const f = countingFetch(() => jsonResponse({ message: "slow down" }, 429));
    const provider = createOsrmProvider({
      baseUrl: "http://osrm.invalid",
      fetchImpl: f.impl,
      sleepImpl: noSleep,
    });
    const result = await provider.table([ORIGIN], [DEST]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("rate_limited");
    expect(f.calls()).toBe(1);
  });

  it("لا يعيد المحاولة على «لا طريق»: جوابٌ وصل لا عطلٌ عابر", async () => {
    const f = countingFetch(() => jsonResponse({ code: "NoRoute", message: "no route found" }));
    const provider = createOsrmProvider({
      baseUrl: "http://osrm.invalid",
      fetchImpl: f.impl,
      sleepImpl: noSleep,
    });
    const result = await provider.route({ origin: ORIGIN, destination: DEST });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("no_route");
    expect(f.calls()).toBe(1);
  });

  it("جدولُ قرار الإعادة واحدٌ لكل المزوّدين", () => {
    expect(deservesRoutingRetry("timeout")).toBe(true);
    expect(deservesRoutingRetry("unreachable")).toBe(true);
    expect(deservesRoutingRetry("server_error")).toBe(true);
    // ما لا يستحقّ: محسومٌ، أو مُضِرٌّ، أو ليس عطلاً أصلاً
    expect(deservesRoutingRetry("client_error")).toBe(false);
    expect(deservesRoutingRetry("rate_limited")).toBe(false);
    expect(deservesRoutingRetry("invalid_request")).toBe(false);
    expect(deservesRoutingRetry("protocol")).toBe(false);
    expect(deservesRoutingRetry("no_route")).toBe(false);
  });
});

describe("maps: OSRM — الانهيار الآمن", () => {
  it("خطأ OSRM بحالة HTTP 200 يُعاد خطأً لا انهياراً", async () => {
    // OSRM يردّ 200 مع `code` مخالف. القديم يفحص `res.ok` وحده ثم يقرأ
    // `routes[0]` من كائنٍ لا `routes` فيه ⇒ TypeError خارج أي try.
    const f = countingFetch(() => jsonResponse({ code: "NoSegment", message: "no segment" }));
    const provider = createOsrmProvider({
      baseUrl: "http://osrm.invalid",
      fetchImpl: f.impl,
      sleepImpl: noSleep,
    });

    const route = await provider.route({ origin: ORIGIN, destination: DEST });
    const nearest = await provider.nearest({ point: ORIGIN });
    const table = await provider.table([ORIGIN], [DEST]);

    for (const r of [route, nearest, table]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("no_route");
    }
  });

  it("جسمٌ ليس JSON يُعاد خطأ بروتوكول", async () => {
    const f = countingFetch(() => new Response("<html>502 Bad Gateway</html>", { status: 200 }));
    const provider = createOsrmProvider({
      baseUrl: "http://osrm.invalid",
      fetchImpl: f.impl,
      sleepImpl: noSleep,
    });
    const result = await provider.route({ origin: ORIGIN, destination: DEST });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("protocol");
  });

  it("ردٌّ بلا `code` يُرفض: غيابُه يعني أن المُخاطَب ليس OSRM", async () => {
    const f = countingFetch(() => jsonResponse({ routes: [] }));
    const provider = createOsrmProvider({
      baseUrl: "http://osrm.invalid",
      fetchImpl: f.impl,
      sleepImpl: noSleep,
    });
    const result = await provider.route({ origin: ORIGIN, destination: DEST });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("protocol");
  });

  it("مسارٌ ناقصُ الحقول يُرفض بدل أن يُعاد بأرقامٍ غائبة", async () => {
    const f = countingFetch(() => jsonResponse({ code: "Ok", routes: [{ distance: 12000 }] }));
    const provider = createOsrmProvider({
      baseUrl: "http://osrm.invalid",
      fetchImpl: f.impl,
      sleepImpl: noSleep,
    });
    const result = await provider.route({ origin: ORIGIN, destination: DEST });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("protocol");
  });

  it("صنفُ الخطأ يُميّز «المزوّد ساقط» من «لا طريق» — وعليه يُبنى السقوط الآمن", async () => {
    const down = createOsrmProvider({
      baseUrl: "http://127.0.0.1:9",
      timeoutMs: 300,
      sleepImpl: noSleep,
    });
    const dr = await down.route({ origin: ORIGIN, destination: DEST });
    expect(dr.ok).toBe(false);
    if (!dr.ok) {
      // عابر ⇒ للمستهلك أن يسقط إلى تقديرٍ تقريبي
      expect(deservesRoutingRetry(dr.error.kind)).toBe(true);
      expect(dr.error.provider).toBe("osrm");
    }

    const f = countingFetch(() => jsonResponse({ code: "NoRoute" }));
    const noRoute = createOsrmProvider({
      baseUrl: "http://osrm.invalid",
      fetchImpl: f.impl,
      sleepImpl: noSleep,
    });
    const nr = await noRoute.route({ origin: ORIGIN, destination: DEST });
    expect(nr.ok).toBe(false);
    // جوابٌ نهائي ⇒ تجميلُه بتقديرٍ تقريبي كذبٌ على العميل: الطريق غير موجود
    if (!nr.ok) expect(deservesRoutingRetry(nr.error.kind)).toBe(false);
  });
});

describe("maps: OSRM — خياراتٌ كانت تُقبل وتُهمَل", () => {
  it("`profile` يُحترم: من طلب مشياً لا يُحسب له زمنُ سيارة", async () => {
    const f = countingFetch(() => jsonResponse(OK_ROUTE));
    const provider = createOsrmProvider({
      baseUrl: "http://osrm.invalid",
      defaultProfile: "walking",
      fetchImpl: f.impl,
      sleepImpl: noSleep,
    });

    await provider.route({ origin: ORIGIN, destination: DEST, profile: "cycling" });
    // خيارُ النداء يسبق ضبطَ المزوّد
    expect(f.urls[0]).toContain("/route/v1/cycling/");
    expect(f.urls[0]).not.toContain("/driving/");

    await provider.route({ origin: ORIGIN, destination: DEST });
    // وبلا خيارٍ في النداء يُستعمل الضبط، لا `driving` المثبَّت نصّاً
    expect(f.urls[1]).toContain("/route/v1/walking/");
  });

  it("`radiusMeters` يُمرَّر لا يُهمَل", async () => {
    const f = countingFetch(() =>
      jsonResponse({ code: "Ok", waypoints: [{ location: [39.19, 21.48], distance: 4 }] }),
    );
    const provider = createOsrmProvider({
      baseUrl: "http://osrm.invalid",
      fetchImpl: f.impl,
      sleepImpl: noSleep,
    });

    await provider.nearest({ point: ORIGIN, radiusMeters: 300 });
    expect(f.urls[0]).toContain("radiuses=300");

    await provider.nearest({ point: ORIGIN });
    // وبلا نصف قطرٍ لا يُرسل الحدّ أصلاً: صفرٌ افتراضيّ كان سيُفرغ النتيجة
    expect(f.urls[1]).not.toContain("radiuses");
  });

  it("`count` غير صحيحٍ يُرفض قبل الشبكة", async () => {
    const f = countingFetch(() => jsonResponse({ code: "Ok", waypoints: [] }));
    const provider = createOsrmProvider({
      baseUrl: "http://osrm.invalid",
      fetchImpl: f.impl,
      sleepImpl: noSleep,
    });
    const result = await provider.nearest({ point: ORIGIN, count: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_request");
    expect(f.calls()).toBe(0);
  });
});
