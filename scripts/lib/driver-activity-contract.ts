/**
 * الغرض: قواعدُ عقدِ حصيلةِ السائقِ وأدائهِ — **تسعُ قواعدَ تُقاسُ على نصِّ
 *   المستودعِ** لا على نيّةِ كاتبِه (البند `F3-05` · `SD-06` · `SD-09`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-05`.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-driver-activity-contract.ts` و`tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: أيُّ شاشةِ أرقامٍ تُعرَضُ على مُشتَغِلٍ — قاعدةُ
 *   «المقامُ يُنشَرُ دائماً» وقاعدةُ «الغيابُ لا يُقرأُ صفراً» عينُهما.
 * يحرسُه: tests/unit/check-driver-activity-contract.test.ts
 * الحاكم: docs/adr/0120-transparency-is-a-denominator-not-a-slogan.md
 *
 * ## لِمَ حاجزٌ على شاشةِ أرقامٍ
 *
 * لأنَّ **الأعطابَ ههنا كلَّها خضراءُ في الاختبارِ**، وكلُّها تُغيِّرُ رزقَ إنسانٍ:
 *
 *   ــ **نسبةٌ بلا مقامٍ**: «قبولُكَ ٥٠٪» عن عرضَينِ حكمٌ على سائقٍ برقمٍ لا
 *      يُحاسَبُ عليه. والمقامُ إن سقطَ من الجوابِ لم يسقُطْ اختبارٌ — تُعرَضُ
 *      النسبةُ وحدَها فتُقرأُ حُكماً نهائيّاً.
 *   ــ **مبلغٌ يُخترَعُ**: المنصّةُ لا تتوسَّطُ في أجرةٍ (`ADR 0039` §٤)، فأيُّ
 *      رقمٍ ماليٍّ ههنا **تقديرٌ يُقرأُ وعداً**، وسائقٌ يقودُ على وعدٍ مخترَعٍ.
 *   ــ **صفرٌ موضعَ غيابٍ**: `rate ?? 0` يجعلُ سائقاً جديداً «صِفرَ قبولٍ» وهوَ
 *      لم يُعرَضْ عليه شيءٌ — وذاكَ ظلمٌ يُحسَبُ حقيقةً (`ADR 0023`).
 *   ــ **سلوكٌ يُزعَمُ أنَّه يُعاقِبُ**: معادلةُ المطابَقةِ اليومَ لا تقرأُ رفضاً
 *      (`packages/domain/dispatch/entity.ts`)، فنصٌّ يُوحي بالعكسِ يُخيفُ ويكسبُ.
 *   ــ **هويّةُ راكبٍ في أرشيفٍ**: جدولُ رحلاتٍ يُقرأُ في وقفةٍ أسهلُ مكانٍ
 *      لتسرُّبِ اسمٍ أو هاتفٍ، ولا حاجةَ لأحدِهما في تقريرٍ عن عملٍ مضى.
 *   ــ **حدُّ يومٍ يُحسَبُ في الجهازِ**: ساعةُ هاتفٍ مضبوطةٌ على منطقةٍ أخرى
 *      تُريهِ «اليومَ» غيرَ يومِ الخادمِ، فيُقرأُ الرقمُ خطأً ويُشتكى من صحّتِه.
 *
 * ## القواعدُ التسعُ
 *
 *   ١. **المقامُ يُنشَرُ دائماً**: `{numerator, denominator, rate}` في الخادمِ،
 *      موصوفٌ في العقدِ، ومعروضٌ في الشاشةِ.
 *   ٢. **لا مالَ مُخترَعٌ**: الغيابُ مُعلَنٌ بأساسِه، ولا لفظَ أجرةٍ في الشريحةِ.
 *   ٣. **الغيابُ لا يُقرأُ صفراً**: لا ارتدادَ إلى صفرٍ، والمُشوَّهُ يُسقِطُ القراءةَ.
 *   ٤. **قرارُ العرضِ نقيٌّ**: لا ساعةَ ولا شبكةَ في النطاقِ ولا في مُحوِّلِ العرضِ.
 *   ٥. **حقيقةُ الترتيبِ من الخادمِ**: العواملُ وأوزانُها والحكمُ في السلوكِ.
 *   ٦. **لا هويّةَ راكبٍ** في الشريحةِ كلِّها، ولا مُعرِّفَ تيليجرام في العميلِ.
 *   ٧. **المسافةُ موسومةٌ بأساسِها**: كِيلومترٌ بلا أساسٍ يُسقِطُ القراءةَ.
 *   ٨. **النافذةُ بمنطقةِ زمنِها من الخادمِ**: لا حسابَ تاريخٍ في العميلِ.
 *   ٩. **كلُّ رمزٍ منشورٍ له نصُّه** في اللغاتِ الثلاثِ.
 *
 * ## وما لا يفعلُه هذا الحاجزُ عن قصدٍ — وحدودُه مُعلَنةٌ (`ح-5`)
 *
 * - **لا يتحقّقُ من صحّةِ رقمٍ**: أنَّ `denominator` هوَ فعلاً عددُ العروضِ
 *   المُرسَلةِ يُقاسُ في تكاملٍ على قاعدةٍ حقيقيّةٍ لا بنصٍّ ساكنٍ.
 * - **لا يقيسُ فهمَ سائقٍ**: أنَّ عرضَ المقامِ يُغيِّرُ إدراكَه ادّعاءٌ ميدانيٌّ
 *   غيرُ مقيسٍ (`ADR 0099`)، والمفروضُ ههنا **ألّا يُحجَبَ** لا أن يُفهَمَ.
 * - **لا يمنعُ مالاً في بنودٍ أخرى**: `F3-09` سيُدخِلُ دفعَ اشتراكٍ، وحينَها
 *   يُقيَّدُ منعُ اللفظِ بهذه الشريحةِ لا يُرفَعُ عنها.
 * - **لا يقرأُ لفظاً في تعليقٍ**: يُغذَّى بشِفرةٍ منزوعةِ التعليقاتِ، وإلّا لَسقطَ
 *   على نثرٍ يُعلِّلُ **نفيَ** المالِ أو **غيابَ** الهويّةِ.
 */

