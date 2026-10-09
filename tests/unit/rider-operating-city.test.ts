/**
 * الغرض: R1 · ADR 0252 — حكمُ الطبقةِ التطبيقيّةِ والمسارِ على `/v1/me/operating-city` بمنافذَ مصطنَعة:
 *   الجلسةُ شرط، والنقطةُ وحدَها تُقبَل (لا مدينةَ من المُدخَل)، وأخطاءُ المخزنِ تُترجَمُ برموزٍ حتميّة.
 * الحالة: منفّذ فعلياً.
 */

import { describe, expect, it } from "bun:test";
import { createOperatingCityRoutes } from "../../apps/gateway/src/routes/me-operating-city.ts";
import type { MiniAppSessionReader } from "../../packages/application/identity/ports.ts";
import {
  type OperatingCityDeps,
  type OperatingCityStore,
  parsePoint,
} from "../../packages/application/rider-city/operating-city.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const sessions = {
  read: async (token: string) =>
    token === "good"
      ? ok({ telegramUserId: "42", expiresAtMs: Date.now() + 60_000 })
      : err({ code: "SESSION_INVALID" }),
} as unknown as MiniAppSessionReader;

function depsWith(store: Partial<OperatingCityStore>, seen: unknown[] = []): OperatingCityDeps {
  return {
    sessions,
    now: () => new Date(),
    store: {
      read: async () => ok({ code: "JED", nameAr: "جدة", nameEn: "Jeddah", isActive: true }),
      locate: async (input) => {
        seen.push(input);
        return ok({
          outcome: "CHANGED" as const,
          city: { code: "MKK", nameAr: "مكة", nameEn: "Makkah", isActive: true },
        });
      },
      ...store,
    },
  };
}

const call = (deps: OperatingCityDeps, init: RequestInit & { token?: string } = {}) => {
  const app = createOperatingCityRoutes({ operatingCity: deps });
  const headers = new Headers(init.headers);
  if (init.token !== undefined) headers.set("Authorization", `Bearer ${init.token}`);
  return app.request("/v1/me/operating-city", { ...init, headers });
};

describe("R1 — parsePoint", () => {
  it("يقبلُ عددَين منتهيَين في مداهما ويرفضُ ما عداهما", () => {
    expect(parsePoint({ lat: 21.5, lng: 39.2 })).toEqual({ lat: 21.5, lng: 39.2 });
    for (const bad of [
      null,
      {},
      { lat: "21", lng: 39 },
      { lat: 91, lng: 0 },
      { lat: 0, lng: -181 },
      { lat: Number.NaN, lng: 0 },
      { lat: Number.POSITIVE_INFINITY, lng: 0 },
    ]) {
      expect(parsePoint(bad)).toBeNull();
    }
  });
});

describe("R1 — GET/POST /v1/me/operating-city", () => {
  it("بلا جلسة ⇒ 401، وبجلسةٍ مرفوضة ⇒ 401", async () => {
    expect((await call(depsWith({}))).status).toBe(401);
    expect((await call(depsWith({}), { token: "bad" })).status).toBe(401);
  });

  it("GET يعيدُ المدينةَ الحاليّةَ بأسمائها", async () => {
    const response = await call(depsWith({}), { token: "good" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      city: { code: "JED", name_ar: "جدة", name_en: "Jeddah", is_active: true },
    });
  });

  it("POST يمرِّرُ النقطةَ وحدَها ومعرّفَ الجلسة — وحقلُ مدينةٍ في الجسمِ لا يصلُ المخزن", async () => {
    const seen: unknown[] = [];
    const response = await call(depsWith({}, seen), {
      token: "good",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 21.42, lng: 39.82, city_id: "x", city: "RUH" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      outcome: "CHANGED",
      city: { code: "MKK", name_ar: "مكة", name_en: "Makkah", is_active: true },
    });
    expect(seen).toEqual([{ telegramUserId: "42", lat: 21.42, lng: 39.82 }]);
  });

  it("نقطةٌ غيرُ صالحة ⇒ 422 INVALID_POINT، وجسمٌ غيرُ JSON ⇒ 400 MALFORMED، ولا نداءَ للمخزن", async () => {
    const seen: unknown[] = [];
    const invalid = await call(depsWith({}, seen), {
      token: "good",
      method: "POST",
      body: JSON.stringify({ lat: 200, lng: 0 }),
    });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toEqual({ ok: false, error: "INVALID_POINT" });
    const malformed = await call(depsWith({}, seen), {
      token: "good",
      method: "POST",
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(seen).toEqual([]);
  });

  it("أخطاءُ المخزنِ: غيرُ الراكب ⇒ 403، وغيرُ الموجود ⇒ 404، والعطل ⇒ 503", async () => {
    for (const [reason, status, code] of [
      ["NOT_A_RIDER", 403, "NOT_A_RIDER"],
      ["USER_NOT_FOUND", 404, "ACCOUNT_NOT_FOUND"],
      ["STORE_ERROR", 503, "OPERATING_CITY_STORE_NOT_AVAILABLE"],
    ] as const) {
      const deps = depsWith({
        locate: async () => err({ code: "OPERATING_CITY_STORE_FAILED", reason }),
      });
      const response = await call(deps, {
        token: "good",
        method: "POST",
        body: JSON.stringify({ lat: 21, lng: 39 }),
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ ok: false, error: code });
    }
  });

  it("بلا تبعيّاتٍ ⇒ 503 معلَنٌ لا 404", async () => {
    const app = createOperatingCityRoutes({});
    expect((await app.request("/v1/me/operating-city")).status).toBe(503);
  });
});
