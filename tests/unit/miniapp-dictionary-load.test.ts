/**
 * الغرض: إثباتُ عقدِ التحميلِ عندَ الطلبِ (`F1-09` · `D-29` · `ADR 0186`): النواةُ لا تحملُ إلّا
 *   العربيّةَ، ولغةٌ غيرُ مُسجَّلةٍ تُترجَمُ بالافتراضيِّ، و`loadMiniAppLanguage` يُسجِّلُ القاموسَ
 *   الحقيقيَّ مرّةً واحدةً فتصيرُ الترجمةُ بلغتِه.
 * الحالة: اختبار فعلي. يُشغَّلُ في عمليّةٍ منفصلةٍ عن `index.ts` (الذي يُسجِّلُ الكلَّ متزامناً)،
 *   ولذا يفحصُ حالةَ ما قبلَ التحميلِ بشرطٍ لا بافتراضٍ.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import {
  isMiniAppDictionaryLoaded,
  translateMiniApp,
} from "../../packages/shared/i18n/miniapp/core.ts";
import en from "../../packages/shared/i18n/miniapp/en.json" with { type: "json" };
import { loadMiniAppLanguage } from "../../packages/shared/i18n/miniapp/load.ts";

const KEY = "welcome.line1";

describe("loadMiniAppLanguage (D-29)", () => {
  it("العربيّةُ حاضرةٌ بلا تحميلٍ", async () => {
    expect(isMiniAppDictionaryLoaded("ar")).toBe(true);
    await loadMiniAppLanguage("ar");
  });

  it("لغةٌ غيرُ مُسجَّلةٍ تُترجَمُ بالافتراضيِّ، ثمَّ بلغتِها بعدَ التحميلِ", async () => {
    if (!isMiniAppDictionaryLoaded("en")) {
      expect(translateMiniApp("en", KEY)).toBe(translateMiniApp("ar", KEY));
    }
    await Promise.all([loadMiniAppLanguage("en"), loadMiniAppLanguage("en")]);
    expect(isMiniAppDictionaryLoaded("en")).toBe(true);
    expect(translateMiniApp("en", KEY)).toBe((en as Record<string, string>)[KEY] as string);
  });
});
