/**
 * الغرض: طبقةُ السمة (البند `F1-06`) — ربطُ `ThemeParams` بمتغيّراتِ CSS، وتلوينُ
 *   رأسِ التطبيقِ وخلفيتِه وشريطِه السفليِّ عبرَ `setHeaderColor` و
 *   `setBackgroundColor` و`setBottomBarColor`، وربطُ `safeAreaInset` و
 *   `contentSafeAreaInset` بمتغيّراتِ الحواشي، وإعادةُ التطبيقِ عندَ تغيّرِ سمةِ
 *   المستخدمِ أو حواشيه. والمرجعُ الحاكم: القسم 9.2 «التنسيق | CSS variables
 *   مربوطة بـ`ThemeParams` مباشرة | لا سمة مزدوجة» · UX-6 «السمة من تيليجرام لا
 *   منّا» · القسم 4.4 وتصحيحُه `ت-6` في أدنى الإصدارات · ADR 0031 §3 و§4.
 * الحالة: منفّذ فعلياً — البند `F1-06`.
 * ينتمي إلى: apps/miniapp/src/tg (طبقةُ التغليفِ الوحيدةُ — ADR 0031 §3)
 * يُتوقع أن يستخدمه لاحقاً: `shell/Shell.tsx` عندَ الإقلاع، وكلُّ شاشةٍ في
 *   `F1-07` وما بعدَها **عبرَ متغيّراتِ CSS لا عبرَ استدعاءٍ من عندِها**.
 * ملاحظات مستقبلية: فحصُ التباينِ آلياً (تمامُ UX-6) وميزانيةُ الأداءِ (`F1-09`)
 *   وألوانُ الهويةِ للتمييزِ تحتاج شاشاتٍ تستهلكُها، فلا تُدَّعى ههنا.
 *
 * ما لا يفعله هذا الملفُّ عن قصد:
 *   ــ لا منطقَ عملٍ ولا قرارَ شاشة: يكتب متغيّراتٍ ويُبلِّغ بما جرى، لا أكثر.
 *   ــ لا يقرأ `initData` ولا يمسّ الجلسةَ ولا الدور: السمةُ ليست مصدرَ هويةٍ ولا
 *      صلاحية، ولا تُحوَّل قيمةٌ منها إلى حالةِ عملٍ إطلاقاً (ADR 0035 §2).
 *   ــ لا يستدعي `ready()` ولا `expand()`: دورةُ حياةِ التطبيقِ في `app.ts`،
 *      وخلطُها بالسمةِ يجعل تغيُّرَ لونٍ حدثاً في دورةِ الحياة.
 *   ــ لا يخزّن شيئاً: لا `CloudStorage` ولا `localStorage`. السمةُ مشتقّةٌ من
 *      المضيفِ في كلِّ إقلاعٍ، فلا نسخةَ ثانيةً تتباعد عن مصدرِها.
 *   ــ لا يخترع لوناً عندَ غيابِ مفتاح: الغائبُ يبقى على افتراضِ
 *      `styles/global.css`، فالافتراضُ مُعلَنٌ في مكانٍ واحد.
 *
 * لماذا متغيّراتُنا لا متغيّراتُ تيليجرامَ الجاهزة؟ يعرض المضيفُ متغيّراتٍ خاصةً
 * به (`--tg-theme-*` و`--tg-safe-area-inset-*`) في العملاءِ الذين يدعمونها
 * ([التوثيق الرسمي](https://core.telegram.org/bots/webapps))، لكنها معدومةٌ خارجَ
 * تيليجرامَ وعلى العملاءِ الأقدم — والاعتمادُ على المجموعتين معاً هو «السمةُ
 * المزدوجةُ» التي يمنعها القسم 9.2. فمجموعةٌ واحدةٌ يملؤها هذا الملفُّ ولها
 * افتراضٌ واحدٌ في CSS.
 */

import { isVersionAtLeast, resolveCapability } from "./capabilities.ts";
import { onTelegramEvent, type TgUnsubscribe } from "./events.ts";
import { type TgOutcome, tgOk, tgUnavailable } from "./outcome.ts";
import { getContentSafeAreaInsets, getSafeAreaInsets, type TgInsets } from "./viewport.ts";
import { getWebApp, type ThemeParams } from "./webapp.ts";

