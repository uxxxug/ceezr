/**
 * الغرض: نصُّ كلِّ شاشةِ حالةٍ في موضعٍ واحدٍ — العنوانُ والشرحُ وزرُّ الفعلِ —
 *   تنفيذاً لـ`UX-5` (لكلِّ شاشةٍ حالةُ خطأٍ **لها زرُّ فعل**) و`UX-8` (الصدقُ في
 *   الحالة) وحالاتِ القسم 9.7.
 * الحالة: منفّذ فعلياً — البند `F1-07`.
 * ينتمي إلى: apps/miniapp/src/system (حزمة `shell` — القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: `system/SystemScreen.tsx` وكلُّ شاشةٍ تعرض حالةَ نظامٍ.
 * ملاحظات مستقبلية: هذه النصوصُ عربيةٌ حرفيةٌ في الشيفرةِ كسائرِ التطبيقِ المصغَّرِ
 *   اليوم: **وصلُه بقواميسِ `packages/shared/i18n` بندُ `F2-11`** ونقطةٌ مفتوحةٌ
 *   معلَنةٌ منذ `F1-05`، ولا يُفتَح ههنا. وموضعُ النصِّ الواحدُ هو ما يجعل الوصلَ
 *   لاحقاً تغييراً في ملفٍّ واحدٍ لا مطاردةً في الشاشات.
 *
 * لماذا خارطةُ نصوصٍ نقيّةٌ لا نصٌّ في `JSX`؟ لأنّ «لكلِّ حالةٍ زرُّ فعلٍ» شرطُ
 * عقدٍ يُختبَر: اختبارٌ واحدٌ يمرّ على الحالاتِ كلِّها ويسقط إن خلت واحدةٌ من
 * فعلٍ أو من شرح. والنصُّ الموزَّعُ في `JSX` لا يُحصى إلا بالعين.
 */

import type { SystemState } from "./failure.ts";

/** الأرقامُ تبقى غربيةً 0-9 (`UX-3`). */
const SECONDS_IN_MINUTE = 60;

export interface SystemScreenText {
  readonly title: string;
  /** ماذا حدث — بلا لومٍ للمستخدمِ وبلا زعمِ سببٍ غيرِ معروف. */
  readonly body: string;
  /**
   * ما يمكن فعلُه الآن. `null` = لا فعلَ بيدِ المستخدمِ **وهذا يُقال صريحاً في
   * `body`** ولا يُترَك فراغاً. والقسم 9.7 يوجب لـ`SS-01` «ما يمكن فعلُه بلا
   * شبكة»، فلا حالةَ انقطاعٍ بلا فعل.
   */
  readonly actionLabel: string | null;
  /** سطرٌ ثانويٌّ: تقديرٌ زمنيٌّ أو حدٌّ معلَن. لا يحمل معلومةً لازمة. */
  readonly hint: string | null;
}

/** حالاتٌ ليست فشلَ نداءٍ: قرارُ تفويضٍ، أو حدٌّ معلَنٌ، أو خطأٌ لا يُصنَّف. */
export type AuxiliaryScreen =
  /** `SS-04` — مدينةٌ غيرُ مدعومة. غيرُ موصولةٍ بقرارِ المالك: انظر `UnsupportedCityScreen`. */
  | { readonly kind: "unsupported_city" }
  /** خطأٌ خرج من حدِّ الخطأِ أو فشلٌ لا يُصنَّف — لا شاشةَ بيضاءَ أبداً (`UX-5`). */
  | { readonly kind: "unknown_error" }
  /** فشلُ تحميلِ حزمةِ سطحٍ — يُعلَن فشلاً ولا يُبدَّل بسطحٍ أدنى (`F1-05`). */
  | { readonly kind: "surface_failed" }
  /** لا حسابَ لهذا المستخدمِ في القاعدة. */
  | { readonly kind: "unregistered" }
  /** محجوبٌ بقرارِ الخادم. */
  | { readonly kind: "blocked" }
  /** دورٌ صحيحٌ لا سطحَ له في التطبيقِ بعد. */
  | { readonly kind: "no_surface_yet" }
  /** المضيفُ ليس تيليجرام، أو لا بيانَ إقلاعٍ فيه. */
  | { readonly kind: "outside_telegram" }
  | { readonly kind: "missing_init_data" };

export type ScreenState = SystemState | AuxiliaryScreen;

const NO_CONNECTION_BODY = {
  device_offline: "جهازك يعلن أنه بلا اتصال. تحقّق من البيانات أو الواي-فاي ثم أعد المحاولة.",
  service_unreachable:
    "شبكة جهازك تعمل، ولم يصل أيّ ردّ من خدمتنا. إمّا خدمتنا متوقّفة الآن أو الطريق إليها محجوب.",
  service_fault: "شبكتك تعمل وخدمتنا تستجيب، لكنّ هذا الطلب بالذات أخفق. أعد المحاولة.",
  undetermined: "تعذّر الوصول إلى خدمتنا، ولم نتحقّق بعد إن كان الانقطاع في شبكتك أم عندنا.",
} as const;

