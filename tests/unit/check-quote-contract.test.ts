/**
 * الغرض: إثباتُ أنَّ حاجزَ عقدِ الاقتباسِ **يُخفِقُ فعلاً** على كلِّ افتراقٍ يدّعي
 *   منعَه — لا أنَّه يمرُّ على المستودعِ كما هوَ اليومَ (`F2-04`). وحاجزٌ لا يُخفِقُ
 *   في اختبارٍ سالبٍ تغطيةٌ مُدَّعاةٌ لا مقيسةٌ، وأخطرُ من غيابِه لأنَّه يُشترى بهِ
 *   اطمئنانٌ بلا ثمنٍ.
 * الحالة: اختبار فعلي — يُستورَدُ الحاجزُ ويُستدعى على مُدخلاتٍ مُصنَّعةٍ، ثمَّ
 *   يُستدعى على المستودعِ الحقيقيِّ في آخرِ الملفِّ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI
 * يُتوقع أن يستخدمه لاحقاً: كلُّ قاعدةٍ تُضافُ إلى الحاجزِ — قاعدةٌ بلا حالةٍ
 *   سالبةٍ ههنا لا تُحسَبُ مفروضةً.
 * ملاحظات مستقبلية: الحالةُ السالبةُ للقاعدةِ الأولى مكتوبةٌ **بمفردةٍ مُجزَّأةٍ**
 *   في نصِّ الاختبارِ نفسِه لِيُحقَنَ الممنوعُ دونَ أن يسقطَ الحاجزُ على ملفِّ
 *   اختبارِه — وهوَ حَقنٌ صريحٌ لا تحايُلٌ: الاختبارُ خارجَ نطاقِ الشريحةِ أصلاً.
 */

import { describe, expect, it } from "bun:test";
import { SERVICE_KINDS } from "../../packages/domain/quote/service-offer.ts";
import {
  BOT_PAYMENT_NOTICE_KEY,
  CLIENT_TEXT_FILES,
  containsWord,
  FINAL_INPUT_GATE,
  FINAL_INPUT_KEYS,
  FORBIDDEN_BOT_FARE_CLAIMS,
  findArabicLiterals,
  findBotPaymentDisclosureViolations,
  findForbiddenWords,
  findPaymentDisclosureViolations,
  findViolations,
  NON_REFUSAL_ERROR_CODES,
  PAYMENT_DISCLOSURE_KEYS,
  PAYMENT_DISCLOSURE_LITERALS,
  REQUIRED_QUOTE_KEYS,
  REVOKED_FUNCTIONS,
  type RepositoryInput,
  readRepository,
  SLICE_FILES,
} from "../../scripts/check-quote-contract.ts";
import { blankComments, blankSqlComments } from "../../scripts/lib/blank-comments.ts";

const LANGUAGES = ["ar", "en", "ur"] as const;

/** مفردةُ الأجرةِ مُجزَّأةً كي لا يراها حاجزٌ يفحصُ نفسَه يوماً. */
const FARE = ["fa", "re"].join("");

function dictionaries(): Record<string, Record<string, string>> {
  const all: Record<string, Record<string, string>> = {};
  const keys = [
    ...REQUIRED_QUOTE_KEYS,
    ...SERVICE_KINDS.map((service) => `rider.quote.service.${service}`),
    // القاعدةُ ٨ — بيانُ طريقةِ الدفعِ مطلوبٌ في اللغاتِ الثلاثِ كذلكَ.
    ...PAYMENT_DISCLOSURE_KEYS,
  ];
  for (const language of LANGUAGES) {
    const dictionary: Record<string, string> = {};
    for (const key of keys) dictionary[key] = `${key} ${language}`;
    all[language] = dictionary;
  }
  return all;
}

function migration(): string {
  const revokes = REVOKED_FUNCTIONS.map(
    (signature) => `revoke execute on function ${signature} from public, anon, authenticated;`,
  ).join("\n");
  return [
    "-- migration-phase: expand",
    "create or replace function quote_ride(p_telegram_id bigint) returns jsonb as $fn$",
    "  return jsonb_build_object('error', 'INVALID_POINT');",
    "  return jsonb_build_object('error', 'CITY_HAS_NO_SERVICE_AREA');",
    "  return jsonb_build_object('error', 'ORIGIN_OUTSIDE_SERVICE_AREA');",
    "  return jsonb_build_object('error', 'DESTINATION_OUTSIDE_SERVICE_AREA');",
    "  return jsonb_build_object('distance_kind', 'STRAIGHT_LINE', 'distance_m', v_meters);",
    "$fn$ language plpgsql;",
    revokes,
  ].join("\n");
}

