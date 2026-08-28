/**
 * الغرض: اختبارُ اتجاهِ المستندِ ولغتِه (البند `F1-06`).
 * الحالة: اختبار — يُشغَّل في `bun test` وفي بوابةِ CI.
 * ينتمي إلى: apps/miniapp/src/styles
 *
 * ما تُثبِته: أن اللغاتَ الثلاثَ المنصوصَ عليها في القسم 9.11 تُترجَم إلى
 * الاتجاهِ الصحيح، وأن الافتراضَ عربيٌّ RTL (UX-3)، وأن غيابَ المستندِ لا يرمي.
 * وما لا تُثبِته: صحةَ التخطيطِ البصريِّ المقلوبِ على شاشةٍ حقيقية — ذلك يُرى
 * بالعينِ ولم يُقَس ههنا.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  APP_LANGUAGES,
  applyDocumentDirection,
  DEFAULT_APP_LANGUAGE,
  directionOf,
  resolveLanguage,
} from "./direction.ts";

/**
 * مستندٌ مُصطنَعٌ محليٌّ: هذا الملفُّ خارجَ `tg/` فلا يستورد أداةَ اختبارِ
 * المضيفِ — حدُّ العزلِ في ADR 0031 §3 يمنع الاستيرادَ العميقَ من الطبقة.
 */
function installRoot(): { lang: string; dir: string } {
  const element = { lang: "", dir: "" };
  (globalThis as unknown as { document?: unknown }).document = { documentElement: element };
  return element;
}

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

describe("ترجمةُ اللغةِ إلى اتجاه", () => {
  test("العربيةُ والأرديةُ RTL والإنجليزيةُ LTR (القسم 9.11)", () => {
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("ur")).toBe("rtl");
    expect(directionOf("en")).toBe("ltr");
  });

  test("اللغاتُ المدعومةُ ثلاثٌ لا رابعةَ يخترعها الكود", () => {
    expect([...APP_LANGUAGES]).toEqual(["ar", "en", "ur"]);
    expect(DEFAULT_APP_LANGUAGE).toBe("ar");
  });

  test("الوسمُ الإقليميُّ يُقرأ بلغتِه الأساسية", () => {
    expect(resolveLanguage("ar-SA")).toBe("ar");
    expect(resolveLanguage("en_US")).toBe("en");
    expect(resolveLanguage("  AR  ")).toBe("ar");
  });

  test("لغةٌ غيرُ مدعومةٍ أو قيمةٌ ليست نصاً تعود إلى الافتراضِ العربيّ", () => {
    expect(resolveLanguage("fr")).toBe("ar");
    expect(resolveLanguage(undefined)).toBe("ar");
    expect(resolveLanguage(null)).toBe("ar");
    expect(resolveLanguage(7)).toBe("ar");
    expect(directionOf("fr")).toBe("rtl");
  });
});

describe("الكتابةُ على جذرِ المستند", () => {
  test("`lang` و`dir` يُضبَطان على `<html>` وحدَه", () => {
    const root = installRoot();

    const result = applyDocumentDirection("en");

    expect(result).toEqual({ language: "en", direction: "ltr", written: true });
    expect(root.lang).toBe("en");
    expect(root.dir).toBe("ltr");
  });

  test("الأرديةُ تُقلَب مثلَ العربية على نفسِ الشاشة", () => {
    const root = installRoot();
    applyDocumentDirection("ur");
    expect(root).toEqual({ lang: "ur", dir: "rtl" });
  });

  test("بلا وسيطٍ يبقى الافتراضُ عربياً RTL (UX-3)", () => {
    const root = installRoot();
    applyDocumentDirection();
    expect(root).toEqual({ lang: "ar", dir: "rtl" });
  });

  test("بلا مستندٍ لا رميَ، والتقريرُ يقول إنه لم يُكتَب", () => {
    delete (globalThis as unknown as { document?: unknown }).document;
    expect(applyDocumentDirection("en")).toEqual({
      language: "en",
      direction: "ltr",
      written: false,
    });
  });
});
