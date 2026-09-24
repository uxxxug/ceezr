/**
 * # سياسةُ النطاقِ الواحدِ وسياسةُ أمنِ المحتوى — وحدةٌ نقيّةٌ واحدةٌ
 *
 * **الغرض:** موضعٌ **واحدٌ** في المستودعِ كلِّه يُعلَن فيه (١) أيُّ نطاقٍ خارجيٍّ
 * مأذونٌ له بتنفيذِ شيءٍ في مستندِ التطبيقِ المصغَّرِ، و(٢) نصُّ سياسةِ أمنِ
 * المحتوى الذي يُحقَن في `dist/index.html` عندَ البناء. والوحدةُ **نقيّةٌ**: لا
 * قراءةَ قرصٍ ولا شبكةَ ولا `process.env` — تأخذ ما تحتاجه معامِلاتٍ وتُعيد نصّاً.
 * والنقاءُ لأجلِ أن يُختبَر النصُّ حرفاً حرفاً، وأن يقرأه **الحاجزُ والباني معاً**
 * فلا يفترقا.
 *
 * **الحالة:** `F1-10` — مُنفَّذ · مُختبَر (ADR 0045).
 *
 * **ينتمي إلى:** البند `F1-10` «تثبيت النطاق الواحد ومنع الأصول التنفيذية
 * الخارجية (TG-005)» · القسم 9.2 صفَّ «النطاق» · القيدَ `TG-005`.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** إضافةُ البناءِ `apps/miniapp/vite/inject-csp.ts`
 * (تحقن الوسمَ) · الحاجزُ `scripts/check-single-origin-assets.ts` (يقارن المُخرَجَ
 * بالسياسةِ ويمنع الأصولَ التنفيذيةَ الخارجية) · واختباراتُ الوحدة.
 *
 * **ملاحظات مستقبلية:** حين تُبنى حزمةُ `map` سيلزم قرارٌ في `connect-src` و
 * `img-src` لبلاطاتِ الخريطةِ، وقرارٌ أشدُّ في `script-src` لمكتبةِ MapLibre —
 * وذلك توتُّرٌ **مُعلَنٌ غيرُ محسومٍ** في ADR 0045 §٦ ولا يُستبَق ههنا بسطر.
 *
 * **ما لا تفعله هذه الوحدةُ عن قصدٍ:**
 * - **لا تُصدِر `frame-ancestors`.** الوسمُ (`<meta>`) **يُهمِلها بنصِّ المعيارِ**،
 *   فكتابتُها تُنتِج حمايةً موهومةً؛ ولو عُمِلت لكسرت تضمينَ تلغرامَ للتطبيقِ في
 *   الويب. وموضعُها رأسُ استجابةٍ من المضيفِ — ولا مضيفَ للتطبيقِ المصغَّرِ بعدُ.
 * - **لا تُصدِر `nonce`.** المُستَعارُ (nonce) يحتاج قيمةً تُولَّد **لكلِّ استجابةٍ**،
 *   ومستندُنا ملفٌّ ثابتٌ يُخدَّم من CDN بلا توليدٍ لكلِّ طلب. فقيمةٌ مكتوبةٌ في
 *   ملفٍّ ثابتٍ ليست مُستَعاراً بل سرّاً معروفاً — وهي أسوأُ من لا شيءٍ لأنها
 *   تُقرأ حمايةً. والبديلُ المستعمَلُ ههنا **بصمةُ المحتوى** (`sha256`).
 * - **لا تُصدِر `'unsafe-inline'` ولا `'unsafe-eval'` بحالٍ** — ولا معامِلَ يفتحهما.
 * - **لا تقرأ بيئةً ولا قرصاً** ولا تعرف شيئاً عن `dist`.
 * - **لا تحرس شيئاً**: هي تُعلِن السياسةَ، والفرضُ في الحاجزِ وحدَه.
 */

import { createHash } from "node:crypto";

