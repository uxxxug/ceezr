/**
 * الغرض: إثباتُ أنّ **مسارَ الإقلاعِ موصولٌ فعلاً** (`F1-07`): ترتيبُ المحاولاتِ
 *   من الأرخصِ إلى الأغلى، وأنّ المبادلةَ لا تحدث إلّا حين تلزم، وأنّ كلَّ فشلٍ
 *   يُصنَّف سبباً صريحاً لا «تعذّر».
 * الحالة: اختبار فعلي — كلُّ التبعياتِ محقونةٌ بلا شبكةٍ ولا تيليجرام.
 * ينتمي إلى: apps/miniapp/src/identity
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: **لا يُثبِت هذا الملفُّ أنّ المبادلةَ تنجح مع خادمٍ حقيقيٍّ
 *   ولا مع عميلِ تيليجرامَ حقيقيّ**: مدخلاتُه مصنوعةٌ، والتحقّقُ على جهازٍ غيرُ
 *   منفَّذٍ في هذه البيئة.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { ApiError, ApiNetworkError } from "../api/client.ts";
import { type BootDeps, establishSession } from "./boot.ts";
import { clearPreboot } from "./preboot.ts";
import { clearSession, setSession } from "./session.ts";

afterEach(() => {
  clearSession();
  clearPreboot();
});

const HOUR_MS = 3_600_000;

/** تجديدٌ لا يجد رمزاً محفوظاً — الحالةُ الشائعةُ في أوّلِ فتح. */
const noStoredToken = async () => ({ renewed: false, reason: "NO_STORED_TOKEN" }) as const;

const baseDeps = (over: BootDeps = {}): BootDeps => ({
  insideTelegram: () => true,
  rawInitData: () => "user=%7B%7D&hash=deadbeef",
  renew: noStoredToken,
  exchange: async () => ({
    ok: true as const,
    accessToken: "a",
    expiresAtMs: Date.now() + HOUR_MS,
  }),
  persist: async () => ({ stored: true }) as never,
  ...over,
});

describe("ترتيبُ المحاولات: الأرخصُ فالأغلى", () => {
  it("جلسةٌ صالحةٌ في الذاكرةِ = لا نداءَ إطلاقاً", async () => {
    let calls = 0;
    setSession({ accessToken: "live", expiresAt: Date.now() + HOUR_MS });
    const result = await establishSession(
      baseDeps({
        renew: async () => {
          calls += 1;
          return { renewed: false, reason: "NO_STORED_TOKEN" } as const;
        },
      }),
    );
    expect(result).toEqual({ established: true, via: "existing" });
    expect(calls).toBe(0);
  });

  it("رمزٌ محفوظٌ يُجدَّد — **ولا تُنادى المبادلةُ**", async () => {
    let exchanged = 0;
    const result = await establishSession(
      baseDeps({
        renew: async () =>
          ({
            renewed: true,
            expiresAtMs: Date.now() + HOUR_MS,
            absoluteExpiresAtMs: Date.now() + HOUR_MS,
            persisted: true,
          }) as const,
        exchange: async () => {
          exchanged += 1;
          throw new Error("لا ينبغي أن تُنادى");
        },
      }),
    );
    expect(result).toEqual({ established: true, via: "renewed" });
    expect(exchanged).toBe(0);
  });

  it("لا رمزَ محفوظاً: تُبادَل `initData` وتُقام الجلسةُ ويُحفَظ رمزُ التجديد", async () => {
    const persisted: string[] = [];
    const result = await establishSession(
      baseDeps({
        exchange: async () => ({
          ok: true as const,
          accessToken: "fresh",
          expiresAtMs: Date.now() + HOUR_MS,
          refreshToken: "r-1",
        }),
        persist: (async (token: string) => {
          persisted.push(token);
          return { stored: true };
        }) as never,
      }),
    );
    expect(result).toEqual({ established: true, via: "exchanged" });
    expect(persisted).toEqual(["r-1"]);
  });

  it("ردٌّ بلا رمزِ تجديدٍ ردٌّ صحيحٌ: جلسةٌ في الذاكرةِ ولا حفظَ ولا فشل", async () => {
    let persistCalls = 0;
    const result = await establishSession(
      baseDeps({
        persist: (async () => {
          persistCalls += 1;
          return { stored: true };
        }) as never,
      }),
    );
    expect(result.established).toBe(true);
    expect(persistCalls).toBe(0);
  });

  it("تعطُّلٌ في التجديدِ لا يُتبَع بمبادلةٍ: الرمزُ المحفوظُ قد يكون صالحاً", async () => {
    let exchanged = 0;
    const result = await establishSession(
      baseDeps({
        renew: async () => ({ renewed: false, reason: "UNAVAILABLE" }) as const,
        exchange: async () => {
          exchanged += 1;
          throw new Error("لا ينبغي أن تُنادى");
        },
      }),
    );
    expect(result).toEqual({ established: false, reason: "UNAVAILABLE" });
    expect(exchanged).toBe(0);
  });
});

