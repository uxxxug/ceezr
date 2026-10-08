import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  contrastRatio,
  evaluateContrast,
  FILL_TEXT,
  LAYER_TWO_PALETTE,
  type LayerOneFallbacks,
  type Palette,
  parseDirectivePalette,
  parseLayerOneFallbacks,
  parseUiTokens,
  type Scheme,
  uiTokenProblems,
} from "../../scripts/lib/ui-contrast";

const directiveMd = readFileSync("docs/UI_UX_CANONICAL_DIRECTIVE.md", "utf8");
const globalCss = readFileSync("apps/miniapp/src/styles/global.css", "utf8");

function clonePalette(p: Palette): Palette {
  return { dark: { ...p.dark }, light: { ...p.light } };
}

function baseInput() {
  return {
    declared: clonePalette(LAYER_TWO_PALETTE),
    directive: parseDirectivePalette(directiveMd),
    layerOne: parseLayerOneFallbacks(globalCss) as Record<Scheme, LayerOneFallbacks>,
  };
}

describe("contrastRatio — WCAG 2.x", () => {
  it("أسودُ على أبيضَ = 21:1، واللونُ على نفسِه = 1:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#4f46e5", "#4f46e5")).toBeCloseTo(1, 5);
  });
  it("متناظرٌ", () => {
    expect(contrastRatio("#0f172a", "#f5a524")).toBeCloseTo(
      contrastRatio("#f5a524", "#0f172a"),
      10,
    );
  });
  it("يرفضُ لوناً غيرَ صالحٍ", () => {
    expect(() => contrastRatio("#fff", "#000000")).toThrow();
  });
});

describe("parseDirectivePalette — جدولُ §2 من الدليلِ الحقيقيِّ", () => {
  it("يقرأُ الرموزَ الأربعةَ بالقيمِ المعلنةِ", () => {
    const p = parseDirectivePalette(directiveMd);
    expect(p.dark.brand).toBe("#8b90ff");
    expect(p.light.amber).toBe("#f5a524");
    expect(p).toEqual(LAYER_TWO_PALETTE);
  });
  it("سالبةٌ: جدولٌ ينقصُه رمزٌ يُسقِطُ القراءةَ", () => {
    const broken = directiveMd.replace(/^\| bad \|.*$/m, "");
    expect(() => parseDirectivePalette(broken)).toThrow();
  });
});

describe("parseLayerOneFallbacks — global.css الحقيقيُّ", () => {
  it("يقرأُ افتراضَي السمتَين", () => {
    const l1 = parseLayerOneFallbacks(globalCss);
    expect(l1.dark.bg).toBe("#0f172a");
    expect(l1.light.bg).toBe("#ffffff");
    expect(l1.light.hint).toBe("#475569");
  });
  it("سالبةٌ: كتلةُ السمةِ الفاتحةِ غائبةٌ تُسقِطُ القراءةَ", () => {
    expect(() =>
      parseLayerOneFallbacks(globalCss.replace(':root[data-tg-scheme="light"]', ":x")),
    ).toThrow();
  });
});