/**
 * ## النطاقاتُ الخارجيةُ المأذونُ لها بتنفيذِ شيءٍ في مستندِنا
 *
 * قائمةٌ **مغلقةٌ**، ومعها **سندُ كلِّ مدخلٍ مكتوباً** لا مجرَّدَ اسمٍ: نطاقٌ يُضاف
 * بلا سندٍ هو بالضبطِ ما يمنعه القيدُ `TG-005`.
 *
 * **وواحدٌ لا أكثر.** والسندُ: توثيقُ تلغرامَ الرسميُّ يشترط تحميلَ سكربتِ جسرِ
 * المنصّةِ من `telegram.org` في رأسِ المستندِ قبلَ أيِّ سكربتٍ آخرَ، **ولا يذكر خياراً
 * لاستضافتِه على نطاقِنا**. (واسمُ الملفِّ لا يُكتَب ههنا: حاجزُ `F1-02` يقصره على
 * `apps/miniapp/index.html` وحدَه، وذاك صوابٌ يُحتَرَم لا يُستثنى منه.) فهذا استثناءٌ **مفروضٌ من المنصّةِ
 * لا اختيارٌ لنا**، ولذلك لا يُقاس عليه: كلُّ نطاقٍ آخرَ ممنوعٌ.
 *
 * وطبقةُ `tg/` تتدهور بلا هذا السكربتِ (`ARCH-014` / ADR 0031)، فمنعُ المتصفّحِ له
 * خارجَ تلغرامَ لا يُسقِط التطبيقَ.
 */
export const ALLOWED_EXTERNAL_ORIGINS: Readonly<Record<string, string>> = Object.freeze({
  "https://telegram.org":
    "سكربتُ Mini App الرسميُّ — يشترطه توثيقُ تلغرامَ في رأسِ المستندِ ولا يذكر " +
    "خياراً لاستضافتِه على نطاقِنا. استثناءٌ مفروضٌ من المنصّةِ لا اختيارٌ لنا.",
});

/** أسماءُ النطاقاتِ المأذونِ لها، مرتَّبةً ثابتاً كي يكون نصُّ السياسةِ حتميّاً. */
export const ALLOWED_EXTERNAL_ORIGIN_LIST: readonly string[] = Object.freeze(
  Object.keys(ALLOWED_EXTERNAL_ORIGINS).sort(),
);

/**
 * الموضعُ **الوحيدُ** المأذونُ له بحملِ مصدرٍ خارجيٍّ في المستودعِ كلِّه.
 * والحاجزُ يقرأ هذا الثابتَ لا نصّاً مكتوباً فيه مرّتَين.
 */
export const SOLE_EXTERNAL_SCRIPT_HOST_FILE = "apps/miniapp/index.html";

/**
 * مَن يُسمَحُ له بتأطيرِ التطبيقِ المصغَّرِ — `frame-ancestors` (ADR 0165 · `F1-10`).
 *
 * وهذا **شرطُ عملٍ لا تشديدٌ أمنيٌّ**: التطبيقُ يُفتَحُ داخلَ إطارٍ في
 * تلغرام، فمنعُ التأطيرِ يُنتِجُ **شاشةً بيضاءَ بلا رسالةِ خطأٍ** في
 * Telegram Desktop وWeb — وهو أسوأُ من عطلٍ صارخٍ.
 *
 * **وموضعُها رأسُ استجابةٍ لا وسمُ `<meta>` — ولا خيارَ لنا في ذلك**:
 * `frame-ancestors` من التوجيهاتِ التي **يتجاهلُها المتصفّحُ في الوسمِ**
 * بحكمِ المواصفةِ. ولذلكَ لا تدخلُ هذهِ القيمةُ في `buildCsp`: إقحامُها في
 * الوسمِ يكتبُ توجيهاً لا يعملُ فيُوهِمُ أنَّ الحمايةَ قائمةٌ.
 *
 * `*.telegram.org` لأنَّ عملاءَ الويبِ يُقدَّمونَ من نطاقاتٍ فرعيّةٍ
 * (`web.telegram.org`)، و`telegram.org` معَها لأنَّ النمطَ الفرعيَّ **لا يشملُ
 * النطاقَ الأصليَّ** في CSP.
 */
export const MINIAPP_FRAME_ANCESTORS: readonly string[] = Object.freeze([
  "https://telegram.org",
  "https://*.telegram.org",
]);

