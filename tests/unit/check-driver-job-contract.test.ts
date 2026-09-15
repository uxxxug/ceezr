/**
 * الغرض: برهانُ سقوطِ حاجزِ عقدِ مَهمّةِ السائقِ — حالةٌ سلبيّةٌ مصنوعةٌ لكلِّ
 *   قاعدةٍ من الثمانِ، وحالةٌ موجبةٌ واحدةٌ على المستودعِ الحقيقيِّ (`ح-7`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-03`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test`.
 * يُتوقع أن يستخدمه لاحقاً: كلُّ قاعدةٍ تُزادُ في الحاجزِ تُزادُ لها حالةٌ ههنا،
 *   وإلّا فهيَ **غيرُ مُنفَذةٍ** ولو كانَ الحاجزُ أخضرَ.
 * يحرسُه: هذا المِلفُّ نفسُه حاجزُ الحاجزِ.
 * الحاكم: docs/adr/0118-a-phase-is-a-human-stamp-not-a-distance-inference.md
 *
 * ولِمَ المستودعُ الحقيقيُّ أساساً للحالاتِ السلبيّةِ: لأنَّ مدخلاً مصنوعاً من
 * الصفرِ يُثبِتُ أنَّ الدالّةَ تُطابِقُ نمطاً، **لا** أنَّ القاعدةَ تنطبقُ على ما
 * كُتِبَ فعلاً. فكلُّ حالةٍ ههنا **تفسدُ نسخةً من الحقيقةِ بفسادٍ واحدٍ** وتقيسُ
 * أنَّ الحاجزَ يراهُ — وأنَّ الأصلَ قبلَ الإفسادِ نظيفٌ.
 *
 * ## وما لا يفعلُه هذا المِلفُّ عن قصدٍ — (`ح-5`)
 *
 * - **لا يقيسُ سلوكَ الشاشةِ ولا SQL**: يقيسُ **حكمَ الحاجزِ** فحسب؛ ذرّيّةُ
 *   الانتقالِ وصدقُ الأختامِ يُقاسانِ في اختبارِ التكاملِ.
 * - **لا يدَّعي استيعاباً لكلِّ إفسادٍ ممكنٍ**: يُثبِتُ أنَّ لكلِّ قاعدةٍ سنّاً،
 *   لا أنَّها لا تُخترَقُ بحيلةٍ نصّيّةٍ. والحدُّ مُعلَنٌ في رأسِ وحدةِ الحاجزِ.
 */

import { describe, expect, test } from "bun:test";
import { readRepository } from "../../scripts/check-driver-job-contract.ts";
import {
  blankSqlObjectComments,
  type DriverJobContractInput,
  driverJobContractProblems,
  errorTextProblems,
  grantProblems,
  keyParityProblems,
  knownErrorCodesInSurface,
  mentions,
  moneyVocabularyProblems,
  phaseHonestyProblems,
  publishedPayloadKeys,
  riderPrivacyProblems,
  SCREEN_FILE,
  singleWriterProblems,
  statusExhaustiveProblems,
  statusTableCodes,
  VIEW_FILE,
} from "../../scripts/lib/driver-job-contract.ts";

const REAL: DriverJobContractInput = readRepository();

/** نسخةٌ من الحقيقةِ بفسادٍ واحدٍ — والفسادُ يُوصَفُ في اسمِ الحالةِ. */
function spoil(patch: Partial<DriverJobContractInput>): DriverJobContractInput {
  return { ...REAL, ...patch };
}

function withSurface(path: string, mutate: (source: string) => string): DriverJobContractInput {
  const source = REAL.surface[path];
  if (source === undefined) throw new Error(`${path}: غيرُ مقروءٍ في المستودعِ.`);
  return spoil({ surface: { ...REAL.surface, [path]: mutate(source) } });
}

function withTranslations(
  language: string,
  mutate: (dictionary: Record<string, string>) => Record<string, string>,
): DriverJobContractInput {
  const dictionary = { ...(REAL.translations[language] ?? {}) };
  return spoil({ translations: { ...REAL.translations, [language]: mutate(dictionary) } });
}

