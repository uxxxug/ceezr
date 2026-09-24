/**
 * الغرض: إثباتُ أنَّ عنصرَ قياسِ سطحِ الراكبِ (`DEC-19` · `ADR 0185`) يُمرَّرُ إلى DOM بحرفِه، وأنَّ حالةَ
 *   التحميلِ — أوّلَ ما ترسمُه شاشةُ الترحيبِ — **بلا** عنصرِ قياسٍ، فلا يلتقطُ القياسُ الرسمَ المبكرَ.
 * الحالة: منفّذ فعلياً — `F1-09` الصفوفُ 3–5 (`[~]`). والموضعُ في الفرعِ الجاهزِ يحرسُه
 *   `scripts/check-rider-surface-timing.ts`؛ والرسمُ الفعليُّ يُثبتُه `scripts/measure-tti.ts`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/welcome
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { riderSurfaceTimingAttribute } from "./surface-timing.ts";
import { WelcomeScreen } from "./WelcomeScreen.tsx";

describe("عنصرُ قياسِ سطحِ الراكبِ — DEC-19", () => {
  it("React يُمرِّرُ السمةَ إلى DOM بحرفِها", () => {
    expect(renderToStaticMarkup(<p {...riderSurfaceTimingAttribute}>x</p>)).toBe(
      '<p elementtiming="waslah-rider-surface">x</p>',
    );
  });

  it("حالةُ التحميلِ بلا عنصرِ قياسٍ (سالبٌ: التقاطُ الرسمِ المبكرِ)", () => {
    const markup = renderToStaticMarkup(<WelcomeScreen loadStatus={() => new Promise(() => {})} />);
    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain("elementtiming");
  });
});
