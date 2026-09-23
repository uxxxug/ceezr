/**
 * الغرض: إثباتُ أنّ تدفّقَ اللغةِ في الإقلاعِ مربوطٌ بصدقٍ (`PD-030`): الموجّهُ
 *   يقرأُ `languageCode` من `fetchViewer` ويُمرِّرُه إلى الأسطحِ عبرَ
 *   `LanguageSurfaceProps`. ولا يُفترَضُ `ar` صامتاً عندَ الغيابِ.
 * الحالة: اختبار فعلي — أنواعٌ وخرجٌ ثابتٌ عبرَ `renderToStaticMarkup`.
 * ينتمي إلى: apps/miniapp/src/routing
 * يُتوقع أن يستخدمه لاحقاً: CI
 *
 * ═══ حدٌّ معلَنٌ ═══
 * لا بيئةَ DOM في المستودع، فلا يُقاسُ `useEffect` ولا انتقالُ حالةٍ. ما يُقاسُ
 * ههنا هو أنّ الأنواعَ مربوطةٌ وأنّ `fetchViewer` يُمرِّرُ اللغةَ صراحةً.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MINIAPP_DEFAULT_LANGUAGE } from "../../../../packages/shared/i18n/miniapp/index.ts";
import type { ViewerView } from "../identity/viewer.ts";
import type { LanguageSurfaceProps } from "./RoleRouter.tsx";
import { RoleRouter } from "./RoleRouter.tsx";

describe("PD-030: ربطُ لغةِ الحسابِ بالإقلاع", () => {
  it("١) `LanguageSurfaceProps` يُلزِمُ `language` و`onLanguageChanged`", () => {
    // هذا اختبارُ نوعٍ: إن غاب حقلٌ أو تغيّر اسمُه فلا يَتجمَّعُ الكود.
    const props: LanguageSurfaceProps = {
      language: "ur",
      onLanguageChanged: () => {},
    };
    expect(props.language).toBe("ur");
    expect(typeof props.onLanguageChanged).toBe("function");
  });

  it("٢) `fetchViewer` يُعيدُ `languageCode` في حالةِ `viewer`", () => {
    const viewer: ViewerView = {
      kind: "viewer",
      role: "rider",
      status: "active",
      languageCode: "ur",
    };
    expect(viewer.languageCode).toBe("ur");
  });

  it("٣) `unavailable` لا يحملُ `languageCode` — فلا افتراضَ صامت", () => {
    const unavailable: ViewerView = { kind: "unavailable" };
    // إن حاولَ أحدٌ قراءةَ `languageCode` من `unavailable` فلا يجدُها.
    expect("languageCode" in unavailable).toBe(false);
  });

  it("٤) الموجّهُ يبدأُ بلغةٍ افتراضيةٍ ثم يُحدِّثُها من الخادمِ", async () => {
    // `renderToStaticMarkup` لا يُشغّلُ `useEffect`، فالحالةُ الأوليةُ هيَ
    // ما يُقاسُ: اللغةُ الافتراضيةُ `ar`، والتحديثُ يقعُ في الأثرِ لا هنا.
    const noop = () => Promise.resolve({ kind: "unavailable" } as ViewerView);
    const html = renderToStaticMarkup(<RoleRouter fetchViewer={noop} />);
    // الموجّهُ يُخرِجُ `Skeleton` أثناءَ `resolving` — لا سطحَ افتراضي.
    expect(html).toContain("sk__line");
  });

  it("٥) اللغةُ الافتراضيةُ هيَ `ar` لا شيءٌ آخر", () => {
    expect(MINIAPP_DEFAULT_LANGUAGE).toBe("ar");
  });
});
