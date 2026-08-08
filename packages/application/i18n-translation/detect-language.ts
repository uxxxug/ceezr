/**
 * الغرض: كشف لغة نصّ قصير من كتابته (الخطّ)، لا من إعداد المستخدم.
 * الحالة: منفّذ فعلياً — المرحلة 2.6.
 * ينتمي إلى: application/i18n-translation
 * يُتوقع أن يستخدمه لاحقاً: packages/infrastructure/notification (التمرير)، لوحة الإدارة
 * ملاحظات مستقبلية: التمييز بين العربية والأردية يحتاج نموذجاً لا خطّاً — موثَّق أدناه.
 */

import type { SupportedLanguage } from "../../domain/i18n-translation/index.ts";

const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F]/u;
const LATIN_SCRIPT = /[A-Za-z]/u;
/** حروف تكاد تنفرد بها الأردية دون العربية — قرينة لا برهان. */
const URDU_MARKERS = /[\u0679\u067E\u0686\u0688\u0691\u06BA\u06BE\u06C1\u06CC\u06D2]/u;

export interface LanguageGuess {
  readonly language: SupportedLanguage | null;
  /** ثقة تقريبية في المدى [0,1] — تُستعمل للقرار لا للعرض. */
  readonly confidence: number;
}

/**
 * الكشف بالخطّ لا باللغة: العربية والأردية تشتركان في الأبجدية نفسها، فالتمييز
 * بينهما بالحروف المنفردة قرينة قد تخطئ. لذلك يبقى إعداد المستخدم هو المصدر
 * الأول للغة، وهذه الدالّة مرجّح احتياطي حين لا يكون الإعداد موجوداً.
 */
export function detectLanguage(text: string): LanguageGuess {
  const trimmed = text.trim();
  if (trimmed === "") return { language: null, confidence: 0 };

  if (URDU_MARKERS.test(trimmed)) return { language: "ur", confidence: 0.75 };
  if (ARABIC_SCRIPT.test(trimmed)) return { language: "ar", confidence: 0.7 };
  if (LATIN_SCRIPT.test(trimmed)) return { language: "en", confidence: 0.6 };
  return { language: null, confidence: 0 };
}

/** اللغة المُعلَنة للمستخدم أولى دائماً؛ الكشف يسدّ غيابها فقط. */
export function resolveLanguage(
  declared: SupportedLanguage | null,
  text: string,
  fallback: SupportedLanguage,
): SupportedLanguage {
  if (declared !== null) return declared;
  return detectLanguage(text).language ?? fallback;
}
