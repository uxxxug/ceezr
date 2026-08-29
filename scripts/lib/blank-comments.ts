/**
 * # تفريغُ التعليقاتِ قبلَ المطابقة — وحدةٌ نقيّةٌ مشتركةٌ
 *
 * **الغرض:** الحواجزُ النصّيةُ تُطابِق أنماطاً على أسطرِ الشيفرة، وتعليقاتُها تشرح
 * القاعدةَ **فتذكر الممنوعَ نصّاً** ولا تُنفِّذ شيئاً. فتُفرَّغ التعليقاتُ قبلَ
 * المطابقة، **مع إبقاءِ أطوالِ الأسطرِ وعددِها كما هي** كي تبقى أرقامُ الأسطرِ في
 * البلاغِ صحيحةً.
 *
 * **الحالة:** `F1-10` — مُنفَّذ · مُختبَر. **وهي إصلاحُ عيبٍ حقيقيٍّ لا تنظيمٌ:**
 * النسخةُ التي كانت منسوخةً في الحواجزِ تُعامِل `//` في `https://` معاملةَ بدايةِ
 * تعليقٍ، **فتفرّغ كلَّ عنوانٍ في المستودعِ**. ومعنى ذلك أنّ أيَّ حاجزٍ يطابق على
 * عنوانٍ كان **ميتاً وهو أخضرُ** — وقد ظهر ذلك في `F1-10` عندَ برهانِ السقوطِ: ثلاثةُ
 * مساببرَ محقونةٍ مرَّت بخروج 0 (ADR 0045 §٧).
 *
 * **ينتمي إلى:** `scripts/lib`
 *
 * **يُتوقع أن يستخدمه لاحقاً:** كلُّ حاجزٍ نصّيٍّ — وللـSQL دالةٌ منفصلةٌ
 * (`blankSqlComments`) لأنّ وسمَ التعليقِ فيه `--` لا `//`. وقد وُصِل به
 * `check-single-origin-assets.ts` و`check-telemetry-policy.ts`، **والباقي يُوصَل
 * عندَ أوّلِ مساسٍ به** ولا يُعاد كتابةُ حاجزٍ سليمٍ بلا سبب.
 *
 * **ملاحظات مستقبلية:** لو احتاج حاجزٌ دقّةً أعلى فالصوابُ **مُحلِّلٌ حقيقيٌّ**
 * (`ts-morph` أو `typescript`) لا حشوُ استثناءاتٍ في هذا المُبَسَّطِ. وحينها يُقرَّر
 * بـADR لأنّه تبعيّةٌ جديدةٌ في مسارِ CI.
 *
 * **ما لا تفعله هذه الوحدةُ عن قصدٍ — وحدودُها مُعلَنةٌ لا مضمرةٌ:**
 * - **ليست مُحلِّلاً**: لا تفهم النصوصَ الحرفيّةَ ولا القوالبَ ولا التعابيرَ
 *   النمطيّةَ. فتعليقٌ داخلَ نصٍّ حرفيٍّ (`const s = "// ليس تعليقاً"`) **يُفرَّغ**
 *   خطأً، وذلك يُنتِج **سلبيّاً كاذباً** (يُفلِت مخالفةً) لا موجباً كاذباً.
 * - **لا تحذف شيئاً**: تُبدِل بمسافاتٍ فقط.
 * - **لا تحرس شيئاً**: القواعدُ في الحواجزِ.
 */

/**
 * `//` بدايةُ تعليقٍ **إلّا** إن سبقها ما يجعلها جزءاً من نصٍّ:
 * - `:` ⇒ مِخطاطُ عنوانٍ (`https://`).
 * - علامةُ اقتباسٍ ⇒ نصٌّ يبدأ بعنوانٍ نسبيِّ المِخطاطِ (`"//cdn.example"`).
 * - `/` ⇒ داخلَ تعليقِ سطرٍ سلفاً، لا يُعاد فتحُه.
 *
 * والحدُّ مُعلَنٌ في رأسِ الملفّ: هذه قاعدةٌ نصّيّةٌ لا تحليلٌ نحويّ.
 */
