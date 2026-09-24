/**
 * الغرض: إثباتُ أنّ إضافةَ البناءِ تحقن السياسةَ **في الموضعِ الصحيحِ وبالبصمةِ
 *   الصحيحةِ**. والموضعُ ليس تفصيلاً تجميليّاً: سياسةٌ في وسمٍ **لا تُطبَّق على ما
 *   سبقها في المستندِ** بنصِّ المعيار، فوسمٌ يُحقَن في ذيلِ الرأسِ يترك سكربتَ
 *   تلغرامَ وكلَّ سابقٍ بلا سياسةٍ — والبناءُ يمرُّ أخضرَ والوسمُ ظاهرٌ في المُخرَجِ.
 * الحالة: منفّذ فعلياً — البند `F1-10`.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: كلُّ تعديلٍ على ترتيبِ إضافاتِ `vite.config.ts`.
 * ملاحظات مستقبلية: حين تُضاف السياسةُ رأسَ استجابةٍ (بعدَ وجودِ مضيفٍ) يبقى هذا
 *   الملفُّ صالحاً: الوسمُ لا يُحذَف، يُدعَم.
 *
 * وما لا يفعله: **لا يُشغِّل Vite ولا متصفّحاً**. يستدعي مُعالِجَ التحويلِ مباشرةً
 * بمستندٍ مصنوعٍ، فلا يُثبِت أنّ ترتيبَ الإضافاتِ في `vite.config.ts` صحيحٌ — ذاك
 * يُثبِته حاجزُ `check-single-origin-assets.ts` على مُخرَجِ بناءٍ حقيقيٍّ في CI،
 * لأنّه يقارن بصمةَ المُخرَجِ بأنماطِ المُخرَجِ. والتغطيةُ ههنا جزئيّةٌ ومُعلَنةٌ.
 */

import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { injectCsp } from "../../apps/miniapp/vite/inject-csp.ts";
import { buildCsp, cspMetaTag } from "../../scripts/lib/content-security-policy.ts";

/** مُعالِجُ التحويلِ وحدَه: بقيّةُ عقدِ Vite ليست موضوعَ هذا الملفِّ. */
function transform(html: string): string {
  const plugin = injectCsp();
  /**
   * Vite يقبل صيغتَين للعقدِ (`handler` أو `transform` القديمةَ)، والإضافةُ تستعمل
   * `handler`. والتضييقُ ههنا **مقصودُ الصرامةِ**: لو تغيّر العقدُ يسقط الاختبارُ
   * بسببٍ مقروءٍ لا بتحويلٍ صامتٍ إلى `any`.
   */
  const hook = plugin.transformIndexHtml as
    | { readonly handler?: (html: string) => string }
    | undefined;
  const handler = hook?.handler;
  if (typeof handler !== "function") {
    throw new Error("عقدُ التحويلِ تغيّر: الاختبارُ يجب أن يُقرَأ لا أن يُصلَح آليّاً.");
  }
  return handler.call(plugin, html);
}

const STYLE = "body{margin:0}";
const STYLE_HASH = `'sha256-${createHash("sha256").update(STYLE, "utf8").digest("base64")}'`;

/**
 * اسمُ سكربتِ الجسرِ ههنا **بديلٌ مقصودٌ**: حاجزُ `F1-02` يقصر اسمَ ملفِّ سكربتِ
 * تيليجرامَ على `apps/miniapp/index.html` وحدَه، والمقصودُ في هذا الاختبارِ **موضعُ
 * الوسمِ قبلَ أيِّ سكربتٍ** لا هويّةُ السكربتِ. فالحاجزُ يُحتَرَم ولا يُستثنى منه.
 */
const DOCUMENT = [
  "<!doctype html>",
  '<html lang="ar" dir="rtl">',
  "  <head>",
  '    <meta charset="UTF-8" />',
  "    <title>وَصْلة</title>",
  `    <style>${STYLE}</style>`,
  '    <script src="https://telegram.org/js/host-bridge.js"></script>',
  "  </head>",
  "  <body></body>",
  "</html>",
].join("\n");

describe("injectCsp — عقدُ الإضافةِ", () => {
  it("يعمل في البناءِ وحدَه: لا سياسةَ مُخفَّفةً في التطوير", () => {
    expect(injectCsp().apply).toBe("build");
  });

  it("`post` كي تُقرأ الأنماطُ بعدَ دمجِها", () => {
    expect(injectCsp().enforce).toBe("post");
    const hook = injectCsp().transformIndexHtml as { readonly order?: string } | undefined;
    expect(hook?.order).toBe("post");
  });
});

