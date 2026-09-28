/**
 * الغرض: قياسُ حاجزِ عقدِ الإنهاءِ والتقييمِ — **حالةٌ سلبيّةٌ مبذورةٌ لكلِّ قاعدةٍ
 *   من السِّتِّ** (`ح-7`: قاعدةٌ بلا حالةٍ سلبيّةٍ غيرُ مُنفَذةٍ).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-07`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci` وخطوةٌ مُسمَّاةٌ في CI.
 *
 * ولماذا تُقاسُ المدخلاتُ المصنوعةُ لا المستودعُ وحدَه: المستودعُ اليومَ **نظيفٌ**،
 * فلو قِيسَ وحدَه لَنجحَ الاختبارُ ولو كانَ الحاجزُ لا يفحصُ شيئاً. فالحالةُ
 * السلبيّةُ هيَ ما يُثبِتُ أنَّ القاعدةَ تعملُ، والحالةُ الموجبةُ تُقاسُ معَها.
 *
 * وما لا يفعلُه: لا يُثبِتُ أنَّ الملخَّصَ صادقٌ على قاعدةٍ حقيقيّةٍ — ذاكَ أثرٌ
 * يُقاسُ في `tests/integration/ride-summary.test.ts` بمحرِّكٍ وساعتِه.
 */

import { describe, expect, it } from "bun:test";
import { readRepository } from "../../scripts/check-ride-summary-contract.ts";
import {
  domainTagVocabulary,
  functionRevokeProblems,
  keyParityProblems,
  moneyProblems,
  REPORT_PROBLEM_KEY,
  type RideSummaryContractInput,
  reportEntryProblems,
  rideSummaryContractProblems,
  SCREEN_FILE,
  separateCamelCase,
  sosEntryProblems,
  sqlTagVocabularies,
  straightLineProblems,
  tagLexiconProblems,
  travelledTraceProblems,
  unbuiltPathProblems,
  usedKeys,
} from "../../scripts/lib/ride-summary-contract.ts";

const SQL = `
create or replace function public.rating_tags_are_valid(p_tags text[])
returns boolean as $fn$
  select p_tags is null or (p_tags <@ array['cleanliness','politeness']::text[])
$fn$ language sql immutable;

create or replace function completed_ride_summary(p_telegram_id bigint, p_order_id uuid)
returns jsonb as $$ select '{}'::jsonb $$ language sql stable security invoker;

revoke execute on function rating_tags_are_valid(text[]) from public, anon, authenticated;
revoke execute on function completed_ride_summary(bigint, uuid) from public, anon, authenticated;
`;

const DOMAIN = `
export const RATING_TAGS = ["cleanliness", "politeness"] as const;
`;

const VIEW = `
const KEYS = {
  meters: "rider.summary.straightLine.meters",
  kilometers: "rider.summary.straightLine.kilometers",
};
`;

const SCREEN = `
const a = t("rider.summary.title");
const b = t("rider.summary.tag.cleanliness");
`;

function dictionary(language: "ar" | "en" | "ur"): Record<string, string> {
  const straight = {
    ar: "وترُ الخطِّ المستقيمِ {meters} متراً.",
    en: "Straight-line distance: {meters} m.",
    ur: "سیدھی لکیر {meters} میٹر۔",
  }[language];
  const trace = {
    ar: "مسافةُ الأثرِ المسجَّلِ {meters} متراً.",
    en: "Recorded trace distance: {meters} m.",
    ur: "درج شدہ نشان ہوائی مسافت {meters} میٹر۔",
  }[language];
  return {
    "rider.summary.title": "ملخَّصٌ",
    "rider.summary.straightLine.meters": straight,
    "rider.summary.travelledTrace.meters": trace,
    "rider.summary.tag.cleanliness": "النظافةُ",
    "rider.summary.tag.politeness": "اللباقةُ",
    "rider.summary.reportProblem": "مشكلةٌ في هذه الرحلةِ",
  };
}