/** المُدَدُ الثلاثُ — مجالٌ مغلقٌ يُفحَصُ في الطرفَينِ وفي النصوصِ. */
export const ACTIVITY_PERIODS: readonly string[] = ["day", "week", "month"];

/** عواملُ الترتيبِ كما هيَ في معادلةِ المطابَقةِ — لا واحدٌ يُزادُ ولا يُنقَصُ. */
export const RANKING_FACTORS: readonly string[] = ["PROXIMITY", "RATING", "PREFERRED_AREA"];

/** رموزُ الخطأِ المنشورةُ من طبقةِ التطبيقِ — لكلٍّ منها نصٌّ في ثلاثِ لغاتٍ. */
export const PUBLIC_ERROR_CODES: readonly string[] = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "ACTIVITY_STORE_NOT_AVAILABLE",
  "NOT_A_DRIVER",
  "PERIOD_INVALID",
  "WINDOW_UNRESOLVED",
];

/** أساسُ غيابِ المبلغِ — **مُعلَنٌ لا مضمرٌ** (`ADR 0039` §٤ · `DEC-11`). */
export const MONEY_BASIS = "NOT_INTERMEDIATED";

/** أساسُ المسافةِ — خطٌّ مستقيمٌ لا طريقٌ مقطوعٌ، ويُقالُ للسائقِ كذلكَ. */
export const DISTANCE_BASIS = "STRAIGHT_LINE";

/** إعدادُ منطقةِ الزمنِ — في القاعدةِ وحدَها، والعميلُ يقرأُ النتيجةَ لا المفتاحَ. */
export const TIMEZONE_SETTING_KEY = "city_timezone";

export const MIGRATION_FILE =
  "supabase/migrations/20260915140000_f3_05_driver_activity_summary.sql";
export const DOMAIN_FILE = "packages/domain/driver/activity.ts";
export const APPLICATION_FILE = "packages/application/driver/driver-activity.ts";
export const STORE_FILE = "packages/infrastructure/driver/driver-activity-store.ts";
export const ROUTE_FILE = "apps/gateway/src/routes/driver-activity.ts";
export const CONTRACT_FILE = "apps/miniapp/src/surfaces/driver/activity/activity-contract.ts";
export const VIEW_FILE = "apps/miniapp/src/surfaces/driver/activity/activity-view.ts";

