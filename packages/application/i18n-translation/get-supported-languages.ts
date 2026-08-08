/**
 * الغرض: قائمة اللغات المعروضة للاختيار، كلٌّ باسمها بلغتها هي.
 * الحالة: منفّذ فعلياً — المرحلة 2.6.
 * ينتمي إلى: application/i18n-translation
 * يُتوقع أن يستخدمه لاحقاً: packages/application/bots/*، apps/admin-dashboard
 * ملاحظات مستقبلية: تُقرأ من القاعدة حين تصير اللغات قابلة للتفعيل لكل مدينة.
 */

import {
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from "../../domain/i18n-translation/index.ts";

export interface LanguageOption {
  readonly code: SupportedLanguage;
  /** الاسم بلغته هو: من لا يقرأ العربية لن يجد «الإنجليزية» مكتوبةً بالعربية. */
  readonly label: string;
}

export function getSupportedLanguages(): readonly LanguageOption[] {
  return SUPPORTED_LANGUAGES.map((code) => ({ code, label: LANGUAGE_LABELS[code] }));
}
