/**
 * الغرض: أحداث الترجمة واللغة — للتدقيق ولقياس نسبة الرسائل التي احتاجت جسراً لغوياً.
 * الحالة: منفّذ فعلياً — المرحلة 2.6.
 * ينتمي إلى: domain/i18n-translation
 * يُتوقع أن يستخدمه لاحقاً: packages/application/i18n-translation، لوحة الإدارة
 * ملاحظات مستقبلية: تُنشر على ناقل أحداث حين يوجد ناقل، لا قبله.
 */

import type { SkipReason } from "./entity.ts";
import type { SupportedLanguage } from "./value-objects.ts";

export interface UserLanguageChanged {
  readonly type: "i18n.language_changed";
  readonly telegramId: string;
  readonly from: SupportedLanguage | null;
  readonly to: SupportedLanguage;
  readonly at: Date;
}

export interface MessageTranslated {
  readonly type: "i18n.message_translated";
  readonly from: SupportedLanguage;
  readonly to: SupportedLanguage;
  readonly provider: string;
  readonly cached: boolean;
  readonly chars: number;
  readonly at: Date;
}

export interface TranslationSkipped {
  readonly type: "i18n.translation_skipped";
  readonly reason: SkipReason;
  readonly at: Date;
}

export type TranslationEvent = UserLanguageChanged | MessageTranslated | TranslationSkipped;
