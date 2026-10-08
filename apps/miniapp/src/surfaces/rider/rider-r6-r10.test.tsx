/**
 * الغرض: إثباتُ UI-3 / PR 4 (R6–R10 · ADR 0237): الترقيمُ الكانونيُّ، والسكّةُ وشريطُ الحقيقةِ من القراءةِ
 *   وحدَها، ووصلُ R6/R7/R9/R10 بإطارِ UI-2 برجوعٍ واحدٍ، وR8 وSOS في مواضعِهما.
 * الحالة: منفّذ فعلياً — UI-3 / PR 4.
 *
 * حدٌّ معلَن: لا بيئةَ DOM (لا تبعيّةَ جديدة). يُقاسُ: الدالّاتُ النقيّة، وأوّلُ رسمٍ ساكن، وعقدُ الربطِ
 * ساكناً (الشِّفرةُ بلا تعليقات). ما لا يُقاسُ: نقرٌ حيٌّ ولا قراءةُ خادمٍ حقيقيّةٌ في عميلِ تيليجرام.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MINIAPP_LANGUAGES,
  miniAppDictionary,
  miniAppTranslator,
} from "../../../../../packages/shared/i18n/miniapp/index.ts";
import "../../../../../packages/shared/i18n/miniapp/ar-parts/rider-ride.ts";
import { ActiveRideScreen } from "./active/ActiveRideScreen.tsx";
import { RideJourney } from "./active/RideJourney.tsx";
import {
  activeRideTruth,
  journeyFromActivePhase,
  journeyFromSearchStatus,
  journeyRail,
  RIDE_JOURNEY_LABEL_KEY,
  RIDE_JOURNEY_LABEL_KEYS,
  RIDE_JOURNEY_STAGES,
  RIDE_JOURNEY_STATE_KEYS,
} from "./active/ride-journey.ts";
import { SearchScreen, type SearchScreenIntent } from "./search/SearchScreen.tsx";
import { SosScreen } from "./sos/SosScreen.tsx";
import { RideSummaryScreen } from "./summary/RideSummaryScreen.tsx";

const HERE = new URL(".", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, HERE), "utf8");

function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1");
}

/** الترقيمُ الكانونيُّ من المصدرِ الأصليّ — نصُّ ADR 0237 حرفاً. */
const CANONICAL_R: Readonly<Record<string, string>> = {
  R6: "البحث عن سائق",
  R7: "الرحلة النشطة",
  R8: "مشاركة الرحلة",
  R9: "SOS",
  R10: "ملخص الرحلة والتقييم",
  R11: "سجل الرحلات وتفاصيلها",
  R12: "الإشعارات",
  R13: "حسابي",
  R14: "الخصوصية والشروط",
  R15: "الدعم والتذاكر والمفقودات وFAQ",
};

const ROOT = codeOnly(read("./RiderRoot.tsx"));
const ACTIVE = codeOnly(read("./active/ActiveRideScreen.tsx"));
const SEARCH = codeOnly(read("./search/SearchScreen.tsx"));

/** مقطعُ الفرعِ من شرطِه حتّى `return` الفرعِ التالي — موضعُ الشاشةِ في `RiderRoot`. */
function branch(condition: string): string {
  const start = ROOT.indexOf(condition);
  expect(start, condition).toBeGreaterThan(-1);
  const next = ROOT.indexOf("\n  if (", start + condition.length);
  return ROOT.slice(start, next === -1 ? undefined : next);
}

const INTENT = {
  service: "transport",
  originLat: 24.6,
  originLng: 46.5,
  destinationLat: 24.7,
  destinationLng: 46.6,
  destinationLabel: "Mall",
  idempotencyKey: "k-1",
} as unknown as SearchScreenIntent;
const never = () => new Promise<never>(() => undefined);

describe("ترقيمُ R6–R15 الكانونيّ (ADR 0237)", () => {
  it("R6…R15 متّصلةٌ، وADR 0237 يحملُ الجدولَ حرفاً، وPR 4 = R6–R10", () => {
    expect(Object.keys(CANONICAL_R)).toEqual(Array.from({ length: 10 }, (_, i) => `R${i + 6}`));
    const adr = readFileSync(
      new URL("../../../../../docs/adr/0237-ui-3-pr4-rider-r6-r10.md", HERE),
      "utf8",
    );
    for (const [r, label] of Object.entries(CANONICAL_R))
      expect(adr, r).toContain(`| ${r} | ${label} |`);
  });
});

