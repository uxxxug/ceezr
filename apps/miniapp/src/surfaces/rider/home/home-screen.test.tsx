/**
 * الغرض: إثباتُ ما يمكن إثباتُه من شاشةِ `SR-02` بلا متصفّحٍ (البند `F2-02`):
 *   أوّلُ خَرْجٍ يُعلِنُ الانتظارَ · إعلانُ تعذّرِ الخريطةِ لا رسمٌ كاذبٌ · وجودُ
 *   كلِّ مفتاحٍ يُنادى في اللغاتِ الثلاثِ · خلوُّ المكوّنِ من نصٍّ حرفيٍّ عربيٍّ.
 * الحالة: اختبار فعلي — `react-dom/server` + قراءةُ المصدرِ.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/home
 * يُتوقع أن يستخدمه لاحقاً: CI
 *
 * ═══ حدٌّ معلَنٌ في قوّةِ هذا الملفِّ ═══
 * لا بيئةَ DOM في هذا المستودعِ. فالمُثبَتُ ههنا **بنيةُ الخَرْجِ الأوّلِ** وحدَها:
 * لا ضغطَ زرٍّ، ولا أثرٌ (`useEffect`) يعمل، ولا انتقالَ حالةٍ بعدَ ردِّ الخادمِ.
 * وصفوفُ الأماكنِ ومفاتيحُ الأخطاءِ تُثبَتُ في `home-view.test.ts` نقيّةً،
 * والمسارُ على قاعدةٍ حقيقيّةٍ في `tests/integration/me-places.test.ts`.
 * **ولم تُفتَح هذه الشاشةُ من مستخدمٍ حقيقيٍّ بعد**: لا نشرَ حيَّ لهذه الحزمةِ.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MINIAPP_LANGUAGES,
  miniAppDictionary,
  translateMiniApp,
} from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import { HomeScreen } from "./HomeScreen.tsx";

const SOURCE = await Bun.file(new URL("./HomeScreen.tsx", import.meta.url)).text();

/** كلُّ `t("…")` حرفيٍّ في المصدرِ — والمُركَّبةُ تُفحَصُ في `home-view.test.ts`. */
function calledKeys(): readonly string[] {
  return [...SOURCE.matchAll(/\bt\("([^"]+)"\)/g)].map((match) => match[1] as string);
}

const pending = () => new Promise<never>(() => {});

describe("شاشةُ الراكبِ الرئيسةُ — أوّلُ خَرْجٍ", () => {
  it("١) تُعلِنُ الانتظارَ للقارئِ الآليِّ وتعرضُ عنواناً وهيكلاً", () => {
    const markup = renderToStaticMarkup(<HomeScreen loadPlaces={pending} loadRecent={pending} />);
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('id="rh-title"');
    expect(markup).toContain('class="sk"');
    expect(markup).toContain(translateMiniApp("ar", "rider.home.title"));
  });

  it("٢) لا تزعمُ أماكنَ ولا وجهاتٍ قبلَ أن يجيبَ الخادمُ", () => {
    const markup = renderToStaticMarkup(<HomeScreen loadPlaces={pending} loadRecent={pending} />);
    expect(markup).not.toContain(translateMiniApp("ar", "rider.home.places.title"));
    expect(markup).not.toContain("rh__place");
  });

  it("٣) اتجاهُ الإطارِ يُشتَقُّ من اللغةِ لا يُثبَّتُ", () => {
    const arabic = renderToStaticMarkup(
      <HomeScreen initialLanguage="ar" loadPlaces={pending} loadRecent={pending} />,
    );
    const english = renderToStaticMarkup(
      <HomeScreen initialLanguage="en" loadPlaces={pending} loadRecent={pending} />,
    );
    expect(arabic).toContain('dir="rtl"');
    expect(english).toContain('dir="ltr"');
  });

  it("٤) كلُّ مفتاحٍ يُنادى في المكوّنِ موجودٌ في اللغاتِ الثلاثِ", () => {
    const keys = calledKeys();
    expect(keys.length).toBeGreaterThan(5);
    for (const language of MINIAPP_LANGUAGES) {
      const dictionary = miniAppDictionary(language);
      for (const key of keys) {
        expect(dictionary[key], `${key} ناقصٌ في ${language}`).toBeString();
      }
    }
  });

  it("٥) المكوّنُ لا يحملُ نصّاً عربيّاً حرفيّاً: كلُّ حرفٍ من القاموسِ", () => {
    // التعليقاتُ عربيّةٌ عن قصدٍ (وثيقةُ الملفِّ)، فتُنزَعُ قبلَ الفحصِ.
    const withoutComments = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(withoutComments).not.toMatch(/[\u0600-\u06ff]/);
  });

  it("٦) حينَ لا مزوّدَ خرائطَ: يُقالُ الحدُّ ولا يُرسَمُ إطارٌ يُوهِمُ موقعاً", () => {
    const markup = renderToStaticMarkup(
      <HomeScreen
        mapProvider="none"
        loadPlaces={async () => ({ places: [] })}
        loadRecent={async () => ({ destinations: [] })}
      />,
    );
    // أوّلُ خَرْجٍ حالةُ انتظارٍ لأنَّ الأثرَ لا يعملُ في التصييرِ الساكنِ؛ فالمقيسُ
    // ههنا أنَّ المصدرَ يربطُ `map.unavailable` بغيابِ المزوّدِ لا بوجودِه.
    expect(markup).toContain('aria-busy="true"');
    expect(SOURCE).toContain('mapProvider === "none"');
    expect(SOURCE).toContain("rider.home.map.unavailable");
  });
});