function sources(): Record<string, string | null> {
  const slice: Record<string, string | null> = {};
  for (const path of SLICE_FILES) slice[path] = "const value = 1;\n";
  slice["packages/domain/quote/distance-kind.ts"] =
    "export interface TaggedDistance {\n  readonly kind: DistanceKind;\n  readonly meters: number;\n}\n";
  slice["packages/application/quote/ports.ts"] =
    'type Code = "ORIGIN_OUTSIDE_SERVICE_AREA" | "DESTINATION_OUTSIDE_SERVICE_AREA";\n';
  slice["apps/miniapp/src/surfaces/rider/quote/quote-view.ts"] = [
    "const REFUSAL_KEYS: Readonly<Record<string, string>> = {",
    '  INVALID_POINT: "rider.quote.refused.invalidPoint",',
    '  CITY_HAS_NO_SERVICE_AREA: "rider.quote.refused.noServiceArea",',
    '  ORIGIN_OUTSIDE_SERVICE_AREA: "rider.quote.refused.originOutside",',
    '  DESTINATION_OUTSIDE_SERVICE_AREA: "rider.quote.refused.destinationOutside",',
    "};",
  ].join("\n");
  slice["packages/application/quote/quote-ride.ts"] =
    "const arrival = await estimateArrival(pair, ports);\n";
  /*
   * والشاشةُ في المُدخَلِ السليمِ تحملُ بيانَ طريقةِ الدفعِ **قبلَ** زرِّ الطلبِ:
   * القاعدةُ ٨ تُوجِبُه، فمُدخَلٌ «سليمٌ» بلا بيانٍ **ليسَ سليماً** بعدَ اليومِ.
   * وهذا تحديثُ مُصنَّعٍ لِمطلبٍ جديدٍ لا تخفيفُ قاعدةٍ.
   */
  slice["apps/miniapp/src/surfaces/rider/quote/QuoteScreen.tsx"] = [
    ...PAYMENT_DISCLOSURE_KEYS.map((key) => `  <p>{t("${key}")}</p>`),
    '  <button>{t("rider.quote.request")}</button>',
  ].join("\n");
  return slice;
}

/*
 * حوارُ الراكبِ في المُدخَلِ السليمِ: مَعبَرٌ واحدٌ يُرسِلُ بيانَ الدفعِ، ولا مفتاحَ
 * مُدخَلٍ أخيرٍ يُطلَبُ من غيرِه. والقاعدةُ ٩ تُوجِبُه (`ADR 0170`).
 */
function dialog(): string {
  return [
    `function ${FINAL_INPUT_GATE}(`,
    "  sender: Sender,",
    "  state: DialogState,",
    `  key: "rider.ask_dropoff" | "rider.ask_parcel",`,
    "): readonly BotReply[] {",
    `  return [reply(sender, tr("${BOT_PAYMENT_NOTICE_KEY}")), reply(sender, tr(key), menu(state))];`,
    "}",
    `    return ${FINAL_INPUT_GATE}(sender, state, "rider.ask_dropoff");`,
    `      return ${FINAL_INPUT_GATE}(sender, state, "rider.ask_parcel");`,
  ].join("\n");
}

/** قاموسُ البوتِ السليمُ: بيانُ الدفعِ موجودٌ ولا دعوى أجرةٍ. */
function botDictionaries(): Record<string, Record<string, string>> {
  const built: Record<string, Record<string, string>> = {};
  for (const language of ["ar", "en", "ur"]) {
    built[language] = {
      [BOT_PAYMENT_NOTICE_KEY]: "تدفعُ للسائقِ نقداً وخارجَ التطبيقِ.",
      "rider.guide": "أرسِلْ موقعَك ثمَّ المقصدَ.",
    };
  }
  return built;
}

