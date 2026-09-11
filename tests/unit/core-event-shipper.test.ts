/**
 * الغرض: قياسُ **حكمِ** ناقلِ الأحداثِ إلى CORE: ما يُسلَّمُ، وما يُعادُ، وما يموتُ
 *    فوراً؛ وأنَّ الطلبَ يُبنى كما ينصُّ العقدُ المنقولُ (مسارٌ، حاملٌ، جسمٌ).
 *    البند `W-5` (ناقلٌ).
 * الحالة: منفّذ فعلياً — 2026-09-12.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test tests/unit`، وسلسلةُ `ci`.
 * ملاحظات مستقبلية: لا شبكةَ ههنا ولا مِخدَعَ HTTP: `fetch` يُحَلُّ وسيطاً. ولو
 *    أُريدَ يوماً قياسُ الشبكةِ نفسِها فذاكَ اختبارُ تكاملٍ بخادمٍ حقيقيٍّ، ولا
 *    يُغني عن هذا ولا يُغني هذا عنه.
 *
 * ## لِمَ يُقاسُ الحكمُ لا النجاحُ وحدَه
 *
 * أسهلُ ما يُكتَبُ في ناقلٍ اختبارُ «٢٠٢ ⇒ نجاحٌ»، وهوَ أقلُّ ما يفيدُ: الخطرُ في
 * تصنيفِ الإخفاقِ. فـ`403` يُعادُ ثمانياً بلا أملٍ إن أُخطئَ تصنيفُه، و`503`
 * يُماتُ فوراً فيُفقَدُ حدثٌ كانَ سيُقبَلُ بعدَ ثانيةٍ. فكلُّ صفٍّ من جدولِ العقدِ
 * مقيسٌ ههنا صريحاً.
 */

import { describe, expect, it } from "bun:test";
import type { EventEnvelope } from "../../packages/application/wasla/fulfillment-lifecycle.ts";
import { createCoreEventShipper } from "../../packages/infrastructure/wasla/core-event-shipper.ts";
import { classifyCoreSubmitStatus } from "../../packages/shared/config/core-event-transport.ts";
import { isErr, isOk } from "../../packages/shared/result/index.ts";

const ENVELOPE: EventEnvelope = {
  event_id: "6f2f1f38-2e39-4a0f-9f2a-6a1b7a2c9d10",
  event_type: "move.job.accepted",
  occurred_at: "2026-09-12T00:00:00.000Z",
  correlation_id: "6f2f1f38-2e39-4a0f-9f2a-6a1b7a2c9d11",
  causation_id: null,
  payload: { fulfillment_id: "6f2f1f38-2e39-4a0f-9f2a-6a1b7a2c9d12", job_id: "job-1" },
};

interface Capture {
  url?: string;
  init?: RequestInit;
}

