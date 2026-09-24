/**
 * الغرض: تحميلُ قاموسِ لغةٍ غيرِ افتراضيّةٍ **عندَ الطلبِ** في التطبيقِ المصغَّرِ وتسجيلُه في النواةِ.
 * الحالة: منفّذ فعلياً — `F1-09` · `D-29` · `ADR 0186`.
 * ينتمي إلى: shared/i18n/miniapp
 *
 * كلُّ لغةٍ حزمةٌ مؤجَّلةٌ مستقلّةٌ (`import()`)، فلا يدفعُ مستخدمُ العربيّةِ ثمنَ الإنجليزيّةِ
 * والأرديّة. والتحميلُ مرّةً لكلِّ لغةٍ؛ والفشلُ يُرفَعُ للمُنادي (الموجّهُ يعرضُ شاشةَ
 * تعذّرِ السطحِ بإعادةِ محاولةٍ) ولا يُبتلَعُ.
 */

import {
  isMiniAppDictionaryLoaded,
  type MiniAppDictionary,
  type MiniAppLanguage,
  registerMiniAppDictionary,
} from "./core.ts";

type DictionaryModule = { readonly default: unknown };

const LOADERS: Readonly<Record<Exclude<MiniAppLanguage, "ar">, () => Promise<DictionaryModule>>> = {
  en: () => import("./en.json"),
  ur: () => import("./ur.json"),
};

const inFlight = new Map<MiniAppLanguage, Promise<void>>();

/** يضمنُ أنَّ قاموسَ اللغةِ مُسجَّلٌ. الافتراضيُّ حاضرٌ فيعودُ فوراً. */
export function loadMiniAppLanguage(language: MiniAppLanguage): Promise<void> {
  if (language === "ar" || isMiniAppDictionaryLoaded(language)) return Promise.resolve();
  const pending = inFlight.get(language);
  if (pending !== undefined) return pending;
  const loading = LOADERS[language]()
    .then((module) => {
      registerMiniAppDictionary(language, module.default as MiniAppDictionary);
    })
    .finally(() => {
      inFlight.delete(language);
    });
  inFlight.set(language, loading);
  return loading;
}