function healthy(): RepositoryInput {
  return {
    migrationSql: migration(),
    sliceSources: sources(),
    miniappDictionaries: dictionaries(),
    riderDialogSource: dialog(),
    botDictionaries: botDictionaries(),
  };
}

function withSlice(path: string, source: string): RepositoryInput {
  const base = healthy();
  return { ...base, sliceSources: { ...base.sliceSources, [path]: source } };
}

describe("حاجزُ عقدِ الاقتباسِ — المُدخَلُ السليمُ يمرُّ", () => {
  it("لا مخالفةَ على مُدخَلٍ مُصنَّعٍ سليمٍ: وإلّا كانت الحالاتُ السالبةُ بلا معنى", () => {
    expect(findViolations(healthy())).toEqual([]);
  });
});

describe("القاعدةُ ١ — مفردةُ الأجرةِ تُسقِطُ الحاجزَ", () => {
  it("حقلُ أجرةٍ في عقدِ المنافذِ يُرفَضُ ولو كانَ فارغاً — `م13-7` يُجمِّدُ التمهيدَ", () => {
    const violations = findViolations(
      withSlice(
        "packages/application/quote/ports.ts",
        `type Code = "ORIGIN_OUTSIDE_SERVICE_AREA" | "DESTINATION_OUTSIDE_SERVICE_AREA";\nexport interface AcceptedQuote {\n  readonly ${FARE}: null;\n}\n`,
      ),
    );
    expect(violations.some((text) => text.includes("ADR 0039"))).toBe(true);
  });

  it("عمودُ سعرٍ في الهجرةِ يُرفَضُ: الحجبُ يشملُ القاعدةَ لا الواجهةَ وحدَها", () => {
    const base = healthy();
    const violations = findViolations({
      ...base,
      migrationSql: `${migration()}\nalter table rides add column price_amount numeric;`,
    });
    expect(violations.some((text) => text.includes("ADR 0039"))).toBe(true);
  });

  it("ذِكرُ المنعِ في تعليقٍ يمرُّ: حاجزٌ يُعاقِبُ الشرحَ يُنتِجُ منعاً بلا سببٍ مقروءٍ", () => {
    const violations = findViolations(
      withSlice(
        "apps/gateway/src/routes/quote.ts",
        `// لا ${FARE} ههنا: الشِّقُّ مُجمَّدٌ.\nconst value = 1;\n`,
      ),
    );
    expect(violations).toEqual([]);
  });

  it("السماحُ المُعلَنُ لسعرِ الاشتراكِ يمرُّ: إيرادُ السائقِ لا يدفعُه الراكبُ", () => {
    const violations = findViolations(
      withSlice(
        "packages/infrastructure/quote/quote-store.ts",
        "const column = row.subscription_price_amount;\n",
      ),
    );
    expect(violations).toEqual([]);
  });
});

describe("القاعدةُ ٢ — المسافةُ لا تُنشَرُ إلّا موسومةً", () => {
  it("حمولةٌ فيها الرقمُ بلا وسمٍ تُسقِطُ الحاجزَ: الفارقُ المقيسُ يبلغُ 2.834 ضِعفاً", () => {
    const base = healthy();
    const violations = findViolations({
      ...base,
      migrationSql: migration().replace("'distance_kind', 'STRAIGHT_LINE', ", ""),
    });
    expect(violations.some((text) => text.includes("2.834"))).toBe(true);
  });

  it("وسمٌ اختياريٌّ في العقدِ يُسقِطُ الحاجزَ: المُصرِّفُ لا يُنبِّهُ على حقلٍ مَنسيٍّ", () => {
    const violations = findViolations(
      withSlice(
        "packages/domain/quote/distance-kind.ts",
        "export interface TaggedDistance {\n  readonly kind?: DistanceKind;\n  readonly meters: number;\n}\n",
      ),
    );
    expect(violations.some((text) => text.includes("TaggedDistance"))).toBe(true);
  });
});

