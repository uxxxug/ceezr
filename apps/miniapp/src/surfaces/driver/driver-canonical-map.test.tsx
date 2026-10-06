/**
 * الغرض: إثباتُ أنَّ ترقيمَ D0–D14 **الكانونيَّ من المصدرِ الأصليّ** (PDF v2.0 · ADR 0236) يقعُ على
 *   الشِّفرةِ الفعليّة: لكلِّ رقمٍ موضعُه الحقيقيُّ في الهيكلِ ومعالجُه أو نداؤه القائم — لا اسمُ ملفٍّ.
 * الحالة: منفّذ فعلياً — UI-4 · مطابقةُ المصدر (ADR 0236 «مطابقةُ المصدر»).
 *
 * حدٌّ معلَن: لا بيئةَ DOM (لا تبعيّةَ جديدة). ما يُقاسُ: أوّلُ رسمٍ ساكنٍ حيثُ يرسمُ السطحُ قبلَ الجلب،
 * وعقدُ الربطِ ساكناً (الشِّفرةُ بلا تعليقات) حيثُ ينتظرُ السطحُ ردَّ الخادم، ومفاتيحُ القاموسِ بثلاثِ لغات.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MINIAPP_LANGUAGES,
  miniAppDictionary,
  miniAppTranslator,
} from "../../../../../packages/shared/i18n/miniapp/index.ts";
import { AccountScreen } from "./account/AccountScreen.tsx";
import type { DriverFlowAction, DriverFlowState } from "./driver-flow.ts";
import {
  broadcastsLocation,
  driverFlowHandlers,
  driverFlowReducer,
  initialDriverFlow,
} from "./driver-flow.ts";

const HERE = new URL(".", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, HERE), "utf8");

/** الشِّفرةُ بلا تعليقات — كي لا يُحتسَبَ شرحٌ أو رقمٌ في تعليقٍ دليلاً. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1");
}

/** الجدولُ الكانونيُّ من المصدرِ الأصليّ — نصُّ ADR 0236 حرفاً. */
const CANONICAL: Readonly<Record<string, string>> = {
  D0: "الهيكل وبث الموقع",
  D1: "لوح العروض",
  D2: "بطاقة العرض",
  D3: "تفاصيل العرض",
  D4: "المهمة الحالية",
  D5: "تعذّر الإكمال",
  D6: "ملخص رحلة السائق وتقييم الراكب",
  D7: "SOS",
  D8: "الوثائق",
  D9: "المركبة",
  D10: "الحصيلة والنشاط",
  D11: "الاشتراك والفاتورة",
  D12: "الحساب وحذفه",
  D13: "دعم السائق وكشف الخصوم",
  D14: "تسجيل السائق من الـMini App",
};

const ROOT = codeOnly(read("./DriverRoot.tsx"));
const JOB = codeOnly(read("./job/JobScreen.tsx"));
const OFFERS = codeOnly(read("./offers/OffersScreen.tsx"));
const SUMMARY = codeOnly(read("./summary/DriverRideSummaryScreen.tsx"));
const SUBSCRIPTION = codeOnly(read("./subscription/SubscriptionScreen.tsx"));
const SUPPORT = codeOnly(read("./support/SupportScreen.tsx"));
const ONBOARDING = codeOnly(read("../onboarding/OnboardingRoot.tsx"));
const ONBOARDING_API = codeOnly(read("../onboarding/onboarding-api.ts"));

/** مقطعُ `case "<kind>":` حتّى `case` التالي — موضعُ الشاشةِ في موجّهِ `DriverRoot`. */
function caseBlock(kind: string): string {
  const start = ROOT.indexOf(`case "${kind}":`);
  expect(start, `case "${kind}"`).toBeGreaterThan(-1);
  const next = ROOT.indexOf("case ", start + 6);
  return ROOT.slice(start, next === -1 ? undefined : next);
}

function keysPresent(keys: readonly string[]) {
  for (const language of MINIAPP_LANGUAGES) {
    const dictionary = miniAppDictionary(language);
    for (const key of keys) expect(dictionary[key]?.trim(), `${key} @ ${language}`).toBeTruthy();
  }
}

