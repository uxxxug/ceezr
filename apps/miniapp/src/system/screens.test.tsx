/**
 * الغرض: إثباتُ ما يمكن إثباتُه من العرضِ بلا متصفّح: أنّ كلَّ شاشةِ حالةٍ تُخرِج
 *   عنواناً ونصّاً وزرَّ فعلٍ حين يكون فعلٌ (`UX-5`)، وأنّ الإعلانَ للقارئِ الآليِّ
 *   موجودٌ (`UX-10`)، وأنّ الإطارَ لا يستعمل يميناً ولا يساراً (`UX-3` · 9.11)،
 *   وأنّ الموجّهَ **لا يعرض سطحاً قبلَ أن يجيب الخادمُ**.
 * الحالة: اختبار فعلي — عرضٌ نصّيٌّ ثابتٌ عبرَ `react-dom/server`.
 * ينتمي إلى: apps/miniapp/src/system
 * يُتوقع أن يستخدمه لاحقاً: CI
 *
 * ═══ حدٌّ معلَنٌ في قوّةِ هذا الملفِّ ═══
 * لا بيئةَ DOM في هذا المستودع (لا `happy-dom` ولا `jsdom` ولا مكتبةَ اختبارِ
 * مكوّنات). فما يُثبَت ههنا **بنيةُ الخَرْجِ الأوّلِ وحدَها**: لا ضغطَ زرٍّ، ولا
 * أثرٌ (`useEffect`) يعمل، ولا انتقالُ حالةٍ بعدَ ردِّ الخادم، ولا حسابُ تنسيقٍ
 * ولا تباينُ ألوانٍ ولا مقاسُ لمسٍ فعليّ: `min-block-size: 44px` مكتوبٌ في
 * `global.css` **ولم يُقَس على جهاز**.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RoleRouter } from "../routing/RoleRouter.tsx";
import { Layout } from "../shell/Layout.tsx";
import { EmptyState } from "./EmptyState.tsx";
import { Skeleton } from "./Skeleton.tsx";
import { SystemScreen } from "./SystemScreen.tsx";
import type { ScreenState } from "./state-text.ts";
import { screenText } from "./state-text.ts";
import { UnsupportedCityScreen } from "./UnsupportedCityScreen.tsx";

const FAILURES: readonly ScreenState[] = [
  { kind: "no_connection", cause: "device_offline" },
  { kind: "no_connection", cause: "service_unreachable" },
  { kind: "service_unavailable", retryAfterSeconds: 30 },
  { kind: "session_expired" },
  { kind: "session_invalid" },
  { kind: "unknown_error" },
  { kind: "surface_failed" },
  { kind: "missing_init_data" },
];

const INFORMATIONAL: readonly ScreenState[] = [
  { kind: "unsupported_city" },
  { kind: "unregistered" },
  { kind: "blocked" },
  { kind: "no_surface_yet" },
  { kind: "outside_telegram" },
];

describe("شاشةُ الحالة: نصٌّ وفعلٌ وإعلان", () => {
  it("كلُّ شاشةِ فشلٍ تُخرِج عنوانَها ونصَّها وزرَّ فعلِها", () => {
    for (const state of FAILURES) {
      const html = renderToStaticMarkup(<SystemScreen state={state} onAction={() => {}} />);
      const text = screenText(state);
      expect(html).toContain(text.title);
      expect(html).toContain(text.body);
      expect(html).toContain("<button");
      expect(html).toContain('role="alert"');
    }
  });

  it("الشاشاتُ الإخباريةُ تُعلَن `status` ولا زرَّ فيها", () => {
    for (const state of INFORMATIONAL) {
      const html = renderToStaticMarkup(<SystemScreen state={state} onAction={() => {}} />);
      expect(html).toContain('role="status"');
      expect(html).not.toContain("<button");
    }
  });

  it("بلا فعلٍ مُمرَّرٍ لا يُرسَم زرٌّ ولو كان للحالةِ عنوانُ فعل", () => {
    const html = renderToStaticMarkup(<SystemScreen state={{ kind: "unknown_error" }} />);
    expect(html).not.toContain("<button");
  });

  it("أثناءَ الفعلِ يُعطَّل الزرُّ فلا يُنادى مرّتين", () => {
    const html = renderToStaticMarkup(
      <SystemScreen state={{ kind: "unknown_error" }} onAction={() => {}} busy />,
    );
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
  });
});

describe("هيكلُ التحميلِ والحالةُ الفارغة (UX-5)", () => {
  it("الهيكلُ مخفيٌّ عن القارئِ الآليِّ — والخبرُ في `aria-busy` على الحاوي", () => {
    expect(renderToStaticMarkup(<Skeleton />)).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<Layout busy>x</Layout>)).toContain('aria-busy="true"');
  });

  it("الحالةُ الفارغةُ ليست خطأً: لا `alert` ولا زرَّ إعادةِ محاولة", () => {
    const html = renderToStaticMarkup(<EmptyState title="لا شيء" body="لا شيء بعد." />);
    expect(html).not.toContain("alert");
    expect(html).not.toContain("<button");
    expect(html).toContain("لا شيء بعد.");
  });
});

describe("الإطارُ المتجاوب (القسم 9.3 · 9.11)", () => {
  it("رأسٌ ومحتوىً ومنطقةُ فعلٍ — بأصنافٍ لا بتنسيقٍ سطريٍّ ذي يمينٍ ويسار", () => {
    const html = renderToStaticMarkup(
      <Layout header={<h1>وَصْلة</h1>} action={<button type="button">تم</button>}>
        محتوى
      </Layout>,
    );
    expect(html).toContain("app-frame");
    expect(html).toContain("app-frame__content");
    expect(html).toContain("app-frame__action");
    expect(html).not.toContain("margin-left");
    expect(html).not.toContain("padding-right");
  });
});

describe("SS-04: الشاشةُ مكتوبةٌ وغيرُ موصولة", () => {
  it("تُخرِج نصَّها ولا تعد بما لا يُنفَّذ", () => {
    const html = renderToStaticMarkup(<UnsupportedCityScreen />);
    expect(html).toContain("مدينتك غير مدعومة بعد");
    expect(html).not.toContain("<button");
  });
});

describe("الموجّه: لا سطحَ قبلَ أن يجيب الخادم", () => {
  it("الخَرْجُ الأوّلُ هيكلُ تحميلٍ — لا سطحَ راكبٍ ولا سائقٍ ولا مشرف", () => {
    const html = renderToStaticMarkup(<RoleRouter />);
    expect(html).toContain("sk__line");
    expect(html).not.toContain("سطح الراكب");
    expect(html).not.toContain("سطح السائق");
    expect(html).not.toContain("سطح المشرف");
  });
});
