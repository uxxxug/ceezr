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
 *
 * زيادةٌ 2026-09-24 (`D-25` · `ح-8` — الملاحظةُ السابقةُ باقيةٌ وكانت **ناقصةً**):
 *   «لا تبعيّةَ لعنوانِ الملفِّ» صحيحٌ في `import.meta.url` وخاطئٌ في **المُعيِّناتِ
 *   النسبيّةِ**: Rolldown يكتبُ `from"./shell-*.js"` نسبةً إلى `assets/index-*.js`،
 *   والمُدمَجُ يُحَلُّ نسبةً إلى **المستندِ** عندَ `/` فيصيرُ `/shell-*.js` — ملفٌّ
 *   لا وجودَ له. فقِيسَ بمتصفّحٍ بلا رأسٍ: ثلاثةُ طلباتِ `404` و`#root` فارغٌ، أي
 *   **شاشةٌ بيضاءُ** على كلِّ جهازٍ، والبناءُ وكلُّ حاجزٍ أخضرُ. فصارت المُعيِّناتُ
 *   تُعادُ كتابتُها **من بياناتِ الحزمةِ** (`imports` · `dynamicImports`) إلى
 *   `base + fileName` المطلقِ، لا بتخمينِ نمطٍ؛ وأيُّ مُعيِّنٍ نسبيٍّ يبقى بعدَها
 *   **يُسقِطُ البناءَ** (`InlineEntrySpecifierError`) لا يمرُّ صامتاً. وتعليقُ خريطةِ
 *   المصدرِ يُحذَفُ من المُدمَجِ لأنَّه يُحَلُّ نسبةً إلى المستندِ كذلكَ.
 */

import type { Plugin } from "vite";

/** مُعيِّنٌ نسبيٌّ بقيَ في المدخلِ المُدمَجِ — يُحَلُّ نسبةً إلى المستندِ فيُخطئُ. */
export class InlineEntrySpecifierError extends Error {
  constructor(readonly specifiers: readonly string[]) {
    super(
      `D-25: مدخلٌ مُدمَجٌ يحملُ مُعيِّناتٍ نسبيّةً تُحَلُّ نسبةً إلى المستندِ لا إلى ` +
        `\`assets/\`: ${specifiers.join(" · ")}`,
    );
    this.name = "InlineEntrySpecifierError";
  }
}

/** كلُّ مُعيِّنٍ نسبيٍّ (`./` أو `../`) بين علامتَي اقتباسٍ في شيفرةٍ مُصغَّرةٍ. */
const RELATIVE_SPECIFIER = /(["'`])(\.{1,2}\/[^"'`\s]+?\.js)\1/g;

/**
 * يُعيدُ كتابةَ مُعيِّناتِ حزمةِ المدخلِ إلى مساراتٍ مطلقةٍ من بياناتِ الحزمةِ
 * نفسِها: لكلِّ ملفٍّ في `imports`/`dynamicImports` (مثلَ `assets/shell-x.js`)
 * يُستبدَلُ `./shell-x.js` بـ`${base}assets/shell-x.js`. ثمَّ يُحذَفُ تعليقُ خريطةِ
 * المصدرِ. وإن بقيَ مُعيِّنٌ نسبيٌّ واحدٌ **رُمِيَ خطأٌ** — لا يُترَكُ للمتصفّحِ.
 *
 * نقيّةٌ ومُصدَّرةٌ كي تُختبَرَ بلا بناءٍ (`ح-7`).
 */
export function absolutizeEntrySpecifiers(
  code: string,
  chunkFileName: string,
  importedFileNames: readonly string[],
  base: string,
): string {
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const chunkDir = chunkFileName.includes("/")
    ? chunkFileName.slice(0, chunkFileName.lastIndexOf("/") + 1)
    : "";
  const targets = new Map<string, string>();
  for (const fileName of importedFileNames) {
    if (!fileName.startsWith(chunkDir)) continue;
    const relative = `./${fileName.slice(chunkDir.length)}`;
    targets.set(relative, `${normalizedBase}${fileName}`);
  }

  let output = code.replace(RELATIVE_SPECIFIER, (whole, quote: string, spec: string) => {
    const absolute = targets.get(spec);
    return absolute === undefined ? whole : `${quote}${absolute}${quote}`;
  });
  output = output.replace(/\n?\/\/# sourceMappingURL=[^\n]*\s*$/, "");

  const leftovers = [...output.matchAll(RELATIVE_SPECIFIER)].map((m) => m[2] ?? "");
  if (leftovers.length > 0) throw new InlineEntrySpecifierError(leftovers);
  return output;
}

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
  /** `base` المُحَلُّ من إعدادِ Vite — `/` افتراضاً؛ لا يُكتَبُ ثابتاً هنا. */
  let base = "/";
  return {
    name: "waslah-inline-entry-script",
    configResolved(config) {
      base = config.base;
    },
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

        const rawSource = typeof chunk.code === "string" ? chunk.code : "";

        if (rawSource === "") return output;

        /** `D-25`: المُعيِّناتُ تُحَلُّ نسبةً إلى المستندِ بعدَ الإدماجِ — فتُطلَقُ. */
        const source = absolutizeEntrySpecifiers(
          rawSource,
          chunk.fileName,
          [...chunk.imports, ...chunk.dynamicImports],
          base,
        );

        /**
         * نستبدلُ الوسمَ بـ`<script type="module">...</script>` مُدمَجاً. ولا
         * نُضيفُ `crossorigin`: السكربتُ مُدمَجٌ في المستندِ، لا طلبٌ شبكيٌّ.
         */
        output = output.replace(
          new RegExp(escapeForRegExp(tag), "g"),
          `<script type="module">${source}</script>`,
        );

        /**
         * الأصلُ يُحذَف من المُخرَج: ملفٌّ لا يطلبه أحدٌ يبقى وعداً بخُبَيْئةٍ باردة.
         * زيادةٌ (`D-25` · `ح-8`): كانَ السطرُ `delete bundle[fileName]` — والمفتاحُ
         * `assets/index-*.js` لا `index-*.js` — فلم يُحذَفْ شيءٌ قطُّ وبقيَ الملفُّ
         * وخريطتُه في `dist/assets/`. فصارَ الحذفُ بالمفتاحِ الكاملِ ومعَه الخريطةُ.
         */
        delete bundle[bundleKey];
        delete bundle[`${bundleKey}.map`];

        return output;
      },
    },
  };
}
