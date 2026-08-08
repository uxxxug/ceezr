/**
 * الغرض: قيم اللغة والترجمة — ما هي لغة مدعومة، وكيف يُطبَّع وسم لغة قادم من تيليجرام،
 *   وما حدود النصّ الذي يجوز إرساله لمزوّد ترجمة خارجي.
 * الحالة: منفّذ فعلياً — المرحلة 2.6.
 * ينتمي إلى: domain/i18n-translation
 * يُتوقع أن يستخدمه لاحقاً: packages/application/i18n-translation، packages/infrastructure/i18n-translation
 * ملاحظات مستقبلية: إضافة لغة تتطلّب قاموساً في packages/shared/i18n وقيداً في القاعدة معاً.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";

/** اللغات التي لها قاموس كامل وقيد في القاعدة. لا لغة رابعة بلا الاثنين معاً. */
export const SUPPORTED_LANGUAGES = ["ar", "en", "ur"] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * حدّ تقني لا تجاري: مزوّدات الترجمة المجانية ترفض النصوص الطويلة أو تبترها،
 * والبتر الصامت أسوأ من الامتناع لأنه يوهم القارئ أنه قرأ الرسالة كاملة.
 */
export const TRANSLATION_MAX_CHARS = 900;

export function isSupportedLanguage(value: string): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * يطبّع وسماً مثل `ar-SA` أو `EN_us` إلى لغة مدعومة. تيليجرام يرسل وسم اللغة
 * بصيغ متفاوتة، ورفض `ar-SA` لأنه ليس `ar` حرفياً خطأ يقع فيه من يقارن نصّين.
 */
export function normalizeLanguageTag(raw: string | null | undefined): SupportedLanguage | null {
  if (raw === null || raw === undefined) return null;
  const base = raw.trim().toLowerCase().replace(/_/g, "-").split("-")[0];
  if (base === undefined || base === "") return null;
  return isSupportedLanguage(base) ? base : null;
}

export type LanguageRejection = "empty" | "unsupported";

export function parseLanguage(
  raw: string | null | undefined,
): Result<SupportedLanguage, { reason: LanguageRejection }> {
  if (raw === null || raw === undefined || raw.trim() === "") return err({ reason: "empty" });
  const normalized = normalizeLanguageTag(raw);
  if (normalized === null) return err({ reason: "unsupported" });
  return ok(normalized);
}

/** زوج لغتين باتجاه: من لغة الكاتب إلى لغة القارئ. */
export interface LanguagePair {
  readonly from: SupportedLanguage;
  readonly to: SupportedLanguage;
}

export function sameLanguage(pair: LanguagePair): boolean {
  return pair.from === pair.to;
}

/** اسم اللغة بلغتها هي — القائمة تُعرض للمستخدم قبل أن نعرف لغته. */
export const LANGUAGE_LABELS: Readonly<Record<SupportedLanguage, string>> = {
  ar: "🇸🇦 العربية",
  en: "🇬🇧 English",
  ur: "🇵🇰 اردو",
};