describe("القاعدةُ ٣ — رفضا منطقةِ الخدمةِ رمزانِ مفصولانِ", () => {
  it("جمعُهما في رمزٍ واحدٍ في الهجرةِ يُسقِطُ الحاجزَ", () => {
    const base = healthy();
    const violations = findViolations({
      ...base,
      migrationSql: migration().replaceAll("DESTINATION_OUTSIDE_SERVICE_AREA", "OUTSIDE_AREA"),
    });
    expect(violations.some((text) => text.includes("DESTINATION_OUTSIDE_SERVICE_AREA"))).toBe(true);
  });

  it("رمزٌ تُعيدُه القاعدةُ ولا يعرفُه التطبيقُ يُسقِطُ الحاجزَ", () => {
    const violations = findViolations(
      withSlice(
        "packages/application/quote/ports.ts",
        'type Code = "ORIGIN_OUTSIDE_SERVICE_AREA";\n',
      ),
    );
    expect(violations.some((text) => text.includes("لا يعرفُ"))).toBe(true);
  });
});

describe("القاعدةُ ٣ (تمامُها) — كلُّ رفضٍ يبلغُ الشاشةَ", () => {
  it("رمزٌ تُعيدُه الهجرةُ ولا يُترجِمُه العرضُ يُسقِطُ الحاجزَ", () => {
    const view = healthy().sliceSources[
      "apps/miniapp/src/surfaces/rider/quote/quote-view.ts"
    ] as string;
    const violations = findViolations(
      withSlice(
        "apps/miniapp/src/surfaces/rider/quote/quote-view.ts",
        view.replace(/^\s*CITY_HAS_NO_SERVICE_AREA:.*$/m, ""),
      ),
    );
    expect(violations.some((text) => text.includes("CITY_HAS_NO_SERVICE_AREA"))).toBe(true);
  });

  it("`USER_NOT_FOUND` مُستثنىً بالإعلانِ لا بالسهوِ: عطبُ حسابٍ لا رفضُ اقتباسٍ", () => {
    expect(findViolations(healthy())).toEqual([]);
  });
});

describe("القاعدةُ ٤ — المدّةُ من النطاقِ وحدَه", () => {
  it("حالةُ استعمالٍ لا تستدعي `estimateArrival` تُسقِطُ الحاجزَ", () => {
    const violations = findViolations(
      withSlice("packages/application/quote/quote-ride.ts", "const minutes = meters / 13.8;\n"),
    );
    expect(violations.some((text) => text.includes("estimateArrival"))).toBe(true);
  });

  it("حسبةُ زمنٍ في نموذجِ العرضِ تُسقِطُ الحاجزَ", () => {
    const base = healthy();
    const view = base.sliceSources["apps/miniapp/src/surfaces/rider/quote/quote-view.ts"];
    const violations = findViolations(
      withSlice(
        "apps/miniapp/src/surfaces/rider/quote/quote-view.ts",
        `${view as string}\nconst minutes = seconds / 60;\n`,
      ),
    );
    expect(violations.some((text) => text.includes("يُنسِّقُ"))).toBe(true);
  });
});

describe("القاعدةُ ٥ — الشاشةُ تُعيدُ مفاتيحَ لا نصّاً", () => {
  it("نصٌّ عربيٌّ حرفيٌّ في نموذجِ العرضِ يُسقِطُ الحاجزَ", () => {
    const violations = findViolations(
      withSlice(
        "apps/miniapp/src/surfaces/rider/quote/quote-view.ts",
        `${healthy().sliceSources["apps/miniapp/src/surfaces/rider/quote/quote-view.ts"] as string}\nconst title = "الرحلةُ المقترَحةُ";\n`,
      ),
    );
    expect(violations.some((text) => text.includes("§9.11"))).toBe(true);
  });

  it("مفتاحٌ ناقصٌ في إحدى اللغاتِ يُسقِطُ الحاجزَ", () => {
    const base = healthy();
    const all = dictionaries();
    const urdu = { ...(all.ur ?? {}) };
    delete urdu["rider.quote.title"];
    const violations = findViolations({
      ...base,
      miniappDictionaries: { ...all, ur: urdu },
    });
    expect(violations.some((text) => text.includes("rider.quote.title"))).toBe(true);
  });

  it("مفتاحٌ حاضرٌ بنصٍّ فارغٍ يُسقِطُ الحاجزَ: الفراغُ شاشةٌ لا تُقرأُ", () => {
    const base = healthy();
    const all = dictionaries();
    const violations = findViolations({
      ...base,
      miniappDictionaries: { ...all, en: { ...(all.en ?? {}), "rider.quote.back": "   " } },
    });
    expect(violations.some((text) => text.includes("rider.quote.back"))).toBe(true);
  });
});