describe("evaluateContrast", () => {
  it("المستودعُ كما هوَ: أخضرُ، ولا إخفاقَ معلنٌ قائمٌ بعدَ PR 1", () => {
    const v = evaluateContrast(baseInput());
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.checks.filter((c) => !c.pass).map((c) => c.id)).toEqual([]);
  });
  it("سالبةٌ: انجرافُ اللوحةِ عن الدليلِ يُسقِطُ", () => {
    const input = baseInput();
    input.declared.light.brand = "#4f46e6";
    const v = evaluateContrast(input);
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.includes("انجرافُ اللوحةِ: brand/light"))).toBe(true);
  });
  it("سالبةٌ: نصٌّ أبيضُ على تعبئةِ amber الفاتحةِ يُسقِطُ (2.04:1)", () => {
    const fillText = {
      dark: { ...FILL_TEXT.dark },
      light: { ...FILL_TEXT.light, amber: "on-light" as const },
    };
    const v = evaluateContrast({ ...baseInput(), fillText });
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.includes("fill/amber/light"))).toBe(true);
  });
  it("سالبةٌ: إخفاقٌ جديدٌ غيرُ معلنٍ يُسقِطُ", () => {
    const input = baseInput();
    input.layerOne.dark = { ...input.layerOne.dark, hint: "#334155" };
    const v = evaluateContrast(input);
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.includes("mute/dark/bg"))).toBe(true);
  });
  it("سالبةٌ: إخفاقٌ معلنٌ زالَ دونَ تحديثِ القائمةِ يُسقِطُ", () => {
    const input = baseInput();
    input.layerOne.light = { ...input.layerOne.light, secondaryBg: "#ffffff" };
    input.layerOne.light = { ...input.layerOne.light, hint: "#64748b" };
    const v = evaluateContrast({ ...input, knownFailures: ["mute/light/secondaryBg"] });
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.includes("لم يَعُد قائماً"))).toBe(true);
  });
});

describe("رموزُ --ui-* في global.css = اللوحةُ المقيسةُ (UI-1 / PR 1)", () => {
  it("الورقةُ الحقيقيّةُ بلا انجرافٍ، والحكمُ الكاملُ أخضر", () => {
    const tokens = parseUiTokens(globalCss);
    expect(uiTokenProblems(tokens, LAYER_TWO_PALETTE)).toEqual([]);
    expect(evaluateContrast({ ...baseInput(), uiTokens: tokens }).ok).toBe(true);
  });

  it("الفاتحُ يرثُ الداكنَ ثمَّ يُعيدُ التعريفَ، والتعليقاتُ لا تُقرأ", () => {
    const css = `:root { --ui-brand: #111111; --ui-ok: #222222; }
/* :root[data-tg-scheme="light"] { --ui-ok: #999999; } */
:root[data-tg-scheme="light"] { --ui-brand: #333333; }`;
    const t = parseUiTokens(css);
    expect(t.dark["ui-brand"]).toBe("#111111");
    expect(t.light["ui-brand"]).toBe("#333333");
    expect(t.light["ui-ok"]).toBe("#222222");
  });

  it("رمزٌ منجرفٌ يُسقِطُ الحاجزَ (سلبيٌّ)", () => {
    const drifted = globalCss.replace("--ui-ok: #0b7a42;", "--ui-ok: #34d399;");
    const problems = uiTokenProblems(parseUiTokens(drifted), LAYER_TWO_PALETTE);
    expect(problems.some((p) => p.includes("--ui-ok/light"))).toBe(true);
    const v = evaluateContrast({ ...baseInput(), uiTokens: parseUiTokens(drifted) });
    expect(v.ok).toBe(false);
  });

  it("لونُ نصٍّ فوقَ التعبئةِ منجرفٌ عن FILL_TEXT يُسقِطُ الحاجزَ (سلبيٌّ)", () => {
    const drifted = globalCss.replace("--ui-bad-on: #ffffff;", "--ui-bad-on: #0f172a;");
    expect(uiTokenProblems(parseUiTokens(drifted), LAYER_TWO_PALETTE)).toContain(
      "انجرافُ رمزِ CSS: --ui-bad-on/light = #0f172a في global.css و#ffffff في المقيس",
    );
  });

  it("رمزٌ غائبٌ يُسقِطُ الحاجزَ (سلبيٌّ)", () => {
    const missing = globalCss.replace(/--ui-amber-on: #0f172a;/g, "");
    const problems = uiTokenProblems(parseUiTokens(missing), LAYER_TWO_PALETTE);
    expect(problems.some((p) => p.startsWith("رمزُ CSS غائبٌ: --ui-amber-on/dark"))).toBe(true);
  });
});