/** شاشةٌ حقيقيّةُ الاسمِ سليمةٌ: مدخلُ الاستغاثةِ مُركَّبٌ و«الإبلاغُ» مشروطٌ بمُستقبِلٍ وسطرُ الأثرِ مُركَّبٌ. */
const GOOD_SCREEN = `
readonly onReportProblem?: () => void;
<SosEntry onOpenSos={onOpenSos} language={language} />
{onReportProblem === undefined ? null : (
  <button type="button" onClick={onReportProblem}>{t("${"rider.summary.reportProblem"}")}</button>
)}
const traceLine = travelledTraceLine(view.travelledTrace);
`;

/** موجِّهٌ سليمٌ: الشكوى تحملُ الرحلةَ الملخَّصةَ. */
const GOOD_ROOT = `
<RideSummaryScreen
  orderId={summarized}
  onReportProblem={() => setSupport({ orderId: summarized })}
/>
`;

function input(overrides: Partial<RideSummaryContractInput> = {}): RideSummaryContractInput {
  return {
    surface: {
      "surface.tsx": SCREEN,
      // (`PD-020`) — شاشةٌ حقيقيّةُ الاسمِ تُركِّبُ مدخلَ الاستغاثةِ كما ينبغي.
      // و(`SR-08`) — وتُركِّبُ «الإبلاغَ عن مشكلةٍ» مشروطاً بمُستقبِلٍ.
      [SCREEN_FILE]: GOOD_SCREEN,
    },
    sql: SQL,
    domain: DOMAIN,
    view: VIEW,
    translations: { ar: dictionary("ar"), en: dictionary("en"), ur: dictionary("ur") },
    root: GOOD_ROOT,
    ...overrides,
  };
}

describe("حاجزُ عقدِ الإنهاءِ والتقييمِ — الحالةُ الموجبةُ", () => {
  it("مدخلاتٌ سليمةٌ لا تُنتِجُ مشكلةً", () => {
    expect(rideSummaryContractProblems(input())).toEqual([]);
  });

  it("مدخلُ استغاثةٍ محذوفٌ يُسقِطُ الحاجزَ (`PD-020`)", () => {
    const problems = sosEntryProblems(input({ surface: { "surface.tsx": SCREEN } }));
    expect(problems).toHaveLength(2);
  });

  it("المستودعُ الحقيقيُّ نفسُه يمرُّ بالقواعدِ السِّتِّ", () => {
    expect(rideSummaryContractProblems(readRepository())).toEqual([]);
  });
});

describe("القاعدة ١ — لا مالَ", () => {
  it("كلمةُ أجرةٍ في شِفرةِ السطحِ تُسقِطُ الحاجزَ", () => {
    const problems = moneyProblems(
      input({ surface: { "surface.tsx": 'const label = t("fare");' } }),
    );
    expect(problems.some((text) => text.includes("مالاً"))).toBe(true);
  });

  it("«إكراميّةٌ» في نصٍّ عربيٍّ تُسقِطُ الحاجزَ — وهيَ أشهرُ ما يُزرَعُ في هذه الشاشةِ", () => {
    const dirty = { ...dictionary("ar"), "rider.summary.tipHint": "أضِفْ إكرامية للسائقِ" };
    const problems = moneyProblems(
      input({ translations: { ar: dirty, en: dictionary("en"), ur: dictionary("ur") } }),
    );
    expect(problems.some((text) => text.includes("نصٌّ يذكرُ مالاً"))).toBe(true);
  });

  it("«إيصالٌ» في مفتاحٍ يُسقِطُ الحاجزَ ولو كانَ نصُّه بريئاً", () => {
    const dirty = { ...dictionary("ar"), "rider.summary.receipt.none": "لا شيءَ" };
    const problems = moneyProblems(
      input({ translations: { ar: dirty, en: dictionary("en"), ur: dictionary("ur") } }),
    );
    expect(problems.some((text) => text.includes("مفتاحٌ يذكرُ مالاً"))).toBe(true);
  });

  it("«multiple» لا تُقرأُ «tip» — الحدودُ تمنعُ السقوطَ العَرَضيَّ", () => {
    const problems = moneyProblems(
      input({ surface: { "surface.tsx": "const multiple = [1, 2, 3];" } }),
    );
    expect(problems).toEqual([]);
  });
});

