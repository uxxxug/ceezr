/**
 * الغرض: إثباتُ **الوَصْلِ** في البند `F1-08` لا وجودِ الطبقةِ وحدَها: أنّ حدَّ
 *   API يُبلِّغ في مساراتِه الأربعةِ ويقرأ `X-Request-Id` من الردّ، وأنّ حدثَ
 *   الإقلاعِ يحمل **معرّفَ الطلبِ الذي أصدره الخادمُ فعلاً**، وأنّ حدَّ الخطأِ
 *   يسجّل وسماً بلا رسالةِ استثناءٍ.
 * الحالة: اختبار فعلي — `globalThis.fetch` مُستبدَلٌ، والردودُ مصنوعةٌ.
 * ينتمي إلى: apps/miniapp/src/telemetry
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: **ليس ههنا خادمٌ حقيقيٌّ ولا بيئةُ DOM**: الردودُ مصنوعةٌ
 *   بـ`Response`، و`componentDidCatch` يُنادى نداءً مباشراً لا بسقوطِ شجرةٍ في
 *   متصفّح. فالمُثبَتُ **الوَصْلُ والعقدُ**، لا سلوكُ الجهازِ. والتحقّقُ أنّ
 *   الخادمَ يُصدِر الرأسَ فعلاً في `tests/unit/gateway-request-id.test.ts`.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { ApiError, ApiNetworkError, type ApiObservation, apiFetch } from "../api/client.ts";
import { establishSession } from "../identity/boot.ts";
import { clearSession, setSession } from "../identity/session.ts";
import { ErrorBoundary } from "../shell/ErrorBoundary.tsx";
import { createMemorySink } from "./sink.ts";
import { createTelemetry } from "./telemetry.ts";

const HOUR_MS = 3_600_000;
const SERVER_ID = "3f1c9b7a-2d4e-4f60-8a11-b2c3d4e5f607";
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  clearSession();
});

/** ردٌّ مصنوعٌ يحمل رأسَ معرّفِ الطلبِ كما يُصدِره الخادمُ (ADR 0043). */
function respondWith(status: number, body: unknown, requestId: string | null = SERVER_ID): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "content-type": "application/json",
        ...(requestId === null ? {} : { "x-request-id": requestId }),
      },
    })) as unknown as typeof fetch;
}

describe("F1-08 · حدُّ API يُبلِّغ ويقرأ معرّفَ الطلب", () => {
  it("نداءٌ ناجحٌ: `ok` ومعرّفُ الطلبِ من رأسِ الردّ", async () => {
    respondWith(200, { ok: true });
    setSession({ accessToken: "live", expiresAt: Date.now() + HOUR_MS });
    const seen: ApiObservation[] = [];
    await apiFetch("/v1/me", { observe: (o) => seen.push(o) });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      path: "/v1/me",
      method: "GET",
      status: 200,
      code: null,
      requestId: SERVER_ID,
      outcome: "ok",
    });
  });

  it("ردٌّ غيرُ ناجحٍ: `rejected` بالرمزِ والحالةِ والمعرّفِ — **والخطأُ يحمل المعرّفَ**", async () => {
    respondWith(401, { ok: false, error: "SESSION_EXPIRED" });
    setSession({ accessToken: "live", expiresAt: Date.now() + HOUR_MS });
    const seen: ApiObservation[] = [];
    const thrown = await apiFetch("/v1/me", { observe: (o) => seen.push(o) }).catch((e) => e);
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).requestId).toBe(SERVER_ID);
    expect(seen[0]?.outcome).toBe("rejected");
    expect(seen[0]?.code).toBe("SESSION_EXPIRED");
    expect(seen[0]?.requestId).toBe(SERVER_ID);
  });

  it("لم يصل ردٌّ: `no_response` **بلا معرّفٍ ولا حالةٍ** — ولا يُختلَق معرّفٌ", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    setSession({ accessToken: "live", expiresAt: Date.now() + HOUR_MS });
    const seen: ApiObservation[] = [];
    const thrown = await apiFetch("/v1/me", { observe: (o) => seen.push(o) }).catch((e) => e);
    expect(thrown).toBeInstanceOf(ApiNetworkError);
    expect(seen[0]).toEqual({
      path: "/v1/me",
      method: "GET",
      status: null,
      code: null,
      requestId: null,
      outcome: "no_response",
    });
  });

  it("رفضٌ محليٌّ بلا جلسةٍ: `not_attempted` — **ولا نداءَ شبكةٍ إطلاقاً**", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const seen: ApiObservation[] = [];
    await apiFetch("/v1/me", { observe: (o) => seen.push(o) }).catch(() => undefined);
    expect(calls).toBe(0);
    expect(seen[0]?.outcome).toBe("not_attempted");
    expect(seen[0]?.code).toBe("SESSION_REQUIRED");
    expect(seen[0]?.requestId).toBeNull();
  });

  it("رأسٌ بشكلٍ غيرِ مقبولٍ يُهمَل ولا يُنقَل إلى الخطأ", async () => {
    respondWith(500, { ok: false, error: "INTERNAL_ERROR" }, "short");
    setSession({ accessToken: "live", expiresAt: Date.now() + HOUR_MS });
    const thrown = (await apiFetch("/v1/me").catch((e) => e)) as ApiError;
    expect(thrown.requestId).toBeNull();
  });

  it("**مُراقِبٌ يرمي لا يُسقِط النداءَ**: القياسُ لا يُفشِل النقل", async () => {
    respondWith(200, { ok: true });
    setSession({ accessToken: "live", expiresAt: Date.now() + HOUR_MS });
    const value = await apiFetch<{ ok: boolean }>("/v1/me", {
      observe: () => {
        throw new Error("مُراقِبٌ معطوبٌ");
      },
    });
    expect(value).toEqual({ ok: true });
  });

  it("نداءٌ بلا مُراقِبٍ لا يتغيّر سلوكُه شعرةً", async () => {
    respondWith(200, { ok: true });
    setSession({ accessToken: "live", expiresAt: Date.now() + HOUR_MS });
    expect(await apiFetch<{ ok: boolean }>("/v1/me")).toEqual({ ok: true });
  });
});