describe("القاعدةُ ٦ — نزعُ التنفيذِ عن الأدوارِ العامّةِ", () => {
  it("غيابُ النزعِ كُلِّيّاً يُسقِطُ الحاجزَ", () => {
    const base = healthy();
    const violations = findViolations({
      ...base,
      migrationSql: migration().replaceAll("revoke execute", "-- revoke execute"),
    });
    expect(violations.some((text) => text.includes("بابُ تعدادٍ"))).toBe(true);
  });

  it("نزعٌ ناقصٌ — دورٌ واحدٌ مَنسيٌّ — يُسقِطُ الحاجزَ", () => {
    const base = healthy();
    const violations = findViolations({
      ...base,
      migrationSql: migration().replaceAll(" from public, anon, authenticated;", " from public;"),
    });
    expect(violations.some((text) => text.includes("authenticated"))).toBe(true);
  });
});

describe("القاعدةُ ٧ — لا سرعةَ ثابتةً ولا معاملَ التفافٍ", () => {
  it("معاملُ التفافٍ في النطاقِ يُسقِطُ الحاجزَ: `ADR 0024` منعَه بقياسٍ", () => {
    const violations = findViolations(
      withSlice("packages/domain/quote/distance-kind.ts", "const DETOUR_FACTOR = 1.4;\n"),
    );
    expect(violations.some((text) => text.includes("1.124"))).toBe(true);
  });

  it("سرعةٌ متوسّطةٌ مُسمّاةٌ تُسقِطُ الحاجزَ", () => {
    const violations = findViolations(
      withSlice("packages/application/quote/quote-ride.ts", "const averageSpeed = 30;\n"),
    );
    expect(violations.some((text) => text.includes("ADR 0024"))).toBe(true);
  });
});

describe("مِلفٌّ غائبٌ", () => {
  it("غيابُ مِلفٍّ من الشريحةِ يُسقِطُ الحاجزَ: عقدٌ مُعلَنٌ بلا شِفرةٍ", () => {
    const violations = findViolations(withSlice(SLICE_FILES[0] as string, null as never));
    expect(violations.some((text) => text.includes("غائبٌ"))).toBe(true);
  });

  it("غيابُ الهجرةِ يُسقِطُ الحاجزَ: الحكمُ في القاعدةِ (القاعدة 0.5)", () => {
    const violations = findViolations({ ...healthy(), migrationSql: null });
    expect(violations.some((text) => text.includes("0.5"))).toBe(true);
  });
});

describe("أدواتُ المطابقةِ", () => {
  it("`containsWord` لا يُطابِقُ جزءَ كلمةٍ: `priceless` ليسَ سعراً", () => {
    expect(containsWord("const priceless = 1;", "price")).toBe(false);
    expect(containsWord("const price = 1;", "price")).toBe(true);
  });

  it("يُطابِقُ العربيّةَ بحدودٍ حرفيّةٍ صحيحةٍ", () => {
    expect(containsWord("حساب الأجرة هنا", "الأجرة")).toBe(true);
  });

  it("`findForbiddenWords` يُعيدُ رقمَ سطرٍ صادقاً بعدَ تفريغِ التعليقِ", () => {
    const source = ["// تعليقٌ", "const a = 1;", `const ${FARE} = 2;`].join("\n");
    const hits = findForbiddenWords("x.ts", source, [FARE], "ts");
    expect(hits.length).toBe(1);
    expect(hits[0]?.line).toBe(3);
  });

  it("جسدُ دالّةِ SQL يبقى مفحوصاً: وهوَ موضعُ الدسِّ الفعليِّ", () => {
    const source = ["-- تعليقٌ", "create function f() as $fn$", `  v := ${FARE};`, "$fn$;"].join(
      "\n",
    );
    const hits = findForbiddenWords("x.sql", source, [FARE], "sql");
    expect(hits.length).toBe(1);
    expect(hits[0]?.line).toBe(3);
  });

  it("`findArabicLiterals` يتجاوزُ التعليقَ ويُمسِكُ الحرفيَّ", () => {
    const source = ['/** شرحٌ عربيٌّ */\nconst key = "rider.quote.title";'].join("\n");
    expect(findArabicLiterals("x.ts", source)).toEqual([]);
    expect(findArabicLiterals("x.ts", 'const t = "عنوانٌ";').length).toBe(1);
  });

  it("الوحدةُ المشتركةُ هيَ المستخدَمةُ لا نسخةٌ رابعةٌ", () => {
    expect(typeof blankComments).toBe("function");
    expect(typeof blankSqlComments).toBe("function");
  });
});

