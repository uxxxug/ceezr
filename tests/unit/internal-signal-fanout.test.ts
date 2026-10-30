import { describe, expect, it } from "bun:test";
import { createPeerSignal } from "../../apps/gateway/src/realtime/peer-signal.ts";
import {
  fanoutSignal,
  signalTargets,
} from "../../packages/infrastructure/notification/internal-signal-fanout.ts";
import { tryLoadConfig } from "../../packages/shared/config/index.ts";

/**
 * تعدُّدُ نسخِ البوّابة (قرارُ المالكِ 2026-10-30) — إشارةُ القناةِ الآنيةِ تُبَثُّ إلى كلِّ نسخة،
 * والمآلُ «بُثَّ» إن بثّتها واحدةٌ؛ ونسخةٌ واحدةٌ = نداءٌ واحدٌ كما كان.
 */

function base(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  return {
    NODE_ENV: "development",
    PORT: "3000",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    DATABASE_URL: "postgres://localhost/test",
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "upstash-token",
    DRIVER_BOT_TOKEN: "123456:driver",
    RIDER_BOT_TOKEN: "654321:rider",
    TELEGRAM_WEBHOOK_SECRET: "abcdefghijklmnopqrstuvwxyz0123456789abcd",
    BOOTSTRAP_ADMIN_TELEGRAM_ID: "123456789",
    MINIAPP_URL: "https://app.example.com",
    ...overrides,
  };
}

type Call = { url: string; body: string };

function fakeFetch(answers: Record<string, boolean | number | "throw">, calls: Call[]) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, body: String(init.body) });
    const host = new URL(url).host;
    const answer = answers[host];
    if (answer === "throw") throw new Error("connect refused");
    if (typeof answer === "number") return new Response("{}", { status: answer });
    return Response.json({ emitted: answer === true });
  };
}

describe("signalTargets", () => {
  it("الغيابُ قائمةٌ فارغة، والعنوانُ الواحدُ قائمةٌ من عنصر", () => {
    expect(signalTargets(null)).toEqual([]);
    expect(signalTargets("http://a:1")).toEqual(["http://a:1"]);
    expect(signalTargets(["http://a:1", "", "http://b:2"])).toEqual(["http://a:1", "http://b:2"]);
  });
});

describe("fanoutSignal", () => {
  const input = {
    path: "/internal/realtime/offers-signal",
    secret: "s".repeat(32),
    body: { telegram_user_id: "42" },
    timeoutMs: 1_000,
  };

  it("نسخةٌ واحدةٌ = نداءٌ واحدٌ ومآلُه كما هو", async () => {
    const calls: Call[] = [];
    const emitted = await fanoutSignal({
      ...input,
      fetch: fakeFetch({ "a:1": true }, calls),
      targets: ["http://a:1"],
    });
    expect(emitted).toBe(true);
    expect(calls.map((c) => c.url)).toEqual(["http://a:1/internal/realtime/offers-signal"]);
  });

  it("السائقُ متّصلٌ بالنسخةِ الثانيةِ وحدَها ⇒ بُثَّ، ووصلَ النداءُ إلى النسختَين", async () => {
    const calls: Call[] = [];
    const emitted = await fanoutSignal({
      ...input,
      fetch: fakeFetch({ "a:1": false, "b:2": true }, calls),
      targets: ["http://a:1", "http://b:2"],
    });
    expect(emitted).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.body === JSON.stringify(input.body))).toBe(true);
  });

  it("نسخةٌ معطّلةٌ أو رافضةٌ لا تُفشلُ ما بثّته أخرى، وفشلُ الكلِّ = لم تُبَثّ", async () => {
    const rejected: number[] = [];
    const ok = await fanoutSignal({
      ...input,
      fetch: fakeFetch({ "a:1": "throw", "b:2": 503, "c:3": true }, []),
      targets: ["http://a:1", "http://b:2", "http://c:3"],
      onRejected: (status) => rejected.push(status),
    });
    expect(ok).toBe(true);
    expect(rejected).toEqual([503]);
    const none = await fanoutSignal({
      ...input,
      fetch: fakeFetch({ "a:1": "throw", "b:2": false }, []),
      targets: ["http://a:1", "http://b:2"],
    });
    expect(none).toBe(false);
  });

  it("بلا أهدافٍ لا نداء", async () => {
    const calls: Call[] = [];
    expect(await fanoutSignal({ ...input, fetch: fakeFetch({}, calls), targets: [] })).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("GATEWAY_INTERNAL_URL قائمةً", () => {
  it("عنوانٌ واحدٌ يبقى كما كان", () => {
    const result = tryLoadConfig(base({ GATEWAY_INTERNAL_URL: "http://gw:8080" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.gatewayInternalUrl).toBe("http://gw:8080/");
    expect(result.value.gatewayInternalUrls).toEqual(["http://gw:8080/"]);
  });

  it("عناوينُ مفصولةٌ بفواصلَ تصيرُ قائمةً، وأوّلُها هو gatewayInternalUrl", () => {
    const result = tryLoadConfig(
      base({ GATEWAY_INTERNAL_URL: "http://gw1:8080, http://gw2:8080 ," }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.gatewayInternalUrls).toEqual(["http://gw1:8080/", "http://gw2:8080/"]);
    expect(result.value.gatewayInternalUrl).toBe("http://gw1:8080/");
  });

  it("عنصرٌ غيرُ صالحٍ يُفشلُ الإقلاعَ صريحًا", () => {
    const result = tryLoadConfig(base({ GATEWAY_INTERNAL_URL: "http://gw1:8080,not a url" }));
    expect(result.ok).toBe(false);
  });

  it("الغيابُ = قائمةٌ فارغة", () => {
    const result = tryLoadConfig(base({}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.gatewayInternalUrls).toEqual([]);
    expect(result.value.gatewayInternalUrl).toBeNull();
  });
});

describe("createPeerSignal", () => {
  it("نسخةٌ واحدةٌ = معطَّلٌ بلا نداء، ونسختان = نداءٌ لكلٍّ بمعرّفِ المصدر", async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch({ "a:1": true, "b:2": false }, calls);
    const single = createPeerSignal({
      targets: ["http://a:1"],
      secret: "s".repeat(32),
      origin: "me",
      fetch,
    });
    expect(single.enabled).toBe(false);
    single.send("/internal/realtime/chat-signal", { order_id: "x" });
    expect(calls).toHaveLength(0);

    const multi = createPeerSignal({
      targets: ["http://a:1", "http://b:2"],
      secret: "s".repeat(32),
      origin: "me",
      fetch,
    });
    expect(multi.enabled).toBe(true);
    multi.send("/internal/realtime/chat-signal", { order_id: "x", last_seq: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      order_id: "x",
      last_seq: 1,
      origin: "me",
    });
  });

  it("بلا سرٍّ = معطَّل", () => {
    const peer = createPeerSignal({
      targets: ["http://a:1", "http://b:2"],
      secret: null,
      origin: "me",
    });
    expect(peer.enabled).toBe(false);
  });
});
