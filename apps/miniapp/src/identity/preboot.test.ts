/**
 * الغرض: إثباتُ أنَّ مستهلكاتِ التقديمِ الساكنِ تقرأُ من `window.__waslahPreboot`
 *   وتُعيدُ `null` حينَ تغيبُ أو تخالفُ رمزَ الوصولِ (`F1-09` · `DEC-19` · `ح-7`).
 * الحالة: اختبار فعلي.
 * ينتمي إلى: apps/miniapp/src/identity
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  clearPreboot,
  consumePrebootConsents,
  consumePrebootSession,
  consumePrebootViewer,
} from "./preboot.ts";

beforeEach(() => {
  clearPreboot();
});

afterEach(() => {
  clearPreboot();
});

function setPreboot(over: Partial<{ accessToken: string }> = {}): {
  session: Promise<unknown>;
  viewer: Promise<unknown>;
  consents: Promise<unknown>;
  accessToken: string;
} {
  const state = {
    session: Promise.resolve({ ok: true, accessToken: "tok", expiresAtMs: 0 }),
    viewer: Promise.resolve({ ok: true, role: "rider", status: "active", languageCode: "ar" }),
    consents: Promise.resolve({ ok: true, documents: [], onboarding: { satisfied: false } }),
    accessToken: "tok",
    ...over,
  };
  (globalThis as { __waslahPreboot?: unknown }).__waslahPreboot = state;
  return state;
}

describe("consumePrebootSession", () => {
  it("يُعيد وعدَ التبادلِ إن وُجد", () => {
    const state = setPreboot();
    expect(consumePrebootSession()).toBe(state.session);
  });

  it("يُعيد `null` إن لم يُوضَع تقديمٌ", () => {
    expect(consumePrebootSession()).toBeNull();
  });
});

describe("consumePrebootViewer", () => {
  it("يُعيد وعدَ الدورِ إن طابقَ الرمزُ", () => {
    const state = setPreboot({ accessToken: "abc" });
    expect(consumePrebootViewer("abc")).toBe(state.viewer);
  });

  it("يُعيد `null` إن خالفَ الرمزُ — نتائجُ جلسةٍ سابقةٍ لا تُستهلَك", () => {
    setPreboot({ accessToken: "old" });
    expect(consumePrebootViewer("new")).toBeNull();
  });

  it("يُعيد `null` إن لم يُوضَع تقديمٌ", () => {
    expect(consumePrebootViewer("abc")).toBeNull();
  });
});

describe("consumePrebootConsents", () => {
  it("يُعيد وعدَ الموافقاتِ إن طابقَ الرمزُ", () => {
    const state = setPreboot({ accessToken: "abc" });
    expect(consumePrebootConsents("abc")).toBe(state.consents);
  });

  it("يُعيد `null` إن خالفَ الرمزُ", () => {
    setPreboot({ accessToken: "old" });
    expect(consumePrebootConsents("new")).toBeNull();
  });

  it("يُعيد `null` إن لم يُوضَع تقديمٌ", () => {
    expect(consumePrebootConsents("abc")).toBeNull();
  });
});

describe("clearPreboot", () => {
  it("يمسحُ ما وُضع", () => {
    setPreboot();
    clearPreboot();
    expect(consumePrebootSession()).toBeNull();
  });
});
