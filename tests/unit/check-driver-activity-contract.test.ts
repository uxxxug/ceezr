/**
 * الغرض: برهانُ سقوطِ حاجزِ عقدِ حصيلةِ السائقِ — **حالةٌ سلبيّةٌ مصنوعةٌ لكلِّ
 *   قاعدةٍ من التسعِ**، وحالةٌ موجبةٌ واحدةٌ على المستودعِ الحقيقيِّ (`ح-7`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-05`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test`.
 * يُتوقع أن يستخدمه لاحقاً: كلُّ قاعدةٍ تُزادُ في الحاجزِ تُزادُ لها حالةٌ ههنا،
 *   وإلّا فهيَ **غيرُ مُنفَذةٍ** ولو كانَ الحاجزُ أخضرَ.
 * الحاكم: docs/adr/0120-transparency-is-a-denominator-not-a-slogan.md
 *
 * ولِمَ المستودعُ الحقيقيُّ أساساً: مدخلٌ مصنوعٌ من الصفرِ يُثبِتُ مُطابَقةَ نمطٍ
 * لا انطباقَ قاعدةٍ على ما كُتِبَ فعلاً. فكلُّ حالةٍ ههنا **تفسدُ نسخةً من
 * الحقيقةِ بفسادٍ واحدٍ**، وتقيسُ أنَّ الحاجزَ يراهُ وأنَّ الأصلَ نظيفٌ.
 *
 * ## وما لا يفعلُه هذا المِلفُّ عن قصدٍ — (`ح-5`)
 *
 * - **لا يتحقّقُ من صحّةِ رقمٍ**: أنَّ المقامَ هوَ فعلاً عددُ العروضِ يُقاسُ في
 *   تكاملٍ على قاعدةٍ حقيقيّةٍ لا بنصٍّ ساكنٍ.
 * - **لا يدَّعي استيعابَ كلِّ إفسادٍ**: يُثبِتُ أنَّ لكلِّ قاعدةٍ سنّاً.
 */

import { describe, expect, test } from "bun:test";
import { readRepository } from "../../scripts/check-driver-activity-contract.ts";
import {
  absenceHonestyProblems,
  CONTRACT_FILE,
  type DriverActivityContractInput,
  denominatorProblems,
  distanceBasisProblems,
  driverActivityContractProblems,
  moneyAbsenceProblems,
  purityProblems,
  rankingTruthProblems,
  riderPrivacyProblems,
  SURFACE_FILES,
  textCoverageProblems,
  VIEW_FILE,
  windowProblems,
} from "../../scripts/lib/driver-activity-contract.ts";

const REAL: DriverActivityContractInput = readRepository();
const SCREEN = SURFACE_FILES[0] as string;

function spoil(patch: Partial<DriverActivityContractInput>): DriverActivityContractInput {
  return { ...REAL, ...patch };
}

function withSurface(
  path: string,
  mutate: (source: string) => string,
): DriverActivityContractInput {
  const source = REAL.surface[path];
  if (source === undefined) throw new Error(`${path}: غيرُ مقروءٍ في المستودعِ.`);
  return spoil({ surface: { ...REAL.surface, [path]: mutate(source) } });
}

function withArabic(key: string, value: string): DriverActivityContractInput {
  return spoil({
    translations: {
      ...REAL.translations,
      ar: { ...(REAL.translations.ar ?? {}), [key]: value },
    },
  });
}

describe("حاجزُ عقدِ حصيلةِ السائقِ — الحالةُ الموجبةُ", () => {
  test("المستودعُ الحقيقيُّ بلا مأخذٍ", () => {
    expect(driverActivityContractProblems(REAL)).toEqual([]);
  });
});

