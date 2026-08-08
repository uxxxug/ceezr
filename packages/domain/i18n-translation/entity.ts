/**
 * الغرض: قرار الترجمة — متى تُترجَم رسالة ومتى لا تُترجَم، وكيف يُبنى مفتاح ذاكرتها،
 *   وكيف تُعرض المترجَمة بجانب أصلها. القرار كلّه هنا بلا شبكة ولا قاعدة.
 * الحالة: منفّذ فعلياً — المرحلة 2.6.
 * ينتمي إلى: domain/i18n-translation
 * يُتوقع أن يستخدمه لاحقاً: packages/application/i18n-translation
 * ملاحظات مستقبلية: كشف اللغة من النصّ نفسه (لا من إعداد المستخدم) يُضاف قراراً هنا أيضاً.
 */

import {
  type LanguagePair,
  type SupportedLanguage,
  sameLanguage,
  TRANSLATION_MAX_CHARS,
} from "./value-objects.ts";

/**
 * لماذا لم تُترجَم الرسالة. السبب يُعاد دائماً ولا يُبتلع: تمرير رسالة بلا ترجمة
 * قرارٌ يجب أن يظهر في السجلّ، وإلا صار «الترجمة لا تعمل» شكوى بلا تشخيص.
 */
export type SkipReason =
  | "same_language"
  | "empty_text"
  | "too_long"
  | "no_translatable_content"
  | "disabled";

export type TranslationDecision =
  | { readonly kind: "translate"; readonly text: string; readonly pair: LanguagePair }
  | { readonly kind: "skip"; readonly reason: SkipReason };

export interface DecideTranslationInput {
  readonly text: string;
  readonly pair: LanguagePair;
  /** يُطفأ حين لا يكون هناك مزوّد مضبوط — الإطفاء قرار تشغيلي لا عطل. */
  readonly enabled: boolean;
  readonly maxChars?: number;
}

/**
 * النصّ الذي لا يحمل حرفاً واحداً — رقم هاتف محجوب، أو رموز، أو أرقام فقط —
 * لا يُرسَل لمزوّد ترجمة: التكلفة والتأخير مقابل نصّ يعود كما ذهب.
 */
export function hasTranslatableContent(text: string): boolean {
  return /\p{L}/u.test(text);
}

export function decideTranslation(input: DecideTranslationInput): TranslationDecision {
  if (!input.enabled) return { kind: "skip", reason: "disabled" };

  const text = input.text.trim();
  if (text === "") return { kind: "skip", reason: "empty_text" };
  if (sameLanguage(input.pair)) return { kind: "skip", reason: "same_language" };
  if (!hasTranslatableContent(text)) return { kind: "skip", reason: "no_translatable_content" };

  const limit = input.maxChars ?? TRANSLATION_MAX_CHARS;
  if (text.length > limit) return { kind: "skip", reason: "too_long" };

  return { kind: "translate", text, pair: input.pair };
}

/**
 * مفتاح الذاكرة المؤقتة. النصّ نفسه جزء من المفتاح لأن الترجمة دالّة فيه،
 * والاتجاه جزء منه لأن ترجمة ع→إن ليست عكس إن→ع.
 */
export function translationCacheKey(pair: LanguagePair, text: string): string {
  return `${pair.from}:${pair.to}:${text.trim()}`;
}

export interface TranslatedMessage {
  /** النصّ الذي يُعرض للقارئ: المترجَم إن نجحت الترجمة، وإلا الأصل. */
  readonly text: string;
  readonly original: string;
  readonly translated: boolean;
  readonly pair: LanguagePair;
  /** سبب عدم الترجمة إن لم تُترجَم، أو null. */
  readonly skipped: SkipReason | null;
  /** اسم المزوّد الذي نفّذ الترجمة فعلاً، أو null. */
  readonly provider: string | null;
  /** هل جاءت من الذاكرة المؤقتة بلا نداء شبكة. */
  readonly cached: boolean;
}

export function untranslated(
  original: string,
  pair: LanguagePair,
  reason: SkipReason,
): TranslatedMessage {
  return {
    text: original,
    original,
    translated: false,
    pair,
    skipped: reason,
    provider: null,
    cached: false,
  };
}

/**
 * الأصل يُعرض دائماً تحت الترجمة ولا يُستبدل بها. الترجمة الآلية تخطئ،
 * ومن يعرف شيئاً من لغة الطرف الآخر يجب أن يملك تصحيح ما فهمه بنفسه —
 * ولو أخفينا الأصل لصار خطأ المزوّد خطأ الطرف في نظر القارئ.
 */
export function shouldShowOriginal(message: TranslatedMessage): boolean {
  return message.translated;
}

/** ما إذا كان طرفان يحتاجان ترجمة بينهما أصلاً — يُستعمل قبل بناء أي حوار. */
export function needsBridging(a: SupportedLanguage, b: SupportedLanguage): boolean {
  return a !== b;
}
