/**
 * الغرض: اختبارُ استردادِ الجلسةِ بعدَ انتهائِها أثناءَ الاستخدامِ (`WR-29` ·
 *   ADR 0303) — محاولةٌ واحدةٌ صامتةٌ في حدِّ API عندَ رفضِ `401` برمزِ جلسةٍ،
 *   وقبلَ الرفضِ المحليِّ عندَ غيابِها، ثمّ إعادةُ النداءِ مرّةً واحدةً لا سلسلةً.
 * الحالة: منفّذ فعلياً — البند `WR-29`.
 * ينتمي إلى: apps/miniapp/src/api
 *
 * حدٌّ معلَن: `fetch` يُستبدَلُ هنا في مكانِه (كما في `client.test.ts`) — لا خادمَ
 * ولا شبكةَ، والاستردادُ دالّةٌ مزيّفةٌ تُحصي نداءاتِها لا تُقيمُ جلسةً حقيقيةً.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clearSession, setSession } from "../identity/session.ts";
import { type ApiError, apiFetch, registerSessionRecovery } from "./client.ts";

const validSession = () => setSession({ accessToken: "tok", expiresAt: Date.now() + 60_000 });

/** ردٌّ بحالةٍ وحِملٍ كما تصنعُه البوابةُ. */
const respond = (status: number, body: unknown): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;

/** ردٌّ ناجحٌ يُثبِتُ ما رآه النداءُ من ترويسةِ التفويضِ. */
function authSeeingFetch(seen: { auth: string | null }): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.auth = headers.get("Authorization");
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  clearSession();
  registerSessionRecovery(null);
  // `client.test.ts`: الجلسةُ حالةٌ على مستوى الوحدةِ يتقاسمُها كلُّ ملفٍّ في
  // عمليّةِ الاختبارِ نفسِها — فتُمسَح هنا لا بعدَ الأخيرِ وحده.
});