describe("الحالةُ الموجبةُ — المستودعُ كما هوَ", () => {
  test("لا مشكلةَ واحدةً في المستودعِ الحقيقيِّ", () => {
    expect(driverJobContractProblems(REAL)).toEqual([]);
  });

  test("المستودعُ يُغذّي الحاجزَ بمادّةٍ حقيقيّةٍ لا بفراغٍ", () => {
    expect(REAL.publicErrorCodes.length).toBeGreaterThanOrEqual(11);
    expect(Object.keys(REAL.surface)).toHaveLength(4);
    expect(statusTableCodes(REAL.route).size).toBe(REAL.publicErrorCodes.length);
    expect(knownErrorCodesInSurface(REAL.surface).size).toBe(REAL.publicErrorCodes.length);
    expect(publishedPayloadKeys(REAL.functionsSql).has("server_time")).toBe(true);
  });
});

describe("القاعدة ١ — مفاتيحُ النصِّ", () => {
  test("مفتاحٌ ناقصٌ في لغةٍ يُسقِطُ", () => {
    const input = withTranslations("en", (dictionary) => {
      delete dictionary["driver.job.title"];
      return dictionary;
    });
    expect(keyParityProblems(input).join("\n")).toContain("driver.job.title");
  });

  test("مفتاحٌ زائدٌ في لغةٍ يُسقِطُ كذلك — النقصُ يُقاسُ في الاتّجاهَينِ", () => {
    const input = withTranslations("ur", (dictionary) => ({
      ...dictionary,
      "driver.job.zzz.invented": "…",
    }));
    expect(keyParityProblems(input).join("\n")).toContain("driver.job.zzz.invented");
  });

  test("مفتاحٌ يُنادى في السطحِ وليسَ في القاموسِ يُسقِطُ", () => {
    const input = withSurface(SCREEN_FILE, (source) =>
      source.replace('"driver.job.title"', '"driver.job.titleMissing"'),
    );
    expect(keyParityProblems(input).join("\n")).toContain("driver.job.titleMissing");
  });

  test("مفتاحٌ يُبنى بقالبٍ وليسَ في القاموسِ يُسقِطُ — والقالبُ لا يُرى بالعينِ", () => {
    const input = withTranslations("ar", (dictionary) => {
      delete dictionary["driver.job.action.COMPLETE_RIDE"];
      return dictionary;
    });
    expect(keyParityProblems(input).join("\n")).toContain("driver.job.action.COMPLETE_RIDE");
  });

  test("قاموسٌ بلا مفتاحٍ بالبادئةِ يُسقِطُ ولا يمرُّ بفراغٍ", () => {
    const input = spoil({ translations: { ar: {}, en: {}, ur: {} } });
    expect(keyParityProblems(input).length).toBeGreaterThan(0);
  });
});

describe("القاعدة ٢ — نصوصُ الرموزِ", () => {
  test("رمزٌ منشورٌ بلا نصٍّ يُسقِطُ", () => {
    const input = withTranslations("ar", (dictionary) => {
      delete dictionary["driver.job.error.PHASE_MISMATCH"];
      return dictionary;
    });
    expect(errorTextProblems(input).join("\n")).toContain("PHASE_MISMATCH");
  });

  test("غيابُ نصِّ المجهولِ يُسقِطُ — الرفضُ غيرُ المُصنَّفِ يبقى مقروءاً", () => {
    const input = withTranslations("en", (dictionary) => {
      delete dictionary["driver.job.error.UNKNOWN"];
      return dictionary;
    });
    expect(errorTextProblems(input).join("\n")).toContain("UNKNOWN");
  });

  test("رمزٌ يعرفُه السطحُ ولا يُصدِرُه التطبيقُ يُسقِطُ", () => {
    const input = withSurface(VIEW_FILE, (source) =>
      source.replace('"JOB_NOT_FOUND"', '"JOB_NOT_FOUND",\n  "GHOST_CODE"'),
    );
    expect(errorTextProblems(input).join("\n")).toContain("GHOST_CODE");
  });

  test("رمزٌ يُصدِرُه التطبيقُ ولا يعرفُه السطحُ يُسقِطُ", () => {
    const input = withSurface(VIEW_FILE, (source) => source.replace('"PHASE_MISMATCH",', ""));
    expect(errorTextProblems(input).join("\n")).toContain("PHASE_MISMATCH");
  });

  test("قائمةُ رموزٍ فارغةٌ لا تمرُّ", () => {
    expect(errorTextProblems(spoil({ publicErrorCodes: [] })).length).toBeGreaterThan(0);
  });
});

