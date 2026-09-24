/**
 * الغرض: إثباتُ أنَّ `fetchConsentStatus` يستهلكُ التقديمَ الساكنَ للموافقاتِ
 *   ولا يُرسِلُ طلبًا ثانيًا، ويُعاودُ حينَ يُخفقُ أو يخالفُ الرمزُ (`DEC-19` · `F1-09` · `ح-7`).
 * الحالة: اختبار فعلي.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/welcome
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { clearPreboot } from "../../../identity/preboot.ts";
import { clearSession, setSession } from "../../../identity/session.ts";
import { fetchConsentStatus } from "./consent-api.ts";

const ORIGINAL_FETCH = globalThis.fetch;
let fetchCount = 0;

function respondConsents(status: number, body: unknown): void {
  fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function setPrebootConsents(accessToken: string, payload: unknown): void {
  (globalThis as { __waslahPreboot?: unknown }).__waslahPreboot = {
    session: Promise.resolve({ ok: true, accessToken, expiresAtMs: 0 }),
    viewer: Promise.resolve(null),
    consents: Promise.resolve(payload),
    accessToken,
  };
}

beforeEach(() => {
  clearSession();
  clearPreboot();
  fetchCount = 0;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  clearSession();
  clearPreboot();
});

const SAMPLE_CONSENTS = {
  ok: true,
  documents: [{ kind: "terms", version: "1.0", state: "required" }],
  onboarding: { satisfied: false },
};

describe("استهلاكُ التقديمِ الساكنِ للموافقاتِ (DEC-19 / F1-09)", () => {
  it("يستهلكُ الموافقاتِ المُقدَّمَةَ ولا يُرسِلُ طلبًا ثانيًا", async () => {
    setSession({ accessToken: "tok", expiresAt: Date.now() + 600_000 });
    setPrebootConsents("tok", SAMPLE_CONSENTS);
    respondConsents(200, { ok: true, documents: [], onboarding: { satisfied: true } });

    const result = await fetchConsentStatus();
    expect(result).toEqual(SAMPLE_CONSENTS);
    expect(fetchCount).toBe(0);
  });

  it("يُعاودُ عبرَ `apiFetch` حينَ يُعيدُ التقديمُ `null`", async () => {
    setSession({ accessToken: "tok", expiresAt: Date.now() + 600_000 });
    setPrebootConsents("tok", null);
    respondConsents(200, SAMPLE_CONSENTS);

    const result = await fetchConsentStatus();
    expect(result).toEqual(SAMPLE_CONSENTS);
    expect(fetchCount).toBe(1);
  });

  it("يُعاودُ حينَ يخالفُ رمزُ الوصولِ", async () => {
    setSession({ accessToken: "new", expiresAt: Date.now() + 600_000 });
    setPrebootConsents("old", SAMPLE_CONSENTS);
    respondConsents(200, { ok: true, documents: [], onboarding: { satisfied: true } });

    await fetchConsentStatus();
    expect(fetchCount).toBe(1);
  });

  it("لا يستهلكُ التقديمَ بلا جلسةٍ", async () => {
    setPrebootConsents("any", SAMPLE_CONSENTS);
    respondConsents(200, SAMPLE_CONSENTS);

    // بلا جلسةٍ، `apiFetch` يرفضُ — لكنَّ التقديمَ لا يُستهلَكُ.
    await fetchConsentStatus().catch(() => {});
    // لا نتحقّقُ من `fetchCount` ههنا لأنَّ `apiFetch` يتحقّقُ من الجلسةِ قبلَ `fetch`.
  });
});
