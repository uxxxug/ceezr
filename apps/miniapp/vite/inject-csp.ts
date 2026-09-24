/**
 * الغرض: حقنُ وسمِ سياسةِ أمنِ المحتوى في `dist/index.html` **من مُخرَجِ البناءِ
 *   نفسِه** لا من نصٍّ مكتوبٍ بيدٍ في المستندِ المصدريّ. والسببُ أنّ السياسةَ تحمل
 *   بصمةَ كتلةِ الأنماطِ المُدمَجةِ (`F1-09`)، والبصمةُ لا تُعرَف قبلَ البناءِ —
 *   فسياسةٌ مكتوبةٌ بيدٍ تتقادم بأوّلِ تعديلِ لونٍ ويُصبح التطبيقُ بلا أنماطٍ بلا
 *   أن ينكسر أيُّ اختبار.
 * الحالة: منفّذ فعلياً — البند `F1-10` (ADR 0045).
 * ينتمي إلى: apps/miniapp/vite
 * يُتوقع أن يستخدمه لاحقاً: كلُّ بناءٍ للتطبيقِ المصغَّر. وحين يُوجَد مضيفٌ للتطبيقِ
 *   في `render.yaml` **تُضاف السياسةُ رأسَ استجابةٍ إلى جانبِ الوسمِ لا بدلاً منه**،
 *   وحينها فقط تصير `frame-ancestors` ممكنةً.
 * ملاحظات مستقبلية:
 *   - الوسمُ **أضعفُ من الرأسِ** بنصِّ المعيار: `frame-ancestors` و`sandbox` و
 *     `report-uri` كلُّها مُهمَلةٌ في الوسمِ. وذلك مُعلَنٌ في ADR 0045 §٥ ولا يُدَّعى
 *     غيرُه — والوسمُ هو ما نملكه اليومَ لأنّ لا مضيفَ للتطبيقِ بعدُ.
 *   - يعمل في البناءِ وحدَه (`apply: "build"`): خادمُ التطويرِ يحتاج `'unsafe-inline'`
 *     و`ws:` للتحديثِ الحيِّ، وسياسةٌ تُخفَّف لأجلِ التطويرِ ثم تُقرأ في الإنتاجِ هي
 *     أخطرُ من لا سياسة. **فلا سياسةَ في التطوير، ولا تخفيفَ للإنتاج.**
 *   - **يقرأ `VITE_WASLAH_API_BASE` من `process.env` مرّةً في `config`**: Vite حمَّل
 *     بيئةَ الطورِ سلفاً في هذه العمليةِ، فالقيمةُ التي تُبنى بها الحزمةُ هي عينُها
 *     التي تدخل السياسةَ. ولو انفصل المصدرانِ يوماً فالواجبُ `loadEnv` صريحاً، لأنّ
 *     `connect-src` أضيقَ من حدِّ API الفعليِّ يمنع كلَّ نداءٍ في زمنِ التشغيلِ
 *     والبناءُ أخضرُ.
 */

import type { Plugin } from "vite";
import {
  buildCsp,
  cspMetaTag,
  inlineScriptBodies,
  inlineStyleBodies,
  sha256Source,
} from "../../../scripts/lib/content-security-policy.ts";

/**
 * زيادةٌ 2026-09-25 (`F1-09` · `D-27`): استخراجُ الأجسامِ المُضمَّنةِ وبصمتُها صارا في
 * وحدةِ السياسةِ مصدراً واحداً يقرؤه هذا الباني والحاجزُ `check-single-origin-assets`
 * معاً — وكانا نسختَينِ تطابقانِ `type="module"` وحدَه فتُسقِطانِ السكربتَ الكلاسيكيَّ.
 */
export function injectCsp(): Plugin {
  let apiBase: string | undefined;

  return {
    name: "waslah-inject-csp",
    /**
     * `post` **وبعدَ `waslah-inline-stylesheet` في ترتيبِ الإضافاتِ**: البصمةُ تُقرأ
     * من الأنماطِ بعدَ دمجِها. ولو سبقناها لبَصَّمنا لا شيءَ ومرَّ البناءُ أخضرَ
     * والتطبيقُ بلا أنماطٍ على الجهاز.
     */
    enforce: "post",
    apply: "build",

    config(_config, env) {
      /**
       * `loadEnv` غيرُ لازمٍ: Vite حمَّل البيئةَ سلفاً لهذا الطورِ، والقيمةُ التي
       * تُبنى بها الحزمةُ هي `process.env.VITE_*` نفسُها في هذه العملية. ونقرأها
       * **مرّةً في الضبطِ** لا في كلِّ تحويلٍ.
       */
      void env;
      apiBase = process.env.VITE_WASLAH_API_BASE;
    },

    transformIndexHtml: {
      order: "post",
      handler(html) {
        const styleHashes = inlineStyleBodies(html).map(sha256Source);
        const scriptHashes = inlineScriptBodies(html).map(sha256Source);
        const policy = buildCsp({
          apiBase,
          inlineStyleHashes: styleHashes,
          inlineScriptHashes: scriptHashes,
        });
        const tag = cspMetaTag(policy);

        /**
         * الموضعُ **أوّلَ ما في الرأسِ**: سياسةٌ في وسمٍ لا تُطبَّق على ما سبقها في
         * المستندِ، فوسمٌ في ذيلِ الرأسِ يترك كلَّ سكربتٍ قبلَه بلا سياسةٍ.
         * و`charset` يبقى أوّلَ الرأسِ فعلياً لأنّ ترميزَ المستندِ يُقرأ قبلَ كلِّ شيءٍ.
         */
        const charset = /<meta\s+charset=["'][^"']*["']\s*\/?>/i;
        if (charset.test(html)) {
          return html.replace(charset, (matched) => `${matched}\n    ${tag}`);
        }
        return html.replace(/<head>/i, (matched) => `${matched}\n    ${tag}`);
      },
    },
  };
}
