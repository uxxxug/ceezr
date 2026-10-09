/**
 * الغرض: R1 · ADR 0252 — حبّةُ المدينةِ التشغيليّةِ وزرُّ تحديثِ الموقعِ في رئيسةِ الراكب.
 *   لا اختيارَ يدويّاً للمدينة، والنصوصُ في اللغاتِ الثلاث، ونتائجُ الخادمِ الأربعُ لكلٍّ نصُّها.
 * الحالة: منفّذ فعلياً.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MINIAPP_LANGUAGES,
  miniAppDictionary,
} from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import { HomeScreen } from "./HomeScreen.tsx";
import { cityLabel, type LocateOutcome, locateMessageKey } from "./operating-city-api.ts";

const SOURCE = await Bun.file(new URL("./HomeScreen.tsx", import.meta.url)).text();
const API = await Bun.file(new URL("./operating-city-api.ts", import.meta.url)).text();
const pending = () => new Promise<never>(() => {});

const KEYS = [
  "rider.home.city.update",
  "rider.home.city.locating",
  "rider.home.city.changed",
  "rider.home.city.same",
  "rider.home.city.outside",
  "rider.home.city.activeRide",
  "rider.home.city.fixFailed",
  "rider.home.city.updateFailed",
] as const;

describe("R1 — المدينةُ التشغيليّةُ في رئيسةِ الراكب", () => {
  it("١) زرُّ «حدّث موقعي» في سطرِ المدينةِ نفسِه، والحبّةُ مشروطةٌ باسمٍ من الخادم", () => {
    expect(SOURCE).toContain('className="rh__city-update"');
    expect(SOURCE).toContain("onClick={() => void updateCity()}");
    expect(SOURCE).toContain("{shownCity === undefined ? null : (");
    // الرئيسةُ في حالِ التحميلِ كما كانت: هيكلٌ بلا حبّةٍ (لا تُخترَعُ مدينةٌ قبلَ الردّ).
    const markup = renderToStaticMarkup(
      <HomeScreen loadPlaces={pending} loadRecent={pending} loadCity={pending} />,
    );
    expect(markup).not.toContain('class="rh__city"');
  });

  it("٢) الاسمُ المعروضُ من الخادمِ أو من الخاصيّةِ وحدَهما، ونصُّه بجانبِ حالتِه", () => {
    expect(SOURCE).toContain(
      "const shownCity = cityName ?? (city === null ? undefined : cityLabel(city, language));",
    );
    expect(SOURCE).toContain(["{`$", '{t("rider.home.city.status")}: $', "{shownCity}`}"].join(""));
  });

  it("٣) لكلِّ نتيجةٍ من الأربعِ نصٌّ مختلف، والنصوصُ في اللغاتِ الثلاث", () => {
    const outcomes: readonly LocateOutcome[] = [
      "CHANGED",
      "SAME_CITY",
      "OUTSIDE_ACTIVE_CITIES",
      "ACTIVE_RIDE",
    ];
    const keys = outcomes.map(locateMessageKey);
    expect(new Set(keys).size).toBe(4);
    for (const language of MINIAPP_LANGUAGES) {
      const dictionary = miniAppDictionary(language);
      for (const key of [...KEYS, ...keys]) expect(dictionary[key]).toBeString();
    }
  });

  it("٤) الاسمُ بلغةِ العرض، والأرديّةُ تقرأُ العربيَّ (لا اسمَ أرديّاً في الجدول)", () => {
    const city = { code: "MKK", name_ar: "مكة", name_en: "Makkah", is_active: true };
    expect(cityLabel(city, "en")).toBe("Makkah");
    expect(cityLabel(city, "ar")).toBe("مكة");
    expect(cityLabel(city, "ur")).toBe("مكة");
  });

  it("٥) لا اختيارَ يدويّاً: لا قائمةَ مدنٍ ولا رمزَ مدينةٍ يُرسَلُ من العميل", () => {
    expect(SOURCE).not.toContain("<select");
    expect(API).toContain("body: { lat, lng }");
    expect(API).not.toMatch(/city_id|city_code|cityId/);
  });
});