describe("injectCsp — الموضعُ", () => {
  it("يحقن الوسمَ مباشرةً بعدَ `charset` وقبلَ كلِّ سكربتٍ", () => {
    const out = transform(DOCUMENT);
    const cspAt = out.indexOf('http-equiv="Content-Security-Policy"');
    expect(cspAt).toBeGreaterThan(out.indexOf("charset"));
    expect(cspAt).toBeLessThan(out.indexOf("<title>"));
    expect(cspAt).toBeLessThan(out.indexOf("host-bridge.js"));
    expect(cspAt).toBeLessThan(out.indexOf("<style>"));
  });

  it("يحقن بعدَ `<head>` إن غاب `charset`: لا يسقط الوسمُ صامتاً", () => {
    const out = transform("<html><head><title>x</title></head><body></body></html>");
    const cspAt = out.indexOf("Content-Security-Policy");
    expect(cspAt).toBeGreaterThan(-1);
    expect(cspAt).toBeLessThan(out.indexOf("<title>"));
  });

  it("يحقن وسماً واحداً لا أكثرَ", () => {
    const out = transform(DOCUMENT);
    expect(out.match(/Content-Security-Policy/g)).toHaveLength(1);
  });

  it("لا يحذف شيئاً من المستندِ", () => {
    const out = transform(DOCUMENT);
    for (const fragment of ["<title>وَصْلة</title>", STYLE, "host-bridge.js", "<body></body>"]) {
      expect(out).toContain(fragment);
    }
  });
});

describe("injectCsp — البصمةُ", () => {
  it("يُبصِّم كتلةَ الأنماطِ الفعليةَ من المستندِ", () => {
    expect(transform(DOCUMENT)).toContain(
      cspMetaTag(buildCsp({ inlineStyleHashes: [STYLE_HASH] })),
    );
  });

  it("تغييرُ حرفٍ واحدٍ في الأنماطِ يُغيِّر البصمةَ: بصمةٌ متقادمةٌ لا تُطابِق", () => {
    const before = transform(DOCUMENT);
    const after = transform(DOCUMENT.replace(STYLE, "body{margin:1px}"));
    expect(after).not.toBe(before);
    expect(after).not.toContain(STYLE_HASH);
  });

  it("كتلتانِ تُنتِجانِ بصمتَين", () => {
    const out = transform(DOCUMENT.replace("<body>", "<style>a{color:red}</style><body>"));
    expect(out.match(/'sha256-/g)).toHaveLength(2);
  });

  it("مستندٌ بلا أنماطٍ: style-src يبقى 'self' بلا تخفيفٍ", () => {
    const out = transform(DOCUMENT.replace(`    <style>${STYLE}</style>\n`, ""));
    expect(out).toContain("style-src 'self';");
    expect(out).not.toContain("unsafe-inline");
  });
});

/**
 * زيادةٌ 2026-09-25 (`F1-09` · `D-27`): السكربتُ الكلاسيكيُّ المُضمَّنُ (التقديمُ الساكنُ)
 * يُبصَّمُ كالوحدةِ — وكانَ المستخرِجُ يطابقُ `type="module"` وحدَه فيخرجُ بلا بصمةٍ
 * ويحجبُه المتصفّحُ صامتاً. والتعليقُ الذي يذكرُ وسماً نصّاً لا يُبصَّم.
 */
describe("injectCsp — بصمةُ السكربتاتِ المُضمَّنة", () => {
  const sha = (text: string): string =>
    `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
  const CLASSIC = "(function(){window.__waslahPreboot={};})();";
  const MODULE = 'import"/assets/a.js";';

  it("يُبصِّمُ الكلاسيكيَّ والوحدةَ معاً، ويتخطّى ذا `src`", () => {
    const doc = DOCUMENT.replace(
      "<body></body>",
      `<body><script type="module">${MODULE}</script><script>${CLASSIC}</script></body>`,
    );
    const out = transform(doc);
    expect(out).toContain(
      cspMetaTag(
        buildCsp({
          inlineStyleHashes: [STYLE_HASH],
          inlineScriptHashes: [sha(MODULE), sha(CLASSIC)],
        }),
      ),
    );
  });

  it("لا يُبصِّمُ وسماً مذكوراً في تعليقٍ", () => {
    const doc = DOCUMENT.replace(
      "<body></body>",
      `<body><!-- <script type="module">x</script> --><script>${CLASSIC}</script></body>`,
    );
    const out = transform(doc);
    expect(out).not.toContain(sha("x"));
    expect(out).toContain(sha(CLASSIC));
  });
});
