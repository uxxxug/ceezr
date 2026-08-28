/**
 * الغرض: اختبارُ طبقةِ القياسِ في البند `F1-08`: التصنيفةُ المغلقةُ، والمنقّي
 *   (قائمةُ مسموحٍ لا ممنوعٍ)، والمَصرِفُ المحدودُ، والعهودُ الثلاثةُ
 *   (لا يرمي · لا حدثَ بلا تنقيةٍ · لا وقتَ من داخلِه).
 * الحالة: اختبار فعلي — لا شبكةَ ولا بيئةَ DOM: طبقةٌ نقيّةٌ تُختبَر نداءً.
 * ينتمي إلى: apps/miniapp/src/telemetry
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: حين يُقرَّر مَصرِفٌ ناقلٌ يُضاف ملفُّ اختبارٍ له وحدَه —
 *   ولا يُوسَّع هذا الملفُّ ليدَّعي ما لم يُبنَ.
 */
import { describe, expect, it } from "bun:test";
import { normalizePath, sanitizeEvent, type TelemetryEvent } from "./events.ts";
import { createMemorySink, noopSink } from "./sink.ts";
import { createTelemetry } from "./telemetry.ts";

const VALID_ID = "9f1c3b7a-2d4e-4f60-8a11-b2c3d4e5f607";

describe("F1-08 · تقويلُ المسار", () => {
  it("يُبقي المسارَ الثابتَ كما هو", () => {
    expect(normalizePath("/v1/session/refresh")).toBe("/v1/session/refresh");
  });

  it("يُبدِل المعرّفَ الرقميَّ بـ`:id` — فلا يُشير المسارُ إلى رحلةٍ بعينِها", () => {
    expect(normalizePath("/v1/rides/4821")).toBe("/v1/rides/:id");
  });

  it("يُبدِل UUID بـ`:id`", () => {
    expect(normalizePath(`/v1/users/${VALID_ID}/rides`)).toBe("/v1/users/:id/rides");
  });

  it("**يقطع المُعامِلاتَ كلَّها**: فيها بحثٌ وإحداثيّاتٌ ورموزٌ", () => {
    expect(normalizePath("/v1/search?q=%D8%A7%D9%84%D9%85%D8%AF%D9%8A%D9%86%D8%A9&lat=24.5")).toBe(
      "/v1/search",
    );
  });

  it("يقطع ما بعدَ `#` أيضاً", () => {
    expect(normalizePath("/v1/me#token=abc")).toBe("/v1/me");
  });

  it("يحدّ عددَ الأجزاءِ بثمانيةٍ — فلا مسارَ بلا حدٍّ في حدثٍ", () => {
    const deep = `/${Array.from({ length: 20 }, () => "seg").join("/")}`;
    expect(normalizePath(deep).split("/").length - 1).toBe(8);
  });

  it("المسارُ الفارغُ أو غيرُ النصِّ يصير `/` لا نصّاً مجهولاً", () => {
    expect(normalizePath("")).toBe("/");
    expect(normalizePath(undefined)).toBe("/");
    expect(normalizePath(42)).toBe("/");
  });
});

describe("F1-08 · المنقّي: قائمةُ مسموحٍ لا قائمةُ ممنوعٍ", () => {
  it("يُبقي معرّفَ الطلبِ الصحيحَ ويرفض ما خالف الصيغةَ", () => {
    const kept = sanitizeEvent({
      kind: "api",
      path: "/v1/me",
      method: "GET",
      status: 200,
      code: null,
      outcome: "ok",
      requestId: VALID_ID,
    });
    expect(kept.kind === "api" && kept.requestId).toBe(VALID_ID);

    const dropped = sanitizeEvent({
      kind: "api",
      path: "/v1/me",
      method: "GET",
      status: 200,
      code: null,
      outcome: "ok",
      requestId: "قصيرٌ\nوفيه سطرٌ",
    });
    expect(dropped.kind === "api" && dropped.requestId).toBeNull();
  });

  it("رمزُ الخطأِ يمرُّ إن كان رمزَ عقدٍ، ويُطرَح إن كان رسالةً حرّةً", () => {
    const ok = sanitizeEvent({
      kind: "api",
      path: "/v1/me",
      method: "GET",
      status: 401,
      code: "SESSION_EXPIRED",
      outcome: "rejected",
      requestId: null,
    });
    expect(ok.kind === "api" && ok.code).toBe("SESSION_EXPIRED");

    const free = sanitizeEvent({
      kind: "api",
      path: "/v1/me",
      method: "GET",
      status: 401,
      code: "انتهت جلسةُ المستخدم +966500000000",
      outcome: "rejected",
      requestId: null,
    });
    expect(free.kind === "api" && free.code).toBeNull();
  });

  it("الطريقةُ غيرُ المعروفةِ تصير `OTHER` لا نصّاً كما وصل", () => {
    const event = sanitizeEvent({
      kind: "api",
      path: "/v1/me",
      method: "TRACE" as never,
      status: 200,
      code: null,
      outcome: "ok",
      requestId: null,
    });
    expect(event.kind === "api" && event.method).toBe("OTHER");
  });

  it("الحالةُ خارجَ مجالِ HTTP تصير `null`", () => {
    for (const status of [0, 99, 600, 1.5, Number.NaN]) {
      const event = sanitizeEvent({
        kind: "api",
        path: "/v1/me",
        method: "GET",
        status,
        code: null,
        outcome: "rejected",
        requestId: null,
      });
      expect(event.kind === "api" && event.status).toBeNull();
    }
  });

  it("**«لم يصل ردٌّ» يُفرَّغ من الحالةِ والرمزِ والمعرّفِ** ولو مُرِّرت", () => {
    const event = sanitizeEvent({
      kind: "api",
      path: "/v1/me",
      method: "GET",
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      outcome: "no_response",
      requestId: VALID_ID,
    });
    expect(event).toEqual({
      kind: "api",
      path: "/v1/me",
      method: "GET",
      status: null,
      code: null,
      outcome: "no_response",
      requestId: null,
    });
  });

  it("**«لم يُرسَل الطلبُ» كذلك**: رفضٌ محليٌّ لا يُنسَب إلى خادمٍ لم يُنادَ", () => {
    const event = sanitizeEvent({
      kind: "api",
      path: "/v1/me",
      method: "GET",
      status: 401,
      code: "SESSION_REQUIRED",
      outcome: "not_attempted",
      requestId: VALID_ID,
    });
    expect(event.kind === "api" && event.status).toBeNull();
    expect(event.kind === "api" && event.code).toBeNull();
    expect(event.kind === "api" && event.requestId).toBeNull();
  });

  it("حدثُ الإقلاعِ الناجحُ لا يحمل سبباً — والسببُ للفشلِ وحدَه", () => {
    const event = sanitizeEvent({
      kind: "boot",
      outcome: "renewed",
      reason: "SOMETHING",
      requestId: VALID_ID,
    });
    expect(event.kind === "boot" && event.reason).toBeNull();
  });

  it("وسمُ خطأِ الواجهةِ يمرُّ إن كان وسماً، ويُطرَح إن كان رسالةَ استثناءٍ", () => {
    expect(sanitizeEvent({ kind: "ui_error", label: "root", requestId: null })).toEqual({
      kind: "ui_error",
      label: "root",
      requestId: null,
    });
    const free = sanitizeEvent({
      kind: "ui_error",
      label: "TypeError: Cannot read property 'x' of undefined at https://t.me/app#tok",
      requestId: null,
    });
    expect(free.kind === "ui_error" && free.label).toBeNull();
  });
});

