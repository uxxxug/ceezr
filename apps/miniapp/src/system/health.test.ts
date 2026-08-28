/**
 * الغرض: إثباتُ أنّ فحصَ الحياةِ يجيب عن سؤالٍ واحدٍ — **هل أجاب الخادمُ؟** —
 *   لا «هل نجح النداءُ؟»؛ وأنّ `navigator.onLine` تُقرأ في اتجاهٍ واحدٍ.
 * الحالة: اختبار فعلي — النداءُ محقونٌ بلا شبكةٍ ولا خادم.
 * ينتمي إلى: apps/miniapp/src/system
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: **لا يُثبِت هذا الملفُّ شيئاً عن `/health` الحقيقيِّ** ولا عن
 *   زمنِ استجابتِه: يُثبِت قراءةَ العميلِ للجوابِ لا صحّةَ الجوابِ نفسِه.
 */

import { describe, expect, it } from "bun:test";
import { ApiError, ApiNetworkError } from "../api/client.ts";
import { deviceOnline, probeReachability } from "./health.ts";

describe("فحصُ الحياةِ: هل أجاب الخادم؟", () => {
  it("نجاحٌ = وصولٌ", async () => {
    expect(await probeReachability(async () => ({ status: "ok" }))).toBe("reachable");
  });

  it("**ردٌّ بحالةِ خطأٍ = وصولٌ أيضاً**: الخادمُ تكلّم", async () => {
    const failing = async (): Promise<never> => {
      throw new ApiError(503, "X", "…");
    };
    expect(await probeReachability(failing)).toBe("reachable");
  });

  it("لم يصل ردٌّ = لا وصول", async () => {
    const dead = async (): Promise<never> => {
      throw new ApiNetworkError();
    };
    expect(await probeReachability(dead)).toBe("unreachable");
  });

  it("خطأٌ من صنفٍ آخرَ يُقرأ لا وصولاً — ولا يُقرأ وصولاً على شكٍّ", async () => {
    const odd = async (): Promise<never> => {
      throw new TypeError("boom");
    };
    expect(await probeReachability(odd)).toBe("unreachable");
  });
});

describe("إعلانُ الجهازِ عن شبكتِه", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  const setOnLine = (value: unknown): void => {
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: value },
      configurable: true,
      writable: true,
    });
  };

  const restore = (): void => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
  };

  it("`false` تُقرأ انقطاعاً", () => {
    setOnLine(false);
    expect(deviceOnline()).toBe(false);
    restore();
  });

  it("`true` تُقرأ اتصالاً — وهي إشارةٌ ضعيفةٌ لا تُبنى عليها دعوى", () => {
    setOnLine(true);
    expect(deviceOnline()).toBe(true);
    restore();
  });

  it("قيمةٌ ليست منطقيةً تُقرأ اتصالاً: لا يُعلَن انقطاعٌ بلا دليل", () => {
    setOnLine(undefined);
    expect(deviceOnline()).toBe(true);
    restore();
  });
});