const AUXILIARY_TEXT: Readonly<Record<AuxiliaryScreen["kind"], SystemScreenText>> = {
  unsupported_city: {
    title: "مدينتك غير مدعومة بعد",
    body: "وَصْلة تعمل في مدن محدّدة، ومدينتك ليست منها اليوم. لا يمكنك طلب رحلة هنا الآن.",
    actionLabel: null,
    hint: "سنعلن المدن الجديدة عند افتتاحها.",
  },
  unknown_error: {
    title: "حدث خطأ غير متوقّع",
    body: "لم نتعرّف على سبب الخطأ، فلا نزعم تشخيصاً. أعد المحاولة، وإن تكرّر فتواصل مع الدعم.",
    actionLabel: "إعادة المحاولة",
    hint: null,
  },
  surface_failed: {
    title: "تعذّر تحميل الشاشة",
    body: "وصل ردّ الخادم وتعذّر تحميل ملفّات الشاشة. لم نفتح لك شاشة بديلة: البديل ليس ما طلبته.",
    actionLabel: "إعادة المحاولة",
    hint: null,
  },
  unregistered: {
    title: "لا حساب لك بعد",
    body: "سجّل من بوت وَصْلة ثم أعد فتح التطبيق. التسجيل لا يحدث من هذه الشاشة.",
    actionLabel: null,
    hint: "الحساب يُنشأ في البوت وحده اليوم.",
  },
  blocked: {
    title: "هذا الحساب محجوب",
    body: "قرار الحجب من الخادم، ولا يمكن تجاوزه من التطبيق. راجع الدعم لمعرفة السبب.",
    actionLabel: null,
    hint: null,
  },
  no_surface_yet: {
    title: "لا شاشة لدورك بعد",
    body: "دورك صحيح ولا توجد له شاشة في التطبيق المصغَّر حتى الآن.",
    actionLabel: null,
    hint: null,
  },
  outside_telegram: {
    title: "افتح وَصْلة من تيليجرام",
    body: "هذا التطبيق يعمل داخل تيليجرام اليوم. تشغيله في متصفّح بمصادقة بديلة لم يُنفَّذ بعد.",
    actionLabel: null,
    hint: null,
  },
  missing_init_data: {
    title: "تعذّر قراءة بيانات تيليجرام",
    body: "لم يسلّمنا تيليجرام بيان الفتح، فلا يمكن التحقّق من هويتك. أعد فتح التطبيق من البوت.",
    actionLabel: "إعادة المحاولة",
    hint: null,
  },
};

/**
 * تقديرٌ زمنيٌّ **إن أرسله الخادمُ وحدَه** (`Retry-After`). ولا يُخترَع عندَ
 * غيابِه: تقديرٌ مخترَعٌ يُقرأ وعداً، والوعدُ المخلَفُ أسوأُ من لا وعد.
 */
export function retryAfterHint(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < SECONDS_IN_MINUTE) return `جرّب بعد نحو ${seconds} ثانية.`;
  const minutes = Math.ceil(seconds / SECONDS_IN_MINUTE);
  return `جرّب بعد نحو ${minutes} دقيقة.`;
}

/**
 * إعلامٌ أم إخبار؟ `alert` يقطع قارئَ الشاشةِ فوراً، وتعميمُه على كلِّ حالةٍ
 * يجعل «مدينتُك غيرُ مدعومة» صرخةً وهي خبرٌ. فالفشلُ يُقاطع، والحدُّ المعلَنُ
 * يُخبَر (`UX-10`: قارئُ شاشةٍ يعمل).
 */
export function screenTone(state: ScreenState): "alert" | "status" {
  const informational: readonly ScreenState["kind"][] = [
    "unsupported_city",
    "unregistered",
    "blocked",
    "no_surface_yet",
    "outside_telegram",
  ];
  return informational.includes(state.kind) ? "status" : "alert";
}

export function screenText(state: ScreenState): SystemScreenText {
  if (state.kind === "no_connection") {
    return {
      title: "لا اتصال",
      body: NO_CONNECTION_BODY[state.cause],
      actionLabel: "إعادة المحاولة",
      hint: "بلا شبكة لا يمكن طلب رحلة ولا متابعة رحلة قائمة: كلّها تحتاج الخادم.",
    };
  }

  if (state.kind === "service_unavailable") {
    return {
      title: "خدمتنا متعطّلة الآن",
      body: "الخطأ عندنا لا عندك: وصل ردّك إلى خدمتنا وأعلنت أنها لا تستطيع الخدمة الآن. لا شيء ضاع من طرفك.",
      actionLabel: "إعادة المحاولة",
      hint: retryAfterHint(state.retryAfterSeconds),
    };
  }

  if (state.kind === "session_expired") {
    return {
      title: "انتهت جلستك",
      body: "الجلسات قصيرة العمر عن قصد. أعد المصادقة وتعود إلى موضعك نفسه بلا إعادة فتح التطبيق.",
      actionLabel: "إعادة المصادقة",
      hint: null,
    };
  }

  if (state.kind === "session_invalid") {
    return {
      title: "الجلسة غير صالحة",
      body: "لم تُقبل جلستك، وعلاجها تحقّق جديد من تيليجرام. أعد المصادقة، وإن لم تنجح فأعد فتح التطبيق من البوت.",
      actionLabel: "إعادة المصادقة",
      hint: null,
    };
  }

  return AUXILIARY_TEXT[state.kind];
}
