/**
 * الغرض: إثباتُ أنّ **تصنيفَ الفشلِ إلى شاشةٍ** يتبع القسم 9.7 حرفاً: تمييزُ
 *   «الشبكةُ أم خدمتُنا؟»، وتمييزُ انتهاءِ الجلسةِ من رفضِها، وردُّ ما لا يُصنَّف
 *   إلى `null` بدلَ ادّعاءِ تشخيصٍ.
 * الحالة: اختبار فعلي — دالّةٌ نقيّةٌ بلا شبكةٍ ولا متصفّح.
 * ينتمي إلى: apps/miniapp/src/system
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: يومَ يُضاف رمزُ خطأٍ جديدٌ في عقدِ القسم 10 فهذا الملفُّ هو
 *   الذي يجب أن يُوسَّع، لا الشاشات.
 */

import { describe, expect, it } from "bun:test";
import { ApiError, ApiNetworkError } from "../api/client.ts";
import {
  classifyFailure,
  failureFromThrown,
  type RequestFailure,
  shouldProbeReachability,
} from "./failure.ts";

const failed: RequestFailure = { transport: "failed" };
/**
 * الرمزُ قبلَ الحالةِ عن قصدٍ: هذا هو الشكلُ الذي يقرؤه
 * `scripts/check-business-constants.ts` رمزَ بروتوكولٍ لا سعرَ سياسةٍ تجاريّة.
 */
const responded = (code: string, status: number, retryAfterSeconds: number | null = null) =>
  ({ transport: "responded", status, code, retryAfterSeconds }) as const;

describe("تمييزُ الشبكةِ من الخدمة (SS-01 · القسم 9.7)", () => {
  it("جهازٌ يعلن انقطاعَه: يُقال ذلك ولا يُنادى فحصٌ", () => {
    expect(classifyFailure(failed, "not_probed", false)).toEqual({
      kind: "no_connection",
      cause: "device_offline",
    });
    expect(shouldProbeReachability(failed, false)).toBe(false);
  });

  it("شبكةُ الجهازِ تعمل والفحصُ لم يصل: خدمتُنا غيرُ قابلةٍ للوصول", () => {
    expect(shouldProbeReachability(failed, true)).toBe(true);
    expect(classifyFailure(failed, "unreachable", true)).toEqual({
      kind: "no_connection",
      cause: "service_unreachable",
    });
  });

  it("الفحصُ وصل: الطريقُ سالكٌ وهذا النداءُ وحدَه أخفق", () => {
    expect(classifyFailure(failed, "reachable", true)).toEqual({
      kind: "no_connection",
      cause: "service_fault",
    });
  });

  it("لم يُنادَ الفحصُ: يُقال «غيرُ محدَّد» ولا يُخترَع سبب", () => {
    expect(classifyFailure(failed, "not_probed", true)).toEqual({
      kind: "no_connection",
      cause: "undetermined",
    });
  });

  it("لا يُنادى الفحصُ لردٍّ وصل: الجوابُ معروفٌ سلفاً", () => {
    expect(shouldProbeReachability(responded("HTTP_ERROR", 500), true)).toBe(false);
  });
});

describe("الجلسة: انتهاءٌ أم رفض (SS-05)", () => {
  it("`SESSION_EXPIRED` = انتهاءٌ، وعلاجُه إعادةُ مصادقة", () => {
    expect(classifyFailure(responded("SESSION_EXPIRED", 401))).toEqual({
      kind: "session_expired",
    });
  });

  it("401 بأيِّ رمزٍ آخرَ = جلسةٌ غيرُ صالحة", () => {
    for (const code of ["SESSION_REQUIRED", "SESSION_INVALID", "INIT_DATA_SIGNATURE"]) {
      expect(classifyFailure(responded(code, 401))).toEqual({ kind: "session_invalid" });
    }
  });
});

describe("تعطّلُ الخدمة (SS-02)", () => {
  it("503 يحمل تقديراً زمنيّاً إن أرسله الخادم", () => {
    expect(classifyFailure(responded("SESSION_NOT_CONFIGURED", 503, 90))).toEqual({
      kind: "service_unavailable",
      retryAfterSeconds: 90,
    });
  });

  it("500 و502 و504 كلُّها تعطّلٌ عندنا لا خطأُ المستخدم", () => {
    for (const status of [500, 502, 504]) {
      expect(classifyFailure(responded("HTTP_ERROR", status))).toEqual({
        kind: "service_unavailable",
        retryAfterSeconds: null,
      });
    }
  });

  it("لا يُخترَع تقديرٌ عندَ غيابِ الترويسة", () => {
    const state = classifyFailure(responded("SESSION_NOT_CONFIGURED", 503));
    expect(state).toEqual({ kind: "service_unavailable", retryAfterSeconds: null });
  });
});

describe("ما لا يُصنَّف لا يُدَّعى", () => {
  it("٤xx غيرُ التفويضِ ليست حالةَ نظامٍ", () => {
    expect(classifyFailure(responded("INVALID_BODY", 400))).toBeNull();
    expect(classifyFailure(responded("FORBIDDEN", 403))).toBeNull();
    expect(classifyFailure(responded("NOT_FOUND", 404))).toBeNull();
    expect(classifyFailure(responded("PAYLOAD_TOO_LARGE", 413))).toBeNull();
    expect(classifyFailure(responded("RATE_LIMITED", 429))).toBeNull();
  });

  it("خطأٌ مجهولُ المصدرِ ليس فشلَ نقلٍ ولا ردَّ خادم", () => {
    expect(failureFromThrown(new TypeError("boom"))).toBeNull();
    expect(failureFromThrown("nope")).toBeNull();
  });
});

describe("ترجمةُ ما رماه حدُّ API", () => {
  it("`ApiNetworkError` = لم يصل ردّ", () => {
    expect(failureFromThrown(new ApiNetworkError())).toEqual({ transport: "failed" });
  });

  it("`ApiError` تنقل الحالةَ والرمزَ والتقديرَ كما هي", () => {
    expect(failureFromThrown(new ApiError(503, "BUSY", "…", 30))).toEqual({
      transport: "responded",
      status: 503,
      code: "BUSY",
      retryAfterSeconds: 30,
    });
  });
});