describe("كلُّ فشلٍ سببٌ صريحٌ لا «تعذّر»", () => {
  it("خارجَ تيليجرام: لا مصادقةَ بديلةَ اليوم", async () => {
    const result = await establishSession(baseDeps({ insideTelegram: () => false }));
    expect(result).toEqual({ established: false, reason: "OUTSIDE_TELEGRAM" });
  });

  it("داخلَ تيليجرامَ بلا بيانِ فتحٍ: لا شيءَ يُبادَل به", async () => {
    for (const value of [null, ""]) {
      const result = await establishSession(baseDeps({ rawInitData: () => value }));
      expect(result).toEqual({ established: false, reason: "MISSING_INIT_DATA" });
    }
  });

  it("401 = رفضٌ، وعلاجُه تحقّقٌ جديد", async () => {
    const result = await establishSession(
      baseDeps({
        exchange: async () => {
          throw new ApiError(401, "INIT_DATA_SIGNATURE", "…");
        },
      }),
    );
    expect(result.established).toBe(false);
    if (!result.established) expect(result.reason).toBe("REJECTED");
  });

  it("503 = تعطّلٌ، ويُمرَّر الاستثناءُ ليُصنَّف شاشةً", async () => {
    const thrown = new ApiError(503, "SESSION_NOT_CONFIGURED", "…", 60);
    const result = await establishSession(
      baseDeps({
        exchange: async () => {
          throw thrown;
        },
      }),
    );
    expect(result.established).toBe(false);
    if (!result.established) {
      expect(result.reason).toBe("UNAVAILABLE");
      expect(result.thrown).toBe(thrown);
    }
  });

  it("لم يصل ردٌّ = تعطّلٌ يُصنَّف لاحقاً بفحصِ الحياة", async () => {
    const result = await establishSession(
      baseDeps({
        exchange: async () => {
          throw new ApiNetworkError();
        },
      }),
    );
    expect(result.established).toBe(false);
    if (!result.established) expect(result.reason).toBe("UNAVAILABLE");
  });
});

describe("استهلاكُ التقديمِ الساكنِ (DEC-19 / F1-09)", () => {
  it("يستهلكُ التبادلَ المُقدَّمَ ولا يُرسِلُ طلبًا ثانيًا", async () => {
    let exchanged = 0;
    const preboot = Promise.resolve({
      ok: true as const,
      accessToken: "pre",
      expiresAtMs: Date.now() + HOUR_MS,
    });
    const result = await establishSession(
      baseDeps({
        consumePreboot: () => preboot,
        exchange: async () => {
          exchanged += 1;
          throw new Error("لا ينبغي أن تُنادى");
        },
      }),
    );
    expect(result).toEqual({ established: true, via: "exchanged" });
    expect(exchanged).toBe(0);
  });

  it("لا يستخدمُ التقديمَ حينَ ينجحُ التجديدُ — التجديدُ أرخصُ وأصدقُ", async () => {
    let prebootCalls = 0;
    const result = await establishSession(
      baseDeps({
        renew: async () =>
          ({
            renewed: true,
            expiresAtMs: Date.now() + HOUR_MS,
            absoluteExpiresAtMs: Date.now() + HOUR_MS,
            persisted: true,
          }) as const,
        consumePreboot: () => {
          prebootCalls += 1;
          return Promise.resolve({ ok: true, accessToken: "x", expiresAtMs: 0 });
        },
        exchange: async () => {
          throw new Error("لا ينبغي أن تُنادى");
        },
      }),
    );
    expect(result).toEqual({ established: true, via: "renewed" });
    expect(prebootCalls).toBe(0);
  });

  it("لا يستخدمُ التقديمَ حينَ تُرفَض الشبكةُ في التجديدِ", async () => {
    let prebootCalls = 0;
    const result = await establishSession(
      baseDeps({
        renew: async () => ({ renewed: false, reason: "UNAVAILABLE" }) as const,
        consumePreboot: () => {
          prebootCalls += 1;
          return Promise.resolve({ ok: true, accessToken: "x", expiresAtMs: 0 });
        },
      }),
    );
    expect(result).toEqual({ established: false, reason: "UNAVAILABLE" });
    expect(prebootCalls).toBe(0);
  });

  it("يفشلُ كما يفشلُ التبادلُ العاديُّ إن رفضَ الخادمُ التبادلَ المُقدَّمَ", async () => {
    const result = await establishSession(
      baseDeps({
        consumePreboot: () =>
          Promise.reject(new ApiError(401, "INIT_DATA_SIGNATURE", "…")),
      }),
    );
    expect(result.established).toBe(false);
    if (!result.established) expect(result.reason).toBe("REJECTED");
  });

  it("يحفظُ رمزَ التجديدِ من التبادلِ المُقدَّمِ إن وُجد", async () => {
    const persisted: string[] = [];
    const result = await establishSession(
      baseDeps({
        consumePreboot: () =>
          Promise.resolve({
            ok: true as const,
            accessToken: "pre",
            expiresAtMs: Date.now() + HOUR_MS,
            refreshToken: "rt-1",
          }),
        persist: (async (token: string) => {
          persisted.push(token);
          return { stored: true };
        }) as never,
      }),
    );
    expect(result).toEqual({ established: true, via: "exchanged" });
    expect(persisted).toEqual(["rt-1"]);
  });

  it("يستهلكُ `null` كأنَّ التقديمَ لم يُبدَأْ — فيمضي في المبادلةِ العاديةِ", async () => {
    let exchanged = 0;
    const result = await establishSession(
      baseDeps({
        consumePreboot: () => null,
        exchange: async () => {
          exchanged += 1;
          return { ok: true as const, accessToken: "x", expiresAtMs: Date.now() + HOUR_MS };
        },
      }),
    );
    expect(result).toEqual({ established: true, via: "exchanged" });
    expect(exchanged).toBe(1);
  });
});