/** مِلفّاتُ السطحِ — مكتوبةً لا مُكتشَفةً بنمطٍ. */
export const SURFACE_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/driver/activity/ActivityScreen.tsx",
  "apps/miniapp/src/surfaces/driver/activity/activity-api.ts",
  VIEW_FILE,
  CONTRACT_FILE,
];

export const TRANSLATION_FILES: Readonly<Record<string, string>> = {
  ar: "packages/shared/i18n/miniapp/ar.json",
  en: "packages/shared/i18n/miniapp/en.json",
  ur: "packages/shared/i18n/miniapp/ur.json",
};

export const KEY_PREFIX = "driver.activity.";

export interface DriverActivityContractInput {
  /** مسارٌ ⇒ شِفرةُ سطحٍ **بلا تعليقاتٍ**. */
  readonly surface: Readonly<Record<string, string>>;
  /** نصُّ النطاقِ النقيِّ **بلا تعليقاتٍ**. */
  readonly domain: string;
  /** نصُّ حالاتِ الاستعمالِ **بلا تعليقاتٍ**. */
  readonly application: string;
  /** نصُّ المُهايِئِ **بلا تعليقاتٍ**. */
  readonly store: string;
  /** نصُّ مسارِ البوّابةِ **بلا تعليقاتٍ**. */
  readonly route: string;
  /** نصُّ الهجرةِ **بلا تعليقاتٍ**. */
  readonly migrationSql: string;
  /** لغةٌ ⇒ قاموسٌ. */
  readonly translations: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

function surfaceText(input: DriverActivityContractInput): string {
  return Object.values(input.surface).join("\n");
}

/** كلُّ نصِّ الشريحةِ — للقواعدِ التي تمنعُ لفظاً في الشريحةِ كلِّها. */
function sliceText(input: DriverActivityContractInput): string {
  return [
    surfaceText(input),
    input.domain,
    input.application,
    input.store,
    input.route,
    input.migrationSql,
  ].join("\n");
}

/** ١) المقامُ يُنشَرُ في الخادمِ ويُوصَفُ في العقدِ ويُعرَضُ في الشاشةِ. */
export function denominatorProblems(input: DriverActivityContractInput): readonly string[] {
  const problems: string[] = [];

  for (const field of ["numerator", "denominator"]) {
    const published = input.migrationSql.split(`'${field}'`).length - 1;
    if (published < 2) {
      problems.push(
        `الهجرةُ «${MIGRATION_FILE}» تنشُرُ «${field}» ${published} مرّةً؛ والكسرانِ اثنانِ (قبولٌ وإلغاءٌ) — ونسبةٌ تُنشَرُ بلا مقامِها تُقرأُ حُكماً نهائيّاً على سائقٍ عن عرضَينِ.`,
      );
    }
  }
  if (!input.migrationSql.includes("'rate', case when")) {
    problems.push(
      `الهجرةُ «${MIGRATION_FILE}» لا تُشرِطُ «rate» بمقامٍ غيرِ صفرٍ — والقسمةُ على صفرٍ إمّا تُسقِطُ الجوابَ أو تُخترَعُ نسبةً، وكلاهما أسوأُ من «غيرِ مقيسٍ».`,
    );
  }
  for (const file of [CONTRACT_FILE, VIEW_FILE]) {
    const code = input.surface[file] ?? "";
    if (!code.includes("denominator")) {
      problems.push(
        `«${file}» لا يذكرُ «denominator» — ومقامٌ يُنشَرُ من الخادمِ ولا يمرُّ بالعقدِ ولا بمُحوِّلِ العرضِ مقامٌ محجوبٌ عن السائقِ.`,
      );
    }
  }
  if (!surfaceText(input).includes("ratio.basis")) {
    problems.push(
      `السطحُ لا يعرضُ «${KEY_PREFIX}ratio.basis» — والمقامُ جزءٌ من الرقمِ لا حاشيةٌ له («ADR 0120»).`,
    );
  }
  if (!input.store.includes("numerator") || !input.store.includes("MALFORMED_RESULT")) {
    problems.push(
      `المُهايِئُ «${STORE_FILE}» لا يقرأُ الكسرَ ويردُّ «MALFORMED_RESULT» — وكسرٌ ناقصٌ يجبُ أن يُسقِطَ القراءةَ لا أن يُكمَّلَ بتخمينٍ في العميلِ.`,
    );
  }
  return problems;
}

/** لفظُ مالٍ في شريحةٍ لا تتوسَّطُ في مالٍ — تقديرٌ يُقرأُ وعداً. */
const MONEY_TOKENS: readonly string[] = [
  "fare",
  "price",
  "earning",
  "earnings",
  "payout",
  "commission",
  "revenue",
  "wallet",
  "sar",
];

/** ٢) لا مالَ مُخترَعٌ: الغيابُ مُعلَنٌ بأساسِه ولا لفظَ أجرةٍ في الشريحةِ. */
export function moneyAbsenceProblems(input: DriverActivityContractInput): readonly string[] {
  const problems: string[] = [];
  if (!input.migrationSql.includes(`'amount', null`)) {
    problems.push(
      `الهجرةُ «${MIGRATION_FILE}» لا تنشُرُ «amount» عَدَماً — والمبلغُ الغائبُ يُعلَنُ عَدَماً بأساسِه، لا يُحذَفُ الحقلُ فيُقرأَ نسياناً ولا يُنشَرُ صفراً فيُقرأَ «لم تكسِبْ شيئاً».`,
    );
  }
  if (!input.migrationSql.includes(`'${MONEY_BASIS}'`)) {
    problems.push(
      `الهجرةُ «${MIGRATION_FILE}» لا تنشُرُ الأساسَ «${MONEY_BASIS}» — وغيابٌ بلا سببٍ منشورٍ يُقرأُ عطلاً في النظامِ لا قراراً فيه («ADR 0039» §٤).`,
    );
  }
  const text = sliceText(input).toLowerCase();
  for (const token of MONEY_TOKENS) {
    if (new RegExp(`\\b${token}\\b`).test(text)) {
      problems.push(
        `اللفظُ «${token}» يظهرُ في شريحةِ الحصيلةِ — والمنصّةُ لا تتوسَّطُ في أجرةٍ ولا تحصِّلُها، فأيُّ رقمٍ ماليٍّ ههنا تقديرٌ يُقرأُ وعداً («DEC-11» · «م13-7»).`,
      );
    }
  }
  return problems;
}

/** ٣) الغيابُ لا يُقرأُ صفراً، والمُشوَّهُ يُسقِطُ القراءةَ. */
export function absenceHonestyProblems(input: DriverActivityContractInput): readonly string[] {
  const problems: string[] = [];
  const zeroFallback = /(\?\?|\|\|)\s*0\b/;
  const numeric = /rate|average|rating|numerator|denominator|amount|seconds|count/i;
  for (const [path, code] of Object.entries(input.surface)) {
    const offending = code
      .split("\n")
      .filter((line) => numeric.test(line) && zeroFallback.test(line));
    if (offending.length > 0) {
      problems.push(
        `«${path}» يرتدُّ برقمٍ إلى صفرٍ — وصفرٌ موضعَ «غيرِ مقيسٍ» يُحسَبُ حقيقةً: سائقٌ لم يُعرَضْ عليه شيءٌ يُقرأُ «صِفرَ قبولٍ» («ADR 0023»).`,
      );
    }
  }
  if (!input.store.includes("UNMEASURED") && !input.store.includes("null")) {
    problems.push(
      `المُهايِئُ «${STORE_FILE}» لا يُمرِّرُ العَدَمَ كما هوَ — وتحويلُ العَدَمِ رقماً في الحدودِ يُخفي الغيابَ عن كلِّ ما بعدَه.`,
    );
  }
  if (!input.migrationSql.includes("then null")) {
    problems.push(
      `الهجرةُ «${MIGRATION_FILE}» لا تنشُرُ عَدَماً في حالٍ واحدةٍ على الأقلِّ — وما لم يُقَسْ يُقالُ عَدَماً لا صفراً.`,
    );
  }
  return problems;
}

/** ٤) القرارُ نقيٌّ: لا ساعةَ ولا شبكةَ في النطاقِ ولا في مُحوِّلِ العرضِ. */
export function purityProblems(input: DriverActivityContractInput): readonly string[] {
  const banned = ["Date.now", "new Date(", "setTimeout", "setInterval", "fetch(", "toLocale"];
  const problems: string[] = [];
  const pure: readonly (readonly [string, string])[] = [
    [DOMAIN_FILE, input.domain],
    [VIEW_FILE, input.surface[VIEW_FILE] ?? ""],
  ];
  for (const [path, code] of pure) {
    for (const token of banned) {
      if (code.includes(token)) {
        problems.push(
          `«${path}» يستعملُ «${token}» — وحُكمُ العرضِ يجبُ أن يكونَ دالّةً نقيّةً: ساعةٌ أو تنسيقُ مُضيفٍ فيه يجعلُ الرقمَ يختلفُ بجهازِ قارئِه فلا يُقاسُ في اختبارٍ.`,
        );
      }
    }
  }
  return problems;
}

/** ٥) حقيقةُ الترتيبِ من الخادمِ: العواملُ وأوزانُها والحكمُ في السلوكِ. */
export function rankingTruthProblems(input: DriverActivityContractInput): readonly string[] {
  const problems: string[] = [];
  for (const factor of RANKING_FACTORS) {
    if (!input.migrationSql.includes(`'${factor}'`)) {
      problems.push(
        `العاملُ «${factor}» غيرُ منشورٍ من الهجرةِ «${MIGRATION_FILE}» — وعاملٌ يعرفُه العميلُ ولا يقولُه الخادمُ عاملٌ يتقادَمُ يومَ تتغيَّرُ المعادلةُ ولا يُلاحَظُ.`,
      );
    }
  }
  if (!input.migrationSql.includes("behaviour_affects_ranking")) {
    problems.push(
      `الهجرةُ «${MIGRATION_FILE}» لا تنشُرُ «behaviour_affects_ranking» — وأثرُ الرفضِ في الترتيبِ يجبُ أن يُقالَ من حيثُ تُحسَبُ المعادلةُ، فيومَ تتغيَّرُ يتغيَّرُ النصُّ معَها لا في ملفِّ ترجمةٍ يُنسى.`,
    );
  }
  const surface = surfaceText(input);
  for (const token of ["weightProximity", "normalizeRating", "scoreCandidate", "proximityFactor"]) {
    if (surface.includes(token)) {
      problems.push(
        `السطحُ يذكرُ «${token}» — ومعادلةُ المطابَقةِ تُقرأُ من الخادمِ ولا تُعادُ في العميلِ: نسخةٌ ثانيةٌ منها تفترقُ عن الأولى بلا أن يسقُطَ شيءٌ.`,
      );
    }
  }
  if (!surface.includes("behaviourAffectsRanking")) {
    problems.push(
      `السطحُ لا يقرأُ «behaviourAffectsRanking» — وحُكمٌ في سلوكِ سائقٍ يُختارُ نصُّه في العميلِ حُكمٌ مُخترَعٌ ههنا لا مقروءٌ من هناكَ.`,
    );
  }
  return problems;
}

/**
 * هويّةُ راكبٍ لا موضعَ لها في تقريرٍ عن عملٍ مضى — **لا في خادمٍ ولا عميلٍ**.
 * وليسَ فيها `telegram_id`: مُعرِّفُ **طالِبِ التقريرِ نفسِه** هوَ مفتاحُ
 * قراءةِ ملكيّتِه في الخادمِ، ومنعُه هناكَ منعُ التحقُّقِ من الملكيّةِ أصلاً — فيُمنَعُ في
 * العميلِ وحدَه بقائمةٍ ثانيةٍ.
 */
const RIDER_IDENTITY_TOKENS: readonly string[] = [
  "rider_name",
  "rider_phone",
  "phone_number",
  "rider_id",
  "riderName",
  "riderPhone",
  "riderId",
];

/**
 * ألفاطٌ تُمنَعُ **في العميلِ وحدَه**: مُعرِّفٌ خارجيٌّ ينزِلُ إلى جهازٍ يُخزَّنُ
 * في سجلٍ أو يُرسَلُ في مُلتقَطِ شاشةٍ، ولا حاجةَ إليهِ في عرضٍ يقرأُه صاحِبُه.
 */
const CLIENT_BANNED_IDENTITY: readonly string[] = ["telegram_id", "telegramId"];

/** ٦) لا هويّةَ راكبٍ في الشريحةِ، ولا مُعرِّفَ تيليجرام في العميلِ. */
export function riderPrivacyProblems(input: DriverActivityContractInput): readonly string[] {
  const problems: string[] = [];
  const text = sliceText(input);
  for (const token of RIDER_IDENTITY_TOKENS) {
    if (text.includes(token)) {
      problems.push(
        `اللفظُ «${token}» يظهرُ في شريحةِ الحصيلةِ — وجدولُ رحلاتٍ يُقرأُ في وقفةٍ أسهلُ مكانٍ لتسرُّبِ هويّةٍ، ولا حاجةَ إليها في تقريرٍ عن عملٍ مضى.`,
      );
    }
  }
  const client = surfaceText(input);
  for (const token of CLIENT_BANNED_IDENTITY) {
    if (client.includes(token)) {
      problems.push(
        `اللفظُ «${token}» يظهرُ في عميلِ الحصيلةِ — ومُعرِّفُ تيليجرام مفتاحُ ملكيّةٍ يُقرأُ في الخادمِ من الجلسةِ، ونزولُه إلى شاشةٍ توسيعُ سطحِ تسرُّبٍ بلا حاجةٍ.`,
      );
    }
  }
  return problems;
}

/** ٧) المسافةُ موسومةٌ بأساسِها — كِيلومترٌ بلا أساسٍ يُسقِطُ القراءةَ. */
export function distanceBasisProblems(input: DriverActivityContractInput): readonly string[] {
  const problems: string[] = [];
  if (!input.migrationSql.includes(`'${DISTANCE_BASIS}'`)) {
    problems.push(
      `الهجرةُ «${MIGRATION_FILE}» لا تسِمُ المسافةَ بـ«${DISTANCE_BASIS}» — ورقمُ كِيلومتراتٍ بلا أساسٍ يُقرأُ طريقاً مقطوعاً وهوَ خطٌّ مستقيمٌ بينَ نقطتَينِ.`,
    );
  }
  if (!input.store.includes("isDistanceBasis")) {
    problems.push(
      `المُهايِئُ «${STORE_FILE}» لا يُلزِمُ المسافةَ بأساسِها — وكيلومترٌ يمرُّ بلا وسمٍ يصيرُ في الشاشةِ رقماً بلا معنىً.`,
    );
  }
  if (!input.domain.includes(DISTANCE_BASIS)) {
    problems.push(
      `النطاقُ «${DOMAIN_FILE}» لا يُعلِنُ الأساسَ «${DISTANCE_BASIS}» — ومجالٌ مفتوحٌ يقبلُ أساساً لا نصَّ له فيُعرَضُ مفتاحاً خاماً.`,
    );
  }
  if (!surfaceText(input).includes("distance.basis.")) {
    problems.push(
      `السطحُ لا يعرضُ نصَّ الأساسِ «${KEY_PREFIX}distance.basis.${DISTANCE_BASIS}» — والوسمُ يُقالُ للسائقِ لا يُحفَظُ في الجوابِ وحدَه.`,
    );
  }
  return problems;
}

/** ٨) النافذةُ بمنطقةِ زمنِها من الخادمِ — لا حسابَ تاريخٍ في العميلِ. */
export function windowProblems(input: DriverActivityContractInput): readonly string[] {
  const problems: string[] = [];
  for (const field of ["'timezone'", "'from'", "'to'"]) {
    if (!input.migrationSql.includes(field)) {
      problems.push(
        `الهجرةُ «${MIGRATION_FILE}» لا تنشُرُ ${field} في النافذةِ — وحدُّ «اليومِ» إن لم يُقَلْ حُسِبَ بساعةِ جهازٍ قد تكونُ على منطقةٍ أخرى، فيُقرأُ الرقمُ خطأً ويُشتكى من صحّتِه.`,
      );
    }
  }
  if (!input.migrationSql.includes(TIMEZONE_SETTING_KEY)) {
    problems.push(
      `الإعدادُ «${TIMEZONE_SETTING_KEY}» غيرُ مبذورٍ ولا مقروءٍ في «${MIGRATION_FILE}» — ومنطقةُ زمنِ المدينةِ إعدادٌ للمُشغِّلِ لا ثابتٌ في شِفرةٍ.`,
    );
  }
  if (surfaceText(input).includes(TIMEZONE_SETTING_KEY)) {
    problems.push(
      `السطحُ يذكرُ اسمَ الإعدادِ «${TIMEZONE_SETTING_KEY}» — أسماءُ الإعداداتِ تُقرأُ في القاعدةِ وحدَها، وعميلٌ يعرفُها يوشكُ أن يقرأَها بنفسِه ويصيرَ مصدرَ حقيقةٍ ثانياً.`,
    );
  }
  if (
    !input.route.includes("WINDOW_UNRESOLVED") ||
    !input.application.includes("WINDOW_UNRESOLVED")
  ) {
    problems.push(
      `«WINDOW_UNRESOLVED» غيرُ مذكورٍ في المسارِ وحالاتِ الاستعمالِ — ونافذةٌ لا تُحسَبُ يجبُ أن تُقالَ خطأً مُسمّىً لا أن تُقرأَ حصيلةً فارغةً.`,
    );
  }
  return problems;
}

/** ٩) كلُّ رمزٍ منشورٍ له نصُّه في اللغاتِ الثلاثِ. */
export function textCoverageProblems(input: DriverActivityContractInput): readonly string[] {
  const problems: string[] = [];
  const required = [
    `${KEY_PREFIX}title`,
    `${KEY_PREFIX}rides`,
    `${KEY_PREFIX}hours`,
    `${KEY_PREFIX}ratio.unmeasured`,
    `${KEY_PREFIX}ratio.basis`,
    `${KEY_PREFIX}rating.none`,
    `${KEY_PREFIX}ranking.behaviourCounts`,
    `${KEY_PREFIX}ranking.behaviourIgnored`,
    `${KEY_PREFIX}money.basis.${MONEY_BASIS}`,
    `${KEY_PREFIX}distance.basis.${DISTANCE_BASIS}`,
    ...ACTIVITY_PERIODS.map((period) => `${KEY_PREFIX}period.${period}`),
    ...RANKING_FACTORS.map((factor) => `${KEY_PREFIX}ranking.factor.${factor}`),
    ...PUBLIC_ERROR_CODES.map((code) => `${KEY_PREFIX}error.${code}`),
    `${KEY_PREFIX}error.UNKNOWN`,
  ];
  for (const [language, dictionary] of Object.entries(input.translations)) {
    for (const key of required) {
      const value = dictionary[key];
      if (value === undefined || value.trim().length === 0) {
        problems.push(
          `المفتاحُ «${key}» غائبٌ أو فارغٌ في «${language}» — ورمزٌ خامٌ على شاشةِ سائقٍ أو فراغٌ يُقرأُ عطلاً («UX-5»).`,
        );
      }
    }
  }
  const arabic = input.translations.ar ?? {};
  for (const [key, placeholder] of [
    [`${KEY_PREFIX}ratio.basis`, "{denominator}"],
    [`${KEY_PREFIX}window`, "{timezone}"],
    [`${KEY_PREFIX}rating.count`, "{count}"],
  ] as const) {
    if (!(arabic[key] ?? "").includes(placeholder)) {
      problems.push(
        `نصُّ «${key}» بلا «${placeholder}» — والحقيقةُ المنشورةُ تُقالُ للسائقِ مقداراً، وإلّا صارَ النصُّ شِعاراً بلا مقامٍ.`,
      );
    }
  }
  return problems;
}

export function driverActivityContractProblems(
  input: DriverActivityContractInput,
): readonly string[] {
  return [
    ...denominatorProblems(input),
    ...moneyAbsenceProblems(input),
    ...absenceHonestyProblems(input),
    ...purityProblems(input),
    ...rankingTruthProblems(input),
    ...riderPrivacyProblems(input),
    ...distanceBasisProblems(input),
    ...windowProblems(input),
    ...textCoverageProblems(input),
  ];
}
