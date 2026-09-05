/**
 * الغرض: إثباتُ أن بيانَ مدنِ الإطلاق يُرفَض قبل لمسِ القاعدة إن كان يُنتج
 *   إطلاقاً ناقصاً أو قروباً مشتركاً بين مدينتين.
 * الحالة: اختبار وحدة فعلي — لا قاعدة ولا شبكة.
 * ينتمي إلى: tests/unit
 * ملاحظات مستقبلية: مدينةٌ سادسةٌ تُضاف إلى `LAUNCH_CITY_CODES` فيسقط أوّلُ
 *   اختبارٍ هنا حتى يُحدَّث البيان — وهذا مقصود: العددُ شرطٌ لا إعداد.
 *
 * لماذا يُفحَص البيانُ قبل القاعدة: تشغيلُ الإطلاق بقروبٍ واحدٍ مكتوبٍ لمدينتين
 * لا يُخفق في أيّ قيدٍ من قيود القاعدة — `cities_group_ids_distinct_*` تحرس
 * التمايزَ داخلَ المدينة لا بينها — فيمرّ التفعيلُ ناجحاً ثمّ يرى سائقُ جدة
 * طلبَ الرياض في قروبه ويقبله. فالعزلُ يُنكَر من بابِ الإعداد لا من بابِ الكود.
 */

import { describe, expect, it } from "bun:test";
import { LAUNCH_CITY_CODES, validateManifest } from "../../scripts/activate-launch-cities.ts";

const قروب = (n: number): string => String(-5000000000 - n);

function بيانٌ_كامل(): Record<string, unknown> {
  return {
    adminTelegramId: "1234567890",
    cities: LAUNCH_CITY_CODES.map((code, index) => ({
      code,
      supportGroupId: قروب(index * 3 + 1),
      escalationGroupId: قروب(index * 3 + 2),
      driversGroupId: قروب(index * 3 + 3),
    })),
  };
}

describe("بيانُ مدنِ الإطلاق: يُقبل الكاملُ وحدَه", () => {
  it("مدنُ الإطلاق خمسٌ بأسمائها لا عدداً مجرّداً", () => {
    expect([...LAUNCH_CITY_CODES]).toEqual(["JED", "MKK", "RUH", "TIF", "MED"]);
  });

  it("يقبل بياناً فيه الخمسُ بقروباتٍ متمايزة", () => {
    const manifest = validateManifest(بيانٌ_كامل());
    expect(manifest.cities).toHaveLength(5);
    expect(manifest.cities.map((c) => c.code).sort()).toEqual([...LAUNCH_CITY_CODES].sort());
  });

  it("يرفض بياناً ناقصةً منه مدينةٌ ويسمّيها", () => {
    const raw = بيانٌ_كامل();
    raw.cities = (raw.cities as unknown[]).slice(0, 4);
    expect(() => validateManifest(raw)).toThrow(/MED/);
  });

  it("يرفض تكرارَ مدينةٍ في البيان", () => {
    const raw = بيانٌ_كامل();
    const cities = raw.cities as Record<string, unknown>[];
    const first = cities[0];
    if (first === undefined) throw new Error("بيانُ الاختبار فارغ");
    cities[1] = { ...first };
    expect(() => validateManifest(raw)).toThrow(/مرّتين/);
  });
});

describe("بيانُ مدنِ الإطلاق: القروباتُ لا تُشترَك", () => {
  it("يرفض قروباً واحداً لمدينتين ويسمّي الطرفين", () => {
    const raw = بيانٌ_كامل();
    const cities = raw.cities as Record<string, unknown>[];
    const jed = cities[0];
    const mkk = cities[1];
    if (jed === undefined || mkk === undefined) throw new Error("بيانُ الاختبار ناقص");
    mkk.driversGroupId = jed.driversGroupId;
    expect(() => validateManifest(raw)).toThrow(/قروبٌ واحدٌ لمدينتين/);
  });

  it("يرفض تساويَ قروبين داخلَ المدينة نفسِها", () => {
    const raw = بيانٌ_كامل();
    const cities = raw.cities as Record<string, unknown>[];
    const jed = cities[0];
    if (jed === undefined) throw new Error("بيانُ الاختبار ناقص");
    jed.escalationGroupId = jed.supportGroupId;
    expect(() => validateManifest(raw)).toThrow(/مختلفة/);
  });
});

describe("بيانُ مدنِ الإطلاق: الأشكالُ الفاسدة", () => {
  it("يرفض معرّفَ قروبٍ صفراً", () => {
    const raw = بيانٌ_كامل();
    const cities = raw.cities as Record<string, unknown>[];
    const jed = cities[0];
    if (jed === undefined) throw new Error("بيانُ الاختبار ناقص");
    jed.supportGroupId = "0";
    expect(() => validateManifest(raw)).toThrow(/صفر/);
  });

  it("يرفض معرّفاً ليس عدداً", () => {
    const raw = بيانٌ_كامل();
    const cities = raw.cities as Record<string, unknown>[];
    const jed = cities[0];
    if (jed === undefined) throw new Error("بيانُ الاختبار ناقص");
    jed.escalationGroupId = "-55x9";
    expect(() => validateManifest(raw)).toThrow(/عدداً صحيحاً/);
  });

  it("يقبل المعرّفَ السالبَ فهو شكلُ القروبات في تلغرام", () => {
    const manifest = validateManifest(بيانٌ_كامل());
    for (const city of manifest.cities) {
      expect(city.driversGroupId.startsWith("-")).toBe(true);
    }
  });

  it("يرفض غيابَ معرّفِ المسؤول", () => {
    const raw = بيانٌ_كامل();
    delete raw.adminTelegramId;
    expect(() => validateManifest(raw)).toThrow(/adminTelegramId/);
  });

  it("يرفض رمزَ مدينةٍ بحروفٍ صغيرة", () => {
    const raw = بيانٌ_كامل();
    const cities = raw.cities as Record<string, unknown>[];
    const jed = cities[0];
    if (jed === undefined) throw new Error("بيانُ الاختبار ناقص");
    jed.code = "jed";
    expect(() => validateManifest(raw)).toThrow(/رمز/);
  });
});