function harness() {
  let state: DriverFlowState = initialDriverFlow({ kind: "offers" });
  const dispatch = (action: DriverFlowAction) => {
    state = driverFlowReducer(state, action);
  };
  return {
    go: driverFlowHandlers(dispatch),
    get state() {
      return state;
    },
  };
}

describe("ترقيمُ D0–D14 الكانونيّ (ADR 0236)", () => {
  it("خمسةَ عشرَ رقماً متّصلةً D0…D14 بلا فجوةٍ ولا تكرار", () => {
    expect(Object.keys(CANONICAL)).toEqual(Array.from({ length: 15 }, (_, i) => `D${i}`));
  });

  it("ADR 0236 يحملُ الجدولَ الكانونيَّ نفسَه، ولا يصفُ الترقيمَ «اشتقاقاً هندسيّاً»", () => {
    const adr = readFileSync(
      new URL("../../../../../docs/adr/0236-ui-4-driver-d0-d14.md", HERE),
      "utf8",
    );
    for (const [d, label] of Object.entries(CANONICAL)) {
      expect(adr, d).toContain(`| ${d} | ${label} |`);
    }
    for (const phrase of ["اشتقاقٌ هندسيٌّ", "اشتقاقاً هندسيّاً", "نقطةُ مراجعة"]) {
      expect(adr).not.toContain(phrase);
    }
  });
});

describe("D0 — الهيكلُ وبثُّ الموقع", () => {
  it("بثُّ الموقعِ يُركَّبُ في `DriverRoot` نفسِه (الهيكل) خارجَ الشاشات، بحارسِ `broadcastsLocation`", () => {
    expect(ROOT).toMatch(/broadcastsLocation\(view\)\s*\?\s*<LocationBroadcast/);
    expect(ROOT).toContain('<ScreenFrame\n        mode="root"');
    expect(broadcastsLocation({ screen: "root", tab: "offers" })).toBe(true);
    expect(broadcastsLocation({ screen: "root", tab: "job" })).toBe(true);
  });
});