function isLineCommentStart(source: string, index: number): boolean {
  if (source.slice(index, index + 2) !== "//") return false;
  const previous = index === 0 ? "" : source[index - 1];
  if (previous === ":" || previous === '"' || previous === "'" || previous === "`") return false;
  return true;
}

/**
 * يُبدِل كلَّ تعليقٍ بمسافاتٍ: `//…` إلى نهايةِ السطرِ · `/*…*\/` · و`<!--…-->`
 * للمستنداتِ. الأسطرُ الجديدةُ تبقى كما هي فلا تتغيّر أرقامُ الأسطر.
 */
export function blankComments(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    if (isLineCommentStart(source, index)) {
      while (index < source.length && source[index] !== "\n") {
        out += " ";
        index += 1;
      }
      continue;
    }
    if (source.slice(index, index + 2) === "/*") {
      while (index < source.length && source.slice(index, index + 2) !== "*/") {
        out += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      /** خاتمةُ التعليقِ نفسُها تُفرَّغ، وقد تكون ناقصةً في ملفٍّ مقطوعٍ. */
      const remaining = Math.min(2, source.length - index);
      out += " ".repeat(remaining);
      index += remaining;
      continue;
    }
    if (source.slice(index, index + 4) === "<!--") {
      while (index < source.length && source.slice(index, index + 3) !== "-->") {
        out += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      const remaining = Math.min(3, source.length - index);
      out += " ".repeat(remaining);
      index += remaining;
      continue;
    }
    out += source[index];
    index += 1;
  }
  return out;
}

/**
 * مثلُ `blankComments` ولكنّ وسمَ تعليقِ السطرِ فيه `--` لا `//`، مع `/*…*\/`.
 * **ولا تُفرَّغ التعليقاتُ داخلَ جسدٍ مُحدَّدٍ بعلامتي دولارٍ** (`$$ … $$` أو
 * `$tag$ … $tag$`) لأنّ جسدَ الدالةِ نصٌّ حرفيٌّ في لغةِ SQL، وفيه DDL حقيقيٌّ
 * يُنفَّذ (`execute format('revoke …')`) فلا يجوز إسقاطُه من المطابقة.
 *
 * **حدٌّ مُعلَنٌ:** النصوصُ المُقتبسةُ بعلامةٍ مفردةٍ غيرُ مقروءةٍ، فـ`--`
 * داخلَ نصٍّ حرفيٍّ يُفرِّغ بقيّةَ السطرِ — وذلك **سلبٌّ كاذبٌ** (يُفلِت
 * مخالفةً) لا موجبٌ كاذبٌ.
 */
export function blankSqlComments(source: string): string {
  let out = "";
  let index = 0;
  let dollarTag: string | null = null;
  while (index < source.length) {
    if (dollarTag !== null) {
      if (source.startsWith(dollarTag, index)) {
        out += dollarTag;
        index += dollarTag.length;
        dollarTag = null;
        continue;
      }
      out += source[index];
      index += 1;
      continue;
    }
    const opening = /^\$[a-z_]*\$/i.exec(source.slice(index, index + 40));
    if (opening !== null) {
      dollarTag = opening[0];
      out += dollarTag;
      index += dollarTag.length;
      continue;
    }
    if (source.slice(index, index + 2) === "--") {
      while (index < source.length && source[index] !== "\n") {
        out += " ";
        index += 1;
      }
      continue;
    }
    if (source.slice(index, index + 2) === "/*") {
      while (index < source.length && source.slice(index, index + 2) !== "*/") {
        out += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      const remaining = Math.min(2, source.length - index);
      out += " ".repeat(remaining);
      index += remaining;
      continue;
    }
    out += source[index];
    index += 1;
  }
  return out;
}
