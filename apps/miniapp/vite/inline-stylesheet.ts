/**
 * الغرض: دَمْجُ ورقةِ الأنماطِ في المستندِ بدلَ طلبِها من الشبكةِ — إسقاطُ طلبٍ
 *   **حاجزٍ للعرضِ** من مسارِ أوّلِ رسم. والحدُّ في القسم 9.9 «طلبات الشبكة لأول
 *   رسم ≤ 6»، وكان المُخرَجُ عندَ سبعةٍ: مستندٌ + سكربتُ تيليجرام + مدخلٌ +
 *   `vendor-react` + `shell` + `identity` + ورقةُ أنماط.
 * الحالة: منفّذ فعلياً — البند `F1-09` (ADR 0044).
 * ينتمي إلى: apps/miniapp/vite
 * يُتوقع أن يستخدمه لاحقاً: كلُّ بناءٍ للتطبيقِ المصغَّر، وأيُّ ورقةِ أنماطٍ ثانيةٍ
 *   تظهر لحزمةٍ مؤجَّلةٍ (تلك **لا تُدمَج**: أنماطُ شاشةٍ لا تُطلَب قبلَ شاشتِها).
 * ملاحظات مستقبلية:
 *   - الدمجُ يصلح لأنّ أنماطَ الحملِ الأوّلِ صغيرةٌ (كيلوباياتٌ) ويُنقَل نصُّها
 *     مضغوطاً مع المستند. **فإن كبُرت** فالدمجُ يصير ضرراً: كلُّ زيارةٍ تُعيد نقلَ
 *     الأنماطِ ولا تُخبِّئها. والحاجزُ يقيس بايتاتَ المُدمَجِ فيظهر ذلك عدداً.
 *   - لا يُدمَج سكربتٌ أبداً: سكربتٌ مُدمَجٌ يُلزِم `'unsafe-inline'` في سياسةِ
 *     المحتوى، وذلك يفتح ما أُغلِق في `F1-10`.
 */

import type { Plugin } from "vite";

/** حرفيّةُ النصِّ في تعبيرٍ نمطيّ: أسماءُ الملفّاتِ تحمل نقاطاً وشُرَطاً. */
function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function inlineStylesheet(): Plugin {
  return {
    name: "waslah-inline-stylesheet",
    /** بعدَ أن يكتب Vite وسمَ الورقةِ في المستند: نحن نستبدله لا نسبقه. */
    enforce: "post",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, context) {
        const bundle = context.bundle;
        if (bundle === undefined) return html;

        let output = html;
        for (const [file, chunk] of Object.entries(bundle)) {
          if (chunk.type !== "asset") continue;
          if (!file.endsWith(".css")) continue;

          const source =
            typeof chunk.source === "string"
              ? chunk.source
              : Buffer.from(chunk.source).toString("utf8");

          const tag = new RegExp(
            `<link[^>]*rel="stylesheet"[^>]*href="/?${escapeForRegExp(file)}"[^>]*>`,
          );
          if (!tag.test(output)) continue;

          output = output.replace(tag, `<style>${source}</style>`);
          /** الأصلُ يُحذَف من المُخرَج: ملفٌّ لا يطلبه أحدٌ يبقى وعداً بخُبَيْئةٍ باردة. */
          delete bundle[file];
        }

        return output;
      },
    },
  };
}
