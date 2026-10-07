/**
 * الغرض: حواجزُ ارتدادٍ لعيوبٍ **قيسَت في متصفّحٍ حيٍّ** في UI-10 (ADR 0245) ولم يلتقطْها
 *   أيُّ حاجزٍ ساكنٍ قبلَها. كلُّ حالةٍ هنا تسمّي العيبَ والقياسَ الذي كشفَه.
 * الحالة: منفّذ — 2026-10-07.
 * ينتمي إلى: apps/miniapp/src/shell
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { Layout } from "./Layout.tsx";
import { ScreenFrame } from "./ScreenFrame.tsx";

const CSS = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  " ",
);

/** أجسامُ كلِّ قاعدةٍ يحوي محدِّدُها (مفصولاً بفاصلة) المحدِّدَ المطلوبَ حرفاً. */
function bodiesOf(selector: string): string[] {
  const out: string[] = [];
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? "").split(",").map((s) => s.trim());
    if (selectors.includes(selector)) out.push(m[2] ?? "");
  }
  return out;
}

function hasDecl(selector: string, decl: RegExp): boolean {
  return bodiesOf(selector).some((b) => decl.test(b));
}

function luminance(hex: string): number {
  const c = (i: number) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(1) + 0.7152 * c(3) + 0.0722 * c(5);
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("UI-10 · إطارٌ واحدٌ ومعلمٌ رئيسيٌّ واحد", () => {
  it("ScreenFrame داخلَ Layout لا يرسمُ `<main>` ثانياً (كانَ: main داخلَ main وحاشيةٌ مضاعفة)", () => {
    const html = renderToStaticMarkup(
      <Layout>
        <ScreenFrame mode="root" title="t" tabs={<nav />}>
          <p>body</p>
        </ScreenFrame>
      </Layout>,
    );
    expect(html.match(/<main\b/g)?.length).toBe(1);
    expect(html).toContain('<div class="app-frame app-frame--nested">');
  });

  it("ScreenFrame وحدَه يبقى `<main>` (لا تغييرَ خارجَ الهيكل)", () => {
    const html = renderToStaticMarkup(
      <ScreenFrame mode="root" title="t" tabs={<nav />}>
        <p>body</p>
      </ScreenFrame>,
    );
    expect(html.startsWith('<main class="app-frame">')).toBe(true);
  });

  it("الإطارُ المتداخلُ بلا حاشيةٍ ثانية", () => {
    expect(hasDecl(".app-frame--nested", /(^|;|\s)padding:\s*0\s*;/)).toBe(true);
  });
});

describe("UI-10 · لا تجاوزَ أفقيّاً على 320px", () => {
  it("`.rh__input` بعرضٍ نسبيٍّ (كانَ: scrollWidth 506 على 320px وتبويبٌ محجوبٌ عن اللمس)", () => {
    expect(hasDecl(".rh__input", /inline-size:\s*100%/)).toBe(true);
  });

  it("عمودُ الإطارِ `minmax(0, 1fr)` (كانَ: `.hs__search-input` دفعَ «رحلاتي» إلى 460px)", () => {
    expect(hasDecl(".app-frame", /grid-template-columns:\s*minmax\(0, 1fr\)/)).toBe(true);
  });
});

describe("UI-10 · لغةُ الحسابِ تحكمُ `<html lang dir>`", () => {
  it("الموجّهُ يطبّقُ اتّجاهَ لغةِ الحسابِ عندَ تغيّرِها (كانَ: ar/rtl دائماً لحسابٍ en وur)", () => {
    const src = readFileSync(new URL("../routing/RoleRouter.tsx", import.meta.url), "utf8");
    expect(src).toMatch(
      /useEffect\(\(\) => \{\s*applyDocumentDirection\(language\);\s*\}, \[language\]\);/,
    );
  });
});

describe("UI-10 · أهدافُ اللمسِ ≥ 44px (قيسَت 38–42px)", () => {
  it("أرضيّةُ كلِّ زرٍّ 44px", () => {
    expect(hasDecl("button", /min-block-size:\s*44px/)).toBe(true);
  });
  for (const sel of [".ac__lang-option", ".dac__period", ".sup__faq", ".dsup__deductions"]) {
    it(`${sel}`, () => {
      expect(hasDecl(sel, /min-block-size:\s*44px/)).toBe(true);
    });
  }
});

describe("UI-10 · تباينُ ما يملكُه التطبيق", () => {
  for (const scheme of ["dark", "light"] as const) {
    it(`افتراضُ الزرِّ (${scheme}): نصُّه عليه ≥ 4.5:1 (كانَ: #ffffff على #0ea5e9 = 2.77)`, () => {
      const sel = scheme === "dark" ? ":root" : ':root[data-tg-scheme="light"]';
      const body = bodiesOf(sel).find((b) => b.includes("--tg-button-color")) ?? "";
      const bg = /--tg-button-color:\s*(#[0-9a-fA-F]{6})/.exec(body)?.[1];
      const fg = /--tg-button-text-color:\s*(#[0-9a-fA-F]{6})/.exec(body)?.[1];
      expect(bg).toBeDefined();
      expect(fg).toBeDefined();
      expect(ratio(bg as string, fg as string)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("افتراضُ الرابطِ الفاتحِ على الخلفيّةِ ≥ 4.5:1 (كانَ: #0284c7 على #ffffff = 4.09)", () => {
    const body =
      bodiesOf(':root[data-tg-scheme="light"]').find((b) => b.includes("--tg-link-color")) ?? "";
    const bg = /--tg-bg-color:\s*(#[0-9a-fA-F]{6})/.exec(body)?.[1] as string;
    for (const name of ["tg-link-color", "tg-accent-text-color"]) {
      const fg = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(body)?.[1] as string;
      expect(ratio(bg, fg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("مدخلُ الاستغاثة: نصُّه ممزوجٌ نحوَ لونِ النصِّ (كانَ: 3.78 فاتح · 4.32 داكن)", () => {
    expect(
      hasDecl(
        ".sos__entry",
        /color:\s*color-mix\(in srgb, var\(--tg-destructive-text-color\) 75%, var\(--tg-text-color\)\)/,
      ),
    ).toBe(true);
  });
});
