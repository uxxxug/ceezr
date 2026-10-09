/** PRD-007 · ADR 0250 — اختبارُ مقروئيّةِ ألوانِ سمةِ تيليجرام الافتراضيّة. */
import { afterEach, describe, expect, test } from "bun:test";
import { AA_TEXT_CONTRAST, contrast, readableShift } from "./readable.ts";
import {
  installFakeDocument,
  installFakeHost,
  removeFakeDocument,
  removeFakeHost,
} from "./test-host.ts";
import { applyTelegramTheme, readableThemeParams } from "./theme.ts";

afterEach(() => {
  removeFakeHost();
  removeFakeDocument();
});

// سمتا تيليجرامَ الافتراضيّتان كما قيسَتا في ADR 0245 (الأربعةُ المواضعُ في PRD-007).
const TG_LIGHT = {
  bg_color: "#ffffff",
  secondary_bg_color: "#efeff3",
  text_color: "#000000",
  hint_color: "#999999",
  link_color: "#2481cc",
  button_color: "#2481cc",
  button_text_color: "#ffffff",
};
const TG_DARK = {
  bg_color: "#17212b",
  secondary_bg_color: "#232e3c",
  text_color: "#f5f5f5",
  hint_color: "#708499",
  link_color: "#6ab3f3",
  button_color: "#5288c1",
  button_text_color: "#ffffff",
};

describe("PRD-007 — قياسُ المشكلةِ قبلَ الحلّ", () => {
  test("الألوانُ الأربعةُ دونَ 4.5:1 فعلًا", () => {
    expect(contrast("#999999", "#ffffff")).toBeLessThan(AA_TEXT_CONTRAST);
    expect(contrast("#2481cc", "#ffffff")).toBeLessThan(AA_TEXT_CONTRAST);
    expect(contrast("#708499", "#17212b")).toBeLessThan(AA_TEXT_CONTRAST);
    expect(contrast("#5288c1", "#ffffff")).toBeLessThan(AA_TEXT_CONTRAST);
  });
});

describe("PRD-007 — الإزاحةُ الدنيا", () => {
  for (const [name, theme] of [
    ["light", TG_LIGHT],
    ["dark", TG_DARK],
  ] as const) {
    test(`${name}: كلُّ لونِ نصٍّ يبلغُ 4.5:1 على الخلفيّتَين، والزرُّ مع نصِّه`, () => {
      const { params } = readableThemeParams(theme);
      for (const key of ["hint_color", "link_color"] as const) {
        for (const bg of [theme.bg_color, theme.secondary_bg_color]) {
          expect(contrast(params[key] as string, bg) as number).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(
        contrast(params.button_color as string, theme.button_text_color) as number,
      ).toBeGreaterThanOrEqual(4.5);
    });
  }

  test("لونٌ مجتازٌ لا يُمسّ، ولا يُخترَعُ لونٌ لمفتاحٍ غائب", () => {
    expect(readableShift("#5b6b7c", ["#ffffff"], "#000000")).toBeNull();
    const { params, adjusted } = readableThemeParams({
      bg_color: "#ffffff",
      text_color: "#000000",
    });
    expect(adjusted).toEqual([]);
    expect(params.hint_color).toBeUndefined();
  });

  test("الإزاحةُ أقلُّ ما يبلغُ العتبة (الخطوةُ السابقةُ لا تبلغُها)", () => {
    const shifted = readableShift("#999999", ["#ffffff"], "#000000") as string;
    expect(contrast(shifted, "#ffffff") as number).toBeGreaterThanOrEqual(4.5);
    expect(contrast(shifted, "#ffffff") as number).toBeLessThan(5.6);
  });

  test("التطبيقُ على المضيف: المتغيّرُ يُكتَبُ مُزاحًا ويُبلَّغُ عنه، وألوانُ الإطارِ كما أُرسلت", () => {
    const doc = installFakeDocument();
    const host = installFakeHost({ themeParams: TG_LIGHT, colorScheme: "light" }, "9.0");
    const report = applyTelegramTheme();
    expect(report.adjusted).toContain("--tg-hint-color");
    expect(report.adjusted).toContain("--tg-button-color");
    expect(doc.variables.get("--tg-hint-color")).not.toBe("#999999");
    expect(
      contrast(doc.variables.get("--tg-hint-color") as string, "#ffffff") as number,
    ).toBeGreaterThanOrEqual(4.5);
    expect(host.calls).toContainEqual({ name: "setBackgroundColor", args: ["#ffffff"] });
  });
});