describe("القاعدة ٣ — لا لفظَ مالٍ", () => {
  test("لفظُ مالٍ في شِفرةِ السطحِ يُسقِطُ", () => {
    const input = withSurface(SCREEN_FILE, (source) => `${source}\nconst fare = 0;\n`);
    expect(moneyVocabularyProblems(input).join("\n")).toContain("fare");
  });

  test("لفظُ مالٍ في نصٍّ مُعرَّبٍ يُسقِطُ", () => {
    const input = withTranslations("ar", (dictionary) => ({
      ...dictionary,
      "driver.job.notes": "الأجرة عشرون",
    }));
    expect(moneyVocabularyProblems(input).join("\n")).toContain("أجرة");
  });

  test("لفظُ مالٍ في الهجرةِ يُسقِطُ", () => {
    const input = spoil({ functionsSql: `${REAL.functionsSql}\nselect 1 as commission;\n` });
    expect(moneyVocabularyProblems(input).join("\n")).toContain("commission");
  });

  test("وصفُ الكائنِ نثرٌ فلا يُسقِطُ — وشِفرةٌ بعينِ اللفظِ تُسقِطُ", () => {
    const prose = "comment on function f() is 'لا أجرةَ ههنا ألبتّةَ';";
    expect(mentions(blankSqlObjectComments(prose), "أجرة")).toBe(false);
    expect(mentions("update t set fare = 1;", "fare")).toBe(true);
  });

  test("الذِكرُ بحدودِ الكلمةِ: «priceless» ليسَ «price»", () => {
    expect(mentions("const priceless = 1;", "price")).toBe(false);
  });
});

describe("القاعدة ٤ — كاتبٌ واحدٌ لكلِّ انتقالٍ", () => {
  test("غيابُ التفويضِ إلى start_ride يُسقِطُ", () => {
    const input = spoil({
      functionsSql: REAL.functionsSql
        .replaceAll("start_ride(", "inline_start_(")
        .replaceAll("driver_inline_start_(", "driver_start_ride("),
    });
    expect(singleWriterProblems(input).join("\n")).toContain("start_ride");
  });

  test("غيابُ التفويضِ إلى complete_ride يُسقِطُ", () => {
    const input = spoil({ functionsSql: REAL.functionsSql.replaceAll("complete_ride(", "x_(") });
    expect(singleWriterProblems(input).join("\n")).toContain("complete_ride");
  });

  test("كاتبٌ ثانٍ للحالةِ يُسقِطُ", () => {
    const input = spoil({
      functionsSql: `${REAL.functionsSql}\nupdate orders set status = 'in_progress' where id = p_order_id;\n`,
    });
    expect(singleWriterProblems(input).join("\n")).toContain("set status");
  });

  test("كاتبانِ لِـarrived_at يُسقِطانِ", () => {
    const input = spoil({
      functionsSql: `${REAL.functionsSql}\nupdate orders set arrived_at = now() where id = p_order_id;\n`,
    });
    expect(singleWriterProblems(input).join("\n")).toContain("arrived_at");
  });

  test("لا كاتبَ لِـarrived_at ألبتّةَ يُسقِطُ", () => {
    const input = spoil({
      functionsSql: REAL.functionsSql.replace("set arrived_at", "set updated_at"),
    });
    expect(singleWriterProblems(input).join("\n")).toContain("arrived_at");
  });
});