/**
 * قيمةُ رأسِ `Content-Security-Policy` للموقعِ الساكنِ — **توجيهٌ واحدٌ**.
 *
 * والاقتصارُ مقصودٌ: توجيهاتُ الجلبِ (`script-src` · `connect-src` …) تبقى في
 * الوسمِ وحدَه لأنَّ `connect-src` فيها يُبنى من `VITE_WASLAH_API_BASE` في زمنِ
 * البناءِ، وكتابتُها رأساً **أيضاً** تُنشِءُ مصدَرَي حقيقةٍ لشيءٍ واحدٍ
 * يفترقانِ بسهوٍ — والمتصفّحُ يُطبّقُ أشدَّهما فيصيرُ المنعُ من حيثُ لا يُقرأ.
 */
export function frameAncestorsHeaderValue(): string {
  return `frame-ancestors ${MINIAPP_FRAME_ANCESTORS.join(" ")}`;
}

export interface CspInputs {
  /**
   * قيمةُ `VITE_WASLAH_API_BASE` كما تُبنى بها الحزمةُ. الفراغُ (أو `undefined`)
   * يعني **الأصلَ نفسَه** كما يفعل `apps/miniapp/src/api/client.ts` — فلا يُضاف
   * أصلٌ إلى `connect-src`.
   */
  readonly apiBase?: string | undefined;
  /**
   * بصماتُ `sha256` **بالنصِّ الكاملِ** (`'sha256-…'`) لكلِّ كتلةِ أنماطٍ مُدمَجةٍ في
   * المستند. مصدرُها المُخرَجُ نفسُه لا وعدٌ.
   */
  readonly inlineStyleHashes: readonly string[];
  /**
   * بصماتُ `sha256` **بالنصِّ الكاملِ** (`'sha256-…'`) لكلِّ سكربتٍ مُدمَجٍ في
   * المستند (المدخلُ في `D-23`). مصدرُها المُخرَجُ نفسُه لا وعدٌ. والنمطُ هو
   * عينُه نمطُ الأنماطِ المُدمَجةِ: بصمةٌ لا `'unsafe-inline'`.
   * اختياريٌّ: إن لم يُمرَّر فلن تُضافَ بصماتٌ إلى `script-src` (التوافقُ مع ما
   * قبلَ `D-23`).
   */
  readonly inlineScriptHashes?: readonly string[];
}

/**
 * أصلُ عنوانٍ مطلقٍ، أو `null` إن لم يكن مطلقاً أو كان فاسداً.
 * والنسبيُّ (`/v1`) والفارغُ يعنيان الأصلَ نفسَه فلا يُضافانِ إلى السياسة.
 */
