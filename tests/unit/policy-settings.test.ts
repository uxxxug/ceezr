/**
 * الغرض: اختبار البوابة الوحيدة التي تدخل منها القيم التجارية إلى الكود.
 * الحالة: اختبار فعلي. يغطي القاعدة 0.3: لا قيمة تجارية إلا من platform_settings ومُتحقَّق منها.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: القيم المرجعية هنا مأخوذة من ملف البذر نفسه، فأي تغيير في البذر يُكشف هنا.
 */
import { describe, expect, it } from "bun:test";
import {
  isSettingKey,
  parseCitySettings,
  SETTING_KEYS,
  subscriptionPriceFor,
  toMatchingParameters,
} from "../../packages/domain/policy/entity.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
import { isErr, isOk } from "../../packages/shared/result/index.ts";
import { SEEDED_SETTINGS, seededRows } from "../support/in-memory-ports.ts";

const JED = "city-jed" as CityId;
const MKK = "city-mkk" as CityId;

describe("سجل المفاتيح", () => {
  it("خمسة عشر مفتاحاً كما في مخطط البذر", () => {
    expect(SETTING_KEYS).toHaveLength(15);
  });
  it("يتعرّف على مفتاح معروف ويرفض المجهول", () => {
    expect(isSettingKey("search_radius_km")).toBe(true);
    expect(isSettingKey("surge_multiplier")).toBe(false);
  });
  it("لكل مفتاح في السجل قيمة مبذورة", () => {
    for (const key of SETTING_KEYS) {
      expect(SEEDED_SETTINGS[key]).toBeDefined();
    }
  });
});

describe("parseCitySettings — المسار السليم", () => {
  it("يقرأ القيم المبذورة كما هي بلا أي قيمة مرمَّزة في الكود", () => {
    const r = parseCitySettings(JED, seededRows(JED));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.subscriptionPriceTransport).toBe(250);
    expect(r.value.subscriptionPriceBoth).toBe(400);
    expect(r.value.currency).toBe("SAR");
    expect(r.value.trialDays).toBe(30);
    expect(r.value.offerTimeoutSeconds).toBe(45);
    expect(r.value.supportedLanguages).toEqual(["ar"]);
  });

  it("يقبل القيم الرقمية القادمة كنصوص من jsonb", () => {
    const r = parseCitySettings(JED, seededRows(JED, { search_radius_km: "12.5" }));
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.searchRadiusKm).toBe(12.5);
  });

  it("يتجاهل مفاتيح مستقبلية مجهولة بلا إسقاط اللقطة", () => {
    const rows = [
      ...seededRows(JED),
      { cityId: JED, key: "future_key_not_yet_used", value: 1, valueType: "number" } as const,
    ];
    expect(isOk(parseCitySettings(JED, rows))).toBe(true);
  });
});

describe("parseCitySettings — الرفض", () => {
  it("يرفض نقص أي مفتاح ويسمّيه", () => {
    const rows = seededRows(JED).filter((r) => r.key !== "offer_timeout_seconds");
    const result = parseCitySettings(JED, rows);
    expect(isErr(result)).toBe(true);
    if (isErr(result) && result.error.code === "MISSING_SETTING") {
      expect(result.error.key).toBe("offer_timeout_seconds");
    } else {
      throw new Error("توقّعنا MISSING_SETTING");
    }
  });

  it("يرفض مهلة عرض غير صحيحة عدداً", () => {
    const result = parseCitySettings(JED, seededRows(JED, { offer_timeout_seconds: 45.5 }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INVALID_SETTING");
  });

  it("يرفض نصف قطر سالباً", () => {
    expect(isErr(parseCitySettings(JED, seededRows(JED, { search_radius_km: -1 })))).toBe(true);
  });

  it("يرفض وزناً خارج المدى [0,1]", () => {
    expect(isErr(parseCitySettings(JED, seededRows(JED, { match_weight_proximity: 1.4 })))).toBe(
      true,
    );
  });

  it("يرفض وزنين لا يجمعان واحداً — أهم حماية للمعادلة", () => {
    const result = parseCitySettings(
      JED,
      seededRows(JED, { match_weight_proximity: 0.8, match_weight_rating: 0.4 }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result) && result.error.code === "INCONSISTENT_WEIGHTS") {
      expect(result.error.sum).toBeCloseTo(1.2, 10);
    } else {
      throw new Error("توقّعنا INCONSISTENT_WEIGHTS");
    }
  });

  it("يقبل توزيعاً مختلفاً للوزنين ما دام مجموعهما واحداً", () => {
    const result = parseCitySettings(
      JED,
      seededRows(JED, { match_weight_proximity: 0.2, match_weight_rating: 0.8 }),
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(toMatchingParameters(result.value).weightRating).toBe(0.8);
  });

  it("يرفض عملة فارغة", () => {
    expect(isErr(parseCitySettings(JED, seededRows(JED, { currency: "  " })))).toBe(true);
  });

  it("يرفض قائمة لغات فارغة", () => {
    expect(isErr(parseCitySettings(JED, seededRows(JED, { supported_languages: [] })))).toBe(true);
  });

  it("يرفض قائمة لغات ليست نصوصاً", () => {
    expect(isErr(parseCitySettings(JED, seededRows(JED, { supported_languages: [1, 2] })))).toBe(
      true,
    );
  });

  it("يرفض صفّاً ينتمي إلى مدينة أخرى — عزل المدن (القاعدة 0.4)", () => {
    const rows = [...seededRows(JED), ...seededRows(MKK)];
    const result = parseCitySettings(JED, rows);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INVALID_SETTING");
  });
});

describe("toMatchingParameters", () => {
  it("يمرّر كل معاملات المطابقة من الإعدادات بلا استنباط", () => {
    const parsed = parseCitySettings(JED, seededRows(JED));
    if (!isOk(parsed)) throw new Error("فشل التحليل");
    expect(toMatchingParameters(parsed.value)).toEqual({
      searchRadiusKm: 10,
      weightProximity: 0.7,
      weightRating: 0.3,
      broadcastBatchSize: 5,
      defaultRating: 4.5,
      ratingMinCountForTrust: 3,
    });
  });
});

describe("subscriptionPriceFor", () => {
  it("سعر كل خطة يأتي من الإعدادات", () => {
    const parsed = parseCitySettings(JED, seededRows(JED));
    if (!isOk(parsed)) throw new Error("فشل التحليل");
    expect(subscriptionPriceFor(parsed.value, "transport")).toBe(250);
    expect(subscriptionPriceFor(parsed.value, "delivery")).toBe(250);
    expect(subscriptionPriceFor(parsed.value, "both")).toBe(400);
  });

  it("يتبع تغيير السعر في الإعدادات فوراً", () => {
    const parsed = parseCitySettings(JED, seededRows(JED, { subscription_price_both: 555 }));
    if (!isOk(parsed)) throw new Error("فشل التحليل");
    expect(subscriptionPriceFor(parsed.value, "both")).toBe(555);
  });
});
