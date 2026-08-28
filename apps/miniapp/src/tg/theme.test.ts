/**
 * الغرض: اختبارُ طبقةِ السمة (البند `F1-06`) أمامَ مضيفٍ مُصطنَع.
 * الحالة: اختبار — يُشغَّل في `bun test` وفي بوابةِ CI.
 * ينتمي إلى: apps/miniapp/src/tg
 *
 * ما تُثبِته هذه الاختبارات: أن الطبقةَ تكتب متغيّراتَ CSS من `ThemeParams`،
 * وتحترم أدنى الإصداراتِ في القسم 4.4 وتصحيحِه `ت-6`، وتربط `safeAreaInset`،
 * وتُعيد التطبيقَ عندَ تغيّرِ السمة، ولا ترمي خارجَ تيليجرامَ ولا عندَ نقصِ
 * المفاتيح، ولا تلمس `initData`.
 * وما لا تُثبِته: سلوكَ عميلِ تيليجرامَ الحقيقيِّ على جهازٍ حقيقيّ — المضيفُ
 * ههنا مُصطنَعٌ، والمُتحقَّقُ منه هو التشغيلُ لا مصداقيةُ المدخل. ذلك يبقى
 * غيرَ مَقيسٍ على جهاز.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  installFakeDocument,
  installFakeHost,
  removeFakeDocument,
  removeFakeHost,
} from "./test-host.ts";
import {
  applyTelegramSafeArea,
  applyTelegramTheme,
  bindTelegramTheme,
  TG_COLOR_SCHEME_VARIABLE,
  TG_SAFE_AREA_CSS_VARIABLES,
  TG_THEME_CSS_VARIABLES,
} from "./theme.ts";

afterEach(() => {
  removeFakeHost();
  removeFakeDocument();
});

const FULL_THEME = {
  bg_color: "#101010",
  text_color: "#f0f0f0",
  hint_color: "#909090",
  link_color: "#3399ff",
  button_color: "#2288ee",
  button_text_color: "#ffffff",
  secondary_bg_color: "#202020",
  header_bg_color: "#111111",
  bottom_bar_bg_color: "#121212",
  accent_text_color: "#44aaff",
  section_bg_color: "#181818",
  section_header_text_color: "#8899aa",
  section_separator_color: "#333333",
  subtitle_text_color: "#778899",
  destructive_text_color: "#ff5555",
};

describe("ThemeParams موجودة بالكامل", () => {
  test("كلُّ مفتاحٍ يصير متغيّرَ CSS، ونمطُ الألوانِ يُكتَب معها", () => {
    const doc = installFakeDocument();
    installFakeHost({ themeParams: FULL_THEME, colorScheme: "dark" }, "9.0");

    const report = applyTelegramTheme();

    expect(report.insideHost).toBe(true);
    expect(report.colorScheme).toBe("dark");
    expect(report.rejected).toEqual([]);
    for (const variable of TG_THEME_CSS_VARIABLES) {
      expect(report.applied).toContain(variable);
      expect(doc.variables.get(variable)).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(doc.variables.get("--tg-bg-color")).toBe("#101010");
    expect(doc.variables.get("--tg-section-separator-color")).toBe("#333333");
    expect(doc.variables.get(TG_COLOR_SCHEME_VARIABLE)).toBe("dark");
  });

  test("ألوانُ إطارِ المضيفِ الثلاثةُ تُرسَل بقيمِها على عميلٍ حديث", () => {
    installFakeDocument();
    const host = installFakeHost({ themeParams: FULL_THEME }, "9.0");

    const report = applyTelegramTheme();

    expect(report.header.ok).toBe(true);
    expect(report.background.ok).toBe(true);
    expect(report.bottomBar.ok).toBe(true);
    expect(host.calls).toContainEqual({ name: "setHeaderColor", args: ["#111111"] });
    expect(host.calls).toContainEqual({ name: "setBackgroundColor", args: ["#101010"] });
    expect(host.calls).toContainEqual({ name: "setBottomBarColor", args: ["#121212"] });
  });
});

describe("أدنى الإصداراتِ كما في تصحيح ت-6", () => {
  test("6.0: متغيّراتُ CSS تُكتَب، ولا استدعاءَ لونٍ للمضيفِ إطلاقاً", () => {
    const doc = installFakeDocument();
    const host = installFakeHost({ themeParams: FULL_THEME }, "6.0");

    const report = applyTelegramTheme();

    expect(doc.variables.get("--tg-bg-color")).toBe("#101010");
    expect(host.names()).not.toContain("setHeaderColor");
    expect(host.names()).not.toContain("setBackgroundColor");
    expect(host.names()).not.toContain("setBottomBarColor");
    expect(report.header.ok === false ? report.header.reason : "").toBe("unsupported-version");
    expect(report.bottomBar.ok === false ? report.bottomBar.reason : "").toBe(
      "unsupported-version",
    );
  });

  test("6.1: الرأسُ يُلوَّن بالكلمةِ لا بقيمةٍ لا يقبلُها العميلُ قبلَ 6.9", () => {
    installFakeDocument();
    const host = installFakeHost({ themeParams: FULL_THEME }, "6.1");

    const report = applyTelegramTheme();

    expect(report.header.ok).toBe(true);
    expect(host.calls).toContainEqual({ name: "setHeaderColor", args: ["bg_color"] });
    expect(host.names()).not.toContain("setBottomBarColor");
  });

  test("7.0 ليس إصدارَ الشريطِ السفليّ — 7.10 هو (ت-6)", () => {
    installFakeDocument();
    const host = installFakeHost({ themeParams: FULL_THEME }, "7.0");

    const report = applyTelegramTheme();

    expect(host.names()).toContain("setHeaderColor");
    expect(host.names()).not.toContain("setBottomBarColor");
    expect(report.bottomBar.ok === false ? report.bottomBar.reason : "").toBe(
      "unsupported-version",
    );
  });

  test("عضوٌ غائبٌ على عميلٍ حديثٍ يُبلَّغ عنه `missing-api` لا يُفترَض", () => {
    installFakeDocument();
    installFakeHost({ themeParams: FULL_THEME, setBottomBarColor: undefined }, "9.0");

    const report = applyTelegramTheme();

    expect(report.bottomBar.ok === false ? report.bottomBar.reason : "").toBe("missing-api");
  });
});

describe("ThemeParams ناقصةٌ أو فاسدة", () => {
  test("المفتاحُ الغائبُ لا يُكتَب ولا يُخترَع له لون", () => {
    const doc = installFakeDocument();
    installFakeHost({ themeParams: { bg_color: "#101010" } }, "9.0");

    const report = applyTelegramTheme();

    expect(report.applied).toContain("--tg-bg-color");
    expect(report.applied).not.toContain("--tg-text-color");
    expect(doc.variables.has("--tg-text-color")).toBe(false);
    expect(report.rejected).toEqual([]);
  });

  test("`themeParams` غيرُ كائنٍ لا يرمي ولا يكتب لوناً", () => {
    const doc = installFakeDocument();
    installFakeHost({ themeParams: "dark" }, "9.0");

    const report = applyTelegramTheme();

    expect(report.insideHost).toBe(true);
    for (const variable of TG_THEME_CSS_VARIABLES) {
      expect(doc.variables.has(variable)).toBe(false);
    }
    /** بلا قيمةٍ مقبولةٍ تُرسَل الكلمةُ إلى المضيف، فيبقى الإطارُ متّسقاً مع سمتِه. */
    expect(report.header.ok).toBe(true);
  });

  test("قيمةٌ غيرُ لونٍ ست عشريٍّ تُرفَض ولا تُكتَب في خاصيةِ نمط", () => {
    const doc = installFakeDocument();
    installFakeHost(
      {
        themeParams: {
          bg_color: "red; } body { display: none",
          text_color: "url(https://example.com/x.png)",
          hint_color: "",
          link_color: 12,
          button_color: "#abc",
        },
      },
      "9.0",
    );

    const report = applyTelegramTheme();

    expect(doc.variables.has("--tg-bg-color")).toBe(false);
    expect(doc.variables.has("--tg-text-color")).toBe(false);
    expect(doc.variables.has("--tg-hint-color")).toBe(false);
    expect(doc.variables.has("--tg-link-color")).toBe(false);
    /** الاختصارُ الثلاثيُّ لونٌ صحيحٌ في CSS فيُقبَل في المتغيّر. */
    expect(doc.variables.get("--tg-button-color")).toBe("#abc");
    expect(report.rejected).toContain("--tg-bg-color");
    expect(report.rejected).toContain("--tg-text-color");
    expect(report.rejected).toContain("--tg-link-color");
  });

  test("الاختصارُ الثلاثيُّ لا يُرسَل إلى المضيفِ لأن الموثَّقَ `#RRGGBB`", () => {
    installFakeDocument();
    const host = installFakeHost({ themeParams: { bg_color: "#abc" } }, "9.0");

    applyTelegramTheme();

    expect(host.calls).toContainEqual({ name: "setBackgroundColor", args: ["bg_color"] });
  });
});

