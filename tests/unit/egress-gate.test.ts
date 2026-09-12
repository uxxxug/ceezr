/**
 * بوّابةُ الصادرِ وقتَ التشغيلِ — قياسُ **الرفضِ** أوّلاً.
 *
 * والحاجزُ الساكنُ (`check-egress-boundary`) يقيسُ أنَّ كلَّ مقصدٍ مُعلَنٌ، ولا يقيسُ
 * أنَّ نداءً غيرَ مُعلَنٍ **يُمنَعُ**. فههنا تُزرَعُ الخروقُ — مضيفٌ غيرُ مُعلَنٍ،
 * بابُ مقصدٍ آخرَ، مخطَّطٌ غيرُ شبكيٍّ، مقصدٌ مجهولٌ، مُدخلُ MARKET — ويُقاسُ أنَّ
 * الناقلَ **لم يُنادَ** ألبتّةَ. فالسماحُ وحدَه يُقاسُ في بوّاباتٍ معطوبةٍ أيضاً.
 *
 * ينتمي إلى: tests/unit · البندُ `W-6` · `ADR 0086`
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  assertEgressAllowed,
  assertEgressEnvironment,
  configuredHostsOf,
  createGuardedFetch,
  decideEgress,
  EgressDeniedError,
  envEgressViolations,
  type FetchLike,
  isLoopbackOrReserved,
  staticHostsOf,
} from "../../packages/shared/wasla/egress-gate.ts";
import {
  type EgressPeer,
  gatedPeers,
  WASLA_EGRESS_REGISTRY,
} from "../../packages/shared/wasla/egress-registry.ts";

/** ناقلٌ يُحسِبُ نداءاتِه: أداةُ القياسِ الفعليّةُ — «هل خرجَ الطلبُ؟». */
function countingTransport(): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const impl: FetchLike = (input) => {
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : "req");
    return Promise.resolve(new Response("ok"));
  };
  return { fetch: impl, calls };
}

const marketPeer: EgressPeer = {
  id: "test-market-peer",
  purpose: "مُدخلٌ مزروعٌ في الاختبارِ لقياسِ رفضِ MARKET نصّاً",
  peerClass: "INFRASTRUCTURE",
  system: "MARKET",
  source: { kind: "literal", hosts: ["market-peer.net"] },
  callSite: "tests/unit/egress-gate.test.ts",
  runtimeGate: { kind: "gated" },
  removed: false,
};

