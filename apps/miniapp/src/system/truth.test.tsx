/**
 * الغرض: حراسةُ طبقةِ الحقيقةِ والحالة (UI-8 · ADR 0242): الحالاتُ السبع، والعمرُ المقيسُ
 *   مقابلَ المجهول (لا صفرَ بديلاً)، والقديمُ ليس مجهولاً، والمصادرُ ونصوصُها في اللغاتِ
 *   الثلاث، والختمُ في `UiTruth`، وحارسٌ ساكنٌ يمنعُ عودةَ عمرٍ مُصفَّرٍ في الشاشات.
 * الحالة: اختبار وحدة فعلي.
 * ينتمي إلى: apps/miniapp/src/system
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import ar from "../../../../packages/shared/i18n/miniapp/ar.json";
import en from "../../../../packages/shared/i18n/miniapp/en.json";
import ur from "../../../../packages/shared/i18n/miniapp/ur.json";
import { RideJourney } from "../surfaces/rider/active/RideJourney.tsx";
import { activeRideTruth } from "../surfaces/rider/active/ride-journey.ts";
import {
  TRUTH_AGE_UNKNOWN_KEY,
  TRUTH_SOURCE_KEYS,
  TRUTH_STATE_KINDS,
  truthAge,
  truthFreshness,
  truthRole,
} from "./truth.ts";
import { UiTruth } from "./ui/index.tsx";

const HERE = new URL(".", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, HERE), "utf8");
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1");

describe("UI-8 · الحالاتُ السبع", () => {
  it("سبعٌ بأسمائِها في §5 ولا ثامنة", () => {
    expect([...TRUTH_STATE_KINDS]).toEqual([
      "loading",
      "empty",
      "error",
      "refused",
      "unavailable",
      "stale",
      "unknown",
    ]);
  });

  it("الخطأُ والرفضُ يقاطعان، وسائرُها يُخبَر", () => {
    const roles = Object.fromEntries(TRUTH_STATE_KINDS.map((k) => [k, truthRole(k)]));
    expect(roles).toEqual({
      loading: "status",
      empty: "status",
      error: "alert",
      refused: "alert",
      unavailable: "status",
      stale: "status",
      unknown: "status",
    });
  });
});

describe("UI-8 · العمر: مقيسٌ أم مجهول — لا صفرَ للغياب", () => {
  for (const raw of [null, undefined, Number.NaN, -1, -0.5, Number.POSITIVE_INFINITY, "12", {}]) {
    it(`${String(raw)} ⇒ مجهول`, () => {
      expect(truthAge(raw)).toEqual({ kind: "unknown" });
    });
  }

  it("الصفرُ المقيسُ صفرٌ حقيقيّ، والكسرُ يُقتطَع", () => {
    expect(truthAge(0)).toEqual({ kind: "measured", seconds: 0 });
    expect(truthAge(12.9)).toEqual({ kind: "measured", seconds: 12 });
  });

  it("المجهولُ ليس قديماً، والقديمُ عمرٌ مقيسٌ تجاوزَ الحدّ", () => {
    expect(truthFreshness({ kind: "unknown" }, 90)).toBe("unknown");
    expect(truthFreshness(truthAge(90), 90)).toBe("fresh");
    expect(truthFreshness(truthAge(91), 90)).toBe("stale");
  });
});

describe("UI-8 · المصادرُ ونصوصُها", () => {
  const dictionaries = { ar, en, ur } as Record<string, Record<string, string>>;
  const keys = [...Object.values(TRUTH_SOURCE_KEYS), TRUTH_AGE_UNKNOWN_KEY];

  it("كلُّ مفتاحٍ في اللغاتِ الثلاث بنصٍّ غيرِ فارغ، في النواة", () => {
    for (const [lang, dict] of Object.entries(dictionaries)) {
      for (const key of keys) {
        expect({ lang, key, ok: (dict[key] ?? "").trim().length > 0 }).toEqual({
          lang,
          key,
          ok: true,
        });
        expect(key.startsWith("truth.")).toBe(true);
      }
    }
  });

  it("نصُّ العمرِ المجهولِ بلا رقم", () => {
    for (const dict of Object.values(dictionaries)) {
      expect(dict[TRUTH_AGE_UNKNOWN_KEY]).not.toMatch(/[0-9٠-٩]/);
    }
  });
});

describe("UI-8 · الختمُ الأصليّ في ui-truth", () => {
  it("بلا ختمٍ لا يُدَّعى مصدر", () => {
    const html = renderToStaticMarkup(<UiTruth text="x" tone="ok" />);
    expect(html).not.toContain("ui-truth__seal");
  });

  it("الختمُ نصٌّ ظاهرٌ داخلَ المنطقةِ المعلَنة", () => {
    const html = renderToStaticMarkup(<UiTruth text="الرحلة جارية." tone="ok" seal="المصدر: س" />);
    expect(html).toMatch(/^<output class="ui-truth ui-truth--ok">/);
    expect(html).toContain('<small class="ui-truth__seal">المصدر: س</small>');
  });

  it("شريطُ الرحلةِ يُختَمُ بسجلِّ الخادم", () => {
    const html = renderToStaticMarkup(
      <RideJourney language="ar" stage="on_trip" truth={activeRideTruth("on_trip")} />,
    );
    expect(html).toContain(
      `<small class="ui-truth__seal">${ar[TRUTH_SOURCE_KEYS.server_record as keyof typeof ar]}</small>`,
    );
  });

  it("للختمِ قاعدةُ CSS بمقياسِ caption وخصائصَ منطقيّة", () => {
    const css = read("../styles/global.css");
    const rule = css.slice(
      css.indexOf(".ui-truth__seal {"),
      css.indexOf("}", css.indexOf(".ui-truth__seal {")),
    );
    expect(rule).toContain("var(--ui-size-caption)");
    expect(rule).not.toMatch(/left|right|!important/);
  });
});

describe("UI-8 · حارسٌ ساكن: لا عمرَ يمرُّ إلى دالّةِ العرضِ بلا حكمِ truthAge", () => {
  const SCREENS = {
    "../surfaces/rider/active/ActiveRideScreen.tsx": [
      "positionLine(",
      "server_age",
      "routing_engine",
    ],
    "../surfaces/rider/sos/SosCard.tsx": ["incidentAgeText(", "server_age"],
    "../surfaces/rider/share/RideShareCard.tsx": ["previewLine(", "server_age"],
  } as const;

  for (const [path, [formatter, ...sources]] of Object.entries(SCREENS)) {
    it(path, () => {
      const code = codeOnly(read(path));
      expect(code).toContain(formatter);
      expect(code).toContain("truthAge(");
      expect(code).toContain("TRUTH_AGE_UNKNOWN_KEY");
      for (const source of sources) expect(code).toContain(`TRUTH_SOURCE_KEYS.${source}`);
      expect(code).not.toContain("setInterval");
    });
  }

  it("كلُّ شاشةٍ تستدعي منسِّقَ عمرٍ من دوالِّ العرضِ مسجَّلةٌ أعلاه", () => {
    const surfaces = new URL("../surfaces/", HERE);
    const glob = new Bun.Glob("**/*.tsx");
    const callers: string[] = [];
    for (const file of glob.scanSync(surfaces.pathname)) {
      if (file.includes(".test.")) continue;
      const code = codeOnly(readFileSync(new URL(file, surfaces), "utf8"));
      if (/\b(positionLine|incidentAgeText|previewLine)\(/.test(code)) callers.push(file);
    }
    expect(callers.sort()).toEqual([
      "rider/active/ActiveRideScreen.tsx",
      "rider/share/RideShareCard.tsx",
      "rider/sos/SosCard.tsx",
    ]);
  });
});