describe("WR-29 — استردادٌ واحدٌ عندَ رفضِ الجلسةِ من الخادمِ", () => {
  test("رفضُ `SESSION_EXPIRED` يستردُّ ثمّ يُعيدُ النداءَ مرّةً واحدةً بالرمزِ الجديدِ", async () => {
    let recoveries = 0;
    registerSessionRecovery(async () => {
      recoveries += 1;
      validSession();
      return true;
    });
    const seen: { auth: string | null } = { auth: null };
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      calls += 1;
      // الرفضُ الأولُ ثمّ القبولُ: الخادمُ استردَّ الجلسةَ فالنداءُ الثاني يمرُّ.
      const impl =
        calls === 1 ? respond(401, { ok: false, error: "SESSION_EXPIRED" }) : authSeeingFetch(seen);
      return impl(...args);
    }) as unknown as typeof fetch;

    try {
      validSession();
      const result = await apiFetch<{ ok: boolean }>("/v1/me");
      expect(result.ok).toBe(true);
      expect(calls).toBe(2);
      expect(recoveries).toBe(1);
      expect(seen.auth).toBe("Bearer tok");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("فشلُ الاستردادِ يُرمي الرفضَ الأصليَّ نفسَهُ بلا تمويهٍ", async () => {
    registerSessionRecovery(async () => false);
    const original = globalThis.fetch;
    globalThis.fetch = respond(401, { ok: false, error: "SESSION_INVALID" });

    try {
      validSession();
      await expect(apiFetch("/v1/me")).rejects.toMatchObject({
        name: "ApiError",
        status: 401,
        code: "SESSION_INVALID",
      } satisfies Partial<ApiError>);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("استثناءُ الاستردادِ نفسِهِ يُعامَلُ فشلاً لا يُخفي الرفضَ", async () => {
    registerSessionRecovery(async () => {
      throw new Error("recovery exploded");
    });
    const original = globalThis.fetch;
    globalThis.fetch = respond(401, { ok: false, error: "SESSION_EXPIRED" });

    try {
      validSession();
      await expect(apiFetch("/v1/me")).rejects.toMatchObject({
        status: 401,
        code: "SESSION_EXPIRED",
      });
    } finally {
      globalThis.fetch = original;
    }
  });

  test("إعادةُ المحاولةِ المُستردَّةِ لا تستردُّ مرّةً ثانيةً مهما رُدَّت", async () => {
    let recoveries = 0;
    registerSessionRecovery(async () => {
      recoveries += 1;
      return true;
    });
    const original = globalThis.fetch;
    globalThis.fetch = respond(401, { ok: false, error: "SESSION_EXPIRED" });

    try {
      validSession();
      await expect(apiFetch("/v1/me")).rejects.toMatchObject({
        status: 401,
        code: "SESSION_EXPIRED",
      });
      expect(recoveries).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("رفضٌ بلا رمزِ جلسةٍ لا يستردُّ: سائرُ أخطاءِ 401 تُرمى كما هي", async () => {
    let recoveries = 0;
    registerSessionRecovery(async () => {
      recoveries += 1;
      return true;
    });
    const original = globalThis.fetch;
    globalThis.fetch = respond(401, { ok: false, error: "ACCOUNT_BLOCKED" });

    try {
      validSession();
      await expect(apiFetch("/v1/me")).rejects.toMatchObject({
        status: 401,
        code: "ACCOUNT_BLOCKED",
      });
      expect(recoveries).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("المسارُ العامُّ لا يستردُّ ولا يُرفَضُ محليّاً", async () => {
    let recoveries = 0;
    registerSessionRecovery(async () => {
      recoveries += 1;
      return true;
    });
    const original = globalThis.fetch;
    globalThis.fetch = respond(401, { ok: false, error: "SESSION_EXPIRED" });

    try {
      await expect(
        apiFetch("/v1/session/telegram", { public: true, method: "POST", body: {} }),
      ).rejects.toMatchObject({ status: 401 });
      expect(recoveries).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("بلا مسجِّلٍ: الرفضُ كما كانَ (`F1-04` قبلَ ADR 0303)", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = respond(401, { ok: false, error: "SESSION_EXPIRED" });

    try {
      validSession();
      await expect(apiFetch("/v1/me")).rejects.toMatchObject({
        status: 401,
        code: "SESSION_EXPIRED",
      });
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("WR-29 — الاستردادُ قبلَ الرفضِ المحليِّ عندَ غيابِ الجلسةِ", () => {
  test("جلسةٌ منتهيةٌ في الذاكرةِ تُستردُّ صامتاً فيمضي النداءُ", async () => {
    let recoveries = 0;
    registerSessionRecovery(async () => {
      recoveries += 1;
      validSession();
      return true;
    });
    const original = globalThis.fetch;
    globalThis.fetch = respond(200, { ok: true });

    try {
      const result = await apiFetch<{ ok: boolean }>("/v1/me");
      expect(result.ok).toBe(true);
      expect(recoveries).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("فشلُ الاستردادِ يُبقي الرفضَ المحليَّ `SESSION_REQUIRED` كما هو", async () => {
    registerSessionRecovery(async () => false);
    const original = globalThis.fetch;
    globalThis.fetch = respond(200, { ok: true });

    try {
      await expect(apiFetch("/v1/me")).rejects.toMatchObject({
        status: 401,
        code: "SESSION_REQUIRED",
      });
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("WR-29 — حدودُ الاستردادِ: تهدئةٌ وتجميعٌ لا دورانَ", () => {
  test("الفشلُ يُفعِلُ تهدئةً: النداءُ التالي لا يفتحُ استرداداً جديداً", async () => {
    let recoveries = 0;
    registerSessionRecovery(async () => {
      recoveries += 1;
      return false;
    });
    const original = globalThis.fetch;
    globalThis.fetch = respond(401, { ok: false, error: "SESSION_EXPIRED" });

    try {
      validSession();
      await expect(apiFetch("/v1/me")).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
      await expect(apiFetch("/v1/me")).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
      expect(recoveries).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("بعدَ انقضاءِ التهدئةِ يستردُّ النداءُ، والنجاحُ يرفعُها فوراً", async () => {
    let recoveries = 0;
    let succeed = false;
    // الخادمُ المزيّفُ لا يقبلُ إلّا رمزَ الجلسةِ **بعدَ** استردادٍ ناجحٍ — فالرفضُ
    // يعني «الجلسةُ ذاتُها» لا «هذا النداءُ».
    let acceptedToken: string | null = null;
    registerSessionRecovery(async () => {
      recoveries += 1;
      if (!succeed) return false;
      setSession({ accessToken: "tok2", expiresAt: Date.now() + 60_000 });
      acceptedToken = "tok2";
      return true;
    });
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (acceptedToken !== null && headers.get("Authorization") === `Bearer ${acceptedToken}`) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: false, error: "SESSION_EXPIRED" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    // ساعةٌ مزيّفةٌ محليّةٌ: التهدئةُ ١٥ ثانيةً فلا يُنتظرْ اختبارٌ واقعياً —
    // وتُردُّ الساعةُ في `finally` فلا يتسرّبُ الزمنُ إلى سائرِ الملفّ.
    const realNow = Date.now;
    let clockMs = realNow();
    Date.now = () => clockMs;
    const advance = (ms: number) => {
      clockMs += ms;
    };

    try {
      validSession();
      // فشلٌ أولُ يُفعِلُ التهدئةَ.
      await expect(apiFetch("/v1/me")).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
      expect(recoveries).toBe(1);
      // قبلَ انقضاءِها: لا استردادَ جديداً (مغطّى في الاختبارِ السابقِ) ثمّ
      // بعدَ انقضاءِها: استردادٌ ناجحٌ **يرفعُها فوراً**.
      advance(16_000);
      succeed = true;
      const result = await apiFetch<{ ok: boolean }>("/v1/me");
      expect(result.ok).toBe(true);
      expect(recoveries).toBe(2);
      // والرفعُ الفوريُّ يُثبَتُ: فشلٌ جديدٌ بعدَ نجاحٍ بخمسِ ثوانٍ فقطَ — لولا
      // رفعُ النجاحِ لبقيت التهدئةُ الأولى حاجبةً لهذا الاستردادِ.
      succeed = false;
      acceptedToken = null;
      clearSession();
      validSession();
      advance(5_000);
      await expect(apiFetch("/v1/me")).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
      expect(recoveries).toBe(3);
      // ثمّ تهدئةُ الفشلِ الجديدِ تعملُ: ثوانٍ لا تكفي فلا استردادَ رابعاً.
      advance(5_000);
      await expect(apiFetch("/v1/me")).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
      expect(recoveries).toBe(3);
    } finally {
      Date.now = realNow;
      globalThis.fetch = original;
    }
  });

  test("نداءانِ متزامنانِ على جلسةٍ واحدةٍ يستردانِ باستردادٍ واحدٍ", async () => {
    let recoveries = 0;
    // يُحفَظُ في كائنٍ لا `let` وحيداً: التحليلُ الانسيابيُّ يضيّقُ المتغيّرَ
    // إلى `null` عندَ موضعِ النداءِ لأنّ الإسنادَ داخلَ معاودةٍ (عِبرةُ `client.test.ts`).
    const gate: { release: (() => void) | null } = { release: null };
    registerSessionRecovery(
      () =>
        new Promise<boolean>((resolve) => {
          recoveries += 1;
          gate.release = () => {
            validSession();
            resolve(true);
          };
        }),
    );
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      calls += 1;
      const impl =
        calls <= 2
          ? respond(401, { ok: false, error: "SESSION_EXPIRED" })
          : respond(200, { ok: true });
      return impl(...args);
    }) as unknown as typeof fetch;

    try {
      validSession();
      const first = apiFetch<{ ok: boolean }>("/v1/me");
      const second = apiFetch<{ ok: boolean }>("/v1/rides");
      // كلاهما رُفضا ووقفَا عندَ الاستردادِ الواحدِ — ثمّ أُطلِقَ.
      await new Promise((resolve) => setTimeout(resolve, 0));
      gate.release?.();
      expect((await first).ok).toBe(true);
      expect((await second).ok).toBe(true);
      expect(recoveries).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});