describe("القاعدة ٥ — نزعُ التنفيذِ ومنحُه", () => {
  test("غيابُ النزعِ لدالّةٍ يُسقِطُ", () => {
    const input = spoil({
      functionsSql: REAL.functionsSql.replace(
        /revoke all on function driver_mark_arrived[^;]*;/,
        "",
      ),
    });
    expect(grantProblems(input).join("\n")).toContain("driver_mark_arrived");
  });

  test("نزعٌ ناقصُ الأدوارِ يُسقِطُ", () => {
    const input = spoil({
      functionsSql: REAL.functionsSql.replace(
        "revoke all on function driver_active_job(bigint) from public, anon, authenticated;",
        "revoke all on function driver_active_job(bigint) from public, anon;",
      ),
    });
    expect(grantProblems(input).join("\n")).toContain("authenticated");
  });

  test("غيابُ المنحِ لدورِ الخدمةِ يُسقِطُ", () => {
    const input = spoil({
      functionsSql: REAL.functionsSql.replace(
        "grant execute on function driver_start_ride(bigint, uuid) to service_role;",
        "",
      ),
    });
    expect(grantProblems(input).join("\n")).toContain("driver_start_ride");
  });

  test("هجرةٌ بلا دالّةٍ لا تمرُّ بفراغٍ", () => {
    expect(grantProblems(spoil({ functionsSql: "select 1;" })).length).toBeGreaterThan(0);
  });
});

describe("القاعدة ٦ — لا ساعةَ ولا استنتاجَ طَورٍ", () => {
  test("ساعةُ جهازٍ في نموذجِ العرضِ تُسقِطُ", () => {
    const input = withSurface(VIEW_FILE, (source) => `${source}\nconst t = Date.now();\n`);
    expect(phaseHonestyProblems(input).join("\n")).toContain("Date.now(");
  });

  test("ساعةُ جهازٍ في النطاقِ تُسقِطُ", () => {
    const input = spoil({ domain: `${REAL.domain}\nconst t = new Date();\n` });
    expect(phaseHonestyProblems(input).join("\n")).toContain("new Date(");
  });

  test("حسابُ مسافةٍ في الهجرةِ يُسقِطُ ولو كانَ عرضاً محضاً", () => {
    const input = spoil({
      functionsSql: `${REAL.functionsSql}\nselect st_distance(a, b) from t;\n`,
    });
    expect(phaseHonestyProblems(input).join("\n")).toContain("st_distance");
  });

  test("لفظُ قُربٍ في نصٍّ مُعرَّبٍ يُسقِطُ", () => {
    const input = withTranslations("ar", (dictionary) => ({
      ...dictionary,
      "driver.job.phase.atPickup": "أنتَ على قُرب من الراكبِ",
    }));
    expect(phaseHonestyProblems(input).join("\n")).toContain("قُرب");
  });

  test("مقارنةُ حالةٍ في الشاشةِ تُسقِطُ — آلةُ حالاتٍ ثانيةٌ في العميلِ", () => {
    const input = withSurface(SCREEN_FILE, (source) =>
      source.replace(
        "export function JobScreen",
        'const phase = "in_progress";\nexport function JobScreen',
      ),
    );
    expect(phaseHonestyProblems(input).join("\n")).toContain("in_progress");
  });

  test("هجرةٌ لا تُنشِرُ لحظةَ الخادمِ تُسقِطُ", () => {
    const input = spoil({
      functionsSql: REAL.functionsSql.replaceAll("'server_time',", "'srv',"),
    });
    expect(phaseHonestyProblems(input).join("\n")).toContain("server_time");
  });

  test("هجرةٌ لا تُنشِرُ الفعلَ التاليَ تُسقِطُ", () => {
    const input = spoil({
      functionsSql: REAL.functionsSql.replaceAll("'next_action',", "'na',"),
    });
    expect(phaseHonestyProblems(input).join("\n")).toContain("next_action");
  });
});

