/**
 * الغرض: نواةُ قواميسِ التطبيقِ المصغَّرِ — الأنواعُ واللغاتُ والاتّجاهُ والترجمةُ على **سجلٍّ**
 *   لا يحملُ ثابتاً إلّا القاموسَ الافتراضيَّ (`ar`). والقاموسانِ الآخرانِ يُسجَّلانِ حينَ يُحتاجُ
 *   إليهما: `index.ts` يُسجِّلُهما متزامناً (للخادمِ والحواجزِ والاختبارات)، و`load.ts` يُحمِّلُهما
 *   عندَ الطلبِ في التطبيقِ المصغَّرِ.
 * الحالة: منفّذ فعلياً — `F1-09` · `D-29` · `ADR 0186` (زيادةٌ على `F2-01` لا محوٌ له).
 * ينتمي إلى: shared/i18n/miniapp
 *
 * ## لماذا سجلٌّ لا ثلاثةُ استيراداتٍ ثابتةٍ
 *
 * كانَت القواميسُ الثلاثةُ تُستورَدُ ثابتةً فتدخلُ حزمةَ `shell` كلُّها (≈ 52.7 KB مضغوطةً للغتَينِ
 * لا تُعرَضانِ) على المسارِ الحرجِ لكلِّ مستخدمٍ — مَقيسٌ في `D-29`. والتطبيقُ لا يعرضُ إلّا لغةَ
 * الحسابِ (`ADR 0178`)، فالبقيّةُ تُنزَّلُ حينَ تُطلَبُ. وحاجزُ البناءِ
 * `apps/miniapp/vite/assert-initial-dictionaries.ts` يُسقِطُ البناءَ إن عادَ قاموسٌ غيرُ افتراضيٍّ
 * إلى الحِملِ الأوّلِ.
 *
 * وما لا يفعلُه: لا يُحمِّلُ شيئاً من الشبكةِ (ذاك `load.ts`)، ولا يخترعُ نصّاً: لغةٌ لم تُسجَّلْ
 * بعدُ تُترجَمُ بالافتراضيِّ ثمَّ بالمفتاحِ — السلوكُ نفسُه لمفتاحٍ ناقصٍ قبلَ هذا التغييرِ.
 */

import ar from "./ar.json" with { type: "json" };

export type MiniAppDictionary = Record<string, string>;

/** اللغاتُ الثلاثُ المُعلَنةُ في القسم 9.11 — لا رابعةَ تُخترَعُ ههنا. */
export const MINIAPP_LANGUAGES = ["ar", "en", "ur"] as const;
export type MiniAppLanguage = (typeof MINIAPP_LANGUAGES)[number];

export const MINIAPP_DEFAULT_LANGUAGE: MiniAppLanguage = "ar";

/** اللغاتُ التي تُكتَبُ من اليمينِ — الأردية منها (9.11)، فلا تُقاسُ باللاتينيّةِ. */
const RIGHT_TO_LEFT: readonly MiniAppLanguage[] = ["ar", "ur"];

const DEFAULT_DICTIONARY = ar as MiniAppDictionary;

/** السجلُّ: الافتراضيُّ حاضرٌ دائماً، والبقيّةُ تُسجَّلُ حينَ تُحمَّلُ. */
const DICTIONARIES: Partial<Record<MiniAppLanguage, MiniAppDictionary>> = {
  ar: DEFAULT_DICTIONARY,
};

/** يُسجِّلُ قاموسَ لغةٍ. يُناديه `index.ts` متزامناً و`load.ts` بعدَ التحميلِ. */
export function registerMiniAppDictionary(
  language: MiniAppLanguage,
  dictionary: MiniAppDictionary,
): void {
  DICTIONARIES[language] = dictionary;
}

/** هل قاموسُ اللغةِ مُسجَّلٌ الآنَ؟ الموجّهُ لا يعرضُ لغةً قبلَ أن يصدقَ هذا. */
export function isMiniAppDictionaryLoaded(language: MiniAppLanguage): boolean {
  return DICTIONARIES[language] !== undefined;
}

export function isMiniAppLanguage(value: string): value is MiniAppLanguage {
  return (MINIAPP_LANGUAGES as readonly string[]).includes(value);
}

export function directionFor(language: MiniAppLanguage): "rtl" | "ltr" {
  return RIGHT_TO_LEFT.includes(language) ? "rtl" : "ltr";
}

export function miniAppDictionary(language: MiniAppLanguage): MiniAppDictionary {
  return DICTIONARIES[language] ?? DEFAULT_DICTIONARY;
}

/**
 * الترجمةُ: مفتاحٌ مفقودٌ يرتدُّ إلى العربيّةِ، ومفقودٌ فيها أيضاً **يُعيدُ المفتاحَ
 * نفسَه** لا نصّاً فارغاً. والفراغُ في الواجهةِ يُقرأُ عطلاً (UX-5)، أمّا مفتاحٌ
 * ظاهرٌ فيُقرأُ خطأَ ترجمةٍ ويُصلَحُ — وكِلا الحالتَينِ يردُّهما الحاجزُ قبلَ الدمجِ.
 */
export function translateMiniApp(language: MiniAppLanguage, key: string): string {
  return DICTIONARIES[language]?.[key] ?? DEFAULT_DICTIONARY[key] ?? key;
}

export function miniAppTranslator(language: MiniAppLanguage): (key: string) => string {
  return (key: string) => translateMiniApp(language, key);
}
