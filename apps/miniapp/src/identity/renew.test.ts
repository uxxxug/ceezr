/**
 * الغرض: اختبارُ تجديدِ الجلسةِ من جانبِ العميل (`F1-04`): يقرأ الرمزَ من التخزينِ
 *   الآمن، ويضع رمزَ الوصولِ في الذاكرةِ وحدَها، ويحفظ رمزَ التجديدِ الجديدَ في
 *   التخزينِ الآمنِ وحدَه، ويمسح ما على الجهازِ إذا رُفض الرمز، ولا يحفظ شيئاً
 *   عندَ غيابِ المخزنِ الآمن.
 * الحالة: اختبار فعلي — `fetch` مُزدوَجٌ ومنفذُ تخزينٍ مُصطنَع، بلا شبكةٍ ولا مضيف.
 * ينتمي إلى: apps/miniapp/src/identity
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: إعادةُ المحاولةِ التلقائيةُ داخلَ `apiFetch` ليست في `F1-04`
 *   ولا يُدَّعى تنفيذُها؛ التجديدُ ههنا نداءٌ صريحٌ من النداء.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { renewSessionFromStorage } from "./renew.ts";
import { getSession, setSession } from "./session.ts";
import { persistRefreshToken, REFRESH_TOKEN_STORAGE_KEY } from "./session-storage.ts";
import { fakeSecureStore, unavailableSecureStore } from "./test-secure-store.ts";

const OLD_TOKEN = "wslr1.old-payload.old-signature";
const NEW_TOKEN = "wslr1.new-payload.new-signature";

interface Recorded {
  readonly bodies: string[];
  restore(): void;
}

/** يُزدوِج `fetch` بردٍّ واحدٍ محدَّد، ويسجّل ما أُرسِل. */
function stubFetch(status: number, payload: unknown): Recorded {
  const original = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return {
    bodies,
    restore() {
      globalThis.fetch = original;
    },
  };
}

const SUCCESS = {
  ok: true,
  accessToken: "wsl1.access.signature",
  tokenType: "Bearer",
  expiresAtMs: Date.now() + 600_000,
  expiresInSeconds: 600,
  refreshToken: NEW_TOKEN,
  refreshExpiresAtMs: Date.now() + 3_600_000,
  refreshExpiresInSeconds: 3600,
  absoluteExpiresAtMs: Date.now() + 43_200_000,
};

afterEach(() => {
  setSession(null);
});

describe("تجديد الجلسة من العميل (F1-04)", () => {
  test("١) التجديدُ ينجح: الوصولُ في الذاكرة والتجديدُ في التخزينِ الآمن", async () => {
    const secure = fakeSecureStore();
    await persistRefreshToken(OLD_TOKEN, secure.store);
    const http = stubFetch(201, SUCCESS);

    try {
      const result = await renewSessionFromStorage(secure.store);
      expect(result.renewed).toBe(true);
      if (!result.renewed) return;
      expect(result.persisted).toBe(true);

      // أُرسِل الرمزُ المحفوظُ في الجسمِ لا في المسارِ ولا في `query`.
      expect(http.bodies[0]).toContain(OLD_TOKEN);

      // الجديدُ حلَّ محلَّ القديمِ في المفتاحِ نفسِه: لا تراكمَ رموزٍ على الجهاز.
      expect(secure.items.get(REFRESH_TOKEN_STORAGE_KEY)).toBe(NEW_TOKEN);
      expect([...secure.items.keys()]).toEqual([REFRESH_TOKEN_STORAGE_KEY]);

      // ورمزُ الوصولِ في الذاكرةِ وحدَها، ورمزُ التجديدِ ليس فيها.
      const session = getSession();
      expect(session?.accessToken).toBe("wsl1.access.signature");
      expect(JSON.stringify(session)).not.toContain(NEW_TOKEN);
      expect(JSON.stringify(session)).not.toContain(OLD_TOKEN);
    } finally {
      http.restore();
    }
  });

  test("لا رمزَ محفوظٌ = لا نداءَ شبكةٍ أصلاً", async () => {
    const secure = fakeSecureStore();
    const http = stubFetch(201, SUCCESS);
    try {
      const result = await renewSessionFromStorage(secure.store);
      expect(result.renewed).toBe(false);
      if (result.renewed) return;
      expect(result.reason).toBe("NO_STORED_TOKEN");
      expect(http.bodies.length).toBe(0);
    } finally {
      http.restore();
    }
  });

  test("١٢) رمزٌ مرفوضٌ = تُمسَح الجلسةُ من الجهازِ ومن الذاكرة", async () => {
    const secure = fakeSecureStore();
    await persistRefreshToken(OLD_TOKEN, secure.store);
    setSession({ accessToken: "stale", expiresAt: Date.now() - 1 });
    const http = stubFetch(401, { ok: false, error: "SESSION_EXPIRED" });

    try {
      const result = await renewSessionFromStorage(secure.store);
      expect(result.renewed).toBe(false);
      if (result.renewed) return;
      expect(result.reason).toBe("REJECTED");
      // لا يُعاد استعمالُ ما لا يعمل، ولا تبقى جلسةٌ ميتةٌ في الذاكرة.
      expect(secure.items.has(REFRESH_TOKEN_STORAGE_KEY)).toBe(false);
      expect(getSession()).toBeNull();
    } finally {
      http.restore();
    }
  });

  test("انقطاعُ الخدمةِ (٥٠٣) لا يمسح الرمزَ المحفوظ", async () => {
    // فرقٌ مقصود: «لا يعمل الآن» ليس «لا يصلح أبداً». ومسحُ الرمزِ عندَ عطلٍ
    // عابرٍ يُخرِج المستخدمَ من التطبيقِ بلا سبب.
    const secure = fakeSecureStore();
    await persistRefreshToken(OLD_TOKEN, secure.store);
    const http = stubFetch(503, { ok: false, error: "SESSION_NOT_CONFIGURED" });

    try {
      const result = await renewSessionFromStorage(secure.store);
      expect(result.renewed).toBe(false);
      if (result.renewed) return;
      expect(result.reason).toBe("UNAVAILABLE");
      expect(secure.items.get(REFRESH_TOKEN_STORAGE_KEY)).toBe(OLD_TOKEN);
    } finally {
      http.restore();
    }
  });

  test("٩) بلا مخزنٍ آمنٍ: لا رمزَ يُقرأ ولا رمزَ يُحفَظ ولا تراجع", async () => {
    const secure = unavailableSecureStore();
    const http = stubFetch(201, SUCCESS);
    try {
      const result = await renewSessionFromStorage(secure.store);
      expect(result.renewed).toBe(false);
      if (result.renewed) return;
      expect(result.reason).toBe("NO_STORED_TOKEN");
      expect(secure.items.size).toBe(0);
    } finally {
      http.restore();
    }
  });
});