describe("القاعدة ٧ — جدولُ حالاتِ HTTP", () => {
  test("رمزٌ بلا حالةٍ يُسقِطُ", () => {
    const input = spoil({ route: REAL.route.replace(/^\s*PHASE_MISMATCH:.*$/m, "") });
    expect(statusExhaustiveProblems(input).join("\n")).toContain("PHASE_MISMATCH");
  });

  test("مدخلٌ ميْتٌ في الجدولِ يُسقِطُ", () => {
    const input = spoil({
      route: REAL.route
        .replace("STATUS_BY_ERROR", "STATUS_BY_ERROR")
        .replace(/(STATUS_BY_ERROR[^=]*=\s*\{)/, "$1\n  DEAD_ENTRY: 418,"),
    });
    expect(statusExhaustiveProblems(input).join("\n")).toContain("DEAD_ENTRY");
  });

  test("جدولٌ غيرُ مقروءٍ لا يمرُّ بفراغٍ", () => {
    expect(
      statusExhaustiveProblems(spoil({ route: "export const x = 1;" })).length,
    ).toBeGreaterThan(0);
  });
});

describe("القاعدة ٨ — هويّةُ الراكبِ", () => {
  test("نشرُ هاتفِ الراكبِ يُسقِطُ", () => {
    const input = spoil({
      functionsSql: REAL.functionsSql.replace(
        "'first_name',",
        "'phone', v_rider_user.phone,\n      'first_name',",
      ),
    });
    expect(riderPrivacyProblems(input).join("\n")).toContain("phone");
  });

  test("نشرُ معرِّفِ تلغرامَ للراكبِ يُسقِطُ", () => {
    const input = spoil({
      functionsSql: REAL.functionsSql.replace(
        "'first_name',",
        "'telegram_id', 1,\n      'first_name',",
      ),
    });
    expect(riderPrivacyProblems(input).join("\n")).toContain("telegram_id");
  });

  test("ذِكرُ هويّةٍ في مِلفِّ عميلٍ يُسقِطُ ولو لم تُنشَرْ", () => {
    const input = withSurface(SCREEN_FILE, (source) => `${source}\nconst id = job.rider_id;\n`);
    expect(riderPrivacyProblems(input).join("\n")).toContain("rider_id");
  });

  test("ذِكرُ هويّةٍ في مِلفِّ المساراتِ يُسقِطُ", () => {
    const input = spoil({ route: `${REAL.route}\nconst full_name = "";\n` });
    expect(riderPrivacyProblems(input).join("\n")).toContain("full_name");
  });

  test("الاسمُ الأوّلُ واللغةُ مسموحانِ بإعلانٍ — والحدُّ مُعلَنٌ لا مضمرٌ", () => {
    expect(publishedPayloadKeys(REAL.functionsSql).has("first_name")).toBe(true);
    expect(riderPrivacyProblems(REAL)).toEqual([]);
  });
});

describe("الحكمُ المُجمَّعُ", () => {
  test("يجمعُ مشكلاتِ قواعدَ متعدّدةٍ في حكمٍ واحدٍ", () => {
    const input = spoil({
      route: `${REAL.route}\nconst full_name = "";\n`,
      functionsSql: `${REAL.functionsSql}\nselect 1 as fare;\n`,
    });
    const problems = driverJobContractProblems(input).join("\n");
    expect(problems).toContain("full_name");
    expect(problems).toContain("fare");
  });

  test("يذكرُ موضعَ المشكلةِ وسببَها لا رقمَ قاعدةٍ مُجرَّداً", () => {
    const input = spoil({ functionsSql: `${REAL.functionsSql}\nselect 1 as wallet;\n` });
    const [first] = driverJobContractProblems(input);
    expect(first).toContain("supabase/migrations/");
    expect(first?.length ?? 0).toBeGreaterThan(40);
  });

  test("مِلفٌّ غائبٌ من السطحِ يُسقِطُ ولا يُقرأُ نجاحاً", () => {
    const surface = { ...REAL.surface };
    delete surface[VIEW_FILE];
    const problems = driverJobContractProblems(spoil({ surface })).join("\n");
    expect(problems).toContain(VIEW_FILE);
  });
});
