/**
 * الغرض: قواعدُ عقدِ اشتراكِ السائقِ — **قراءةٌ + تجديدٌ يبدأُ الدفعَ**، مقيسةٌ
 *   على نصِّ المستودعِ لا نيّةِ كاتبِه (البند `F3-06` · `SD-07`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-06`.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-driver-subscription-contract.ts` و`tests/unit`.
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ## لِمَ حاجزٌ على شاشةِ اشتراكٍ
 *
 * لأنَّ الأعطابَ ههنا كلَّها خضراءُ في الاختبارِ وكلُّها تخدعُ سائقاً بسعرٍ:
 *
 *   ــ **سعرٌ مرمَّزٌ**: `250`/`400` ثابتاً في الشِّفرةِ يتخلَّفُ عن تحديثِ
 *      المشغِّلِ لسعرِ `platform_settings`، فيُعرَضُ سعرٌ قديمٌ أو يُحسَبُ دفعٌ
 *      بسعرٍ لم يعُدْ سارياً.
 *   ــ **تجديدٌ صامتٌ**: زرٌّ يظهرُ ولا فعلَ خلفَه — سائقٌ يضغطُ ولا يحدثُ شيءٌ،
 *      وهو أخفضُ ثقةً من زرٍّ لا يظهرُ أصلاً.
 *   ــ **نجاحٌ بلا مزوّدٍ**: تجديدٌ يُجيبُ `200` والمزوّدُ غيرُ مهيّأٍ يُوهِمُ
 *      سائقاً أنَّ دفعَه بدأَ وهو لم يبدأْ.
 *   ــ **تاريخٌ محجوبٌ**: سائقٌ لا يرى دفعاتِه السابقةَ لا يستطيعُ مراجعةَ ما
 *      دُفِعَ ولا الاعتراضَ على ما لم يُدفَعْ.
 *
 * ## القواعدُ
 *
 *   ١. **لا سعرَ مرمَّزٌ**: `250`/`400`/`30` (يوم التجربة) لا يظهرانِ حرفيّينِ
 *      في طبقةِ التطبيقِ أو المسارِ أو الشاشةِ — السعرُ من الحمولةِ أو RPC.
 *   ٢. **التجديدُ حاضرٌ**: مسارٌ `POST /renew`، وحالةُ استخدامٍ تستدعي
 *      `subscribePlan`، وزرٌّ في الشاشةِ.
 *   ٣. **الفشلُ مُغلَقٌ**: غيابُ المزوّدِ يُعلَنُ `PAYMENT_PROVIDER_NOT_AVAILABLE`
 *      بـ`503` — لا نجاحٌ صامتٌ ولا استثناءٌ غيرُ مُصنَّفٍ.
 *   ٤. **تاريخُ الدفعِ معروضٌ**: الشاشةُ تعرضُ سطراً من التاريخِ.
 *   ٥. **كلُّ رمزٍ منشورٍ له نصُّه** في اللغاتِ الثلاثِ.
 */

/** أرقامٌ تجاريّةٌ يُحظَرُ ترميزُها حرفيّاً في طبقةِ التطبيقِ والمسارِ والشاشةِ. */
export const FORBIDDEN_HARDCODED_NUMBERS: readonly string[] = ["250", "400"];

export const APPLICATION_FILE = "packages/application/driver/driver-subscription.ts";
export const ROUTE_FILE = "apps/gateway/src/routes/driver-subscription.ts";
export const DOMAIN_FILE = "packages/domain/driver/driver-subscription.ts";
export const CONTRACT_FILE =
  "apps/miniapp/src/surfaces/driver/subscription/subscription-contract.ts";
export const VIEW_FILE = "apps/miniapp/src/surfaces/driver/subscription/subscription-view.ts";
export const SCREEN_FILE = "apps/miniapp/src/surfaces/driver/subscription/SubscriptionScreen.tsx";
export const API_FILE = "apps/miniapp/src/surfaces/driver/subscription/subscription-api.ts";

