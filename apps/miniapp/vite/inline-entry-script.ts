/**
 * الغرض: دَمْجُ حزمةِ المدخلِ في المستندِ بدلَ طلبِها من الشبكةِ — إسقاطُ طلبٍ
 *   من مسارِ أوّلِ رسم. والسببُ: `vite@8`/Rolldown يُولِّدُ حزمةَ `rolldown-runtime`
 *   القسريّةَ (٢٢٠ بايت) كطلبِ `modulepreload` سابعٍ، فيكسرُ الحدَّ (٦). وإدماجُ
 *   المدخلِ (الذي هو نفسُه طلبٌ مستقلٌّ) يُنقِصُ العددَ من ٧ إلى ٦.
 *
 *   والنمطُ هو عينُه نمطُ `inline-stylesheet.ts`: حزمةٌ مُدمَجةٌ في المستندِ
 *   ببصمةِ `sha256` في `script-src` — لا `'unsafe-inline'`. وما كان التعليقُ القديمُ
 *   في `inline-stylesheet.ts` يقولُه («لا يُدمَج سكربتٌ أبداً: يُلزِم unsafe-inline»)
 *   كان قاصراً: البصمةُ بديلٌ مشروعٌ، وهو ما تفعلهُ `style-src` منذُ `F1-09`.
 *
 * الحالة: منفّذٌ — البند `D-23` (ADR 0045 تمديدٌ).
 * ينتمي إلى: apps/miniapp/vite
 * يُتوقَّع أن يستخدمه لاحقاً: كلُّ بناءٍ للتطبيقِ المصغَّر.
 *
 * ملاحظات:
 *   - **ترتيُّ الإضافةِ**: قبلَ `injectCsp` في مصفوفةِ الإضافاتِ، لكي تُقرَأ
 *     بصمةُ السكربتِ المُدمَجِ من المُخرَجِ بعدَ الإدماجِ لا قبله.
 *   - **المُدمَجُ هو المدخلُ وحدَه**: الحزمُ المؤجَّلةُ (`driver` · `admin` ·
 *     `rider-home`) لا تُدمَج — تُطلَبُ عندَ الحاجة. وحزمةُ `rolldown-runtime`
 *     (٢٢٠ بايت) تبقى طلبَ `modulepreload`، لكنَّ العدَّدَ يعودُ إلى ٦ لأنَّ
 *     المدخلَ صارَ مُدمَجاً لا طلباً شبكيّاً.
 *   - **لا `import.meta.url`**: المدخلُ بسيطٌ (bootstrap يَستوردُ حزمَ shell)، فلا
 *     تبعيةً لعنوانِ الملفِّ تختلفُ بينَ الإدماجِ والتحميلِ المستقلِّ. ولو ظهرت
 *     يوماً يُعادُ النظرُ في الإدماجِ بـADR.
 */

import type { Plugin } from "vite";

/** حرفيّةُ النصِّ في تعبيرٍ نمطيّ: أسماءُ الملفّاتِ تحمل نقاطاً وشُرَطاً. */
function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * يُولِّد Rolldown اسمَ حزمةِ المدخلِ ببصمةٍ في الاسمِ: `index-<hash>.js`. ولا يُعرفُ
 * الاسمُ قبلَ البناءِ، فيُطابَقُ بالنمطِ: `<script ... src="/assets/index-*.js">`.
 */
const ENTRY_SCRIPT_PATTERN =
  /<script\s+[^>]*type="module"[^>]*\ssrc="\/assets\/index-[^"]+\.js"[^>]*>\s*<\/script>/g;

export function inlineEntryScript(): Plugin {
  return {
    name: "waslah-inline-entry-script",
    /** بعدَ أن يكتب Vite وسمَ المدخلِ في المستند: نحن نستبدله لا نسبقه. */
    enforce: "post",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, context) {
        const bundle = context.bundle;
        if (bundle === undefined) return html;

        let output = html;

        /**
         * نطابقُ وسمَ المدخلِ ونستخرجُ اسمَ الملفِّ منه. ولا نطابقُ على اسمِ
         * الملفِّ في `bundle` مباشرةً لأنَّ الاسمَ يحمِلُ بصمةً لا تُعرفُ قبلَ البناءِ.
         */
        const match = ENTRY_SCRIPT_PATTERN.exec(output);
        if (match === null) return output;

        const tag = match[0];
        const srcMatch = tag.match(/src="\/assets\/(index-[^"]+\.js)"/);
        if (srcMatch === null) return output;

        const fileName = srcMatch[1];
        if (fileName === undefined) return output;
        /** المفتاحُ في الحزمةِ يحملُ المسارَ الكاملَ: `assets/index-*.js`. */
        const bundleKey = `assets/${fileName}`;
        const chunk = bundle[bundleKey];
        if (chunk === undefined || chunk.type !== "chunk") {
          /** لا مدخلَ في الحزمةِ — لا شيءَ نُدمِجُه. */
          return output;
        }

        const source = typeof chunk.code === "string" ? chunk.code : "";

        if (source === "") return output;

        /**
         * نستبدلُ الوسمَ بـ`<script type="module">...</script>` مُدمَجاً. ولا
         * نُضيفُ `crossorigin`: السكربتُ مُدمَجٌ في المستندِ، لا طلبٌ شبكيٌّ.
         */
        output = output.replace(
          new RegExp(escapeForRegExp(tag), "g"),
          `<script type="module">${source}</script>`,
        );

        /** الأصلُ يُحذَف من المُخرَج: ملفٌّ لا يطلبه أحدٌ يبقى وعداً بخُبَيْئةٍ باردة. */
        delete bundle[fileName];

        return output;
      },
    },
  };
}