/**
 * القاعدةُ ٨ — والحالاتُ السالبةُ ههنا هيَ **كلُّ** قيمةِ القاعدةِ: أن يمرَّ
 * المستودعُ كما هوَ اليومَ لا يُثبِتُ أنَّ الحاجزَ يمنعُ شيئاً.
 */
describe("القاعدة ٨ — بيانُ طريقةِ الدفعِ قبلَ الطلبِ", () => {
  const dictionaries = () => {
    const one: Record<string, string> = {};
    for (const key of PAYMENT_DISCLOSURE_KEYS) one[key] = "نصٌّ";
    return { ar: { ...one }, en: { ...one }, ur: { ...one } };
  };
  const screen = (order: "before" | "after") => {
    const lines = PAYMENT_DISCLOSURE_KEYS.map((key) => `  <p>{t("${key}")}</p>`);
    const button = '  <button>{t("rider.quote.request")}</button>';
    return order === "before" ? [...lines, button].join("\n") : [button, ...lines].join("\n");
  };

  it("الشكلُ المستقيمُ لا يُسقِطُ شيئاً — وإلّا لَكانَ الحاجزُ يمنعُ الصوابَ", () => {
    expect(findPaymentDisclosureViolations(screen("before"), dictionaries())).toEqual([]);
  });

  it("مفتاحٌ غائبٌ من القاموسِ يُسقِطُ البناءَ — في كلِّ لغةٍ على حدةٍ", () => {
    for (const language of ["ar", "en", "ur"] as const) {
      const dicts = dictionaries();
      delete dicts[language][PAYMENT_DISCLOSURE_KEYS[1] as string];
      const found = findPaymentDisclosureViolations(screen("before"), dicts);
      expect(found.length).toBe(1);
      expect(found[0]).toContain(`${language}.json`);
    }
  });

  it("مفتاحٌ فارغٌ أو فراغٌ محضٌ يُسقِطُ البناءَ — فراغٌ ليسَ بياناً", () => {
    for (const value of ["", "   "]) {
      const dicts = dictionaries();
      dicts.ar[PAYMENT_DISCLOSURE_KEYS[0] as string] = value;
      expect(findPaymentDisclosureViolations(screen("before"), dicts).length).toBe(1);
    }
  });

  it("**مفتاحٌ في القاموسِ غيرُ مرسومٍ في الشاشةِ يُسقِطُ البناءَ** — وهوَ الخضرةُ الكاذبةُ التي تُخشى", () => {
    for (const key of PAYMENT_DISCLOSURE_KEYS) {
      const source = screen("before").split(`  <p>{t("${key}")}</p>\n`).join("");
      const found = findPaymentDisclosureViolations(source, dictionaries());
      expect(found.length).toBe(1);
      expect(found[0]).toContain(key);
      expect(found[0]).toContain("غيرُ مرسومٍ");
    }
  });

  it("**بيانٌ بعدَ زرِّ الطلبِ يُسقِطُ البناءَ** — والزرُّ نقطةُ لا رجعةَ فيها", () => {
    const found = findPaymentDisclosureViolations(screen("after"), dictionaries());
    expect(found.length).toBe(1);
    expect(found[0]).toContain("بعدَ");
  });

  it("السماحُ مشروطٌ لا رخصةَ سطرٍ: مفردةٌ ممنوعةٌ تستترُ بجانبِ مفتاحٍ تُمسَكُ", () => {
    const hidden = ["f", "are"].join("");
    const source = [
      `  <p data-${hidden}="10">{t("${PAYMENT_DISCLOSURE_KEYS[0] as string}")}</p>`,
      ...PAYMENT_DISCLOSURE_KEYS.slice(1).map((key) => `  <p>{t("${key}")}</p>`),
      '  <button>{t("rider.quote.request")}</button>',
    ].join("\n");
    const found = findPaymentDisclosureViolations(source, dictionaries());
    expect(found.length).toBe(1);
    expect(found[0]).toContain("يستترُ");
  });

  it("وصنفُ العرضِ المُعلَنُ لا يُسقِطُ سطرَه — وإلّا صارَ الإعلانُ بلا معنىً", () => {
    const source = [
      `  <section className="qt__payment">`,
      ...PAYMENT_DISCLOSURE_KEYS.map(
        (key) => `    <p className="qt__payment-line">{t("${key}")}</p>`,
      ),
      '  <button>{t("rider.quote.request")}</button>',
    ].join("\n");
    expect(findPaymentDisclosureViolations(source, dictionaries())).toEqual([]);
  });

  it("شاشةٌ غائبةٌ لا تُخرِجُ الحاجزَ أخضرَ: نقصُ القاموسِ يُقالُ رغمَ ذلكَ", () => {
    expect(findPaymentDisclosureViolations(null, { ar: {}, en: {}, ur: {} }).length).toBe(12);
  });

  it("الأصنافُ مُعلَنةٌ والأطولُ أوّلاً — وإلّا بقيَ `-line` يُقرأُ مفردةً بعدَ النزعِ", () => {
    expect(PAYMENT_DISCLOSURE_LITERALS).toContain("qt__payment-line");
    expect(PAYMENT_DISCLOSURE_LITERALS.indexOf("qt__payment-line")).toBeLessThan(
      PAYMENT_DISCLOSURE_LITERALS.indexOf("qt__payment"),
    );
    for (const key of PAYMENT_DISCLOSURE_KEYS) expect(PAYMENT_DISCLOSURE_LITERALS).toContain(key);
  });

  it("**السماحُ ليسَ سابقةً**: مفتاحٌ أخٌ لم يُعلَنْ لا يُستَثنى", () => {
    for (const literal of PAYMENT_DISCLOSURE_LITERALS) {
      expect(literal).not.toBe("rider.quote.payment.");
      expect(literal).not.toBe("payment");
    }
  });
});

