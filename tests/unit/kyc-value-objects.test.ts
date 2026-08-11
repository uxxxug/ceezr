/**
 * الغرض: التحقّق من كائنات قيمة الملفّ التوثيقي — الهوية واللوحة ونوع المركبة.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { isKycComplete, missingKycFields } from "../../packages/domain/kyc/entity.ts";
import {
  normalizeDigits,
  parseNationalId,
  parsePlateNumber,
  parseVehicleType,
} from "../../packages/domain/kyc/value-objects.ts";

describe("تطبيع الأرقام", () => {
  it("يحوّل الأرقام العربية‑الهندية إلى ASCII", () => {
    expect(normalizeDigits("١٠٢٣٤٥٦٧٨٩")).toBe("1023456789");
  });

  it("يحوّل الأرقام الفارسية إلى ASCII", () => {
    expect(normalizeDigits("۱۰۲۳")).toBe("1023");
  });

  it("لا يمسّ الحروف ولا الرموز", () => {
    expect(normalizeDigits("أ ب ج ١٢٣٤")).toBe("أ ب ج 1234");
  });
});

describe("رقم الهوية", () => {
  it("يقبل هوية وطنية تبدأ بـ1", () => {
    const result = parseNationalId("1012345678");
    expect(result.ok && result.value).toBe("1012345678");
  });

  it("يقبل إقامة تبدأ بـ2", () => {
    const result = parseNationalId("2012345678");
    expect(result.ok && result.value).toBe("2012345678");
  });

  it("يقبل رقماً مكتوباً بالأرقام العربية ويعيده بـASCII", () => {
    // أكثر إدخالٍ شيوعاً من لوحة مفاتيح عربية — رفضه كان سيرفض إدخالاً صحيحاً
    const result = parseNationalId("١٠١٢٣٤٥٦٧٨");
    expect(result.ok && result.value).toBe("1012345678");
  });

  it("يتجاهل المسافات والشرطات", () => {
    const result = parseNationalId(" 1012-345-678 ");
    expect(result.ok && result.value).toBe("1012345678");
  });

  it("يرفض ما ليس عشرة أرقام", () => {
    const result = parseNationalId("101234567");
    expect(!result.ok && result.error.reason).toBe("bad_length");
  });

  it("يرفض بادئة غير 1 أو 2", () => {
    const result = parseNationalId("3012345678");
    expect(!result.ok && result.error.reason).toBe("bad_prefix");
  });

  it("يرفض الحروف", () => {
    const result = parseNationalId("10123456AB");
    expect(!result.ok && result.error.reason).toBe("not_digits");
  });

  it("يرفض الفراغ", () => {
    const result = parseNationalId("   ");
    expect(!result.ok && result.error.reason).toBe("empty");
  });
});

describe("رقم اللوحة", () => {
  it("يقبل لوحة عربية", () => {
    const result = parsePlateNumber("أ ب ج ١٢٣٤");
    expect(result.ok && result.value).toBe("أ ب ج 1234");
  });

  it("يقبل لوحة لاتينية ويوحّد حالة الحروف", () => {
    const result = parsePlateNumber("abc 1234");
    expect(result.ok && result.value).toBe("ABC 1234");
  });

  it("يوحّد المسافات المكرّرة", () => {
    const result = parsePlateNumber("ABC    1234");
    expect(result.ok && result.value).toBe("ABC 1234");
  });

  it("يرفض ما لا حروف فيه", () => {
    const result = parsePlateNumber("12345");
    expect(!result.ok && result.error.reason).toBe("missing_letters");
  });

  it("يرفض ما لا أرقام فيه", () => {
    const result = parsePlateNumber("ABCDE");
    expect(!result.ok && result.error.reason).toBe("missing_digits");
  });

  it("يرفض القصير جداً", () => {
    const result = parsePlateNumber("A1");
    expect(!result.ok && result.error.reason).toBe("too_short");
  });

  it("يرفض الطويل جداً", () => {
    const result = parsePlateNumber("ABCDEFGHIJ 1234567");
    expect(!result.ok && result.error.reason).toBe("too_long");
  });
});

describe("نوع المركبة", () => {
  it("يقبل الأنواع الأربعة", () => {
    for (const type of ["sedan", "suv", "van", "motorcycle"]) {
      expect(parseVehicleType(type).ok).toBe(true);
    }
  });

  it("يرفض نوعاً غير معروف", () => {
    expect(parseVehicleType("truck").ok).toBe(false);
  });
});

describe("اكتمال الملفّ التوثيقي", () => {
  const complete = {
    vehicleType: "sedan",
    plateNumber: "ABC 1234",
    nationalId: "1012345678",
    vehiclePhotoFileId: "file-1",
  };

  it("يعدّ الملفّ الكامل مكتملاً", () => {
    expect(isKycComplete(complete)).toBe(true);
    expect(missingKycFields(complete)).toEqual([]);
  });

  it("يسمّي الحقل الناقص بعينه لا مجرّد ناقص", () => {
    const missing = missingKycFields({ ...complete, nationalId: null });
    expect(missing).toEqual(["national_id"]);
  });

  it("يعدّ الحقل الفارغ ناقصاً لا موجوداً", () => {
    // سلسلة فارغة في القاعدة ليست ملفّاً مكتملاً — وإلا مرّ سائق بلوحة فارغة
    const missing = missingKycFields({ ...complete, plateNumber: "   " });
    expect(missing).toEqual(["plate_number"]);
  });

  it("يسرد كل النواقص معاً", () => {
    expect(
      missingKycFields({
        vehicleType: null,
        plateNumber: null,
        nationalId: null,
        vehiclePhotoFileId: null,
      }),
    ).toEqual(["vehicle_type", "plate_number", "national_id", "vehicle_photo"]);
  });
});
