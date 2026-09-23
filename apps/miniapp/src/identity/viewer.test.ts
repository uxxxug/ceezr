/**
 * الغرض: إثباتُ أنّ الدورَ في التطبيقِ المصغَّرِ **مقروءٌ من الخادمِ وحدَه**
 *   (`F1-05`): لا طلبَ قبلَ الجلسة، ولا دورَ يُخزَّن، ولا قيمةَ مجهولةً تُقبَل،
 *   وكلُّ رمزِ خطأٍ يُترجَم إلى حالةٍ صريحةٍ لا إلى افتراض.
 * الحالة: اختبار فعلي — `fetch` مُبدَلٌ في العمليةِ نفسِها بلا شبكةٍ ولا خادم.
 * ينتمي إلى: apps/miniapp/src/identity
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: يومَ يُضاف إلى الردِّ حقلٌ ثالثٌ فهذا الملفُّ يجب أن يسقط
 *   حتى يُقرَأ الحقلُ صريحاً — لا أن يمرَّ صامتاً.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { clearSession, setSession } from "./session.ts";
import { fetchViewer } from "./viewer.ts";

const ORIGINAL_FETCH = globalThis.fetch;

interface Seen {
  url: string | null;
  auth: string | null;
  method: string | null;
  count: number;
}

const seen: Seen = { url: null, auth: null, method: null, count: 0 };

function respond(status: number, body: unknown): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.count += 1;
    seen.url = String(input);
    seen.method = init?.method ?? "GET";
    seen.auth = new Headers(init?.headers).get("Authorization");
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function withSession(): void {
  setSession({ accessToken: "access-token-value", expiresAt: Date.now() + 600_000 });
}

beforeEach(() => {
  clearSession();
  seen.url = null;
  seen.auth = null;
  seen.method = null;
  seen.count = 0;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  clearSession();
});

describe("قراءةُ الدورِ من الخادم: القبول", () => {
  it("١) تقرأ الدورَ والحالةَ كما أعادهما الخادمُ", async () => {
    withSession();
    respond(200, { ok: true, role: "driver", status: "active", languageCode: "ar" });

    expect(await fetchViewer()).toEqual({
      kind: "viewer",
      role: "driver",
      status: "active",
      languageCode: "ar",
    });
    expect(seen.url).toContain("/v1/me");
    expect(seen.method).toBe("GET");
    expect(seen.auth).toBe("Bearer access-token-value");
  });

  it("٢) «غير مسجَّل» حالةٌ تُقرأ لا خطأٌ يُخفى", async () => {
    withSession();
    respond(200, { ok: true, role: "unknown", status: "unregistered", languageCode: "ar" });

    expect(await fetchViewer()).toEqual({
      kind: "viewer",
      role: "unknown",
      status: "unregistered",
      languageCode: "ar",
    });
  });

  it("٣) `support` يُقرأ كما هو ولا يُطوى على راكب", async () => {
    withSession();
    respond(200, { ok: true, role: "support", status: "active", languageCode: "ar" });
    expect(await fetchViewer()).toEqual({
      kind: "viewer",
      role: "support",
      status: "active",
      languageCode: "ar",
    });
  });
});

describe("قراءةُ الدورِ من الخادم: لا وصولَ قبلَ الجلسة", () => {
  it("٤) بلا جلسةٍ: لا طلبَ شبكةٍ إطلاقاً (ADR 0035)", async () => {
    respond(200, { ok: true, role: "admin", status: "active" });

    expect(await fetchViewer()).toEqual({ kind: "session_invalid" });
    expect(seen.count).toBe(0);
  });

  it("٥) جلسةٌ منتهيةٌ محليّاً: لا طلبَ شبكةٍ ولا دورٌ محفوظٌ يُستعمَل", async () => {
    setSession({ accessToken: "stale", expiresAt: Date.now() - 1 });
    respond(200, { ok: true, role: "admin", status: "active" });

    expect(await fetchViewer()).toEqual({ kind: "session_invalid" });
    expect(seen.count).toBe(0);
  });
});

describe("قراءةُ الدورِ من الخادم: الرفضُ والترجمة", () => {
  it("٦) `ACCOUNT_BLOCKED` = حالةُ حجبٍ صريحةٌ لا سطحٌ يُفتَح", async () => {
    withSession();
    respond(403, { ok: false, error: "ACCOUNT_BLOCKED" });
    expect(await fetchViewer()).toEqual({ kind: "blocked" });
  });

  it("٧) `SESSION_EXPIRED` يُفرَّق عن الباطلِ ليُعرَف أنّ العلاجَ تجديد", async () => {
    withSession();
    respond(401, { ok: false, error: "SESSION_EXPIRED" });
    expect(await fetchViewer()).toEqual({ kind: "session_expired" });
  });

  it("٨) `SESSION_INVALID` و`SESSION_REQUIRED` حالتُهما إعادةُ تحقّق", async () => {
    withSession();
    respond(401, { ok: false, error: "SESSION_INVALID" });
    expect(await fetchViewer()).toEqual({ kind: "session_invalid" });

    withSession();
    respond(401, { ok: false, error: "SESSION_REQUIRED" });
    expect(await fetchViewer()).toEqual({ kind: "session_invalid" });
  });

  /**
   * أُضيف في `F1-07`: `unavailable` تحمل الآن سببَ الفشلِ الخامَ (`failure`) كي
   * تُصنَّف شاشةً — والحكمُ نفسُه لم يتغيّر: `unavailable` لا سطحٌ افتراضي.
   * التأكيدُ صار أدقَّ لا أضعف: الحقلُ الجديدُ يُقرأ صريحاً.
   */
  it("٩) تعطيلٌ معلَنٌ على الخادمِ = `unavailable` لا سطحٌ افتراضي", async () => {
    withSession();
    respond(503, { ok: false, error: "SESSION_NOT_AVAILABLE" });
    expect(await fetchViewer()).toEqual({
      kind: "unavailable",
      failure: {
        transport: "responded",
        status: 503,
        code: "SESSION_NOT_AVAILABLE",
        retryAfterSeconds: null,
      },
    });

    withSession();
    respond(503, { ok: false, error: "PROFILE_NOT_AVAILABLE" });
    expect(await fetchViewer()).toEqual({
      kind: "unavailable",
      failure: {
        transport: "responded",
        status: 503,
        code: "PROFILE_NOT_AVAILABLE",
        retryAfterSeconds: null,
      },
    });
  });

  it("١٠) رمزٌ لا يعرفه العميلُ = `unavailable` لا تخمينُ معنى", async () => {
    withSession();
    respond(500, { ok: false, error: "SOMETHING_ELSE" });
    expect(await fetchViewer()).toEqual({
      kind: "unavailable",
      failure: {
        transport: "responded",
        status: 500,
        code: "SOMETHING_ELSE",
        retryAfterSeconds: null,
      },
    });
  });

  it("١١) انقطاعُ الشبكةِ = `unavailable` لا دورٌ من الذاكرة", async () => {
    withSession();
    globalThis.fetch = (async () => {
      throw new Error("انقطاعٌ مُصنَّع");
    }) as unknown as typeof fetch;
    expect(await fetchViewer()).toEqual({
      kind: "unavailable",
      failure: { transport: "failed" },
    });
  });
});

