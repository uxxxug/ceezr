/**
 * الغرض: إثبات أن حرس القيم التجارية يفرّق بين قيمةٍ ينفّذها المنطق وقيمةٍ في تعليق وصفيّ.
 *
 *   قبل هذا الاختبار كان الفاحص يُسقط تعليقات `//` وحدها، فيرفع مخالفةً على رقمٍ داخل
 *   تعليق كتلة `/** … *\/` — وهو نصٌّ لا ينفّذه أحد. فكان CI البعيد أحمر على مخالفتين
 *   وهميتين، والأسوأ من الإنذار الكاذب أنّه يُدرَّب الناظر على تجاهل الفاحص.
 *
 *   والاختبار هنا يحرس الاتجاهين معاً: لا إنذار كاذب على التعليقات، ولا تسامح مع رقمٍ
 *   في كودٍ قابلٍ للتنفيذ — لأن ترخيص الفاحص أسوأ من ضجيجه.
 *
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أيّ تعديل على scripts/check-business-constants.ts
 * ملاحظات مستقبلية: يوم تُضاف قيمة ممنوعة جديدة إلى FORBIDDEN تبقى هذه التوكيدات صالحة —
 *   فهي تختبر آلية التمييز لا قائمة الأرقام.
 */

import { describe, expect, it } from "bun:test";
import { executableLines, findHardcodedValues } from "../../scripts/check-business-constants.ts";

describe("حرس القيم التجارية: تعليق أم كود", () => {
  it("رقم ممنوع داخل تعليق سطريّ لا يُحتسب مخالفة", () => {
    expect(findHardcodedValues("// مهلة العرض 45 ثانية افتراضاً\nconst x = 1;\n")).toEqual([]);
  });

  it("رقم ممنوع داخل تعليق كتلة متعدّد الأسطر لا يُحتسب مخالفة", () => {
    const source = [
      "/**",
      " * أقصر من مهلة العرض (45 ثانية افتراضاً) عن قصد.",
      " */",
      "const timeout = readSetting();",
      "",
    ].join("\n");
    expect(findHardcodedValues(source)).toEqual([]);
  });

  it("رقم ممنوع في كود قابل للتنفيذ يُحتسب مخالفةً بسطره الصحيح", () => {
    const source = ["const a = 1;", "const offerTimeout = 45;", "const b = 2;", ""].join("\n");
    expect(findHardcodedValues(source)).toEqual([{ line: 2, value: 45 }]);
  });

  it("لا يُخفي كوداً يلي تعليق كتلة أُغلق في السطر نفسه", () => {
    const source = ["/* وصف */ const price = 250;", ""].join("\n");
    expect(findHardcodedValues(source)).toEqual([{ line: 1, value: 250 }]);
  });

  it("لا يعتبر الكود بعد نهاية الكتلة تعليقاً", () => {
    const source = ["/* بداية", "  وسط 45", "*/", "const price = 400;", ""].join("\n");
    expect(findHardcodedValues(source)).toEqual([{ line: 4, value: 400 }]);
  });

  it("رموز حالة HTTP تبقى مقبولة داخل الاستجابة", () => {
    expect(findHardcodedValues("return c.json({ ok: false }, 400);\n")).toEqual([]);
  });

  it("عدد الأسطر المُخرَجة يساوي عدد أسطر المصدر فتبقى أرقام الأسطر صحيحة", () => {
    const source = "a\n/* x\ny */\nb\n";
    expect(executableLines(source).length).toBe(source.split("\n").length);
  });
});