export const SURFACE_FILES: readonly string[] = [SCREEN_FILE, API_FILE, VIEW_FILE, CONTRACT_FILE];

export const TRANSLATION_FILES: Readonly<Record<string, string>> = {
  ar: "packages/shared/i18n/miniapp/ar.json",
  en: "packages/shared/i18n/miniapp/en.json",
  ur: "packages/shared/i18n/miniapp/ur.json",
};

export const KEY_PREFIX = "driver.subscription.";

/** رموزُ الخطأِ المنشورةُ — لكلٍّ منها نصٌّ في ثلاثِ لغاتٍ. */
export const PUBLIC_ERROR_CODES: readonly string[] = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "SUBSCRIPTION_STORE_NOT_AVAILABLE",
  "NOT_A_DRIVER",
  "PAYMENT_PROVIDER_NOT_AVAILABLE",
  "PLAN_INVALID",
  "RENEWAL_FAILED",
];

export interface DriverSubscriptionContractInput {
  /** مسارٌ ⇒ شِفرةُ سطحٍ **بلا تعليقاتٍ**. */
  readonly surface: Readonly<Record<string, string>>;
  /** نصُّ النطاقِ النقيِّ **بلا تعليقاتٍ**. */
  readonly domain: string;
  /** نصُّ حالاتِ الاستعمالِ **بلا تعليقاتٍ**. */
  readonly application: string;
  /** نصُّ مسارِ البوّابةِ **بلا تعليقاتٍ**. */
  readonly route: string;
  /** لغةٌ ⇒ قاموسٌ. */
  readonly translations: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

function surfaceText(input: DriverSubscriptionContractInput): string {
  return Object.values(input.surface).join("\n");
}

/** ١) لا سعرَ مرمَّزٌ حرفيّاً في طبقةِ التطبيقِ أو المسارِ أو الشاشةِ. */
export function hardcodedPriceProblems(input: DriverSubscriptionContractInput): readonly string[] {
  const problems: string[] = [];
  const lines = `${input.application}\n${input.route}\n${surfaceText(input)}`.split("\n");
  for (const token of FORBIDDEN_HARDCODED_NUMBERS) {
    /** استبعادُ الأسطرِ التي تُعرّفُ رموزَ حالاتِ HTTP أو تَتعاملُ معها. */
    const priceLines = lines.filter((line) => {
      const trimmed = line.trim();
      /** أسطرُ مثل `PLAN_INVALID: 400,` أو `Record<…, 400 | 401 | 403 | 503>` */
      if (/^[A-Z_]+\s*:\s*\d{3},?\s*$/.test(trimmed)) return false;
      if (/Record<.*\d{3}.*>/.test(trimmed)) return false;
      return true;
    });
    if (new RegExp(`\\b${token}\\b`).test(priceLines.join("\n"))) {
      problems.push(
        `الرقمُ «${token}» يظهرُ حرفيّاً في طبقةِ التطبيقِ أو المسارِ أو الشاشةِ — والسعرُ يُقرأُ من الحمولةِ أو RPC لا من ثابتٍ يتخلَّفُ عن «platform_settings».`,
      );
    }
  }
  return problems;
}

/** ٢) التجديدُ حاضرٌ: مسارٌ ومسارُ استخدامٍ وزرٌّ في الشاشةِ. */
export function renewalPresenceProblems(input: DriverSubscriptionContractInput): readonly string[] {
  const problems: string[] = [];
  if (!input.route.includes("/v1/driver/subscription/renew")) {
    problems.push(
      `«${ROUTE_FILE}» لا يُعرِّفُ مسارَ «/v1/driver/subscription/renew» — والشاشةُ بلا فعلٍ تجديدٍّ أضعفُ من شاشةٍ لا تعرضُ زرَّه أصلاً.`,
    );
  }
  if (!input.application.includes("renewDriverSubscription")) {
    problems.push(
      `«${APPLICATION_FILE}» لا يُعرِّفُ «renewDriverSubscription» — التجديدُ حالةُ استخدامٍ لا امتدادٌ لحالةِ قراءةٍ.`,
    );
  }
  if (!input.application.includes("subscribePlan")) {
    problems.push(
      `«${APPLICATION_FILE}» لا يستدعي «subscribePlan» — والتجديدُ يُعيدُ استخدامَ منفذِ الدفعِ القائمِ لا يُنشئُ مساراً موازياً له.`,
    );
  }
  const screen = input.surface[SCREEN_FILE] ?? "";
  if (!screen.toLowerCase().includes("renew")) {
    problems.push(
      `«${SCREEN_FILE}» لا يذكرُ فعلَ تجديدٍ — والشاشةُ بلا زرِّ «جدِّد الآن» لوحُ قراءةٍ لا شاشةُ اشتراكٍ كاملةٌ.`,
    );
  }
  return problems;
}

/** ٣) الفشلُ مُغلَقٌ: غيابُ المزوّدِ يُعلَنُ لا يُنجَحُ صامتاً. */
export function failClosedProblems(input: DriverSubscriptionContractInput): readonly string[] {
  const problems: string[] = [];
  if (!input.application.includes("PAYMENT_PROVIDER_NOT_AVAILABLE")) {
    problems.push(
      `«${APPLICATION_FILE}» لا يُعرِّفُ رمزَ «PAYMENT_PROVIDER_NOT_AVAILABLE» — وغيابُ المزوّدِ يجبُ أن يُعلَنَ لا أن يُنجَحَ التجديدُ صامتاً بلا دفعٍ.`,
    );
  }
  if (!input.route.includes("renewal === undefined")) {
    problems.push(
      `«${ROUTE_FILE}» لا يفحصُ غيابَ تبعيّاتِ التجديدِ صريحاً — وتبعيّةٌ غائبةٌ يجبُ أن تُسقِطَ المسارَ بـ503 لا أن تُمرَّرَ إلى طبقةٍ تفترضُ حضورَها.`,
    );
  }
  if (!input.route.includes("503")) {
    problems.push(`«${ROUTE_FILE}» لا يردُّ «503» — وتعطيلُ مزوّدٍ حالةٌ معلَنةٌ برمزِ حالةٍ لا رفضٌ عامٌّ.`);
  }
  return problems;
}

/** ٤) تاريخُ الدفعِ معروضٌ في الشاشةِ. */
export function historyDisplayProblems(input: DriverSubscriptionContractInput): readonly string[] {
  const problems: string[] = [];
  const screen = input.surface[SCREEN_FILE] ?? "";
  const view = input.surface[VIEW_FILE] ?? "";
  if (!screen.toLowerCase().includes("history") && !view.toLowerCase().includes("history")) {
    problems.push(
      `لا «${SCREEN_FILE}» ولا «${VIEW_FILE}» يذكرُ «history» — وسائقٌ لا يرى دفعاتِه السابقةَ لا يستطيعُ مراجعةَ ما دُفِعَ.`,
    );
  }
  return problems;
}

/** ٥) كلُّ رمزٍ منشورٍ له نصُّه في اللغاتِ الثلاثِ. */
export function textCoverageProblems(input: DriverSubscriptionContractInput): readonly string[] {
  const problems: string[] = [];
  for (const code of PUBLIC_ERROR_CODES) {
    const key = `${KEY_PREFIX}error.${code}`;
    for (const [language, dict] of Object.entries(input.translations)) {
      if (dict === undefined) continue;
      const text = dict[key];
      if (text === undefined || text.trim().length === 0) {
        problems.push(`اللغةُ «${language}» تفتقدُ نصَّ الرمزِ «${key}» — ورمزٌ بلا نصٍّ يُعرَضُ خاماً.`);
      }
    }
  }
  return problems;
}

export function driverSubscriptionContractProblems(
  input: DriverSubscriptionContractInput,
): readonly string[] {
  return [
    ...hardcodedPriceProblems(input),
    ...renewalPresenceProblems(input),
    ...failClosedProblems(input),
    ...historyDisplayProblems(input),
    ...textCoverageProblems(input),
  ];
}