/** `fetch` يردُّ رمزاً وجسماً معلومَينِ، ويُسجِّلُ ما طُلِبَ منه. */
function respondWith(status: number, body: unknown, capture: Capture = {}): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    capture.url = String(url);
    capture.init = init;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function shipper(fetchImpl: typeof fetch, timeoutMs?: number) {
  return createCoreEventShipper({
    baseUrl: "https://core.example/",
    bearerToken: "service-token-for-move",
    fetchImpl,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

describe("ناقلُ أحداثِ MOVE إلى CORE — بناءُ الطلبِ", () => {
  it("يُودِعُ في `/v1/events` بمصادقةِ حاملٍ وجسمٍ هوَ المغلَّفُ نفسُه", async () => {
    const capture: Capture = {};
    const result = await shipper(
      respondWith(
        202,
        { event_id: ENVELOPE.event_id, accepted: true, first_delivery: true },
        capture,
      ),
    ).ship(ENVELOPE);

    expect(isOk(result)).toBe(true);
    expect(capture.url).toBe("https://core.example/v1/events");
    expect(capture.init?.method).toBe("POST");
    const headers = capture.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer service-token-for-move");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(String(capture.init?.body))).toEqual(ENVELOPE);
  });

  it("لا يُضاعِفُ الشرطةَ حينَ يحملُ الأصلُ شرطةً خاتمةً", async () => {
    const capture: Capture = {};
    await createCoreEventShipper({
      baseUrl: "https://core.example///",
      bearerToken: "t",
      fetchImpl: respondWith(202, { accepted: true, first_delivery: true }, capture),
    }).ship(ENVELOPE);
    expect(capture.url).toBe("https://core.example/v1/events");
  });
});

describe("ناقلُ أحداثِ MOVE إلى CORE — التسليمُ والإسلامُ", () => {
  it("`202` بإيصالٍ أوّلَ مرّةٍ = تسليمٌ و`firstDelivery=true`", async () => {
    const result = await shipper(
      respondWith(202, { event_id: ENVELOPE.event_id, accepted: true, first_delivery: true }),
    ).ship(ENVELOPE);
    expect(isOk(result) && result.value.firstDelivery).toBe(true);
  });

  it("إعادةُ الإيداعِ نفسِه = تسليمٌ لا إخفاقٌ، و`firstDelivery=false`", async () => {
    const result = await shipper(
      respondWith(202, { event_id: ENVELOPE.event_id, accepted: true, first_delivery: false }),
    ).ship(ENVELOPE);
    expect(isOk(result)).toBe(true);
    expect(isOk(result) && result.value.firstDelivery).toBe(false);
  });

  it("`200` كذلك تسليمٌ: العقدُ يقرأُ كلَّ `2xx` قبولاً لا `202` وحدَها", async () => {
    const result = await shipper(respondWith(200, { accepted: true, first_delivery: true })).ship(
      ENVELOPE,
    );
    expect(isOk(result)).toBe(true);
  });
});

describe("ناقلُ أحداثِ MOVE إلى CORE — الإخفاقُ العابرُ يُعادُ", () => {
  for (const status of [500, 502, 503, 504]) {
    it(`\`${status}\` = إعادةٌ لا موتٌ`, async () => {
      const result = await shipper(respondWith(status, "upstream down")).ship(ENVELOPE);
      expect(isErr(result) && result.error.permanent).toBe(false);
      expect(isErr(result) && result.error.detail).toContain(String(status));
    });
  }

  for (const status of [408, 429]) {
    it(`\`${status}\` = إعادةٌ استثناءً من قاعدةِ موتِ \`4xx\``, async () => {
      const result = await shipper(respondWith(status, "slow down")).ship(ENVELOPE);
      expect(isErr(result) && result.error.permanent).toBe(false);
    });
  }

  it("عطلُ شبكةٍ = إعادةٌ بسببٍ يُسمّى `NETWORK`", async () => {
    const failing = (async () => {
      throw new Error("ECONNREFUSED 10.0.0.1:443");
    }) as unknown as typeof fetch;
    const result = await shipper(failing).ship(ENVELOPE);
    expect(isErr(result) && result.error.permanent).toBe(false);
    expect(isErr(result) && result.error.detail).toContain("NETWORK");
  });

  it("انقضاءُ المهلةِ = إعادةٌ بسببٍ يُسمّى `TIMEOUT` لا عطلُ شبكةٍ مجهولٌ", async () => {
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new Error("The operation was aborted")),
        );
      })) as unknown as typeof fetch;
    const result = await shipper(hanging, 5).ship(ENVELOPE);
    expect(isErr(result) && result.error.permanent).toBe(false);
    expect(isErr(result) && result.error.detail).toContain("TIMEOUT");
  });

  it("رمزُ نجاحٍ بجسمٍ لا يُفَكُّ = إعادةٌ: لا تسليمَ بلا إيصالٍ", async () => {
    const result = await shipper(respondWith(202, "<html>proxy</html>")).ship(ENVELOPE);
    expect(isErr(result) && result.error.permanent).toBe(false);
    expect(isErr(result) && result.error.detail).toContain("MALFORMED_ACCEPTED_BODY");
  });

  it("`accepted=false` مع رمزِ نجاحٍ = إعادةٌ لا تسليمٌ مُدَّعىً", async () => {
    const result = await shipper(respondWith(202, { accepted: false, first_delivery: true })).ship(
      ENVELOPE,
    );
    expect(isErr(result) && result.error.detail).toContain("CORE_DID_NOT_ACCEPT");
  });
});

describe("ناقلُ أحداثِ MOVE إلى CORE — الإخفاقُ الدائمُ يموتُ فوراً", () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    it(`\`${status}\` = موتٌ فوريٌّ: إعادةُ البايتاتِ عينِها تُنتِجُ الرفضَ عينَه`, async () => {
      const result = await shipper(respondWith(status, "refused")).ship(ENVELOPE);
      expect(isErr(result) && result.error.permanent).toBe(true);
      expect(isErr(result) && result.error.detail).toContain(String(status));
    });
  }

  it("إيصالٌ بمعرّفٍ غيرِ الذي أُودِعَ = موتٌ: لا يُقيَّدُ تسليمُ حدثٍ آخرَ لنا", async () => {
    const result = await shipper(
      respondWith(202, { event_id: "00000000-0000-4000-8000-000000000000", accepted: true }),
    ).ship(ENVELOPE);
    expect(isErr(result) && result.error.permanent).toBe(true);
    expect(isErr(result) && result.error.detail).toContain("EVENT_ID_MISMATCH");
  });
});

describe("تصنيفُ الرموزِ — الحكمُ دالّةٌ واحدةٌ يُنادِيها الناقلُ والحاجزُ", () => {
  it("لا يُماتُ على رمزٍ لا ينصُّ عليه العقدُ", () => {
    expect(classifyCoreSubmitStatus(100)).toBe("retry");
    expect(classifyCoreSubmitStatus(600)).toBe("retry");
    expect(classifyCoreSubmitStatus(302)).toBe("retry");
  });
});