describe("التشغيلُ خارجَ تيليجرام", () => {
  test("لا مضيفَ: لا كتابةَ ولا رمي، والتقريرُ يقول `no-telegram`", () => {
    const doc = installFakeDocument();
    removeFakeHost();

    const report = applyTelegramTheme();

    expect(report.insideHost).toBe(false);
    expect(report.applied).toEqual([]);
    expect(doc.variables.size).toBe(0);
    expect(report.header.ok === false ? report.header.reason : "").toBe("no-telegram");
    expect(report.background.ok === false ? report.background.reason : "").toBe("no-telegram");
    expect(report.bottomBar.ok === false ? report.bottomBar.reason : "").toBe("no-telegram");
  });

  test("لا مستندَ ولا مضيف: التقريرُ يعود ولا شيءَ يُرمى", () => {
    removeFakeHost();
    removeFakeDocument();
    expect(() => applyTelegramTheme()).not.toThrow();
    expect(() => applyTelegramSafeArea()).not.toThrow();
    const detach = bindTelegramTheme();
    expect(() => {
      detach();
      detach();
    }).not.toThrow();
  });

  test("مضيفٌ بلا مستند: القراءةُ تنجح والكتابةُ لا تحدث", () => {
    removeFakeDocument();
    installFakeHost({ themeParams: FULL_THEME }, "9.0");

    const report = applyTelegramTheme();

    expect(report.insideHost).toBe(true);
    expect(report.applied).toEqual([]);
    expect(report.header.ok).toBe(true);
  });
});

