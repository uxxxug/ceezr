/**
 * الغرض: أخطاء الترجمة مصنَّفة بحسب ما يجب فعله عندها، لا بحسب نصّ المزوّد.
 * الحالة: منفّذ فعلياً — المرحلة 2.6.
 * ينتمي إلى: domain/i18n-translation
 * يُتوقع أن يستخدمه لاحقاً: packages/application/i18n-translation، packages/infrastructure/i18n-translation
 * ملاحظات مستقبلية: عند تعدّد المزوّدات يُضاف حقل المزوّد للتمييز في السجلّ.
 */

/**
 * تصنيف الفشل: قابل لإعادة المحاولة أم لا. المزوّد المتعثّر لحظةً غير المزوّد
 * الذي لا يعرف زوج اللغتين أصلاً — الأول يُعاد معه، والثاني لا معنى لإعادته.
 */
export type TranslationFailureKind =
  | "provider_unavailable"
  | "rate_limited"
  | "unsupported_pair"
  | "bad_response"
  | "timeout";

export class TranslationFailure {
  readonly code = "TRANSLATION_FAILURE" as const;
  constructor(
    readonly kind: TranslationFailureKind,
    readonly provider: string,
    readonly detail: string,
  ) {}

  /** هل يستحقّ إعادة المحاولة بمزوّد بديل أو بعد حين. */
  get retryable(): boolean {
    return this.kind !== "unsupported_pair";
  }
}

export class UnsupportedLanguageError {
  readonly code = "UNSUPPORTED_LANGUAGE" as const;
  constructor(readonly requested: string) {}
}