describe("F1-08 · حدثُ الإقلاعِ مربوطٌ بمعرّفِ الطلب", () => {
  it("مبادلةٌ ناجحةٌ: حدثٌ واحدٌ `exchanged` بمعرّفِ الطلبِ الذي أصدره الخادمُ", async () => {
    respondWith(200, {
      ok: true,
      accessToken: "a",
      expiresAtMs: Date.now() + HOUR_MS,
    });
    const sink = createMemorySink(8);
    const result = await establishSession({
      insideTelegram: () => true,
      rawInitData: () => "user=%7B%7D&hash=deadbeef",
      renew: async () => ({ renewed: false, reason: "NO_STORED_TOKEN" }) as const,
      persist: async () => ({ stored: true }) as never,
      telemetry: createTelemetry({ sink, now: () => 7 }),
    });
    expect(result).toEqual({ established: true, via: "exchanged" });
    expect(sink.size()).toBe(1);
    expect(sink.entries()[0]?.event).toEqual({
      kind: "boot",
      outcome: "exchanged",
      reason: null,
      requestId: SERVER_ID,
    });
  });

  it("رفضُ المبادلةِ: حدثٌ `failed` بسببٍ صريحٍ وبمعرّفِ الطلبِ من الخطأ", async () => {
    const sink = createMemorySink(8);
    await establishSession({
      insideTelegram: () => true,
      rawInitData: () => "user=%7B%7D&hash=deadbeef",
      renew: async () => ({ renewed: false, reason: "NO_STORED_TOKEN" }) as const,
      exchange: async () => {
        throw new ApiError(401, "INIT_DATA_INVALID", "rejected", null, SERVER_ID);
      },
      telemetry: createTelemetry({ sink, now: () => 7 }),
    });
    expect(sink.entries()[0]?.event).toEqual({
      kind: "boot",
      outcome: "failed",
      reason: "REJECTED",
      requestId: SERVER_ID,
    });
  });

  it("جلسةٌ في الذاكرةِ: حدثٌ `existing` **بلا معرّفٍ** — لا نداءَ فلا رأسَ", async () => {
    const sink = createMemorySink(8);
    setSession({ accessToken: "live", expiresAt: Date.now() + HOUR_MS });
    await establishSession({ telemetry: createTelemetry({ sink, now: () => 7 }) });
    expect(sink.entries()[0]?.event).toEqual({
      kind: "boot",
      outcome: "existing",
      reason: null,
      requestId: null,
    });
  });

  it("تعطُّلٌ في التجديدِ: حدثٌ `failed / UNAVAILABLE` **بلا معرّفٍ** حين لا ردَّ", async () => {
    const sink = createMemorySink(8);
    await establishSession({
      renew: async () => ({ renewed: false, reason: "UNAVAILABLE" }) as const,
      telemetry: createTelemetry({ sink, now: () => 7 }),
    });
    expect(sink.entries()[0]?.event).toEqual({
      kind: "boot",
      outcome: "failed",
      reason: "UNAVAILABLE",
      requestId: null,
    });
  });

  it("**إقلاعٌ بلا قياسٍ لا يسجّل ولا يتعطّل**: القياسُ اختياريٌّ فعلاً", async () => {
    setSession({ accessToken: "live", expiresAt: Date.now() + HOUR_MS });
    expect(await establishSession()).toEqual({ established: true, via: "existing" });
  });

  it("حدثٌ **واحدٌ** لكلِّ إقلاعٍ لا حدثٌ لكلِّ خطوةٍ", async () => {
    const sink = createMemorySink(8);
    await establishSession({
      insideTelegram: () => false,
      renew: async () => ({ renewed: false, reason: "NO_STORED_TOKEN" }) as const,
      telemetry: createTelemetry({ sink, now: () => 7 }),
    });
    expect(sink.size()).toBe(1);
  });
});

describe("F1-08 · حدُّ الخطأِ يسجّل وسماً لا رسالةً", () => {
  it("`componentDidCatch` يسجّل `ui_error` بالوسمِ وحدَه", () => {
    const sink = createMemorySink(4);
    const telemetry = createTelemetry({ sink, now: () => 11 });
    const boundary = new ErrorBoundary({ children: null, label: "root", telemetry });
    const originalError = console.error;
    console.error = () => undefined;
    try {
      boundary.componentDidCatch(new Error("انفجارٌ فيه عنوانٌ https://t.me/app#tok"), {
        componentStack: "\n    at Shell\n    at App",
      });
    } finally {
      console.error = originalError;
    }
    expect(sink.entries()[0]?.event).toEqual({
      kind: "ui_error",
      label: "root",
      requestId: null,
    });
  });

  it("حدٌّ بلا قياسٍ لا يسجّل ولا يتعطّل", () => {
    const boundary = new ErrorBoundary({ children: null });
    const originalError = console.error;
    console.error = () => undefined;
    try {
      expect(() =>
        boundary.componentDidCatch(new Error("x"), { componentStack: "" }),
      ).not.toThrow();
    } finally {
      console.error = originalError;
    }
  });
});
