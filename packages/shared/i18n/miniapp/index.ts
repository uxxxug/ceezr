/**
 * الغرض: قواميسُ **التطبيقِ المصغَّرِ** وحدَها — نصُّ الشاشةِ باللغاتِ الثلاثِ
 *   (القسم 9.11)، منفصلةٌ عن قواميسِ البوتاتِ لا مكرَّرةٌ عنها.
 * الحالة: منفّذ فعلياً — البند `F2-01`.
 * ينتمي إلى: shared/i18n/miniapp
 * يُتوقع أن يستخدمه لاحقاً: كلُّ شاشةِ `F2` و`F3`، والحاجزُ
 *   `scripts/check-consent-documents.ts`.
 * ملاحظات مستقبلية: حينَ تُنقَلُ نصوصُ شاشاتِ `F1` الستَّةَ والأربعينَ إلى ههنا
 *   (وهي دَينٌ مُعلَنٌ في `ROADMAP.md`) يصيرُ بالإمكانِ إنزالُ حاجزِ «لا نصَّ داخلَ
 *   مكوّنٍ» على `apps/miniapp` كلِّه؛ ولا يُنزَلُ قبلَ ذاكَ بإعفاءاتٍ.
 *
 * ## لماذا ملفّاتٌ منفصلةٌ لا مفاتيحُ في قواميسِ البوتاتِ
 *
 * قواميسُ البوتاتِ فيها 376 مفتاحاً ولا يحتاجُ التطبيقُ منها شيئاً. وضمُّها إلى
 * حزمةِ العميلِ يُحمِّلُ الشبكةَ الضعيفةَ (UX-4) نصّاً لا يُقرأُ، ويُقاسُ ذلكَ في
 * ميزانيةِ الأداءِ (9.9). والفصلُ **ليس** مصدراً ثانياً للحقيقةِ (القاعدة 0.6):
 * كلُّ مفتاحٍ موجودٌ في ملفٍّ واحدٍ فقط، ولا مفتاحَ مشتركاً بينَ القاموسَينِ —
 * وذاكَ ما يفرضُه الحاجزُ حرفاً لا ما نأملُه.
 *
 * وما لا يفعلُه هذا الملفُّ: لا يقرأُ لغةَ الجهازِ ولا `ThemeParams` ولا يحفظُ
 * اختياراً — اللغةُ تُمرَّرُ وسيطاً، وحفظُها في الحسابِ بندُ `F2-11`.
 */

import ar from "./ar.json" with { type: "json" };
import en from "./en.json" with { type: "json" };
import ur from "./ur.json" with { type: "json" };

export type MiniAppDictionary = Record<string, string>;

/** اللغاتُ الثلاثُ المُعلَنةُ في القسم 9.11 — لا رابعةَ تُخترَعُ ههنا. */
export const MINIAPP_LANGUAGES = ["ar", "en", "ur"] as const;
export type MiniAppLanguage = (typeof MINIAPP_LANGUAGES)[number];

export const MINIAPP_DEFAULT_LANGUAGE: MiniAppLanguage = "ar";

/** اللغاتُ التي تُكتَبُ من اليمينِ — الأردية منها (9.11)، فلا تُقاسُ باللاتينيّةِ. */
const RIGHT_TO_LEFT: readonly MiniAppLanguage[] = ["ar", "ur"];

const DICTIONARIES: Readonly<Record<MiniAppLanguage, MiniAppDictionary>> = {
  ar: ar as MiniAppDictionary,
  en: en as MiniAppDictionary,
  ur: ur as MiniAppDictionary,
};

export function isMiniAppLanguage(value: string): value is MiniAppLanguage {
  return (MINIAPP_LANGUAGES as readonly string[]).includes(value);
}

export function directionFor(language: MiniAppLanguage): "rtl" | "ltr" {
  return RIGHT_TO_LEFT.includes(language) ? "rtl" : "ltr";
}

export function miniAppDictionary(language: MiniAppLanguage): MiniAppDictionary {
  return DICTIONARIES[language];
}

/**
 * الترجمةُ: مفتاحٌ مفقودٌ يرتدُّ إلى العربيّةِ، ومفقودٌ فيها أيضاً **يُعيدُ المفتاحَ
 * نفسَه** لا نصّاً فارغاً. والفراغُ في الواجهةِ يُقرأُ عطلاً (UX-5)، أمّا مفتاحٌ
 * ظاهرٌ فيُقرأُ خطأَ ترجمةٍ ويُصلَحُ — وكِلا الحالتَينِ يردُّهما الحاجزُ قبلَ الدمجِ.
 */
export function translateMiniApp(language: MiniAppLanguage, key: string): string {
  const fallback = DICTIONARIES[MINIAPP_DEFAULT_LANGUAGE];
  return DICTIONARIES[language][key] ?? fallback[key] ?? key;
}

export function miniAppTranslator(language: MiniAppLanguage): (key: string) => string {
  return (key: string) => translateMiniApp(language, key);
}