describe("المستودعُ الحقيقيُّ", () => {
  it("الشريحةُ كما هيَ اليومَ تمرُّ بالحاجزِ: وهذا ما يُحرَسُ لا ما يُدَّعى", () => {
    expect(findViolations(readRepository())).toEqual([]);
  });

  it("الاستثناءُ من الرفضِ مُعلَنٌ بالاسمِ ولا يتوسَّعُ صامتاً", () => {
    expect(NON_REFUSAL_ERROR_CODES).toEqual(["USER_NOT_FOUND"]);
  });

  it("مِلفّا العميلِ المحكومانِ بالنصِّ من الشريحةِ نفسِها", () => {
    for (const path of CLIENT_TEXT_FILES) expect(SLICE_FILES).toContain(path);
  });
});

/*
 * القاعدةُ ٩ — بيانُ الدفعِ في بابِ البوتِ (`ADR 0170`).
 *
 * القاعدةُ ٨ حرسَت شاشةً واحدةً، والطلبُ يُنشَأُ من بابَينِ. وهذه الحالاتُ تُرى
 * **ساقطةً** على كلِّ خرقٍ منفرداً، إذ حاجزٌ بلا حالةٍ سالبةٍ مقيسةٍ دعوًى لا إنفاذٌ.
 */
describe("القاعدةُ ٩ — بيانُ الدفعِ قبلَ المُدخَلِ الأخيرِ في البوتِ", () => {
  const dialogSource = (): string => healthy().riderDialogSource ?? "";
  const dicts = (): Record<string, Record<string, string>> => ({ ...botDictionaries() });

  it("المُدخَلُ السليمُ يمرُّ — فالحاجزُ لا يمنعُ الصوابَ", () => {
    expect(findBotPaymentDisclosureViolations(dialogSource(), dicts())).toEqual([]);
  });

  it("الحاجزُ لا يمرُّ حيثُ لا يقرأُ حوارَ الراكبِ", () => {
    const violations = findBotPaymentDisclosureViolations(null, dicts());
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.includes("غيرُ مقروءٍ"))).toBe(true);
  });

  for (const language of ["ar", "en", "ur"]) {
    it(`مفتاحُ البيانِ غائبٌ في «${language}» ⇒ يسقُطُ باسمِ اللغةِ`, () => {
      const broken = dicts();
      const copy = { ...(broken[language] ?? {}) };
      delete copy[BOT_PAYMENT_NOTICE_KEY];
      broken[language] = copy;
      const violations = findBotPaymentDisclosureViolations(dialogSource(), broken);
      expect(violations.some((v) => v.includes(`${language}.json`))).toBe(true);
    });
  }

  it("مفتاحُ البيانِ فراغٌ ⇒ يسقُطُ، فالفراغُ ليسَ بياناً", () => {
    const broken = dicts();
    broken["ar"] = { ...(broken["ar"] ?? {}), [BOT_PAYMENT_NOTICE_KEY]: "   " };
    expect(findBotPaymentDisclosureViolations(dialogSource(), broken).length).toBeGreaterThan(0);
  });

  it("المَعبَرُ غائبٌ ⇒ يسقُطُ، فبيانٌ مبثوثٌ في الفروعِ يُنسى في الفرعِ التالي", () => {
    const violations = findBotPaymentDisclosureViolations(
      dialogSource().split(`function ${FINAL_INPUT_GATE}`).join("function somethingElse"),
      dicts(),
    );
    expect(violations.some((v) => v.includes("لا مَعبَرَ"))).toBe(true);
  });

  it("المَعبَرُ قائمٌ بلا بيانٍ ⇒ يسقُطُ، فمَعبَرٌ بلا بيانٍ بابٌ سُمِّيَ حاجزاً", () => {
    const violations = findBotPaymentDisclosureViolations(
      dialogSource().split(`tr("${BOT_PAYMENT_NOTICE_KEY}")`).join('tr("rider.welcome")'),
      dicts(),
    );
    expect(violations.some((v) => v.includes("لا يُرسِلُ"))).toBe(true);
  });

  for (const key of FINAL_INPUT_KEYS) {
    it(`«${key}» مطلوبٌ بغيرِ المَعبَرِ ⇒ يسقُطُ`, () => {
      const bypassed = dialogSource()
        .split(`${FINAL_INPUT_GATE}(sender, state, "${key}");`)
        .join(`reply(sender, tr("${key}"), menu(state));`);
      const violations = findBotPaymentDisclosureViolations(bypassed, dicts());
      expect(violations.some((v) => v.includes(key) && v.includes("بغيرِ"))).toBe(true);
    });

    it(`«${key}» لا يُطلَبُ ألبتَّةَ ⇒ يسقُطُ صريحاً لا يُقرأُ خضرةً`, () => {
      const removed = dialogSource()
        .split("\n")
        .filter((line) => !line.includes(`${FINAL_INPUT_GATE}(sender, state, "${key}")`))
        .join("\n")
        .split(`| "${key}"`)
        .join("")
        .split(`"${key}" |`)
        .join("");
      const violations = findBotPaymentDisclosureViolations(removed, dicts());
      expect(violations.some((v) => v.includes(key) && v.includes("ألبتَّةَ"))).toBe(true);
    });
  }

  for (const claim of FORBIDDEN_BOT_FARE_CLAIMS) {
    it(`دعوى «${claim}» في نصِّ راكبٍ ⇒ يسقُطُ`, () => {
      const broken = dicts();
      broken["ar"] = { ...(broken["ar"] ?? {}), "rider.guide": `نصٌّ فيه ${claim} لا أكثرَ` };
      const violations = findBotPaymentDisclosureViolations(dialogSource(), broken);
      expect(violations.some((v) => v.includes(claim))).toBe(true);
    });
  }

  it("دعوى الأجرةِ في نصِّ سائقٍ لا تُسقِطُ — الحكمُ على شريحةِ الراكبِ لا على كلِّ نصٍّ", () => {
    const broken = dicts();
    broken["ar"] = { ...(broken["ar"] ?? {}), "driver.note": "السعر التقديري للاشتراكِ" };
    expect(findBotPaymentDisclosureViolations(dialogSource(), broken)).toEqual([]);
  });

  it("المستودعُ الحقيقيُّ يمرُّ بالقاعدةِ ٩", () => {
    const input = readRepository();
    expect(
      findBotPaymentDisclosureViolations(input.riderDialogSource, input.botDictionaries),
    ).toEqual([]);
  });
});