/**
 * خريطةُ مفاتيحِ `ThemeParams` إلى متغيّراتِ CSS. خاصّةٌ بالملفِّ عن قصد: أسماءُ
 * تيليجرامَ بصيغةِ `snake_case` لا تخرج من `tg/` ولو كبياناتٍ (القسم 9.2).
 * المفاتيحُ كلُّها موثَّقةٌ في [توثيق Mini Apps](https://core.telegram.org/bots/webapps).
 */
const THEME_MAP: readonly (readonly [keyof ThemeParams, string])[] = [
  ["bg_color", "--tg-bg-color"],
  ["text_color", "--tg-text-color"],
  ["hint_color", "--tg-hint-color"],
  ["link_color", "--tg-link-color"],
  ["button_color", "--tg-button-color"],
  ["button_text_color", "--tg-button-text-color"],
  ["secondary_bg_color", "--tg-secondary-bg-color"],
  ["header_bg_color", "--tg-header-bg-color"],
  ["bottom_bar_bg_color", "--tg-bottom-bar-bg-color"],
  ["accent_text_color", "--tg-accent-text-color"],
  ["section_bg_color", "--tg-section-bg-color"],
  ["section_header_text_color", "--tg-section-header-text-color"],
  ["section_separator_color", "--tg-section-separator-color"],
  ["subtitle_text_color", "--tg-subtitle-text-color"],
  ["destructive_text_color", "--tg-destructive-text-color"],
];

/** متغيّرُ نمطِ الألوانِ: يقود `color-scheme` في `global.css`. */
export const TG_COLOR_SCHEME_VARIABLE = "--tg-color-scheme";

/** أسماءُ متغيّراتِ السمةِ التي تكتبها هذه الطبقة — لكلٍّ منها افتراضٌ في CSS. */
export const TG_THEME_CSS_VARIABLES: readonly string[] = Object.freeze(
  THEME_MAP.map(([, cssVariable]) => cssVariable),
);

const SAFE_AREA_PREFIX = "--tg-safe-area-";
const CONTENT_SAFE_AREA_PREFIX = "--tg-content-safe-area-";
const INSET_SIDES = ["top", "bottom", "left", "right"] as const;

/** أسماءُ متغيّراتِ الحواشي التي تكتبها هذه الطبقة. */
export const TG_SAFE_AREA_CSS_VARIABLES: readonly string[] = Object.freeze([
  ...INSET_SIDES.map((side) => `${SAFE_AREA_PREFIX}${side}`),
  ...INSET_SIDES.map((side) => `${CONTENT_SAFE_AREA_PREFIX}${side}`),
]);

export type TgColorScheme = "light" | "dark";

export type TgThemeReport = {
  /** هل كان ثمّةَ مضيفُ تيليجرامَ أصلاً؟ خارجَه لا تُكتَب سمةٌ ولا يُنادى شيء. */
  readonly insideHost: boolean;
  readonly colorScheme: TgColorScheme;
  /** متغيّراتٌ كُتِبت فعلاً. */
  readonly applied: readonly string[];
  /** متغيّراتٌ وردت لها قيمةٌ غيرُ مقبولةٍ فتُركت على افتراضِها. */
  readonly rejected: readonly string[];
  readonly header: TgOutcome<true>;
  readonly background: TgOutcome<true>;
  readonly bottomBar: TgOutcome<true>;
};

export type TgSafeAreaReport = {
  readonly applied: readonly string[];
  readonly safeArea: TgOutcome<TgInsets>;
  readonly contentSafeArea: TgOutcome<TgInsets>;
};

/** ما يُقبل في متغيّرِ CSS: لونٌ ست عشريٌّ فقط — صيغةُ تيليجرامَ الموثَّقة. */
const CSS_HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/** ما يُرسَل إلى المضيف: `#RRGGBB` وحدَه كما ينصّ التوثيق. */
const HOST_HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * لماذا تُصفّى القيمُ؟ المضيفُ مدخلٌ لا يُوثَق به، وقيمةٌ مثل `red;}` مكتوبةٌ في
 * خاصيةِ نمطٍ تفتح بابَ حقنٍ في CSS. والتصفيةُ ههنا نظافةٌ لا منطقُ عمل.
 */
function cssColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return CSS_HEX_COLOR.test(trimmed) ? trimmed : null;
}

function hostColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return HOST_HEX_COLOR.test(trimmed) ? trimmed : null;
}

/**
 * جذرُ المستندِ إن وُجد. خارجَ المتصفحِ (اختبارٌ أو تصييرٌ بلا DOM) لا مستندَ ولا
 * رمي: تُقرأ السمةُ ويُبلَّغ عنها ولا تُكتَب.
 */
function rootStyle(): Pick<CSSStyleDeclaration, "setProperty"> | null {
  if (typeof document === "undefined") return null;
  const root: unknown = document.documentElement;
  if (typeof root !== "object" || root === null) return null;
  const style = (root as { style?: unknown }).style;
  if (typeof style !== "object" || style === null) return null;
  const setProperty = (style as { setProperty?: unknown }).setProperty;
  return typeof setProperty === "function"
    ? (style as Pick<CSSStyleDeclaration, "setProperty">)
    : null;
}

function readThemeParams(): ThemeParams {
  const host = getWebApp();
  const params: unknown = host?.themeParams;
  return typeof params === "object" && params !== null ? (params as ThemeParams) : {};
}

/**
 * `setHeaderColor` — أدنى إصدارٍ 6.1 (`ت-6`: لا 7.0). وحتى الإصدارِ 6.9 لا يقبل
 * المضيفُ إلا كلمتَي `bg_color`/`secondary_bg_color` أو قيمةً مأخوذةً من
 * `themeParams` ذاتِها، فنرسل الكلمةَ في العملاءِ الأقدمِ ولا نراهن على قيمةٍ
 * قد يرفضُها ([التوثيق الرسمي](https://core.telegram.org/bots/webapps)).
 */