describe("١) المقامُ يُنشَرُ ويُوصَفُ ويُعرَضُ", () => {
  test("مقامٌ يُحجَبُ من الخادمِ فيسقطُ — نسبةٌ بلا مقامٍ حُكمٌ لا يُحاسَبُ عليه", () => {
    const spoiled = spoil({
      migrationSql: REAL.migrationSql.replaceAll("'denominator'", "'dnm'"),
    });
    expect(denominatorProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("نسبةٌ تُحسَبُ بلا شرطِ مقامٍ فتسقطُ — قسمةٌ على صفرٍ تُخترَعُ نسبةً", () => {
    const spoiled = spoil({
      migrationSql: REAL.migrationSql.replaceAll("'rate', case when", "'rate', round"),
    });
    expect(denominatorProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("عقدُ العميلِ بلا مقامٍ فيسقطُ — مقامٌ لا يمرُّ بالعقدِ محجوبٌ", () => {
    const spoiled = withSurface(CONTRACT_FILE, (source) => source.replaceAll("denominator", "dnm"));
    expect(denominatorProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("٢) لا مالَ مُخترَعٌ", () => {
  test("مبلغٌ يُنشَرُ بلا عَدَمٍ فيسقطُ — صفرٌ يُقرأُ «لم تكسِبْ شيئاً»", () => {
    const spoiled = spoil({
      migrationSql: REAL.migrationSql.replaceAll("'amount', null", "'amount', 0"),
    });
    expect(moneyAbsenceProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("لفظُ أجرةٍ في السطحِ فيسقطُ — تقديرٌ يُقرأُ وعداً", () => {
    const spoiled = withSurface(SCREEN, (source) => `${source}\nconst fare = 1;\n`);
    expect(moneyAbsenceProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("٣) الغيابُ لا يُقرأُ صفراً", () => {
  test("ارتدادُ نسبةٍ إلى صفرٍ فيسقطُ — سائقٌ لم يُعرَضْ عليهِ شيءٌ ليسَ «صِفرَ قبولٍ»", () => {
    const spoiled = withSurface(
      VIEW_FILE,
      (source) => `${source}\nexport const shownRate = (rate: number | null) => rate ?? 0;\n`,
    );
    expect(absenceHonestyProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("هجرةٌ بلا عَدَمٍ منشورٍ فتسقطُ — ما لم يُقَسْ يُقالُ عَدَماً", () => {
    const spoiled = spoil({ migrationSql: REAL.migrationSql.replaceAll("then null", "then 0") });
    expect(absenceHonestyProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("٤) قرارُ العرضِ نقيٌّ", () => {
  test("ساعةٌ في النطاقِ فتسقطُ — رقمٌ يختلفُ بساعةِ قارئِه لا يُقاسُ", () => {
    const spoiled = spoil({ domain: `${REAL.domain}\nconst at = Date.now();\n` });
    expect(purityProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("تنسيقُ مُضيفٍ في مُحوِّلِ العرضِ فيسقطُ — «toLocale» يُغيِّرُ النصَّ بالجهازِ", () => {
    const spoiled = withSurface(
      VIEW_FILE,
      (source) => `${source}\nexport const shown = (n: number) => n.toLocaleString();\n`,
    );
    expect(purityProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("٥) حقيقةُ الترتيبِ من الخادمِ", () => {
  test("عاملٌ يُحجَبُ من الخادمِ فيسقطُ — عاملٌ يعرفُه العميلُ وحدَه يتقادَمُ", () => {
    const spoiled = spoil({
      migrationSql: REAL.migrationSql.replaceAll("'PREFERRED_AREA'", "'AREA_PREF'"),
    });
    expect(rankingTruthProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("حُكمُ السلوكِ يُحجَبُ فيسقطُ — أثرُ الرفضِ يُقالُ من حيثُ تُحسَبُ المعادلةُ", () => {
    const spoiled = spoil({
      migrationSql: REAL.migrationSql.replaceAll("behaviour_affects_ranking", "beh_rank"),
    });
    expect(rankingTruthProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("معادلةٌ تُعادُ في العميلِ فتسقطُ — نسخةٌ ثانيةٌ تفترقُ بلا أن يسقُطَ شيءٌ", () => {
    const spoiled = withSurface(VIEW_FILE, (source) => `${source}\nconst weightProximity = 0.5;\n`);
    expect(rankingTruthProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("٦) لا هويّةَ راكبٍ ولا مُعرِّفَ تيليجرام في العميلِ", () => {
  test("هاتفُ راكبٍ في الجدولِ فيسقطُ — أرشيفٌ لا يحتاجُ هويّةً", () => {
    const spoiled = spoil({ route: `${REAL.route}\nconst leak = "rider_phone";\n` });
    expect(riderPrivacyProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("مُعرِّفُ تيليجرام في الشاشةِ فيسقطُ — مفتاحُ ملكيّةٍ لا ينزِلُ إلى جهازٍ", () => {
    const spoiled = withSurface(SCREEN, (source) => `${source}\nconst who = "telegram_id";\n`);
    expect(riderPrivacyProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("٧) المسافةُ موسومةٌ بأساسِها", () => {
  test("مسافةٌ بلا وسمٍ من الخادمِ فتسقطُ — خطٌّ مستقيمٌ يُقرأُ طريقاً مقطوعاً", () => {
    const spoiled = spoil({
      migrationSql: REAL.migrationSql.replaceAll("'STRAIGHT_LINE'", "'LINE_AIR'"),
    });
    expect(distanceBasisProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("مُهايِئٌ لا يُلزِمُ الأساسَ فيسقطُ — كِيلومترٌ بلا وسمٍ رقمٌ بلا معنىً", () => {
    const spoiled = spoil({ store: REAL.store.replaceAll("isDistanceBasis", "asBasisLoose") });
    expect(distanceBasisProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("٨) النافذةُ بمنطقةِ زمنٍ منشورةٍ", () => {
  test("منطقةُ زمنٍ تُحجَبُ فتسقطُ — حدُّ «اليومِ» يُحسَبُ بساعةِ جهازٍ", () => {
    const spoiled = spoil({ migrationSql: REAL.migrationSql.replaceAll("'timezone'", "'tz'") });
    expect(windowProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("اسمُ الإعدادِ في العميلِ فيسقطُ — عميلٌ يعرفُه يوشكُ أن يقرأَه بنفسِه", () => {
    const spoiled = withSurface(SCREEN, (source) => `${source}\nconst key = "city_timezone";\n`);
    expect(windowProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("نافذةٌ لا تُحسَبُ بلا خطأٍ مُسمّىً فتسقطُ — لا تُقرأُ حصيلةً فارغةً", () => {
    const spoiled = spoil({ route: REAL.route.replaceAll("WINDOW_UNRESOLVED", "WIN_BAD") });
    expect(windowProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("٩) لكلِّ رمزٍ نصُّه في اللغاتِ الثلاثِ", () => {
  test("نصُّ خطأٍ فارغٌ فيسقطُ — رمزٌ خامٌ على شاشةِ سائقٍ", () => {
    const spoiled = withArabic("driver.activity.error.WINDOW_UNRESOLVED", "   ");
    expect(textCoverageProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("نصُّ المقامِ بلا مُعامِلِه فيسقطُ — شِعارٌ بلا مقامٍ", () => {
    const spoiled = withArabic("driver.activity.ratio.basis", "من العروضِ");
    expect(textCoverageProblems(spoiled).length).toBeGreaterThan(0);
  });
});
