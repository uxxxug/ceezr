/**
 * الغرض: إثباتُ ما يمكن إثباتُه من شاشةِ الترحيبِ بلا متصفّحٍ (`F2-01`): أوّلُ
 *   خَرْجٍ يُعلِنُ الانتظارَ ويحملُ عنواناً وهيكلاً، وأنَّ كلَّ مفتاحٍ يُنادى في
 *   المكوّنِ موجودٌ في اللغاتِ الثلاثِ، وأنَّ المكوّنَ **لا يحملُ نصّاً حرفيّاً**.
 * الحالة: اختبار فعلي — عرضٌ نصّيٌّ ثابتٌ عبرَ `react-dom/server` + قراءةُ المصدرِ.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/welcome
 * يُتوقع أن يستخدمه لاحقاً: CI
 *
 * ═══ حدٌّ معلَنٌ في قوّةِ هذا الملفِّ ═══
 * لا بيئةَ DOM في هذا المستودعِ (لا `happy-dom` ولا `jsdom` ولا مكتبةَ اختبارِ
 * مكوّناتٍ). فالمُثبَتُ ههنا **بنيةُ الخَرْجِ الأوّلِ** وحدَها: لا ضغطَ زرٍّ، ولا
 * أثرٌ (`useEffect`) يعمل، ولا انتقالُ حالةٍ بعدَ ردِّ الخادمِ، ولا قياسَ مساحةِ
 * لمسٍ. وصفوفُ الموافقاتِ وأخطاؤها تُثبَتُ في `consent-view.test.ts` نقيّةً،
 * وبوّابةُ القاموسِ في `tests/unit/check-consent-documents.test.ts`. وبوّابةُ
 * `F2` نفسُها (رحلةٌ كاملةٌ على جهازٍ حقيقيٍّ مسجَّلةٌ بفيديو) خارجَ الآلةِ كلِّها.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MINIAPP_LANGUAGES,
  miniAppDictionary,
  translateMiniApp,
} from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import { WelcomeScreen } from "./WelcomeScreen.tsx";

const SOURCE = await Bun.file(new URL("./WelcomeScreen.tsx", import.meta.url)).text();

/** كلُّ `t("…")` في المصدرِ — والمفاتيحُ المُركَّبةُ تُفحَصُ بأنفسِها أدناه. */
function calledKeys(): readonly string[] {
  return [...SOURCE.matchAll(/\bt\("([^"]+)"\)/g)].map((m) => m[1] as string);
}

describe("شاشةُ الترحيبِ — أوّلُ خَرْجٍ", () => {
  it("١) تُعلِنُ الانتظارَ للقارئِ الآليِّ وتعرضُ عنواناً وهيكلاً", () => {
    const markup = renderToStaticMarkup(<WelcomeScreen loadStatus={() => new Promise(() => {})} />);
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('id="wc-title"');
    expect(markup).toContain('class="sk"');
    expect(markup).toContain(translateMiniApp("ar", "welcome.title"));
  });

  it("٢) لا تعرضُ زرَّ «ابدأ» ولا أيَّ موافقةٍ قبلَ أن يجيبَ الخادمُ", () => {
    const markup = renderToStaticMarkup(<WelcomeScreen loadStatus={() => new Promise(() => {})} />);
    expect(markup).not.toContain(translateMiniApp("ar", "welcome.start"));
    expect(markup).not.toContain("wc__doc");
  });

  it("٣) اتجاهُ الإطارِ يُشتَقُّ من اللغةِ لا يُثبَّتُ", () => {
    const arabic = renderToStaticMarkup(
      <WelcomeScreen initialLanguage="ar" loadStatus={() => new Promise(() => {})} />,
    );
    const english = renderToStaticMarkup(
      <WelcomeScreen initialLanguage="en" loadStatus={() => new Promise(() => {})} />,
    );
    expect(arabic).toContain('dir="rtl"');
    expect(english).toContain('dir="ltr"');
  });
});

describe("شاشةُ الترحيبِ — النصُّ من القاموسِ وحدَه", () => {
  it("٤) كلُّ مفتاحٍ يُنادى موجودٌ في اللغاتِ الثلاثِ بنصٍّ غيرِ فارغٍ", () => {
    const keys = calledKeys();
    expect(keys.length).toBeGreaterThan(10);
    for (const language of MINIAPP_LANGUAGES) {
      const dictionary = miniAppDictionary(language);
      for (const key of keys) {
        expect(dictionary[key], `${key} @ ${language}`).toBeString();
        expect((dictionary[key] ?? "").length, `${key} @ ${language}`).toBeGreaterThan(0);
      }
    }
  });

  it("٥) مفاتيحُ اللغاتِ المُركَّبةُ موجودةٌ لكلِّ لغةٍ", () => {
    for (const language of MINIAPP_LANGUAGES) {
      const dictionary = miniAppDictionary(language);
      for (const code of MINIAPP_LANGUAGES) {
        expect((dictionary[`welcome.language.${code}`] ?? "").length).toBeGreaterThan(0);
      }
    }
  });

  it("٦) لا حرفَ عربيٍّ ولا أردويٍّ داخلَ المكوّنِ خارجَ التعليقاتِ (9.11)", () => {
    const withoutComments = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const arabicLetters = withoutComments.match(/[\u0600-\u06ff]/g) ?? [];
    expect(arabicLetters).toEqual([]);
  });
});