describe("السكّةُ وشريطُ الحقيقةِ — من القراءةِ وحدَها", () => {
  it("R7: أطوارُ العقدِ الخمسةُ مراحلُ، وما سواها لا سكّةَ له", () => {
    for (const stage of RIDE_JOURNEY_STAGES) expect(journeyFromActivePhase(stage)).toBe(stage);
    expect(journeyFromActivePhase("closed")).toBeNull();
    expect(journeyFromActivePhase("teleported")).toBeNull();
  });

  it("R6: حالةُ الطلبِ ⇒ مرحلة؛ الملغاةُ والمتعذّرةُ والمجهولةُ بلا سكّة", () => {
    expect(journeyFromSearchStatus("searching")).toBe("searching");
    expect(journeyFromSearchStatus("matched")).toBe("driver_assigned");
    expect(journeyFromSearchStatus("in_progress")).toBe("on_trip");
    expect(journeyFromSearchStatus("completed")).toBe("completed");
    for (const s of ["cancelled", "failed", "unknown", ""])
      expect(journeyFromSearchStatus(s)).toBeNull();
  });

  it("خطواتُ السكّة: قبلَ المرحلةِ تمّ، وهيَ الآن، وبعدَها لاحق؛ والانتهاءُ كلُّه تمّ", () => {
    expect(journeyRail("driver_arrived").map((s) => s.state)).toEqual([
      "done",
      "done",
      "current",
      "pending",
      "pending",
    ]);
    expect(journeyRail("searching").filter((s) => s.state === "current")).toHaveLength(1);
    expect(journeyRail("completed").every((s) => s.state === "done")).toBe(true);
  });

  it("شريطُ الحقيقة: نصُّ الطورِ نفسُه، ونغمةٌ من الطور، والمجهولُ بنغمةِ unknown", () => {
    expect(activeRideTruth("searching")).toEqual({
      key: "rider.active.phase.searching",
      tone: "amber",
    });
    expect(activeRideTruth("on_trip")).toEqual({ key: "rider.active.phase.onTrip", tone: "brand" });
    expect(activeRideTruth("completed")).toEqual({
      key: "rider.active.phase.completed",
      tone: "ok",
    });
    expect(activeRideTruth("closed")).toEqual({
      key: "rider.active.phase.closed",
      tone: "unknown",
    });
    expect(activeRideTruth("teleported").tone).toBe("unknown");
  });

  it("المفاتيحُ الجديدةُ في اللغاتِ الثلاث", () => {
    const keys = [
      RIDE_JOURNEY_LABEL_KEY,
      ...Object.values(RIDE_JOURNEY_LABEL_KEYS),
      ...Object.values(RIDE_JOURNEY_STATE_KEYS),
      "rider.ride.activeTitle",
    ];
    for (const language of MINIAPP_LANGUAGES) {
      const dictionary = miniAppDictionary(language);
      for (const key of keys) expect(dictionary[key]?.trim(), `${key} @ ${language}`).toBeTruthy();
    }
  });

  for (const language of MINIAPP_LANGUAGES) {
    it(`RideJourney يرسمُ سكّةً بخمسِ مراحلَ وموضعٍ واحدٍ «الآن» وشريطاً واحداً · ${language}`, () => {
      const t = miniAppTranslator(language);
      const html = renderToStaticMarkup(
        <RideJourney language={language} stage="on_trip" truth={activeRideTruth("on_trip")} />,
      );
      expect(html.match(/class="ui-rail__item /g) ?? []).toHaveLength(5);
      expect(html.match(/aria-current="step"/g) ?? []).toHaveLength(1);
      expect(html).toContain(`aria-label="${t(RIDE_JOURNEY_LABEL_KEY)}"`);
      expect(html.match(/<output class="ui-truth ui-truth--brand"/g) ?? []).toHaveLength(1);
      expect(html).toContain(t("rider.active.phase.onTrip"));
    });
  }

  it("بلا مرحلةٍ ولا شريطٍ لا يُرسَمُ شيء — لا سكّةَ مختلقة", () => {
    expect(renderToStaticMarkup(<RideJourney language="ar" stage={null} truth={null} />)).toBe("");
  });
});

describe("R6–R10 داخلَ إطارِ UI-2 — رجوعٌ واحدٌ ولا عنوانٌ مكرّر", () => {
  it("R6: البحثُ تدفّقٌ برجوعِ الإطار، ولغةٌ موصولة، ومدخلُ SOS", () => {
    const b = branch("if (intent !== null)");
    expect(b).toContain(
      '<ScreenFrame\n        mode="flow"\n        title={t("rider.search.title")}',
    );
    expect(b).toContain('back={{ label: t("rider.search.back"), onBack: leaveSearch }}');
    expect(b).toContain("initialLanguage={language}");
    expect(b).toContain("showTitle={false}");
    expect(b).toContain("onOpenSos={onOpenSos}");
    expect(SEARCH).toContain('journeyFromSearchStatus(view?.status ?? "searching")');
  });

  it("R7: الرحلةُ النشطةُ تدفّقٌ، وفيها السكّةُ والشريطُ وR8 وبطاقةُ SOS", () => {
    const b = branch("if (followed !== null)");
    expect(b).toContain('title={t("rider.ride.activeTitle")}');
    expect(b).toContain('back={{ label: t("rider.search.back"), onBack: leaveActive }}');
    expect(b).toContain("initialLanguage={language}");
    expect(b).toContain("showTitle={false}");
    expect(ACTIVE).toContain("truth={activeRideTruth(view.phase)}");
    expect(ACTIVE).toContain("stage={journeyFromActivePhase(view.phase)}");
    expect(ACTIVE).toContain("<RideShareCard orderId={orderId} language={language} />");
    expect(ACTIVE).toContain("<SosCard language={language} />");
  });

  it("R9: SOS تدفّقٌ أعلى الترتيب، والرجوعُ يُطفِئُ الرايةَ من رأسِ الإطار", () => {
    const b = branch("if (sosOpen)");
    expect(b).toContain('back={{ label: t("rider.sos.back"), onBack: () => setSosOpen(false) }}');
    expect(b).toContain("<SosScreen language={language} showTitle={false} />");
    expect(ROOT.indexOf("if (sosOpen)")).toBeLessThan(ROOT.indexOf("if (support !== null)"));
  });

  it("R10: الملخّصُ تدفّقٌ برجوعِ الإطارِ وحدَه، ومدخلُ SOS والشكوى موصولان", () => {
    const b = branch("if (summarized !== null)");
    expect(b).toContain('back={{ label: t("rider.summary.back"), onBack: leaveSummary }}');
    expect(b).toContain("showBack={false}");
    expect(b).toContain("showTitle={false}");
    expect(b).toContain("onOpenSos={onOpenSos}");
    expect(b).toContain("onReportProblem={() => setSupport({ orderId: summarized })}");
  });

  it("الانتقالاتُ لم تتغيّر: البحثُ ⇒ الرحلة ⇒ الملخّص", () => {
    expect(branch("if (intent !== null)")).toContain(
      "onActiveRide={(orderId) => setFollowed(orderId)}",
    );
    expect(branch("if (followed !== null)")).toContain(
      "onFinished={(orderId) => setSummarized(orderId)}",
    );
  });

  for (const language of MINIAPP_LANGUAGES) {
    it(`أوّلُ رسمٍ داخلَ الإطارِ بلا h1 مكرّرٍ ولا زرِّ رجوعٍ ثانٍ · ${language}`, () => {
      const search = renderToStaticMarkup(
        <SearchScreen
          intent={INTENT}
          initialLanguage={language}
          showTitle={false}
          request={never}
        />,
      );
      const active = renderToStaticMarkup(
        <ActiveRideScreen
          orderId="o-1"
          initialLanguage={language}
          showTitle={false}
          read={never}
        />,
      );
      const summary = renderToStaticMarkup(
        <RideSummaryScreen
          orderId="o-1"
          initialLanguage={language}
          showTitle={false}
          showBack={false}
          read={never}
        />,
      );
      const sos = renderToStaticMarkup(<SosScreen language={language} showTitle={false} />);
      for (const html of [search, active, summary, sos]) {
        expect(html).not.toContain("<h1");
        expect(html).not.toContain("aria-labelledby=");
      }
      expect(sos).not.toContain("sos__back");
      expect(summary).not.toContain("sm__back");
    });
  }

  it("خارجَ الإطارِ يبقى السلوكُ القديم: العنوانُ ظاهر، وزرُّ رجوعِ SOS حينَ يُمرَّر", () => {
    expect(renderToStaticMarkup(<SearchScreen intent={INTENT} request={never} />)).toContain(
      'id="rs-title"',
    );
    expect(renderToStaticMarkup(<ActiveRideScreen orderId="o-1" read={never} />)).toContain(
      'id="ar-title"',
    );
    expect(renderToStaticMarkup(<SosScreen onBack={() => undefined} />)).toContain("sos__back");
  });
});