describe("حدود التجديد من العميل (F1-04)", () => {
  test("مسارٌ غيرُ مركَّبٍ (٤٠٤) لا يمسح الرمزَ المحفوظ", async () => {
    // حكمٌ على الخادمِ لا على الرمز: خادمٌ بلا مسارِ تجديدٍ لا يقول إنّ الرمزَ
    // فاسدٌ. ومسحُه ههنا كان سيُخرِج المستخدمَ بسببِ خطأِ نشرٍ لا خطأِ رمز.
    const secure = fakeSecureStore();
    await persistRefreshToken(OLD_TOKEN, secure.store);
    const http = stubFetch(404, { ok: false, error: "NOT_FOUND" });
    try {
      const result = await renewSessionFromStorage(secure.store);
      expect(result.renewed).toBe(false);
      if (result.renewed) return;
      expect(result.reason).toBe("UNAVAILABLE");
      expect(secure.items.get(REFRESH_TOKEN_STORAGE_KEY)).toBe(OLD_TOKEN);
    } finally {
      http.restore();
    }
  });

  test("٤٠٠ (رمزٌ مشوَّه) يمسح الرمزَ المحفوظ", async () => {
    // رمزُ حالةٍ لا قيمةٌ تجارية — ويُكتَب هكذا كي يقرأه فاحصُ الثوابتِ حالةً.
    const malformed = { status: 400 } as const;
    const secure = fakeSecureStore();
    await persistRefreshToken(OLD_TOKEN, secure.store);
    const http = stubFetch(malformed.status, { ok: false, error: "REFRESH_TOKEN_MALFORMED" });
    try {
      const result = await renewSessionFromStorage(secure.store);
      expect(result.renewed).toBe(false);
      if (result.renewed) return;
      expect(result.reason).toBe("REJECTED");
      expect(secure.items.has(REFRESH_TOKEN_STORAGE_KEY)).toBe(false);
    } finally {
      http.restore();
    }
  });

  test("٩) اختفاءُ المخزنِ بينَ الحفظِ والتجديدِ = لا نداءَ ولا تراجع", async () => {
    // حالةُ عميلٍ فقَدَ المخزنَ الآمنَ بعدَ أن كان يحفظ فيه: الجلسةُ تبقى في
    // الذاكرةِ وتُغلَق بإغلاقِ التطبيق. نقصٌ في الراحةِ لا في الأمان.
    const secure = unavailableSecureStore();
    const http = stubFetch(201, SUCCESS);
    try {
      // بلا مخزنٍ لا يُقرأ رمزٌ أصلاً، فالنتيجةُ «لا رمزَ محفوظ» لا خطأٌ صامت.
      const result = await renewSessionFromStorage(secure.store);
      expect(result.renewed).toBe(false);
      if (result.renewed) return;
      expect(result.reason).toBe("NO_STORED_TOKEN");
      expect(http.bodies.length).toBe(0);
    } finally {
      http.restore();
    }
  });
});
