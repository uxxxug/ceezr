/**
 * الغرض: ربطُ تدفّقِ R0–R5 بمكدّسِ UI-2: الوجهةُ ← الاقتباسُ ← الرجوعُ،
 *   والتبويباتُ الجذريّةُ والحركةُ المنطقيّةُ.
 * الحالة: اختباراتُ المخفِّضِ النقيِّ + عقودُ وصلٍ ساكنةٌ؛ لا بيئةَ DOM تفاعليّةً.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MINIAPP_LANGUAGES,
  miniAppDictionary,
  miniAppTranslator,
} from "../../../../../packages/shared/i18n/miniapp/index.ts";
import { ROOT_TABS } from "../../shell/root-tabs.ts";
import { RootTabBar, ScreenTransition } from "../../shell/ScreenFrame.tsx";
import { currentScreen, initialScreenStack, screenStackReducer } from "../../shell/screen-stack.ts";
import { DestinationScreen } from "./destination/DestinationScreen.tsx";
import { HomeScreen } from "./home/HomeScreen.tsx";
import { QuoteScreen } from "./quote/QuoteScreen.tsx";

const SOURCE = readFileSync(new URL("./RiderRoot.tsx", import.meta.url), "utf8");

describe("RiderRoot — تدفّقُ الوجهةِ والاقتباسِ", () => {
  it("اختيارُ الوجهةِ يدفعُ destination؛ وتصديقُها يدفعُ quote بحركةِ forward", () => {
    const root = initialScreenStack<
      "home" | "rides" | "support" | "account",
      "destination" | "quote"
    >("home");
    const destination = screenStackReducer(root, {
      type: "push",
      screen: "destination",
    });
    expect(currentScreen(destination)).toBe("destination");
    expect(destination.motion).toBe("forward");
    expect(SOURCE).toContain('stack.push("destination")');
    expect(SOURCE).toContain('stack.push("quote")');
  });

  it("الرجوعُ من الاقتباسِ يعيدُ الوجهةَ، ومن الوجهةِ يعيدُ جذرَ الرئيسيةِ", () => {
    const root = initialScreenStack<
      "home" | "rides" | "support" | "account",
      "destination" | "quote"
    >("home");
    const destination = screenStackReducer(root, { type: "push", screen: "destination" });
    const quote = screenStackReducer(destination, { type: "push", screen: "quote" });
    const backToDestination = screenStackReducer(quote, { type: "pop" });
    expect(currentScreen(backToDestination)).toBe("destination");
    expect(backToDestination.motion).toBe("back");

    const backToHome = screenStackReducer(backToDestination, { type: "pop" });
    expect(currentScreen(backToHome)).toBeNull();
    expect(backToHome.tab).toBe("home");
    expect(backToHome.motion).toBe("back");
    expect(SOURCE.match(/onBack: stack\.pop/g)?.length).toBe(2);
  });

  it("R6 يبدأُ بعدَ إفراغِ المكدّسِ، وتبقى النيّةُ في مسارِ useState القائمِ", () => {
    expect(SOURCE).toContain("stack.reset()");
    expect(SOURCE).toContain("setIntent(picked)");
    expect(SOURCE).toContain("if (intent !== null)");
  });

  it("ScreenTransition يتلقّى المفتاحَ والحركةَ من المكدّس", () => {
    expect(
      SOURCE.match(
        /<ScreenTransition screenKey=\{stack\.currentKey\} motion=\{stack\.state\.motion\}>/g,
      ),
    ).toHaveLength(3);
    const forward = renderToStaticMarkup(
      <ScreenTransition screenKey="s1" motion="forward">
        <p>destination</p>
      </ScreenTransition>,
    );
    const back = renderToStaticMarkup(
      <ScreenTransition screenKey="tab:home" motion="back">
        <p>home</p>
      </ScreenTransition>,
    );
    expect(forward).toContain("app-frame__screen--forward");
    expect(back).toContain("app-frame__screen--back");
  });
});

describe("RiderRoot — تبويباتُ الجذرِ", () => {
  const t = miniAppTranslator("en");
  const labels = {
    home: t("rider.tabs.home"),
    rides: t("rider.tabs.rides"),
    support: t("rider.tabs.support"),
    account: t("rider.tabs.account"),
  };

  it("يُخرِجُ أربعَ علاماتٍ بوسومِ القاموسِ ومعلمِ تنقّلٍ دلاليٍّ", () => {
    expect(ROOT_TABS.rider).toEqual(["home", "rides", "support", "account"]);
    const html = renderToStaticMarkup(
      <RootTabBar
        surface="rider"
        label={t("rider.tabs.navigation")}
        labels={labels}
        active="home"
        onSelect={() => undefined}
      />,
    );
    expect(html).toContain('<nav class="app-frame__tabs" aria-label="Main navigation">');
    expect(html.match(/<button type="button"/g)).toHaveLength(4);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain(">Home<");
    expect(html).toContain(">My rides<");
    expect(html).toContain(">Support<");
    expect(html).toContain(">Account<");
  });

  it("الإطارُ يملكُ العنوانَ والرجوعَ؛ الشاشاتُ لا تكرّرُ H1 ولا ترسمُ رجوعاً بلا فعل", () => {
    const home = renderToStaticMarkup(
      <HomeScreen
        showTitle={false}
        loadPlaces={() => new Promise(() => {})}
        loadRecent={() => new Promise(() => {})}
      />,
    );
    const destination = renderToStaticMarkup(<DestinationScreen showTitle={false} />);
    const quote = renderToStaticMarkup(
      <QuoteScreen showTitle={false} destination={{ label: "Destination", lat: 24, lng: 46 }} />,
    );
    expect(home).not.toContain('id="rh-title"');
    expect(destination).not.toContain('id="rd-title"');
    expect(destination).not.toContain("rd__back");
    expect(quote).not.toContain('id="qt-title"');
    expect(quote).not.toContain("qt__back");
    expect(SOURCE).toContain('back={{ label: t("rider.destination.back"), onBack: stack.pop }}');
    expect(SOURCE).toContain('back={{ label: t("rider.quote.back"), onBack: stack.pop }}');
  });

  it("اختيارُ rides/support/account يصلُ إلى وجهته القائمةِ ولا يضيفُ فعلًا وهميّاً", () => {
    expect(SOURCE).toContain('case "rides":');
    expect(SOURCE).toContain("onOpenHistory();");
    expect(SOURCE).toContain('case "support":');
    expect(SOURCE).toContain("onOpenSupport();");
    expect(SOURCE).toContain('case "account":');
    expect(SOURCE).toContain("onOpenAccount();");
    expect(SOURCE).toContain("setSupport({ orderId: null })");
    expect(SOURCE).toContain("setAccount(true)");
  });

  it("وسومُ التبويبِ واسمُ معلمِ التنقّلِ موجودةٌ في اللغاتِ الثلاثِ", () => {
    for (const language of MINIAPP_LANGUAGES) {
      const dictionary = miniAppDictionary(language);
      for (const key of [
        "rider.tabs.account",
        "rider.tabs.home",
        "rider.tabs.navigation",
        "rider.tabs.rides",
        "rider.tabs.support",
        "rider.quote.services.empty",
      ]) {
        expect(dictionary[key], `${key} @ ${language}`).toBeString();
        expect(dictionary[key]?.trim()).not.toBe("");
      }
    }
  });
});
