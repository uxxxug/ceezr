/**
 * الغرض: اختبار حقيقي لمحمّل الترجمة الثابتة.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: عند إضافة لغة جديدة، أضِف ملف JSON فقط دون تعديل كود البوت.
 */
import { describe, expect, it } from "bun:test";
import { DEFAULT_LANGUAGE, hasLanguage, translate } from "../../packages/shared/i18n/index.ts";

describe("i18n", () => {
  it("اللغة الافتراضية عربية ومدعومة", () => {
    expect(DEFAULT_LANGUAGE).toBe("ar");
    expect(hasLanguage("ar")).toBe(true);
    expect(hasLanguage("fr")).toBe(false);
  });

  it("يرجع نص اللغة المطلوبة", () => {
    expect(translate("en", "common.language_saved")).toBe("Language saved.");
  });

  it("يعود للعربية عند لغة غير مدعومة", () => {
    expect(translate("fr", "common.language_saved")).toBe("تم حفظ اللغة.");
  });
});