function sendHeaderColor(params: ThemeParams): TgOutcome<true> {
  const gate = resolveCapability("headerColor");
  if (gate.host === null) return tgUnavailable<true>(gate.reason);
  const set = gate.host.setHeaderColor;
  if (!set) return tgUnavailable<true>("missing-api");
  const wanted = hostColor(params.header_bg_color) ?? hostColor(params.bg_color);
  const value = wanted !== null && isVersionAtLeast("6.9") ? wanted : "bg_color";
  try {
    set.call(gate.host, value);
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}

/** `setBackgroundColor` — أدنى إصدارٍ 6.1، ويقبل الكلمةَ أو `#RRGGBB`. */
function sendBackgroundColor(params: ThemeParams): TgOutcome<true> {
  const gate = resolveCapability("backgroundColor");
  if (gate.host === null) return tgUnavailable<true>(gate.reason);
  const set = gate.host.setBackgroundColor;
  if (!set) return tgUnavailable<true>("missing-api");
  const value = hostColor(params.bg_color) ?? "bg_color";
  try {
    set.call(gate.host, value);
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}

/**
 * `setBottomBarColor` — أدنى إصدارٍ **7.10** لا 7.0، وهو نصُّ تصحيحِ `ت-6`
 * في القسم 4.4. وبوابةُ القدرةِ `bottomBarColor` تحمل هذا الرقمَ فعلاً.
 */
function sendBottomBarColor(params: ThemeParams): TgOutcome<true> {
  const gate = resolveCapability("bottomBarColor");
  if (gate.host === null) return tgUnavailable<true>(gate.reason);
  const set = gate.host.setBottomBarColor;
  if (!set) return tgUnavailable<true>("missing-api");
  const value = hostColor(params.bottom_bar_bg_color) ?? "bottom_bar_bg_color";
  try {
    set.call(gate.host, value);
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}

/**
 * يطبّق سمةَ المستخدمِ مرةً واحدة: متغيّراتُ CSS ثم ألوانُ إطارِ المضيف.
 * لا يرمي في أيِّ حالة: غيابُ المضيفِ وغيابُ المستندِ وقيمةٌ فاسدةٌ كلُّها
 * حالاتٌ متوقَّعةٌ تُوصَف في التقريرِ العائد.
 */
export function applyTelegramTheme(): TgThemeReport {
  const host = getWebApp();
  const style = rootStyle();
  const applied: string[] = [];
  const rejected: string[] = [];

  if (!host) {
    return {
      insideHost: false,
      colorScheme: "light",
      applied,
      rejected,
      header: tgUnavailable<true>("no-telegram"),
      background: tgUnavailable<true>("no-telegram"),
      bottomBar: tgUnavailable<true>("no-telegram"),
    };
  }

  const params = readThemeParams();
  for (const [key, cssVariable] of THEME_MAP) {
    const raw = params[key];
    /** مفتاحٌ غائبٌ يبقى على افتراضِ `global.css` — لا لونَ يُخترَع. */
    if (raw === undefined || raw === null) continue;
    const color = cssColor(raw);
    if (color === null) {
      rejected.push(cssVariable);
      continue;
    }
    if (style === null) continue;
    style.setProperty(cssVariable, color);
    applied.push(cssVariable);
  }

  const colorScheme: TgColorScheme = host.colorScheme === "dark" ? "dark" : "light";
  if (style !== null) {
    style.setProperty(TG_COLOR_SCHEME_VARIABLE, colorScheme);
    applied.push(TG_COLOR_SCHEME_VARIABLE);
  }

  return {
    insideHost: true,
    colorScheme,
    applied,
    rejected,
    header: sendHeaderColor(params),
    background: sendBackgroundColor(params),
    bottomBar: sendBottomBarColor(params),
  };
}

function writeInsets(
  style: Pick<CSSStyleDeclaration, "setProperty"> | null,
  prefix: string,
  insets: TgInsets,
  applied: string[],
): void {
  if (style === null) return;
  for (const side of INSET_SIDES) {
    /** حاشيةٌ سالبةٌ أو كسريةٌ لا معنى لها في تخطيط: تُقصَر ثم تُدوَّر. */
    const px = Math.max(0, Math.round(insets[side]));
    const name = `${prefix}${side}`;
    style.setProperty(name, `${px}px`);
    applied.push(name);
  }
}

/**
 * يربط `safeAreaInset` و`contentSafeAreaInset` بمتغيّراتِ الحواشي (أدنى إصدارٍ
 * 8.0 — القسم 4.4). وعلى عميلٍ أقدمَ أو خارجَ تيليجرامَ لا يُكتَب شيءٌ فيبقى
 * `env(safe-area-inset-*)` هو المصدرَ كما في `global.css`.
 */
export function applyTelegramSafeArea(): TgSafeAreaReport {
  const style = rootStyle();
  const applied: string[] = [];
  const safeArea = getSafeAreaInsets();
  const contentSafeArea = getContentSafeAreaInsets();
  if (safeArea.ok) writeInsets(style, SAFE_AREA_PREFIX, safeArea.value, applied);
  if (contentSafeArea.ok) {
    writeInsets(style, CONTENT_SAFE_AREA_PREFIX, contentSafeArea.value, applied);
  }
  return { applied, safeArea, contentSafeArea };
}

/**
 * يطبّق السمةَ والحواشي، ثم يبقى مربوطاً بأحداثِ المضيف: سمةٌ تُطبَّق مرةً عندَ
 * الإقلاعِ تتقادم لحظةَ ينقل المستخدمُ تيليجرامَ إلى الوضعِ الليلي، وحواشٍ
 * تُقرأ مرةً تكذب لحظةَ يدخل التطبيقُ ملءَ الشاشة. والعائدُ فكُّ الارتباط،
 * ونداؤه مرتين آمن.
 */
export function bindTelegramTheme(): TgUnsubscribe {
  applyTelegramTheme();
  applyTelegramSafeArea();

  const detachers: TgUnsubscribe[] = [
    onTelegramEvent("themeChanged", () => {
      applyTelegramTheme();
    }),
    onTelegramEvent("safeAreaChanged", () => {
      applyTelegramSafeArea();
    }),
    onTelegramEvent("contentSafeAreaChanged", () => {
      applyTelegramSafeArea();
    }),
    onTelegramEvent("fullscreenChanged", () => {
      applyTelegramSafeArea();
    }),
  ];

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (const detach of detachers) detach();
  };
}
