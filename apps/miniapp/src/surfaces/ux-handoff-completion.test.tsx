/**
 * الغرض: إثباتُ إغلاقِ فجواتِ لوحاتِ التسليمِ `wasla-ux-handoff-ar.zip` المثبتةِ في
 *   `docs/ux/UX-HANDOFF-COVERAGE-MATRIX.md` (ADR 0249): R4 · R5→R6/R7 · R13 · R15 · R0 · D3 · D5.
 * الحالة: منفّذ فعلياً.
 *
 * حدٌّ معلَن: لا بيئةَ DOM (لا تبعيّةَ جديدة). يُقاسُ: الدالّاتُ النقيّة، وأوّلُ رسمٍ ساكن، وعقدُ الربطِ
 * ساكناً (الشِّفرةُ بلا تعليقات). ما لا يُقاسُ هنا: نقرٌ حيٌّ في عميلِ تيليجرام — اللقطاتُ في المصفوفةِ تغطّيه محلّيّاً.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MINIAPP_LANGUAGES,
  miniAppDictionary,
  miniAppTranslator,
} from "../../../../packages/shared/i18n/miniapp/index.ts";
import "../../../../packages/shared/i18n/miniapp/ar-parts/rider-ride.ts";
import "../../../../packages/shared/i18n/miniapp/ar-parts/support.ts";
import "../../../../packages/shared/i18n/miniapp/ar-parts/account.ts";
import "../../../../packages/shared/i18n/miniapp/ar-parts/onboarding.ts";
import "../../../../packages/shared/i18n/miniapp/ar-parts/driver.ts";
import { windowBoundText } from "./driver/activity/activity-view.ts";
import { riderLanguageText, stampAgeMinutes } from "./driver/job/job-view.ts";
import { FaqScreen } from "./rider/faq/FaqScreen.tsx";
import { SearchScreen, type SearchScreenIntent } from "./rider/search/SearchScreen.tsx";

const HERE = new URL(".", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, HERE), "utf8");
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1");
}

const ROOT = codeOnly(read("./rider/RiderRoot.tsx"));
const ACTIVE = codeOnly(read("./rider/active/ActiveRideScreen.tsx"));
const SHARE = codeOnly(read("./rider/share/RideShareCard.tsx"));
const ACCOUNT = codeOnly(read("./rider/account/AccountScreen.tsx"));
const JOB = codeOnly(read("./driver/job/JobScreen.tsx"));
const ACTIVITY = codeOnly(read("./driver/activity/ActivityScreen.tsx"));

const never = () => new Promise<never>(() => undefined);
const INTENT = {
  service: "transport",
  originLat: 24.6,
  originLng: 46.5,
  destinationLat: 24.7,
  destinationLng: 46.6,
  destinationLabel: "حي الروضة",
  idempotencyKey: "k-1",
} as unknown as SearchScreenIntent;

describe("D3 · أعمارُ أختامِ المَهمّةِ من لحظةِ الخادم (لا ISO خامّ)", () => {
  const server = "2026-10-09T11:00:00.000Z";
  it("دقائقُ كاملةٌ من لحظةِ الخادم", () => {
    expect(stampAgeMinutes("2026-10-09T10:50:30.000Z", server)).toBe(9);
    expect(stampAgeMinutes("2026-10-09T10:59:31.000Z", server)).toBe(0);
  });
  it("ختمٌ بعدَ لحظةِ الخادمِ أو معطوبٌ = لا عمر (لا صفرَ مختلَق)", () => {
    expect(stampAgeMinutes("2026-10-09T11:00:01.000Z", server)).toBeNull();
    expect(stampAgeMinutes("not-a-date", server)).toBeNull();
    expect(stampAgeMinutes("2026-10-09T10:00:00.000Z", "garbage")).toBeNull();
  });
  it("الشاشةُ تمرِّرُ لحظةَ الخادمِ ولا تعرضُ القيمةَ الخامّ", () => {
    expect(JOB).toContain("serverTime: response.server_time");
    expect(JOB).toContain("stampAgeMinutes(value, serverTime)");
    expect(JOB).not.toContain('{value ?? t("driver.job.stamp.none")}');
  });
});

describe("D5 · حدودُ النافذةِ بمنطقتِها المُعلَنةِ", () => {
  it("منتصفُ الليلِ بتوقيتِ الرياضِ لا UTC", () => {
    expect(windowBoundText("2026-10-08T21:00:00.000Z", "Asia/Riyadh")).toBe("2026/10/09 00:00");
    expect(windowBoundText("2026-10-09T21:00:00.000Z", "Asia/Riyadh")).toBe("2026/10/10 00:00");
  });
  it("حدٌّ معطوبٌ أو منطقةٌ مجهولةٌ يُعرَضُ كما وردَ — لا تخمينَ منطقةٍ", () => {
    expect(windowBoundText("garbage", "Asia/Riyadh")).toBe("garbage");
    expect(windowBoundText("2026-10-08T21:00:00.000Z", "Not/AZone")).toBe(
      "2026-10-08T21:00:00.000Z",
    );
  });
  it("الشاشةُ تستعملُها للحدَّين", () => {
    expect(ACTIVITY).toContain("windowBoundText(summary.from, summary.timezone)");
    expect(ACTIVITY).toContain("windowBoundText(summary.to, summary.timezone)");
  });
});

describe("R5 → R6/R7 · المشاركةُ والمساعدةُ شاشتانِ يفتحُهما صفُّ أزرار", () => {
  it("الرحلةُ النشطةُ ترسمُ الصفَّ بمستقبِلَيه، والبطاقتانِ المدمجتانِ للمُركِّبِ الذي لا يمرِّرُهما", () => {
    expect(ACTIVE).toContain(
      "{onOpenShare === undefined && <RideShareCard orderId={orderId} language={language} />}",
    );
    expect(ACTIVE).toContain("{onOpenHelp === undefined && <SosCard language={language} />}");
    expect(ACTIVE).toContain('className="ar__open-share" onClick={() => onOpenShare()}');
    expect(ACTIVE).toContain('className="ar__open-help" onClick={() => onOpenHelp()}');
  });
  it("المُركِّبُ يصلُ الزرَّينِ بشاشتَين حقيقيّتَين، والرجوعُ يُعيدُ الرحلةَ نفسَها", () => {
    expect(ROOT).toContain("onOpenShare={() => setShareOpen(true)}");
    expect(ROOT).toContain("onOpenHelp={onOpenSos}");
    const share = ROOT.slice(ROOT.indexOf("if (followed !== null && shareOpen)"));
    expect(share).toContain('title={t("rider.frame.share")}');
    expect(share).toContain("onBack: () => setShareOpen(false)");
    expect(share).toContain("<RideShareCard orderId={followed} language={language} standalone />");
    expect(ROOT.indexOf("if (followed !== null && shareOpen)")).toBeLessThan(
      ROOT.indexOf("if (followed !== null) {"),
    );
  });
  it("شاشةُ المشاركةِ المستقلّةُ لا تُترَكُ فارغةً حين لا مشاركة", () => {
    expect(SHARE).toContain("return standalone ? (");
    expect(SHARE).toContain('t("rider.share.unavailable")');
  });
});

describe("R13 · الأماكنُ المحفوظةُ وجهةُ الطوارئ صفّانِ يفتحانِ شاشتَين", () => {
  it("بمستقبِلٍ يُرسَمُ الصفُّ، وبلا مستقبِلٍ تبقى اللوحةُ مدمجةً (لا زرَّ بلا مستقبِل)", () => {
    expect(ACCOUNT).toContain("onOpenSavedPlaces === undefined ? null : (");
    expect(ACCOUNT).toContain("onOpenEmergencyContact === undefined ? null : (");
    expect(ACCOUNT).toContain("{onOpenSavedPlaces === undefined ? (");
    expect(ACCOUNT).toContain("{onOpenEmergencyContact === undefined ? (");
    expect(ROOT).toContain("onOpenSavedPlaces={() => setSavedPlacesOpen(true)}");
    expect(ROOT).toContain("onOpenEmergencyContact={() => setEmergencyOpen(true)}");
    expect(ROOT).toContain('title={t("rider.frame.savedPlaces")}');
    expect(ROOT).toContain('title={t("rider.frame.emergency")}');
  });
});

describe("R4 · بطاقةُ الطلبِ تحملُ الخدمةَ من النيّةِ نفسِها", () => {
  for (const language of MINIAPP_LANGUAGES) {
    it(`الخدمةُ بنصِّها المترجَمِ · ${language}`, () => {
      const t = miniAppTranslator(language);
      const html = renderToStaticMarkup(
        <SearchScreen
          intent={INTENT}
          initialLanguage={language}
          showTitle={false}
          request={never}
        />,
      );
      expect(html).toContain("rs__destination-service");
      expect(html).toContain(
        t("rider.search.service").replace("{label}", t("rider.quote.service.transport")),
      );
    });
  }
  it("خدمةٌ لا يعرفُها العميلُ لا تُعرَضُ خامّاً", () => {
    const html = renderToStaticMarkup(
      <SearchScreen
        intent={{ ...INTENT, service: "courier" } as SearchScreenIntent}
        showTitle={false}
        request={never}
      />,
    );
    expect(html).not.toContain("rs__destination-service");
    expect(html).not.toContain("courier");
  });
});

describe("R15 · الأسئلةُ الشائعةُ الخمسةُ كما في اللوحة 05", () => {
  it("نصوصُ الأسئلةِ العربيّةُ حرفاً", () => {
    const html = renderToStaticMarkup(<FaqScreen language="ar" showTitle={false} />);
    for (const q of [
      "كيف أختار الوجهة؟",
      "هل تحدّد وَصْلة الأجرة؟",
      "متى تتحدّث حالة الرحلة؟",
      "كيف أطلب المساعدة؟",
      "ماذا لو رُفضت الوجهة؟",
    ]) {
      expect(html).toContain(q);
    }
  });
});

describe("R0 · نصُّ الترحيبِ لا يَعِدُ بمدّةٍ بلا مصدرِ طرق", () => {
  it("العربيّةُ تشترطُ مصدرَ الطرقِ كما تفعلُ الإنجليزيّةُ والأرديّة", () => {
    const ar = miniAppDictionary("ar")["welcome.line2"] ?? "";
    expect(ar).toContain("فقط حين يتوفّر مصدر طرق صالح");
    expect(ar).not.toContain("المسافة والمدّة المتوقّعة");
  });
  it("المفاتيحُ الجديدةُ في اللغاتِ الثلاثِ", () => {
    for (const language of MINIAPP_LANGUAGES) {
      const d = miniAppDictionary(language);
      for (const key of [
        "rider.search.service",
        "rider.active.openShare",
        "rider.active.openHelp",
        "rider.share.unavailable",
        "rider.account.savedPlaces.open",
        "rider.account.emergency.open",
        "rider.frame.share",
        "rider.frame.savedPlaces",
        "rider.frame.emergency",
        "driver.job.stamp.ago",
        "driver.job.stamp.justNow",
      ]) {
        expect(d[key], `${language}:${key}`).toBeTruthy();
      }
    }
  });
});

describe("D2 · تفاصيلُ العرضِ ثلاثُ بطاقاتٍ كما في اللوحة 06 (بلا وقتٍ مختلَق)", () => {
  const DETAIL = codeOnly(read("./driver/offers/OfferDetailScreen.tsx"));
  it("ثلاثُ بطاقاتٍ معنونة: بياناتُ الطلب ← المواقع ← المسافة", () => {
    const order = [
      DETAIL.indexOf('t("driver.offers.detail.section.request")'),
      DETAIL.indexOf('t("driver.offers.detail.section.places")'),
      DETAIL.indexOf('t("driver.offers.detail.section.distance")'),
    ];
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(DETAIL.match(/<UiCard\b/g)?.length).toBe(3);
  });
  it("بطاقةُ المسافةِ لا تحملُ إلّا صفَّي المسافة — لا مدّةَ ولا ETA", () => {
    const start = DETAIL.indexOf('t("driver.offers.detail.section.distance")');
    const card = DETAIL.slice(start, DETAIL.indexOf("</UiCard>", start));
    expect(card.match(/<DistanceRow\b/g)?.length).toBe(2);
    expect(card).not.toMatch(/\beta\b|duration|minutes/i);
  });
  it("العناوينُ مترجمةٌ في اللغاتِ الثلاث، والعربيّةُ «المسافة» لا «المسافة والوقت»", () => {
    for (const lang of MINIAPP_LANGUAGES) {
      const t = miniAppTranslator(lang);
      for (const k of ["request", "places", "distance"]) {
        const key = `driver.offers.detail.section.${k}`;
        expect(t(key)).not.toBe(key);
      }
    }
    expect(miniAppTranslator("ar")("driver.offers.detail.section.distance")).toBe("المسافة");
  });
});

describe("D3 · لغةُ الراكبِ باسمِها لا برمزِها الخامّ", () => {
  it("الرموزُ الثلاثةُ أسماءٌ، والمجهولُ يُعرَضُ كما ورد", () => {
    const t = miniAppTranslator("ar");
    expect(riderLanguageText("ar", t)).toBe("العربية");
    expect(riderLanguageText("EN", t)).toBe("English");
    expect(riderLanguageText("ur", t)).toBe("اردو");
    expect(riderLanguageText("fr", t)).toBe("fr");
  });
  it("المهمّةُ ترسمُ الاسمَ عبرَ الدالّة، لا `riderLanguageCode` خامًّا", () => {
    expect(JOB).toContain("riderLanguageText(job.riderLanguageCode, t)");
    expect(JOB).not.toMatch(/·\s*\{job\.riderLanguageCode\}/);
  });
});

describe("D4 · بعدَ «أنهِ الرحلة» يبقى زرُّ الملخّص (القراءةُ تعيدُ job: null)", () => {
  it("فرعُ «لا مهمّة» يرسمُ نتيجةَ الإكمالِ وزرَّ الملخّصِ من حالِ الفعل", () => {
    const start = JOB.indexOf("if (state.job === null)");
    const branch = JOB.slice(start, JOB.indexOf("const job = state.job;", start));
    expect(start).toBeGreaterThan(0);
    expect(branch).toContain('t("driver.job.viewSummary")');
    expect(branch).toContain("onCompleted?.(completedOrderId)");
    expect(branch).toContain("t(DONE_KEY.COMPLETE_RIDE)");
  });
  it("الزرُّ مشروطٌ بإكمالٍ فعليٍّ ومستقبِلٍ مُمرَّر — لا زرَّ بلا مستقبِل", () => {
    expect(JOB).toMatch(
      /const completedOrderId =\s*act\.kind === "done" &&\s*act\.key === DONE_KEY\.COMPLETE_RIDE &&\s*onCompleted !== undefined/,
    );
  });
});

describe("حاجزُ الترميزِ المزدوج: `apiFetch` يرمّزُ `body` بنفسِه", () => {
  it("لا مستدعٍ لـ`apiFetch` يمرّرُ `body: JSON.stringify(...)` (كان يصلُ الخادمَ نصًّا فيُرفَضُ MALFORMED)", async () => {
    const { Glob } = await import("bun");
    const offenders: string[] = [];
    for await (const file of new Glob("apps/miniapp/src/**/*.{ts,tsx}").scan(".")) {
      if (file.includes(".test.") || file.endsWith("api/client.ts")) continue;
      const src = await Bun.file(file).text();
      if (src.includes("apiFetch") && /body:\s*JSON\.stringify\(/.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
