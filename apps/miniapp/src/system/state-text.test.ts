/**
 * الغرض: إثباتُ شروطِ النصِّ التي ينصّ عليها العقدُ لا ذوقُ الكاتب: `UX-5`
 *   (لكلِّ حالةٍ نصٌّ وفعلٌ حيثُ يكون فعلٌ)، و`UX-8` (الصدق)، والقسم 9.7
 *   (`SS-01` يقول ما يمكن فعلُه بلا شبكة · `SS-02` يقول ما يعمل وما لا يعمل
 *   وتقديراً **إن وُجد**).
 * الحالة: اختبار فعلي — نصٌّ نقيٌّ بلا عرضٍ ولا متصفّح.
 * ينتمي إلى: apps/miniapp/src/system
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: حين يُوصَل التطبيقُ بقواميسِ `packages/shared/i18n` (`F2-11`)
 *   تبقى هذه الشروطُ كما هي ويتغيّر مصدرُ النصِّ وحدَه.
 */

import { describe, expect, it } from "bun:test";
import type { ScreenState } from "./state-text.ts";
import { retryAfterHint, screenText, screenTone } from "./state-text.ts";

/** كلُّ حالةٍ يمكن أن تُعرَض — والقائمةُ صريحةٌ كي تسقط عندَ إضافةِ حالةٍ بلا نصّ. */
const ALL: readonly ScreenState[] = [
  { kind: "no_connection", cause: "device_offline" },
  { kind: "no_connection", cause: "service_unreachable" },
  { kind: "no_connection", cause: "service_fault" },
  { kind: "no_connection", cause: "undetermined" },
  { kind: "service_unavailable", retryAfterSeconds: null },
  { kind: "service_unavailable", retryAfterSeconds: 50 },
  { kind: "session_expired" },
  { kind: "session_invalid" },
  { kind: "unsupported_city" },
  { kind: "unknown_error" },
  { kind: "surface_failed" },
  { kind: "unregistered" },
  { kind: "blocked" },
  { kind: "no_surface_yet" },
  { kind: "outside_telegram" },
  { kind: "missing_init_data" },
];

describe("لا حالةَ بلا نصّ (UX-5)", () => {
  it("لكلِّ حالةٍ عنوانٌ وشرحٌ غيرُ فارغين", () => {
    for (const state of ALL) {
      const text = screenText(state);
      expect(text.title.length).toBeGreaterThan(0);
      expect(text.body.length).toBeGreaterThan(8);
    }
  });

  it("كلُّ حالةِ فشلٍ قابلةٍ للإصلاحِ لها زرُّ فعل", () => {
    const recoverable: readonly ScreenState[] = [
      { kind: "no_connection", cause: "undetermined" },
      { kind: "service_unavailable", retryAfterSeconds: null },
      { kind: "session_expired" },
      { kind: "session_invalid" },
      { kind: "unknown_error" },
      { kind: "surface_failed" },
    ];
    for (const state of recoverable) {
      expect(screenText(state).actionLabel).not.toBeNull();
    }
  });

  it("ما لا فعلَ فيه للمستخدمِ لا يُعطى زرّاً كاذباً (UX-8)", () => {
    for (const kind of ["unsupported_city", "unregistered", "blocked", "no_surface_yet"] as const) {
      expect(screenText({ kind }).actionLabel).toBeNull();
    }
  });
});

describe("SS-01: ما يمكن فعلُه بلا شبكة (القسم 9.7)", () => {
  it("لكلِّ سببٍ نصٌّ مختلفٌ — لا جملةٌ واحدةٌ لكلِّ الانقطاعات", () => {
    const bodies = new Set(
      (["device_offline", "service_unreachable", "service_fault", "undetermined"] as const).map(
        (cause) => screenText({ kind: "no_connection", cause }).body,
      ),
    );
    expect(bodies.size).toBe(4);
  });

  it("يُقال ما لا يعمل بلا شبكةٍ صراحةً", () => {
    const text = screenText({ kind: "no_connection", cause: "device_offline" });
    expect(text.hint).not.toBeNull();
    expect(text.hint).toContain("بلا شبكة");
  });
});

describe("SS-02: ما يعمل وما لا يعمل، وتقديرٌ إن وُجد", () => {
  it("النصُّ ينسب العطلَ إلى الخدمةِ لا إلى المستخدم", () => {
    const text = screenText({ kind: "service_unavailable", retryAfterSeconds: null });
    expect(text.body).toContain("عندنا");
    expect(text.body).toContain("لا شيء ضاع");
  });

  it("**لا تقديرَ زمنيَّ حين لا يرسله الخادم**", () => {
    expect(screenText({ kind: "service_unavailable", retryAfterSeconds: null }).hint).toBeNull();
  });

  it("تقديرٌ بالثواني ثم بالدقائقِ حين يرسله الخادم", () => {
    expect(retryAfterHint(50)).toContain("50");
    expect(retryAfterHint(120)).toContain("2");
    expect(retryAfterHint(null)).toBeNull();
    expect(screenText({ kind: "service_unavailable", retryAfterSeconds: 50 }).hint).not.toBeNull();
  });
});

describe("SS-04: الحدُّ يُقال ولا يوعَد بما لا يُنفَّذ", () => {
  it("لا زرَّ «أبلغني»: زرٌّ كهذا ينشئ اشتراكاً لا وجودَ له (ADR 0035)", () => {
    const text = screenText({ kind: "unsupported_city" });
    expect(text.actionLabel).toBeNull();
    expect(text.body).not.toContain("أبلغني");
  });
});

describe("نبرةُ الإعلانِ للقارئِ الآليّ (UX-10)", () => {
  it("الفشلُ يقاطع، والحدُّ المعلَنُ يُخبَر", () => {
    expect(screenTone({ kind: "no_connection", cause: "undetermined" })).toBe("alert");
    expect(screenTone({ kind: "session_expired" })).toBe("alert");
    expect(screenTone({ kind: "unsupported_city" })).toBe("status");
    expect(screenTone({ kind: "blocked" })).toBe("status");
  });
});