describe("القاعدة ٢ — لا مسافةَ تُدَّعى مقطوعةً", () => {
  it("نصٌّ يحملُ رقمَ مسافةٍ بلا تصريحِ الخطِّ المستقيمِ يُسقِطُ الحاجزَ", () => {
    const dirty = {
      ...dictionary("ar"),
      "rider.summary.straightLine.meters": "المسافةُ {meters} متراً.",
    };
    const problems = straightLineProblems(
      input({ translations: { ar: dirty, en: dictionary("en"), ur: dictionary("ur") } }),
    );
    expect(problems.some((text) => text.includes("وترُ خطٍّ مستقيمٍ"))).toBe(true);
  });

  it("لفظُ «مقطوعةٍ» في نصٍّ يُسقِطُ الحاجزَ ولو صرَّحَ بالوترِ", () => {
    const dirty = {
      ...dictionary("ar"),
      "rider.summary.straightLine.meters":
        "وترُ الخطِّ المستقيمِ {meters} متراً، والمسافةُ المقطوعةُ أطولُ.",
    };
    const problems = straightLineProblems(
      input({ translations: { ar: dirty, en: dictionary("en"), ur: dictionary("ur") } }),
    );
    expect(problems.some((text) => text.includes("مسافةً مقطوعةً"))).toBe(true);
  });

  it("«travelled» في شِفرةِ السطحِ تُسقِطُ الحاجزَ", () => {
    const problems = straightLineProblems(
      input({ surface: { "surface.tsx": "const travelled = meters;" } }),
    );
    expect(problems.some((text) => text.includes("قطعَ مسافةٍ"))).toBe(true);
  });

  it("مفتاحُ مسافةٍ خارجَ «straightLine» في نموذجِ العرضِ يُسقِطُ الحاجزَ", () => {
    const problems = straightLineProblems(
      input({ view: 'const key = "rider.summary.distance.meters";' }),
    );
    expect(problems.some((text) => text.includes("حاملُ القيدِ"))).toBe(true);
  });

  it("لغةٌ بلا علامةٍ مُعلَنةٍ لا تمرُّ صامتةً", () => {
    const problems = straightLineProblems(
      input({
        translations: {
          ar: dictionary("ar"),
          en: dictionary("en"),
          fr: dictionary("en"),
          ur: dictionary("ur"),
        },
      }),
    );
    expect(problems.some((text) => text.includes("لا علامةَ"))).toBe(true);
  });
});

describe("القاعدة ٣ — مُعجَمُ الوسومِ واحدٌ", () => {
  it("وسمٌ في الهجرةِ لا نظيرَ له في النطاقِ يُسقِطُ الحاجزَ", () => {
    const problems = tagLexiconProblems(
      input({
        sql: SQL.replace("'cleanliness','politeness'", "'cleanliness','politeness','music'"),
      }),
    );
    expect(problems.some((text) => text.includes("يفترقُ"))).toBe(true);
  });

  it("اختلافُ الترتيبِ وحدَه يُسقِطُ الحاجزَ — المطابقةُ حرفاً وترتيباً", () => {
    const problems = tagLexiconProblems(
      input({ domain: 'export const RATING_TAGS = ["politeness", "cleanliness"] as const;' }),
    );
    expect(problems.some((text) => text.includes("يفترقُ"))).toBe(true);
  });

  it("وسمٌ بلا نصٍّ في قاموسٍ يُسقِطُ الحاجزَ", () => {
    const poor = { ...dictionary("en") };
    delete poor["rider.summary.tag.politeness"];
    const problems = tagLexiconProblems(
      input({ translations: { ar: dictionary("ar"), en: poor, ur: dictionary("ur") } }),
    );
    expect(problems.some((text) => text.includes("وسمٌ بلا نصٍّ"))).toBe(true);
  });

  it("قائمةٌ فارغةٌ في النطاقِ لا تمرُّ زوراً", () => {
    const problems = tagLexiconProblems(input({ domain: "export const NOTHING = 1;" }));
    expect(problems.some((text) => text.includes("لم تُقرأْ"))).toBe(true);
  });

  it("هجرةٌ بلا مُعجَمٍ لا تمرُّ زوراً", () => {
    const problems = tagLexiconProblems(input({ sql: "select 1;" }));
    expect(problems.some((text) => text.includes("لم يُقرأْ مُعجَمُ"))).toBe(true);
  });

  it("القراءتانِ تُستخرجانِ بترتيبِهما", () => {
    expect(domainTagVocabulary(DOMAIN)).toEqual(["cleanliness", "politeness"]);
    expect(sqlTagVocabularies(SQL)).toEqual([["cleanliness", "politeness"]]);
  });
});