describe("قراءةُ الدورِ من الخادم: لا ترقيةَ عندَ الشك", () => {
  it("١٢) دورٌ لا تعرفه القائمةُ يُرفَض ولا يُقبَل كما هو", async () => {
    withSession();
    respond(200, { ok: true, role: "superadmin", status: "active" });
    expect(await fetchViewer()).toEqual({ kind: "unavailable" });
  });

  it("١٣) ردٌّ بلا حقلِ حالةٍ يُرفَض ولا يُكمَّل بافتراض", async () => {
    withSession();
    respond(200, { ok: true, role: "admin" });
    expect(await fetchViewer()).toEqual({ kind: "unavailable" });
  });

  it("١٤) حالةٌ لا تعرفها القائمةُ تُرفَض", async () => {
    withSession();
    respond(200, { ok: true, role: "rider", status: "trialing" });
    expect(await fetchViewer()).toEqual({ kind: "unavailable" });
  });

  it("١٥) ردٌّ فارغٌ يُرفَض", async () => {
    withSession();
    respond(200, {});
    expect(await fetchViewer()).toEqual({ kind: "unavailable" });
  });
});

describe("قراءةُ لغةِ الواجهةِ من الخادم (PD-030)", () => {
  it("١٦) لغةٌ غيرُ الافتراضية تُمرَّر كما هي", async () => {
    withSession();
    respond(200, { ok: true, role: "rider", status: "active", languageCode: "ur" });
    expect(await fetchViewer()).toEqual({
      kind: "viewer",
      role: "rider",
      status: "active",
      languageCode: "ur",
    });
  });

  it("١٧) لغةٌ غيرُ معروفةٍ = `unavailable` لا افتراض", async () => {
    withSession();
    respond(200, { ok: true, role: "rider", status: "active", languageCode: "fr" });
    expect(await fetchViewer()).toEqual({ kind: "unavailable" });
  });

  it("١٨) لغةٌ غائبةٌ = `unavailable` لا `ar` صامت", async () => {
    withSession();
    respond(200, { ok: true, role: "rider", status: "active" });
    expect(await fetchViewer()).toEqual({ kind: "unavailable" });
  });
});
