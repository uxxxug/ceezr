/**
 * الغرض: نصُّ كلِّ شاشةِ حالةٍ في موضعٍ واحدٍ — العنوانُ والشرحُ وزرُّ الفعلِ —
 *   تنفيذاً لـ`UX-5` (لكلِّ شاشةٍ حالةُ خطأٍ **لها زرُّ فعل**) و`UX-8` (الصدقُ في
 *   الحالة) وحالاتِ القسم 9.7.
 * الحالة: منفّذ فعلياً — البند `F1-07`.
 * ينتمي إلى: apps/miniapp/src/system (حزمة `shell` — القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: `system/SystemScreen.tsx` وكلُّ شاشةٍ تعرض حالةَ نظامٍ.
 * ملاحظات مستقبلية: النصوصُ في القاموس (`sys.*` · `TRUTH-01`) — هذا الملفُّ يختارُ
 *   المفتاحَ ولا يحملُ نصّاً.
 *
 * لماذا خارطةُ نصوصٍ نقيّةٌ لا نصٌّ في `JSX`؟ لأنّ «لكلِّ حالةٍ زرُّ فعلٍ» شرطُ
 * عقدٍ يُختبَر: اختبارٌ واحدٌ يمرّ على الحالاتِ كلِّها ويسقط إن خلت واحدةٌ من
 * فعلٍ أو من شرح. والنصُّ الموزَّعُ في `JSX` لا يُحصى إلا بالعين.
 */

import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../packages/shared/i18n/miniapp/core.ts";
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
  | { readonly kind: "missing_init_data" }
  /**
   * `UI-SESS-01`: بيانُ الفتحِ نفسُه رُفِضَ (انتهت مهلتُه أو استُعمِلَ قبلُ) ولا رمزَ
   * محفوظاً — حالُ إعادةِ تحميلِ الصفحةِ داخلَ تيليجرام. «أعد المحاولة» هنا تَعِدُ
   * بما لا يقعُ: البيانُ ذاتُه سيُرفَضُ ثانيةً، والعلاجُ فتحٌ جديدٌ من البوت.
   */
  | { readonly kind: "launch_stale" };

export type ScreenState = SystemState | AuxiliaryScreen;

/**
 * `TRUTH-01`: النصُّ مفاتيحُ قاموسٍ (`sys.*`) في اللغاتِ الثلاث — كانَ عربيّاً حرفيّاً
 * فيراهُ مستخدمُ English/اردو بالعربيّة (الأمرُ التصميميّ §1.4 #2). العنوانُ والشرحُ
 * `sys.<kind>.title`/`.body` دائماً؛ وما يختلفُ بينَ الحالاتِ (الفعلُ والتلميح) معلَنٌ ههنا.
 */
interface AuxiliaryKeys {
  readonly action: string | null;
  readonly hint: string | null;
}

const AUXILIARY_KEYS: Readonly<Record<AuxiliaryScreen["kind"], AuxiliaryKeys>> = {
  unsupported_city: { action: null, hint: "sys.unsupported_city.hint" },
  unknown_error: { action: "sys.action.retry", hint: null },
  surface_failed: { action: "sys.action.retry", hint: null },
  unregistered: { action: null, hint: "sys.unregistered.hint" },
  blocked: { action: null, hint: null },
  no_surface_yet: { action: null, hint: null },
  outside_telegram: { action: "sys.outside_telegram.action", hint: null },
  launch_stale: { action: "sys.launch_stale.action", hint: null },
  missing_init_data: { action: "sys.action.retry", hint: null },
};

type Translate = (key: string) => string;

function translatorFor(language: MiniAppLanguage): Translate {
  return miniAppTranslator(language);
}

/**
 * تقديرٌ زمنيٌّ **إن أرسله الخادمُ وحدَه** (`Retry-After`). ولا يُخترَع عندَ
 * غيابِه: تقديرٌ مخترَعٌ يُقرأ وعداً، والوعدُ المخلَفُ أسوأُ من لا وعد.
 */
export function retryAfterHint(
  seconds: number | null,
  language: MiniAppLanguage = MINIAPP_DEFAULT_LANGUAGE,
): string | null {
  if (seconds === null) return null;
  const t = translatorFor(language);
  if (seconds < SECONDS_IN_MINUTE)
    return t("sys.retry_after.seconds").replace("{seconds}", String(seconds));
  const minutes = Math.ceil(seconds / SECONDS_IN_MINUTE);
  return t("sys.retry_after.minutes").replace("{minutes}", String(minutes));
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

export function screenText(
  state: ScreenState,
  language: MiniAppLanguage = MINIAPP_DEFAULT_LANGUAGE,
): SystemScreenText {
  const t = translatorFor(language);
  if (state.kind === "no_connection") {
    return {
      title: t("sys.no_connection.title"),
      body: t(`sys.no_connection.body.${state.cause}`),
      actionLabel: t("sys.action.retry"),
      hint: t("sys.no_connection.hint"),
    };
  }

  if (state.kind === "service_unavailable") {
    return {
      title: t("sys.service_unavailable.title"),
      body: t("sys.service_unavailable.body"),
      actionLabel: t("sys.action.retry"),
      hint: retryAfterHint(state.retryAfterSeconds, language),
    };
  }

  if (state.kind === "session_expired" || state.kind === "session_invalid") {
    return {
      title: t(`sys.${state.kind}.title`),
      body: t(`sys.${state.kind}.body`),
      actionLabel: t("sys.action.reauthenticate"),
      hint: null,
    };
  }

  const keys = AUXILIARY_KEYS[state.kind];
  return {
    title: t(`sys.${state.kind}.title`),
    body: t(`sys.${state.kind}.body`),
    actionLabel: keys.action === null ? null : t(keys.action),
    hint: keys.hint === null ? null : t(keys.hint),
  };
}

/** نصُّ الزرِّ أثناءَ تنفيذِ الفعل — من القاموسِ لا حرفاً. */
export function busyActionLabel(language: MiniAppLanguage = MINIAPP_DEFAULT_LANGUAGE): string {
  return translatorFor(language)("sys.action.busy");
}