describe("D1–D3 — اللوحُ والبطاقةُ والتفاصيل", () => {
  it("D2: بطاقةُ العرضِ عنصرُ اللوحِ بمؤقّتِ CSS، ومنها يُفتَحُ D3", () => {
    expect(OFFERS).toMatch(/<li className=\{`dof__item[\s\S]*?<UiTimer \{\.\.\.timer\} \/>/);
    expect(OFFERS).toContain("onOpenOffer(card.offerId)");
  });

  it("D3: تفاصيلُ العرضِ تدفّقٌ بقبولٍ ورفضٍ موصولَين", () => {
    const block = caseBlock("offer");
    expect(block).toContain("<OfferDetailScreen");
    expect(block).toContain("onAccepted={go.offerAccepted}");
    expect(block).toContain("onRejected={go.offerRejected}");
  });
});

describe("D4–D7 — المهمّةُ وتعذّرُ الإكمالِ والملخّصُ وSOS", () => {
  it("D4: «مهمّتي» يرسمُ `JobScreen` واكتمالُه يفتحُ D6", () => {
    expect(caseBlock("job")).toContain(
      "<JobScreen language={language} showTitle={false} onCompleted={go.jobCompleted} />",
    );
  });

  it("D5: تعذّرُ الإكمالِ نداءٌ حقيقيٌّ (`reportDriverCannotComplete`) بتأكيدٍ وحالاتٍ معلنة", () => {
    expect(JOB).toContain("reportCannotComplete = reportDriverCannotComplete");
    expect(JOB).toContain("await reportCannotComplete(orderId)");
    keysPresent([
      "driver.job.cannotComplete.label",
      "driver.job.cannotComplete.confirmQuestion",
      "driver.job.cannotComplete.confirmSend",
      "driver.job.cannotComplete.cancel",
      "driver.job.cannotComplete.sent",
      "driver.job.cannotComplete.failed",
    ]);
  });

  it("D6: الملخّصُ تدفّقٌ فوقَ «مهمّتي» وفيه تقييمُ الراكبِ بنداءٍ قائم", () => {
    expect(caseBlock("summary")).toContain("<DriverRideSummaryScreen");
    expect(SUMMARY).toContain("submitRating(orderId, { stars, comment: comment.trim() })");
    keysPresent(["driver.summary.rateRider", "driver.summary.stars.label"]);
    const h = harness();
    h.go.selectTab("job");
    h.go.jobCompleted("7c9e6679-7425-40de-944b-e07fc1f90ae7");
    expect(h.state.stack.map((e) => e.screen.kind)).toEqual(["summary"]);
  });

  it("D7: SOS نداءُ `triggerDriverSos` القائمُ من «مهمّتي» بحالاتِه الأربع", () => {
    expect(JOB).toContain("triggerSos = triggerDriverSos");
    expect(JOB).toContain("await triggerSos()");
    keysPresent([
      "driver.job.sos.sent",
      "driver.job.sos.alreadyOpen",
      "driver.job.sos.refused",
      "driver.job.sos.failed",
      "driver.job.sos.sending",
    ]);
  });
});

describe("D8–D13 — ملفُّ العملِ والحسابُ والدعم", () => {
  it("D8: الوثائقُ تدفّقٌ وفيه خطواتُ الرفعِ الحقيقيّة؛ D9: المركبةُ تدفّق", () => {
    expect(caseBlock("documents")).toContain("<DocumentsScreen");
    expect(caseBlock("vehicle")).toContain("<VehicleScreen");
  });

  it("D10: «أرباحي» يرسمُ الحصيلةَ والنشاط", () => {
    expect(caseBlock("earnings")).toContain("<ActivityScreen");
  });

  it("D11: الاشتراكُ تدفّقٌ ومعه لوحُ الفاتورة", () => {
    expect(caseBlock("subscription")).toContain("<SubscriptionScreen");
    expect(SUBSCRIPTION).toContain(
      'import { PaymentInvoicePanel } from "./PaymentInvoicePanel.tsx"',
    );
    expect(SUBSCRIPTION).toContain("<PaymentInvoicePanel");
  });

  for (const language of MINIAPP_LANGUAGES) {
    it(`D12: «حسابي» يرسمُ بابَ حذفِ الحسابِ في أوّلِ رسم · ${language}`, () => {
      const t = miniAppTranslator(language);
      expect(caseBlock("account")).toContain("<AccountScreen");
      const html = renderToStaticMarkup(<AccountScreen language={language} showTitle={false} />);
      expect(html).toContain(t("driver.account.erasure.open"));
    });
  }

  it("D13: دعمُ السائقِ تدفّقٌ، وكشفُ الخصومِ منه وحدَه", () => {
    expect(caseBlock("support")).toContain("onOpenDeductionTrace={go.openDeductionTrace}");
    expect(SUPPORT).toContain("onOpenDeductionTrace");
    expect(caseBlock("deductionTrace")).toContain("<DeductionTraceScreen");
    const h = harness();
    h.go.openSupport();
    h.go.openDeductionTrace();
    expect(h.state.stack.map((e) => e.screen.kind)).toEqual(["support", "deductionTrace"]);
  });
});

describe("D14 — تسجيلُ السائقِ من الـMini App", () => {
  it("سطحُ التسجيلِ يفرّقُ جمهورَ السائقِ ويقولُ له المسارَ الحقيقيَّ بلا نموذجٍ مُختلَق", () => {
    expect(ONBOARDING).toContain('state.status.audience === "driver"');
    expect(ONBOARDING).toContain('t("onboarding.driver.title")');
    expect(ONBOARDING).toContain('t("onboarding.driver.body")');
    keysPresent(["onboarding.driver.title", "onboarding.driver.body", "onboarding.driver.close"]);
  });

  it("فجوةُ عقدٍ مسجّلة: لا نداءَ تسجيلِ سائقٍ في العميل — إن أُضيفَ فليُحدَّث ADR 0236", () => {
    expect(ONBOARDING_API).toContain('"/v1/onboarding/rider"');
    expect(ONBOARDING_API).not.toContain("/v1/onboarding/driver");
  });
});