describe("القاعدة ٤ — مفاتيحُ ثلاثةٌ متطابقةٌ", () => {
  it("مفتاحٌ ناقصٌ في قاموسٍ يُسقِطُ الحاجزَ", () => {
    const poor = { ...dictionary("ur") };
    delete poor["rider.summary.title"];
    const problems = keyParityProblems(
      input({ translations: { ar: dictionary("ar"), en: dictionary("en"), ur: poor } }),
    );
    expect(problems.some((text) => text.includes("مفتاحٌ ناقصٌ"))).toBe(true);
  });

  it("مفتاحٌ يُنادى في السطحِ وليسَ في القاموسِ يُسقِطُ الحاجزَ", () => {
    const problems = keyParityProblems(
      input({ surface: { "surface.tsx": 'const a = t("rider.summary.ghost");' } }),
    );
    expect(problems.some((text) => text.includes("يُنادى في السطحِ"))).toBe(true);
  });

  it("قواميسُ بلا مفتاحٍ بالبادئةِ لا تمرُّ زوراً", () => {
    const problems = keyParityProblems(
      input({ surface: {}, translations: { ar: {}, en: {}, ur: {} } }),
    );
    expect(problems.some((text) => text.includes("لا يقيسُ فراغاً"))).toBe(true);
  });

  it("المفاتيحُ المُنادَاةُ تُقرأُ حرفاً", () => {
    expect([...usedKeys({ "a.tsx": SCREEN })].sort()).toEqual([
      "rider.summary.tag.cleanliness",
      "rider.summary.title",
    ]);
  });
});

describe("القاعدة ٥ — لا زرَّ لمسارٍ لم يُبنَ", () => {
  it("زرُّ تذكرةِ دعمٍ في السطحِ يُسقِطُ الحاجزَ — **وباسمٍ سنَّوريٍّ** كما تُكتَبُ الشِّفرةُ فعلاً", () => {
    const problems = unbuiltPathProblems(
      input({ surface: { "surface.tsx": "const onPress = () => openSupportTicket();" } }),
    );
    expect(problems.some((text) => text.includes("لم يُبنَ"))).toBe(true);
  });

  it("«shared» و«sharedState» لا تُقرآنِ «share» بعدَ فصلِ الحدودِ السنَّوريّةِ", () => {
    expect(separateCamelCase("openSupportTicket")).toBe("open support ticket");
    expect(separateCamelCase("sharedState")).toBe("shared state");
    const problems = unbuiltPathProblems(
      input({ surface: { "surface.tsx": "const sharedState = useSharedState();" } }),
    );
    expect(problems).toEqual([]);
  });

  it("مفتاحُ مشاركةٍ في قاموسٍ يُسقِطُ الحاجزَ", () => {
    const dirty = { ...dictionary("ar"), "rider.summary.share": "شارِكْ رحلتَك" };
    const problems = unbuiltPathProblems(
      input({ translations: { ar: dirty, en: dictionary("en"), ur: dictionary("ur") } }),
    );
    expect(problems.some((text) => text.includes("مفتاحٌ لمسارٍ لم يُبنَ"))).toBe(true);
  });

  it("«shared» في مسارِ استيرادٍ لا تُقرأُ «share»", () => {
    const problems = unbuiltPathProblems(
      input({
        surface: { "surface.tsx": 'import { t } from "../../packages/shared/i18n/index.ts";' },
      }),
    );
    expect(problems).toEqual([]);
  });
});

