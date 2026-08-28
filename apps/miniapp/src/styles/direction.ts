/**
 * الغرض: اتجاهُ المستندِ ولغتُه (البند `F1-06` — الجزءُ المتعلّقُ بالاتجاه):
 *   دالّةٌ نقيّةٌ تترجم رمزَ اللغةِ إلى اتجاه، وتطبيقٌ واحدٌ على `<html>`.
 *   والمرجعُ الحاكم: UX-3 «التخطيط `dir="rtl"` افتراضاً … والإنجليزيةُ والأردية
 *   تُقلبان تلقائياً» · القسم 9.11 «الأردية RTL أيضاً؛ الإنجليزية LTR — الاختبارُ
 *   يشمل الثلاثةَ على نفسِ الشاشة».
 * الحالة: منفّذ فعلياً — البند `F1-06`.
 * ينتمي إلى: apps/miniapp/src/styles (حزمة `shell` — «الإطار، السمة» القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: `shell/Shell.tsx` عندَ الإقلاع، وشاشةُ اختيارِ اللغةِ
 *   في `SR-01`/`SR-12` عندَ بنائها (`F2-01` · `F2-11`) فتمرّر لغةَ المستخدم.
 * ملاحظات مستقبلية: القواميسُ نفسُها في `packages/shared/i18n` (القسم 9.11)،
 *   وربطُ التطبيقِ المصغَّرِ بها بندٌ آخرُ لأنه يجرّ ثلاثةَ قواميسَ إلى حزمةِ
 *   الإقلاعِ وله ميزانيةٌ في القسم 9.9. وههنا رموزُ اللغاتِ الثلاثةِ فقط بلا
 *   نصوص، وقيمةُ الافتراضِ مطابقةٌ لـ`DEFAULT_LANGUAGE` في تلك الحزمة.
 *
 * ما لا يفعله هذا الملفُّ عن قصد:
 *   ــ لا يستنتج لغةً من المضيفِ ولا من `initData` ولا من المتصفح: اللغةُ تُمرَّر
 *      صريحةً، والافتراضُ عربيّ. فاستنتاجُ اللغةِ قرارُ شاشةٍ لا قرارُ طبقة.
 *   ــ لا يخزّن اللغةَ: تخزينُها تفضيلٌ للمستخدمِ في شاشةِ الحساب، لا هنا.
 *   ــ لا يحمل نصّاً واحداً: النصوصُ مفاتيحُ في `i18n` (القسم 9.11).
 */

/** اللغاتُ الثلاثُ المنصوصُ عليها في القسم 9.11 — لا رابعةَ يخترعها الكود. */
export const APP_LANGUAGES = ["ar", "en", "ur"] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number];

/** العربيةُ افتراضاً (UX-3)، ومطابقٌ لـ`DEFAULT_LANGUAGE` في `packages/shared/i18n`. */
export const DEFAULT_APP_LANGUAGE: AppLanguage = "ar";

export type TextDirection = "rtl" | "ltr";

/** العربيةُ والأرديةُ من اليمينِ إلى اليسار، والإنجليزيةُ وحدَها من اليسار. */
const DIRECTIONS: Readonly<Record<AppLanguage, TextDirection>> = Object.freeze({
  ar: "rtl",
  en: "ltr",
  ur: "rtl",
});

/** لغةٌ غيرُ مدعومةٍ ليست خطأً يُرمى: تُقرأ افتراضاً عربية. */
export function resolveLanguage(value: unknown): AppLanguage {
  if (typeof value !== "string") return DEFAULT_APP_LANGUAGE;
  const code = value.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return (APP_LANGUAGES as readonly string[]).includes(code)
    ? (code as AppLanguage)
    : DEFAULT_APP_LANGUAGE;
}

export function directionOf(value: unknown): TextDirection {
  return DIRECTIONS[resolveLanguage(value)];
}

export type DocumentDirection = {
  readonly language: AppLanguage;
  readonly direction: TextDirection;
  /** هل كُتِبت القيمُ على `<html>` فعلاً؟ لا مستندَ = لا كتابةَ ولا رمي. */
  readonly written: boolean;
};

/**
 * يضبط `lang` و`dir` على `<html>` وحدَه. والاتجاهُ يُورَّث منه إلى الصفحةِ كلِّها،
 * فلا تُثبَّت جهةٌ في أيِّ قاعدةِ CSS أخرى — وإلا صار قلبُ الاتجاهِ استثناءً
 * يُطارَد في كلِّ ملف.
 */
export function applyDocumentDirection(value: unknown = DEFAULT_APP_LANGUAGE): DocumentDirection {
  const language = resolveLanguage(value);
  const direction = DIRECTIONS[language];
  if (typeof document === "undefined") return { language, direction, written: false };
  const root: unknown = document.documentElement;
  if (typeof root !== "object" || root === null) return { language, direction, written: false };
  const element = root as { lang?: string; dir?: string };
  element.lang = language;
  element.dir = direction;
  return { language, direction, written: true };
}
