/**
 * الغرض: إثباتُ أنّ تفريغَ التعليقاتِ **لا يقتل العناوينَ**. وهذا الملفُّ وُلِد من
 *   عيبٍ حقيقيٍّ لا من احتياطٍ: النسخةُ التي كانت منسوخةً في الحواجزِ تُعامِل `//`
 *   في `https://` معاملةَ بدايةِ تعليقٍ، فتفرّغ كلَّ عنوانٍ في المستودعِ — ومعنى ذلك
 *   أنّ حاجزَ `F1-10` **كان يمرُّ بخروجِ صفرٍ على ثلاثةِ مساببرَ محقونةٍ** حتى ظهر
 *   ذلك في برهانِ السقوطِ. فالاختبارُ ههنا يمنع رجوعَ العيبِ بعدَ إصلاحِه.
 * الحالة: منفّذ فعلياً — البند `F1-10`.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: كلُّ حاجزٍ يُوصَل بالوحدةِ المشتركةِ.
 * ملاحظات مستقبلية: **السلبيُّ الكاذبُ المُعلَنُ مُختبَرٌ ههنا بقصدٍ** (سطرٌ فيه
 *   `"// نصٌّ"` يُفرَّغ خطأً). وهو مُثبَّتٌ في الاختبارِ كي يكون تغييرُه قراراً
 *   واعياً: من يُدخِل مُحلِّلاً حقيقيّاً سيُسقِط هذا الاختبارَ فيقرأ سببَه.
 *
 * وما لا يفعله: لا يُثبِت أنّ أيَّ حاجزٍ صحيحٌ — يُثبِت أنّ خطوةَ التهيئةِ لا تُخفي
 * الدليلَ عن الحواجزِ.
 */

import { describe, expect, it } from "bun:test";
import { blankComments } from "../../scripts/lib/blank-comments.ts";

describe("blankComments — لا يقتل العناوينَ", () => {
  it("يُبقي عنواناً في نصٍّ حرفيٍّ كما هو: هذا هو العيبُ الذي أُصلِح", () => {
    const source = 'const url = "https://cdn.example.com/lib.js";';
    expect(blankComments(source)).toBe(source);
  });

  it("يُبقي عنواناً نسبيَّ المِخطاطِ: صيغةٌ ثالثةٌ للأصلِ الخارجيِّ", () => {
    const source = 'const url = "//cdn.example.com/lib.js";';
    expect(blankComments(source)).toBe(source);
  });

  it("يُبقي عنواناً غيرَ آمنٍ أيضاً: المنعُ حقُّ الحاجزِ لا حقُّ هذه الدالّةِ", () => {
    const source = "const url = `http://insecure.example/x`;";
    expect(blankComments(source)).toBe(source);
  });
});

describe("blankComments — يُفرِّغ التعليقاتَ", () => {
  it("تعليقُ سطرٍ يصير مسافاتٍ بالطولِ نفسِه", () => {
    const source = 'const a = 1; // fetch("https://x")';
    const blanked = blankComments(source);
    expect(blanked.length).toBe(source.length);
    expect(blanked).toBe("const a = 1;                      ");
    expect(blanked).not.toContain("fetch");
  });

  it("تعليقُ كتلةٍ يُفرَّغ وتبقى أسطرُه فلا تنزلق أرقامُ الأسطرِ في البلاغِ", () => {
    const source = ["const a = 1;", "/*", ' * eval("boom")', " */", "const b = 2;"].join("\n");
    const blanked = blankComments(source);
    expect(blanked.split("\n")).toHaveLength(5);
    expect(blanked.split("\n")[4]).toBe("const b = 2;");
    expect(blanked).not.toContain("eval");
  });

  it("تعليقُ مستندٍ يُفرَّغ: الحواجزُ تفحص index.html أيضاً", () => {
    const source = '<p>a</p><!-- <iframe src="x"> --><p>b</p>';
    const blanked = blankComments(source);
    expect(blanked.length).toBe(source.length);
    expect(blanked).not.toContain("iframe");
    expect(blanked.startsWith("<p>a</p>")).toBe(true);
    expect(blanked.endsWith("<p>b</p>")).toBe(true);
  });

  it("تعليقٌ فيه عنوانٌ يُفرَّغ كلُّه: العنوانُ في التعليقِ توثيقٌ لا طلبٌ", () => {
    expect(blankComments("// see https://core.telegram.org/bots/webapps")).toBe(
      " ".repeat("// see https://core.telegram.org/bots/webapps".length),
    );
  });

  it("لا يرمي على تعليقٍ غيرِ مُغلَقٍ في آخرِ الملفِّ", () => {
    const unclosed = "const a = 1; /* ناقصٌ";
    /** الشيفرةُ قبلَ التعليقِ تبقى، والتعليقُ الناقصُ يُفرَّغ إلى آخرِ الملفِّ. */
    expect(blankComments(unclosed)).toBe(`const a = 1;${" ".repeat(unclosed.length - 12)}`);
    expect(blankComments("<p>a</p><!-- ناقصٌ").trimEnd()).toBe("<p>a</p>");
  });
});

describe("blankComments — الحدُّ المُعلَنُ", () => {
  /**
   * هذا **سلبيٌّ كاذبٌ مقصودُ التثبيتِ**: الدالّةُ ليست مُحلِّلاً، فلا تعرف أنّ
   * `//` ههنا داخلَ نصٍّ. والأثرُ أنّها تُفلِت مخالفةً لا أنّها تخترع واحدةً —
   * وذاك الاتجاهُ الآمنُ لحاجزٍ نصّيٍّ. ولو أُدخِل مُحلِّلٌ يوماً فهذا السطرُ
   * يسقط أوّلاً فيُقرَأ سببُه (ADR 0045 §٧).
   */
  it("يُفرِّغ خطأً نصّاً حرفيّاً يبدأ بـ`//` بعدَ مسافةٍ", () => {
    const literal = 'const s = "x // y";';
    expect(blankComments(literal)).toBe('const s = "x' + " ".repeat(literal.length - 12));
  });

  it("لا يُفرِّغ قسمةً: `a / b` ليست تعليقاً", () => {
    const source = "const r = a / b;";
    expect(blankComments(source)).toBe(source);
  });
});