describe("safeAreaInset", () => {
  test("8.0: الحواشيُ الجهازيةُ والمحتوى تُكتَبان بالبكسل", () => {
    const doc = installFakeDocument();
    installFakeHost(
      {
        safeAreaInset: { top: 44, bottom: 34, left: 0, right: 0 },
        contentSafeAreaInset: { top: 56, bottom: 0, left: 0, right: 0 },
      },
      "8.0",
    );

    const report = applyTelegramSafeArea();

    expect(doc.variables.get("--tg-safe-area-top")).toBe("44px");
    expect(doc.variables.get("--tg-safe-area-bottom")).toBe("34px");
    expect(doc.variables.get("--tg-content-safe-area-top")).toBe("56px");
    for (const variable of TG_SAFE_AREA_CSS_VARIABLES) {
      expect(report.applied).toContain(variable);
    }
  });

  test("قيمٌ سالبةٌ أو كسريةٌ تُقصَر وتُدوَّر", () => {
    const doc = installFakeDocument();
    installFakeHost(
      {
        safeAreaInset: { top: 12.4, bottom: -8, left: 0.6, right: 0 },
        contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      "8.0",
    );

    applyTelegramSafeArea();

    expect(doc.variables.get("--tg-safe-area-top")).toBe("12px");
    expect(doc.variables.get("--tg-safe-area-bottom")).toBe("0px");
    expect(doc.variables.get("--tg-safe-area-left")).toBe("1px");
  });

  test("7.10: لا حواشيَ تُكتَب فيبقى `env()` هو المصدر", () => {
    const doc = installFakeDocument();
    installFakeHost({}, "7.10");

    const report = applyTelegramSafeArea();

    expect(report.applied).toEqual([]);
    expect(doc.variables.size).toBe(0);
    expect(report.safeArea.ok === false ? report.safeArea.reason : "").toBe("unsupported-version");
  });

  test("خارجَ تيليجرام: لا حواشيَ ولا رمي", () => {
    const doc = installFakeDocument();
    removeFakeHost();

    const report = applyTelegramSafeArea();

    expect(report.applied).toEqual([]);
    expect(doc.variables.size).toBe(0);
    expect(report.contentSafeArea.ok === false ? report.contentSafeArea.reason : "").toBe(
      "no-telegram",
    );
  });
});

describe("الربطُ بأحداثِ المضيف", () => {
  test("`themeChanged` يُعيد تطبيقَ السمةِ بقيمِها الجديدة", () => {
    const doc = installFakeDocument();
    const host = installFakeHost({ themeParams: { bg_color: "#101010" } }, "9.0");

    const detach = bindTelegramTheme();
    expect(doc.variables.get("--tg-bg-color")).toBe("#101010");

    (host.webApp as unknown as { themeParams: Record<string, string> }).themeParams = {
      bg_color: "#f5f5f5",
    };
    (host.webApp as unknown as { colorScheme: string }).colorScheme = "light";
    host.emit("themeChanged");

    expect(doc.variables.get("--tg-bg-color")).toBe("#f5f5f5");
    detach();
  });

  test("`safeAreaChanged` و`contentSafeAreaChanged` و`fullscreenChanged` تُعيد قراءةَ الحواشي", () => {
    const doc = installFakeDocument();
    const host = installFakeHost(
      {
        safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
        contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      "8.0",
    );

    const detach = bindTelegramTheme();
    expect(doc.variables.get("--tg-safe-area-top")).toBe("0px");

    (host.webApp as unknown as { safeAreaInset: Record<string, number> }).safeAreaInset = {
      top: 59,
      bottom: 0,
      left: 0,
      right: 0,
    };
    host.emit("safeAreaChanged");
    expect(doc.variables.get("--tg-safe-area-top")).toBe("59px");

    (
      host.webApp as unknown as { contentSafeAreaInset: Record<string, number> }
    ).contentSafeAreaInset = {
      top: 46,
      bottom: 0,
      left: 0,
      right: 0,
    };
    host.emit("contentSafeAreaChanged");
    expect(doc.variables.get("--tg-content-safe-area-top")).toBe("46px");

    (host.webApp as unknown as { safeAreaInset: Record<string, number> }).safeAreaInset = {
      top: 77,
      bottom: 0,
      left: 0,
      right: 0,
    };
    host.emit("fullscreenChanged");
    expect(doc.variables.get("--tg-safe-area-top")).toBe("77px");

    detach();
  });

  test("فكُّ الارتباطِ يوقف إعادةَ التطبيق، ونداؤه مرتين آمن", () => {
    const doc = installFakeDocument();
    const host = installFakeHost({ themeParams: { bg_color: "#101010" } }, "9.0");

    const detach = bindTelegramTheme();
    detach();
    detach();

    (host.webApp as unknown as { themeParams: Record<string, string> }).themeParams = {
      bg_color: "#f5f5f5",
    };
    host.emit("themeChanged");

    expect(doc.variables.get("--tg-bg-color")).toBe("#101010");
    expect(host.names().filter((name) => name === "offEvent")).toHaveLength(4);
  });
});

describe("السمةُ ليست مصدرَ هويةٍ ولا حالةَ عمل", () => {
  test("تطبيقُ السمةِ لا يلمس بيانَ الاعتمادِ ولا دورةَ الحياة", () => {
    installFakeDocument();
    const host = installFakeHost({ themeParams: FULL_THEME }, "9.0");

    let credentialRead = false;
    Object.defineProperty(host.webApp, "initData", {
      configurable: true,
      get: () => {
        credentialRead = true;
        return "";
      },
    });

    const report = applyTelegramTheme();
    applyTelegramSafeArea();

    expect(credentialRead).toBe(false);
    expect(host.names()).not.toContain("ready");
    expect(host.names()).not.toContain("expand");
    /** ولا يخرج من التقريرِ اسمُ مفتاحٍ من مفاتيحِ تيليجرامَ بصيغتِها. */
    expect(JSON.stringify(report)).not.toContain('bg_color":');
  });
});

describe("القيمُ الافتراضيةُ معلنةٌ في مكانٍ واحد", () => {
  const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");

  test("لكلِّ متغيّرِ سمةٍ افتراضٌ في `styles/global.css`", () => {
    for (const variable of TG_THEME_CSS_VARIABLES) {
      expect(css).toContain(`${variable}: #`);
    }
  });

  test("لكلِّ متغيّرِ حاشيةٍ افتراضٌ صفريٌّ، و`env()` هو المصدرُ البديل", () => {
    for (const variable of TG_SAFE_AREA_CSS_VARIABLES) {
      expect(css).toContain(`${variable}: 0px`);
    }
    expect(css).toContain("env(safe-area-inset-top, 0px)");
    expect(css).toContain("env(safe-area-inset-bottom, 0px)");
    expect(css).toContain("env(safe-area-inset-left, 0px)");
    expect(css).toContain("env(safe-area-inset-right, 0px)");
  });

  test("نمطُ الألوانِ يقوده متغيّرُ السمةِ بافتراضٍ مزدوج", () => {
    expect(css).toContain(`color-scheme: var(${TG_COLOR_SCHEME_VARIABLE}, light dark)`);
  });

  test("لا اتجاهَ مثبَّتٌ في `body` فتبقى الإنجليزيةُ LTR", () => {
    expect(css).not.toContain("direction: rtl");
  });
});