describe("بوّابةُ الصادرِ: الرفضُ", () => {
  test("مضيفٌ غيرُ مُعلَنٍ يُرفَضُ ولا يُنادى الناقلُ", async () => {
    const t = countingTransport();
    const guarded = createGuardedFetch("moyasar-payments", t.fetch);
    await expect(guarded("https://evil-host.net/v1/payments")).rejects.toThrow(EgressDeniedError);
    expect(t.calls).toEqual([]);
  });

  test("بابُ مقصدٍ آخرَ يُفرَزُ بسببِه لا بسببِ «غيرِ مُعلَنٍ»", () => {
    const decision = decideEgress({
      peerId: "moyasar-payments",
      url: "https://api.telegram.org/botX/sendMessage",
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("HOST_OF_ANOTHER_PEER");
  });

  test("مقصدٌ ليسَ في السجلِّ يُرفَضُ: المجهولُ لا يمرُّ", () => {
    const decision = decideEgress({ peerId: "not-a-peer", url: "https://api.telegram.org/x" });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("UNKNOWN_PEER");
  });

  test("مُدخلٌ يُعلِنُ MARKET يُرفَضُ ولو كانَ مضيفُه مُعلَناً فيه", () => {
    const decision = decideEgress({
      peerId: marketPeer.id,
      url: "https://market-peer.net/x",
      registry: [...WASLA_EGRESS_REGISTRY, marketPeer],
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("MARKET_SYSTEM");
  });

  test("مخطَّطٌ غيرُ شبكيٍّ وعنوانٌ معطوبٌ: سببانِ متمايزانِ", () => {
    const scheme = decideEgress({ peerId: "moyasar-payments", url: "file:///etc/passwd" });
    expect(scheme.allowed).toBe(false);
    if (!scheme.allowed) expect(scheme.reason).toBe("NON_HTTP_SCHEME");
    const malformed = decideEgress({ peerId: "moyasar-payments", url: "api.moyasar.com/v1" });
    expect(malformed.allowed).toBe(false);
    if (!malformed.allowed) expect(malformed.reason).toBe("MALFORMED_URL");
  });

  test("رسالةُ الرفضِ لا تحملُ سرّاً ولا مساراً ولا رمزَ حاملٍ", () => {
    let message = "";
    try {
      assertEgressAllowed({
        peerId: "telegram-bot-api",
        url: "https://evil-host.net/bot123:SECRET-TOKEN/sendMessage?key=sk_live_abc",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("telegram-bot-api");
    expect(message).toContain("UNDECLARED_HOST");
    expect(message).not.toContain("SECRET-TOKEN");
    expect(message).not.toContain("sk_live_abc");
    expect(message).not.toContain("sendMessage");
  });

  test("البوّابةُ قبلَ الناقلِ المحقونِ أيضاً: الحقنُ ليسَ باباً جانبيّاً", async () => {
    const t = countingTransport();
    const guarded = createGuardedFetch("core-events-ingress", t.fetch, { env: {} });
    await expect(guarded("https://core.internal.corp/events")).rejects.toThrow(EgressDeniedError);
    expect(t.calls).toEqual([]);
  });
});

describe("بوّابةُ الصادرِ: السماحُ بحدودِه", () => {
  test("مضيفٌ مُعلَنٌ حرفاً يمرُّ ويُنادى الناقلُ مرّةً", async () => {
    const t = countingTransport();
    const guarded = createGuardedFetch("moyasar-payments", t.fetch);
    const response = await guarded("https://api.moyasar.com/v1/payments");
    expect(response.status).toBe(200);
    expect(t.calls).toEqual(["https://api.moyasar.com/v1/payments"]);
  });

  test("مضيفُ البيئةِ يمرُّ إن ضُبِطَ، ويُرفَضُ نظيرُه إن لم يُضبَطْ", () => {
    const env = { CORE_EVENTS_BASE_URL: "https://core.internal.corp/api" };
    const allowed = decideEgress({
      peerId: "core-events-ingress",
      url: "https://core.internal.corp/api/events",
      env,
    });
    expect(allowed.allowed).toBe(true);
    if (allowed.allowed) expect(allowed.reason).toBe("CONFIGURED_ENV_HOST");
    const denied = decideEgress({
      peerId: "core-events-ingress",
      url: "https://core.internal.corp/api/events",
      env: { CORE_EVENTS_BASE_URL: "https://other.internal.corp" },
    });
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.reason).toBe("UNDECLARED_HOST");
  });

  test("الحَلقةُ الراجعةُ والنطاقاتُ المحفوظةُ حدٌّ مُعلَنٌ لا ثقبٌ مفتوحٌ", () => {
    expect(isLoopbackOrReserved("localhost")).toBe(true);
    expect(isLoopbackOrReserved("127.0.0.1")).toBe(true);
    expect(isLoopbackOrReserved("core.test")).toBe(true);
    expect(isLoopbackOrReserved("core.internal.corp")).toBe(false);
    expect(isLoopbackOrReserved("localhost.attacker.net")).toBe(false);
  });

  test("مضيفاتُ المُدخلِ: الساكنةُ لا تُخلَطُ بالمضبوطةِ بالبيئةِ", () => {
    const shipper = WASLA_EGRESS_REGISTRY.find((p) => p.id === "core-events-ingress");
    expect(shipper).toBeDefined();
    if (shipper === undefined) return;
    expect(staticHostsOf(shipper)).toEqual([]);
    expect(
      configuredHostsOf(shipper, { CORE_EVENTS_BASE_URL: "https://c.internal.corp/x" }),
    ).toEqual(["c.internal.corp"]);
    expect(configuredHostsOf(shipper, {})).toEqual([]);
  });
});

describe("بيئةُ التشغيلِ عندَ الإقلاعِ", () => {
  test("مفتاحٌ مضبوطٌ على بابِ مقصدٍ آخرَ يُبلَّغُ ويُسقِطُ الإقلاعَ", () => {
    const env = { CORE_EVENTS_BASE_URL: "https://api.telegram.org" };
    const violations = envEgressViolations(env);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.envKey).toBe("CORE_EVENTS_BASE_URL");
    expect(violations[0]?.detail).toContain("telegram-bot-api");
    expect(() => assertEgressEnvironment(env)).toThrow();
  });

  test("بيئةٌ فارغةٌ أو محلّيّةٌ لا تُسقِطُ الإقلاعَ: الحاجزُ للتشابكِ لا للنقصِ", () => {
    expect(envEgressViolations({})).toEqual([]);
    expect(() =>
      assertEgressEnvironment({ CORE_EVENTS_BASE_URL: "http://localhost:8787" }),
    ).not.toThrow();
  });

  test("مخطَّطٌ لا يُعرَفُ في مفتاحِ بيئةٍ يُبلَّغُ مفتاحاً مضبوطاً خطأً", () => {
    const violations = envEgressViolations({ CORE_EVENTS_BASE_URL: "ftp://core.internal.corp" });
    expect(violations.length).toBe(1);
    expect(violations[0]?.detail).toContain("مخطَّطٌ");
  });
});

describe("السجلُّ والبوّابةُ مصدرٌ واحدٌ", () => {
  test("كلُّ مقصدٍ مُلزَمٍ بالبوّابةِ يُقرَأُ منها بمعرّفِه", () => {
    const gated = gatedPeers();
    expect(gated.length).toBeGreaterThan(0);
    for (const peer of gated) {
      const decision = decideEgress({ peerId: peer.id, url: "https://undeclared.internal.corp/x" });
      expect(decision.allowed).toBe(false);
    }
  });

  test("لا مُدخلَ MARKET في السجلِّ المُسلَّمِ", () => {
    expect(WASLA_EGRESS_REGISTRY.filter((p) => p.system === "MARKET")).toEqual([]);
  });
});

describe("الحاجزُ موصولٌ بإقلاعِ البوّابةِ", () => {
  /**
   * قياسُ الوصلِ لا وجودِ الدالّةِ: دالّةٌ صحيحةٌ لا يُناديها أحدٌ لا تحرسُ شيئاً.
   * ويُقاسُ **الترتيبُ** أيضاً — قبلَ تركيبِ الحاويةِ — لأنَّ حاجزاً بعدَ فتحِ
   * الاتّصالاتِ وتسجيلِ المسالكِ ليسَ فشلاً سريعاً.
   */
  test("إقلاعُ البوّابةِ يُنادي حاجزَ البيئةِ قبلَ تركيبِ الحاويةِ", () => {
    const source = readFileSync("apps/gateway/src/index.ts", "utf8");
    const guardAt = source.indexOf("assertEgressEnvironment(process.env)");
    const containerAt = source.indexOf("buildContainer(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(containerAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(containerAt);
  });
});
