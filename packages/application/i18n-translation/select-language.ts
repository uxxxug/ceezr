/**
 * الغرض: تغيير لغة المستخدم — التحقّق في الدومين، والكتابة الذرّية في القاعدة.
 * الحالة: منفّذ فعلياً — المرحلة 2.6.
 * ينتمي إلى: application/i18n-translation
 * يُتوقع أن يستخدمه لاحقاً: packages/application/bots/*، apps/admin-dashboard
 * ملاحظات مستقبلية: عند دعم لغة رابعة يتغيّر الدومين والقاعدة معاً، ولا يتغيّر هذا الملفّ.
 */

import {
  parseLanguage,
  type SupportedLanguage,
  UnsupportedLanguageError,
} from "../../domain/i18n-translation/index.ts";
import { err, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

export interface LanguageChangeOutcome {
  readonly language: SupportedLanguage;
  /** false حين اختار المستخدم لغته الحالية — نجاح بلا كتابة ولا سجلّ تدقيق. */
  readonly changed: boolean;
  readonly previous: SupportedLanguage | null;
}

export interface LanguagePreferencePort {
  /** يقابل الدالّة set_user_language. */
  setLanguage(
    telegramId: string,
    language: SupportedLanguage,
  ): Promise<Result<LanguageChangeOutcome, PortFailureError>>;
  /** يقابل الدالّة get_user_language؛ null إن لم يكن المستخدم مسجَّلاً بعد. */
  getLanguage(telegramId: string): Promise<Result<SupportedLanguage | null, PortFailureError>>;
}

export interface SelectLanguageDependencies {
  readonly preferences: LanguagePreferencePort;
}

export type SelectLanguageError = UnsupportedLanguageError | PortFailureError;

export async function selectLanguage(
  input: { readonly telegramId: string; readonly language: string },
  deps: SelectLanguageDependencies,
): Promise<Result<LanguageChangeOutcome, SelectLanguageError>> {
  const parsed = parseLanguage(input.language);
  if (!parsed.ok) return err(new UnsupportedLanguageError(input.language));
  return deps.preferences.setLanguage(input.telegramId, parsed.value);
}
