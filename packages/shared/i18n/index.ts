/**
 * الغرض: محمّل قواميس الرسائل الثابتة — لا نص مكتوب مباشرة داخل كود البوتات (القسم 3.8).
 * الحالة: أساس تقني منفّذ فعلياً (تحميل وتعويض متغيّرات فقط) — خدمة الترجمة الآلية تبقى هيكلاً.
 * ينتمي إلى: shared/i18n
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/*، packages/application/i18n-translation
 * ملاحظات مستقبلية: قائمة اللغات المدعومة تُقرأ لاحقاً من platform_settings لا من الكود.
 */

import ar from "./ar.json" with { type: "json" };
import en from "./en.json" with { type: "json" };
import ur from "./ur.json" with { type: "json" };

export type Dictionary = Record<string, string>;

const dictionaries: Record<string, Dictionary> = {
  ar: ar as Dictionary,
  en: en as Dictionary,
  ur: ur as Dictionary,
};

export const DEFAULT_LANGUAGE = "ar";

export function hasLanguage(lang: string): boolean {
  return Object.prototype.hasOwnProperty.call(dictionaries, lang);
}

export function translate(
  lang: string,
  key: string,
  params: Record<string, string | number> = {},
): string {
  const dict = dictionaries[lang] ?? dictionaries[DEFAULT_LANGUAGE]!;
  const template = dict[key] ?? dictionaries[DEFAULT_LANGUAGE]![key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

export function t(lang: string) {
  return (key: string, params?: Record<string, string | number>) =>
    translate(lang, key, params ?? {});
}