describe("F1-08 · المَصرِف", () => {
  it("المَصرِفُ الافتراضيُّ يستقبل ولا يُرجِع شيئاً ولا يرمي", () => {
    expect(
      noopSink.record({ atMs: 1, event: { kind: "ui_error", label: null, requestId: null } }),
    ).toBeUndefined();
  });

  it("مَصرِفُ الذاكرةِ **حَلْقةٌ محدودةٌ**: يُسقِط الأقدمَ ويحسبه", () => {
    const sink = createMemorySink(2);
    const telemetry = createTelemetry({ sink, now: () => 1_000 });
    for (const label of ["one", "two", "three"]) {
      telemetry.record({ kind: "ui_error", label, requestId: null });
    }
    expect(sink.size()).toBe(2);
    expect(sink.dropped()).toBe(1);
    const labels = sink.entries().map((r) => (r.event.kind === "ui_error" ? r.event.label : null));
    expect(labels).toEqual(["two", "three"]);
  });

  it("سعةٌ غيرُ موجبةٍ تُرفَض عندَ الإنشاءِ لا عندَ أوّلِ حدث", () => {
    expect(() => createMemorySink(0)).toThrow(RangeError);
    expect(() => createMemorySink(-3)).toThrow(RangeError);
    expect(() => createMemorySink(1.5)).toThrow(RangeError);
  });
});

describe("F1-08 · عهودُ طبقةِ القياس", () => {
  it("**لا وقتَ من داخلِه**: اللحظةُ من ساعةٍ محقونةٍ", () => {
    const sink = createMemorySink(4);
    createTelemetry({ sink, now: () => 1_756_000_000_000 }).record({
      kind: "boot",
      outcome: "existing",
      reason: null,
      requestId: null,
    });
    expect(sink.entries()[0]?.atMs).toBe(1_756_000_000_000);
  });

  it("**لا حدثَ يمرُّ بلا تنقيةٍ**: المُسجَّلُ هو المُنقَّى لا ما مرّره المنادي", () => {
    const sink = createMemorySink(4);
    createTelemetry({ sink, now: () => 5 }).record({
      kind: "api",
      path: "/v1/rides/4821?token=abc",
      method: "GET",
      status: 200,
      code: null,
      outcome: "ok",
      requestId: "x",
    });
    expect(sink.entries()[0]?.event).toEqual({
      kind: "api",
      path: "/v1/rides/:id",
      method: "GET",
      status: 200,
      code: null,
      outcome: "ok",
      requestId: null,
    });
  });

  it("**لا يرمي أبداً**: مَصرِفٌ يرمي لا يُسقِط المنادي", () => {
    const angry = {
      record: (): void => {
        throw new Error("مَصرِفٌ معطوبٌ");
      },
    };
    const telemetry = createTelemetry({ sink: angry, now: () => 1 });
    expect(() =>
      telemetry.record({ kind: "ui_error", label: "root", requestId: null }),
    ).not.toThrow();
  });

  it("منقّياً يرمي؟ لا: المنقّي نقيٌّ — لكنّ حدثاً بحقولٍ غريبةٍ يمرُّ مُفرَّغاً", () => {
    const sink = createMemorySink(2);
    createTelemetry({ sink, now: () => 1 }).record({
      kind: "ui_error",
      label: 12345,
      requestId: {},
    } as unknown as TelemetryEvent);
    expect(sink.entries()[0]?.event).toEqual({
      kind: "ui_error",
      label: null,
      requestId: null,
    });
  });
});