describe("القاعدة ٨ — «الإبلاغُ عن مشكلةٍ» موصولٌ بالرحلةِ (`SR-08`)", () => {
  const withScreen = (screen: string) =>
    input({ surface: { "surface.tsx": SCREEN, [SCREEN_FILE]: screen } });

  it("المدخلاتُ السليمةُ لا تُنتِجُ مشكلةً", () => {
    expect(reportEntryProblems(input())).toEqual([]);
  });

  it("شاشةٌ بلا «onReportProblem?» تُسقِطُ الحاجزَ", () => {
    const screen = GOOD_SCREEN.replace("readonly onReportProblem?: () => void;", "");
    const problems = reportEntryProblems(withScreen(screen));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("لا تقبلُ");
  });

  it("زرٌّ غيرُ مشروطٍ بمُستقبِلٍ يُسقِطُ الحاجزَ", () => {
    const screen = GOOD_SCREEN.replace("onReportProblem === undefined ? null : ", "");
    const problems = reportEntryProblems(withScreen(screen));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("غيرُ مشروطٍ");
  });

  it("زرٌّ بمفتاحِ سطحٍ آخرَ يُسقِطُ الحاجزَ", () => {
    const screen = GOOD_SCREEN.replace(REPORT_PROBLEM_KEY, "rider.history.detail.reportProblem");
    const problems = reportEntryProblems(withScreen(screen));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(REPORT_PROBLEM_KEY);
  });

  it("موجِّهٌ لا يُوصِلُ المدخلَ يُسقِطُ الحاجزَ", () => {
    const problems = reportEntryProblems(
      input({ root: "<RideSummaryScreen orderId={summarized} />" }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("الموجِّهُ");
  });

  it("موجِّهٌ يفتحُ شكوى عامّةً (`orderId: null`) يُسقِطُ الحاجزَ — الربطُ بالرحلةِ هوَ المقيسُ", () => {
    const root = GOOD_ROOT.replace("orderId: summarized", "orderId: null");
    expect(reportEntryProblems(input({ root }))).toHaveLength(1);
  });

  it("القاعدةُ الخامسةُ لم تُخفَّفْ: ذكرُ التذكرةِ في السطحِ ما زالَ يُسقِطُ", () => {
    const screen = `${GOOD_SCREEN}\nconst go = () => openSupportTicket();`;
    const problems = unbuiltPathProblems(withScreen(screen));
    expect(problems.some((text) => text.includes("لم يُبنَ"))).toBe(true);
  });

  it("المستودعُ الحقيقيُّ يمرُّ بالقاعدةِ الثامنةِ", () => {
    expect(reportEntryProblems(readRepository())).toEqual([]);
  });
});

describe("القاعدة ٦ — لا دالّةَ بلا نزعِ تنفيذٍ", () => {
  it("دالّةٌ بلا نزعٍ تُسقِطُ الحاجزَ", () => {
    const problems = functionRevokeProblems(
      input({
        sql: "create or replace function public.summary_of(p bigint) returns jsonb as $$ select '{}'::jsonb $$ language sql;",
      }),
    );
    expect(problems.some((text) => text.includes("ولا تنزعُ تنفيذَها"))).toBe(true);
  });

  it("نزعٌ يذكرُ دورَينِ من ثلاثةٍ يُسقِطُ الحاجزَ", () => {
    const problems = functionRevokeProblems(
      input({
        sql: SQL.replace("from public, anon, authenticated;\nrevoke", "from public, anon;\nrevoke"),
      }),
    );
    expect(problems.some((text) => text.includes("authenticated"))).toBe(true);
  });

  it("بادئةُ المخطَّطِ في النزعِ لا تُخدِعُ الحاجزَ", () => {
    const problems = functionRevokeProblems(
      input({
        sql: SQL.replace(
          "revoke execute on function rating_tags_are_valid(text[])",
          "revoke execute on function public.rating_tags_are_valid(text[])",
        ),
      }),
    );
    expect(problems).toEqual([]);
  });

  it("هجرةٌ بلا دالّةٍ لا تمرُّ زوراً", () => {
    const problems = functionRevokeProblems(input({ sql: "select 1;" }));
    expect(problems.some((text) => text.includes("لم تُقرأْ دالّةٌ"))).toBe(true);
  });
});

describe("القاعدة ٩ — مسافةُ الأثرِ المسجَّلِ تُصرِّحُ بأثرِها (`ADR 0208`)", () => {
  it("نصٌّ في نطاقِ الأثرِ يحملُ رقمَ مسافةٍ بلا تصريحِ الأثرِ يُسقِطُ الحاجزَ", () => {
    const problems = travelledTraceProblems(
      input({
        translations: {
          ar: {
            ...dictionary("ar"),
            "rider.summary.travelledTrace.meters": "المسافةُ {meters} متراً.",
          },
          en: dictionary("en"),
          ur: dictionary("ur"),
        },
      }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("rider.summary.travelledTrace.meters");
  });

  it("الشاشةُ التي لا تركِّبُ سطرَ الأثرِ تُسقِطُ الحاجزَ — لا شِفرةً ميتةً تُحسَبُ إنجازاً", () => {
    const problems = travelledTraceProblems(
      input({
        surface: {
          "surface.tsx": SCREEN,
          [SCREEN_FILE]: GOOD_SCREEN.replace("travelledTraceLine", "gone"),
        },
      }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(SCREEN_FILE);
  });

  it("ألفاظُ القطعِ تبقى محظورةً خارجَ نطاقِ الأثرِ — نقلٌ لا حذفٌ", () => {
    const problems = straightLineProblems(
      input({
        translations: {
          ar: { ...dictionary("ar"), "rider.summary.other": "مسافةٌ مقطوعةٌ {meters} م." },
          en: dictionary("en"),
          ur: dictionary("ur"),
        },
      }),
    );
    expect(problems.some((problem) => problem.includes("مقطوعة"))).toBe(true);
  });

  it("مفتاحُ مسافةٍ لا يقعُ تحتَ الوترِ ولا الأثرِ يُسقِطُ الحاجزَ", () => {
    const problems = straightLineProblems(
      input({
        view: VIEW + '\nconst bad = "rider.summary.trip.meters";\n',
      }),
    );
    expect(problems.some((problem) => problem.includes("rider.summary.trip.meters"))).toBe(true);
  });

  it("نطاقُ الأثرِ مسموحٌ لألفاظِ القطعِ (المسارُ مبنيٌّ) — والتصريحُ شرطُه", () => {
    const problems = straightLineProblems(
      input({
        translations: {
          en: {
            ...dictionary("en"),
            "rider.summary.travelledTrace.kilometers": "Distance travelled: {kilometers} km.",
          },
          ar: dictionary("ar"),
          ur: dictionary("ur"),
        },
      }),
    );
    // لا مشكلةَ من القاعدةِ الثانيةِ: النطاقُ مسموحٌ — والتصريحَ تحكمُهُ التاسعةُ.
    expect(problems).toEqual([]);
    const trace = travelledTraceProblems(
      input({
        translations: {
          en: {
            ...dictionary("en"),
            "rider.summary.travelledTrace.kilometers": "Distance travelled: {kilometers} km.",
          },
          ar: dictionary("ar"),
          ur: dictionary("ur"),
        },
      }),
    );
    expect(trace).toHaveLength(1);
  });
});