export function originOf(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "" || !/^https?:\/\//i.test(trimmed)) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

/**
 * يبني نصَّ السياسةِ. الترتيبُ والفواصلُ حتميّةٌ كي يقارنها الحاجزُ حرفياً بما في
 * `dist/index.html` — فسياسةٌ تُحقَن ثم تُعدَّل بيدٍ لا تمرُّ.
 *
 * ولكلِّ تعليمةٍ سببٌ:
 * - `default-src 'none'` — الأصلُ المنعُ، وكلُّ ما يُسمَح يُسمَّى صريحاً. فقالبٌ
 *   جديدٌ (خطٌّ · عامِلٌ · بيانُ تطبيقٍ) يُمنَع حتى يُقرَّر، لا يمرُّ صامتاً.
 * - `script-src 'self' <المأذونُ> <بصماتُ السكربتِ المُدمَجِ>` — بلا `'unsafe-inline'`
 *   ولا `'unsafe-eval'`. والبصماتُ تمديدٌ من `D-23`: المدخلُ مُدمَجٌ في المستندِ
 *   بنمطِ الأنماطِ، فبصمتُه في `script-src` شرطُ عملِ التطبيق.
 * - `style-src 'self' <بصماتُ الأنماطِ المُدمَجةِ>` — الأنماطُ صارت في المستندِ
 *   بقرارِ `F1-09` (طلبُ شبكةٍ أقلُّ)، فبصمتُها **شرطُ عملِ التطبيق**: البندانِ
 *   مقترنانِ لا مستقلّانِ.
 * - `img-src 'self' data:` — `data:` لأنّ أيقونةً مُدمَجةً في CSS تُقرأ صورةً.
 * - `connect-src` — الأصلُ نفسُه، ومعه أصلُ الواجهةِ إن كان مطلقاً في زمنِ البناء.
 * - `base-uri 'none'` — يمنع تحويلَ كلِّ مسارٍ نسبيٍّ بوسمِ `<base>` مُحقَن.
 * - `form-action 'none'` — لا نموذجَ في التطبيقِ، فالإرسالُ إلى أيِّ مكانٍ ممنوعٌ.
 * - `object-src 'none'` — لا `<object>` ولا `<embed>` بحالٍ.
 * - `frame-src 'none'` و`child-src 'none'` — لا إطارَ داخليَّ (وهو نصُّ الحاجزِ
 *   أيضاً)؛ ومُصرَّحانِ ولا يُتركانِ لتراجعِ `default-src` كي يكون المنعُ مقروءاً.
 */
export function buildCsp(inputs: CspInputs): string {
  const external = ALLOWED_EXTERNAL_ORIGIN_LIST.join(" ");
  const apiOrigin = originOf(inputs.apiBase);
  const connect = apiOrigin === null ? "'self'" : `'self' ${apiOrigin}`;
  const styles =
    inputs.inlineStyleHashes.length === 0
      ? "'self'"
      : `'self' ${inputs.inlineStyleHashes.join(" ")}`;
  const scriptHashes = inputs.inlineScriptHashes ?? [];
  const scripts =
    scriptHashes.length === 0
      ? `'self' ${external}`
      : `'self' ${external} ${scriptHashes.join(" ")}`;

  return [
    "default-src 'none'",
    `script-src ${scripts}`,
    `style-src ${styles}`,
    "img-src 'self' data:",
    `connect-src ${connect}`,
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
  ].join("; ");
}

/** وسمُ السياسةِ كما يُحقَن في الرأسِ. موضعُ بنائِه واحدٌ فلا يفترق الحاجزُ والباني. */
export function cspMetaTag(policy: string): string {
  return `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
}

/** بصمةُ `sha256` بصيغةِ السياسةِ: `'sha256-<base64>'`. حسابٌ نقيٌّ لا قرصَ فيه. */
export function sha256Source(source: string): string {
  return `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`;
}

/**
 * التعليقاتُ تُحذَفُ قبلَ الاستخراجِ: المتصفّحُ لا يُنفِّذُ ما فيها، ووسمٌ مذكورٌ نصّاً
 * في تعليقٍ كانَ سيُطابَقُ فتُحسَبُ بصمةُ جسمٍ لا وجودَ له ويُحجَبُ السكربتُ الحقيقيُّ.
 */
function withoutHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

/** أجسامُ كتلِ `<style>` المُضمَّنةِ في مستندٍ، بترتيبِ ورودِها. */
export function inlineStyleBodies(html: string): string[] {
  const source = withoutHtmlComments(html);
  const bodies: string[] = [];
  const pattern = /<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g;
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    bodies.push(match[1] ?? "");
  }
  return bodies;
}

/**
 * أجسامُ **كلِّ** سكربتٍ مُضمَّنٍ في مستندٍ — وحدةً كانَ (`type="module"`) أو
 * كلاسيكيّاً (بلا `type`) — بترتيبِ ورودِها؛ ويُتخطّى ما له `src=` لأنَّه ليسَ مُضمَّناً.
 *
 * زيادةٌ 2026-09-25 (`F1-09` · `D-27`): كانَ المستخرِجُ نسختَينِ (الباني والحاجزُ)
 * تطابقانِ `type="module"` وحدَه، فسكربتٌ كلاسيكيٌّ مُضمَّنٌ يخرجُ بلا بصمةٍ فيحجبُه
 * المتصفّحُ صامتاً. وصارَ مصدراً واحداً هنا يقرؤه الاثنانِ فلا يفترقانِ.
 */
export function inlineScriptBodies(html: string): string[] {
  const source = withoutHtmlComments(html);
  const bodies: string[] = [];
  const pattern = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    const attributes = match[1] ?? "";
    if (/\ssrc=/.test(attributes)) continue;
    bodies.push(match[2] ?? "");
  }
  return bodies;
}
