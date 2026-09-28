/**
 * الغرض: قواعدُ عقدِ شاشةِ الإنهاءِ والتقييمِ — ستُّ قواعدَ تُقاسُ على **نصِّ**
 *   المستودعِ لا على نيّةِ كاتبِه (البند `F2-07` · `SR-07` · `SR-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-07`.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-ride-summary-contract.ts` و`tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-09` (المشاركةُ) حينَ يُبنى مسارُها فتُنقَلُ
 *   كلمتُها من المحظورِ إلى المسموحِ **بتعديلِ هذا المِلفِّ معَ مسارِها** لا
 *   بإسكاتِ الحاجزِ؛ و`F2-08` لو فُتِحَت تذكرةُ دعمٍ.
 *
 * ## لماذا حاجزٌ آخرُ وقد وُجِدَ حاجزُ `UX-022`
 *
 * حاجزُ الرحلةِ النشطةِ يقيسُ **شاشتَه** بمفاتيحِها `rider.active.`، وهذه شاشةٌ
 * أخرى بمفاتيحَ أخرى وهجرةٍ أخرى. ولو وُسِّعَ ذاكَ لَصارَ حاجزاً واحداً يُقرأُ
 * فشلُه فلا يُعرَفُ أيُّ سطحٍ نقضَ العقدَ. **والأخطرُ**: هذه الشاشةُ تعرضُ
 * **رقمَ مسافةٍ** وتُدعى «ملخَّصَ رحلةٍ» — وهذانِ مَدخلا الكذبِ اللذانِ لا
 * يُمسِكُهما حاجزٌ عن شاشةٍ لا تعرضُهما.
 *
 * ## القواعدُ الستُّ
 *
 *   ١. **لا مالَ**: لا أجرةَ ولا إيصالَ ولا إكراميّةَ في شِفرةِ السطحِ ولا في
 *      مفاتيحِه ولا في نصوصِه الثلاثةِ (`ADR 0039` §٤ · `DEC-11` · `م13-7`).
 *      وحتّى **خانةٌ فارغةٌ** للإكراميّةِ محظورةٌ: تُملأُ غداً بلا قرارٍ.
 *   ٢. **لا مسافةَ تُدَّعى مقطوعةً**: كلُّ نصٍّ يحملُ رقمَ مسافةٍ يحملُ معَه
 *      **تصريحَ الخطِّ المستقيمِ**، ولا لفظَ «مقطوعةٍ» ولا `travelled`. وسببُه
 *      أنَّ القاعدةَ لا تحفظُ أثرَ مسارٍ: `st_distance` بينَ نقطتَينِ وترٌ، ومن
 *      عرضَه «مسافةً» فقد أخبرَ بما لا يعلمُ.
 *   ٣. **مُعجَمُ الوسومِ واحدٌ**: قائمةُ `RATING_TAGS` في النطاقِ تُطابِقُ
 *      **حرفاً وترتيباً** كلَّ مُعجَمٍ في الهجرةِ. فافتراقُهما يُرسِلُ وسماً
 *      يُرَدُّ، أو يُخفي وسماً تقبلُه القاعدةُ ولا يُعرَضُ.
 *   ٤. **مفاتيحُ ثلاثةٌ متطابقةٌ**: مجموعةُ مفاتيحِ `rider.summary.` واحدةٌ في
 *      `ar` و`en` و`ur`، وكلُّ مفتاحٍ يُنادى في السطحِ موجودٌ في الثلاثةِ.
 *   ٥. **لا زرَّ لمسارٍ لم يُبنَ**: لا تذكرةَ دعمٍ ولا شكوى ولا مشاركةَ ولا
 *      طوارئَ في هذا السطحِ — مساراتُها لم تُبنَ، وزرٌّ لا يفعلُ شيئاً وعدٌ لا
 *      عقدٌ. والغيابُ مُسمَّى في دليلِ الإغلاقِ لا مطويٌّ.
 *   ٦. **لا دالّةَ بلا نزعِ تنفيذٍ**: كلُّ دالّةٍ تُنشئُها الهجرةُ يُنزَعُ
 *      تنفيذُها عن `public` و`anon` و`authenticated` **بالثلاثةِ مُسمّاةً**.
 *      والمنحُ ضمنيٌّ، فالنسيانُ هوَ الحالةُ الافتراضيّةُ لا الشاذّةُ.
 *   ٧. **مدخلُ الاستغاثةِ يُركَّبُ** (`PD-020` — زيادةٌ سابقةٌ).
 *   ٨. **«الإبلاغُ عن مشكلةٍ» موصولٌ بالرحلةِ** (`SR-08` · 2026-09-28 — زيادةٌ `ح-8`).
 *   ٩. **مسافةُ الأثرِ المسجَّلِ تُصرِّحُ بأثرِها** (`ADR 0208` · 2026-09-28 —
 *      زيادةٌ `ح-8`): بُنيَ القياسُ من `driver_location_history` فصارَ اسمُ
 *      `travelledTrace` مساراً مبنيّاً. **نقلٌ لا حذف** (عينُ حكمِ `PD-020`):
 *      ألفاظُ القطعِ (`travelled` · «مقطوعة») تبقى محظورةً في كلِّ نصٍّ ومفتاحٍ
 *      **إلّا** نطاقَ `rider.summary.travelledTrace.` — وهناكَ يُشترَطُ التصريحُ
 *      بالأثرِ المسجَّلِ في كلِّ نصٍّ يحملُ رقمَ مسافةٍ، وتركيبُ السطرِ في
 *      الشاشةِ فعلاً (لا شِفرةً ميتةً تُحسَبُ إنجازاً).
 *
 * ## ما لا يفعلُه عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ
 *
 * - **لا يُثبِتُ أنَّ الملخَّصَ صادقٌ عندَ راكبٍ حقيقيٍّ**: يُثبِتُ غيابَ ستِّ
 *   كذباتٍ مُسمَّاةٍ. والمدّةُ والوترُ يُقاسانِ على قاعدةٍ حقيقيّةٍ في
 *   `tests/integration/ride-summary.test.ts`، وهذا حاجزُ نصٍّ لا حاجزُ أثرٍ.
 * - **لا يقرأُ دلالةَ الشِّفرةِ**: يقرأُ نصّاً وعلاماتٍ مُعلَنةً. فمن أرادَ
 *   الاحتيالَ عليه قدرَ، ومن أرادَ الصدقَ لم يُخطئْ سهواً — وذاكَ غرضُه.
 * - **لا يحكمُ في جودةِ الترجمةِ**: يقيسُ وجودَ المفتاحِ وعلامتَه لا فصاحتَه.
 * - **لا يفحصُ صلاحيّاتَ قاعدةٍ حيّةٍ**: ذاكَ أثرٌ يُقاسُ بمحرِّكٍ في
 *   `tests/integration/database-privilege-surface.test.ts`.
 */

/** مِلفّاتُ السطحِ المقروءةُ — مكتوبةً لا مُكتشَفةً، فزيادةُ مِلفٍّ تُزادُ ههنا. */
export const SURFACE_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/rider/summary/RideSummaryScreen.tsx",
  "apps/miniapp/src/surfaces/rider/summary/ride-summary-view.ts",
  "apps/miniapp/src/surfaces/rider/summary/ride-summary-api.ts",
  "apps/miniapp/src/surfaces/rider/summary/ride-summary-contract.ts",
];

export const SUMMARY_SQL_FILE =
  "supabase/migrations/20260914010000_f2_07_ride_summary_and_rating_tags.sql";
export const DOMAIN_FILE = "packages/domain/transport/ride-summary.ts";
export const VIEW_FILE = "apps/miniapp/src/surfaces/rider/summary/ride-summary-view.ts";
export const TRANSLATION_FILES: Readonly<Record<string, string>> = {
  ar: "packages/shared/i18n/miniapp/ar.json",
  en: "packages/shared/i18n/miniapp/en.json",
  ur: "packages/shared/i18n/miniapp/ur.json",
};

/** بادئةُ مفاتيحِ هذا السطحِ. */
export const KEY_PREFIX = "rider.summary.";

/**
 * معجمُ المالِ — إنجليزيّاً وعربيّاً وأُردِيّاً. و«الإكراميّةُ» ههنا **معَ**
 * معجمِ `UX-022`: شاشةُ ما بعدَ الرحلةِ هيَ موضعُها المُعتادُ في كلِّ تطبيقٍ،
 * فحظرُها يُكتَبُ صريحاً ولا يُترَكُ للاجتهادِ.
 */
export const MONEY_TOKENS: readonly string[] = [
  "fare",
  "price",
  "pricing",
  "amount",
  "payment",
  "payout",
  "invoice",
  "receipt",
  "penalty",
  "refund",
  "wallet",
  "currency",
  "sar",
  "riyal",
  "tip",
  "tipping",
  "gratuity",
  "سعر",
  "السعر",
  "أجرة",
  "الأجرة",
  "تسعير",
  "دفع",
  "الدفع",
  "مبلغ",
  "المبلغ",
  "رسم",
  "رسوم",
  "غرامة",
  "عقوبة",
  "ريال",
  "محفظة",
  "فاتورة",
  "إيصال",
  "إكرامية",
  "إكراميّة",
  "بخشش",
  "کرایہ",
  "ادائیگی",
  "رسید",
];

/**
 * معجمُ المساراتِ التي لم تُبنَ في هذا البندِ — زرٌّ لها اليومَ زرٌّ كاذبٌ.
 * وتذكرةُ الدعمِ ههنا **غيابٌ مُصرَّحٌ**: `open_support_ticket` موجودةٌ في
 * القاعدةِ منذُ بندٍ سابقٍ ولم يُوصَلْ لها مسارٌ ولا سطحٌ، فرسمُ زرٍّ لها
 * يُحوِّلُ الغيابَ المُصرَّحَ إلى وعدٍ مكسورٍ.
 */
export const UNBUILT_PATH_TOKENS: readonly string[] = [
  "support",
  "ticket",
  "complaint",
  "dispute",
  "share",
  "whatsapp",
  "tel:",
  "دعم",
  "تذكرة",
  "شكوى",
  "اعتراض",
  "مشاركة",
  "شارك",
  "اتصل",
  "اتّصل",
];

/**
 * ## إضافةُ البند `PD-020` (2026-09-20) — **نقلٌ لا حذفٌ**
 *
 * خمسةُ رموزٍ (`sos` · `emergency` · `panic` · «طوارئ» · «استغاثة») كانت في
 * `UNBUILT_PATH_TOKENS` أعلاه، ونُقِلَت إلى ههنا لأنَّ مدخلَها **بُنِيَ وصارَ
 * من كلِّ سطحٍ ذي صلةٍ** (`PD-020`): شاشةُ الملخصِ نفسُها كانت من «الأسطحِ
 * التسعةِ» التي عليها مدخلُ الاستغاثةِ — فبقاؤها في معجمِ المحظورِ كان سيردُّ
 * البناءَ بعدَ أن صارَ الحضورُ هو الصوابَ. ولا سطرَ حُذِفَ (القاعدة ح-2):
 * الرموزُ انتقلَت ولم تُمحَ، وحراستُها انقلبَت ولم تسقطْ:
 *   ــ **مفاتيحُ `rider.summary.` ما زالت ممنوعةً منها**: نصُّ الاستغاثةِ مِلكُ
 *      `rider.sos.`، ولو تسرّبَ إلى مفاتيحِ الملخصِ لَصارَ للمعنى الواحدِ نصّانِ.
 *   ــ **والشاشةُ يجبُ أن تركّبَ المدخلَ فعلاً**: القاعدةُ السابعةُ أدناه —
 *      مَن حذفَ التركيبَ سقطَ بناؤُهُ، ولا يمرُّ الحذفُ صامتاً.
 */
export const SOS_BUILT_PATH_TOKENS: readonly string[] = [
  "sos",
  "emergency",
  "panic",
  "طوارئ",
  "استغاثة",
];

/** الشاشةُ — يُفحَصُ تركيبُ مدخلِ الاستغاثةِ فيها (`PD-020`). */
export const SCREEN_FILE = "apps/miniapp/src/surfaces/rider/summary/RideSummaryScreen.tsx";

/** الموجِّهُ — يُركِّبُ الملخَّصَ ويُوصِلُ «الإبلاغَ عن مشكلةٍ» بسطحِ الدعمِ (`SR-08`). */
export const ROOT_FILE = "apps/miniapp/src/surfaces/rider/RiderRoot.tsx";

/** مفتاحُ «الإبلاغِ عن مشكلةٍ» في هذا السطحِ — نصُّه لا يذكرُ تذكرةً ولا دعماً. */
export const REPORT_PROBLEM_KEY = "rider.summary.reportProblem";

/**
 * الوصلُ في الموجِّهِ كما يجبُ أن يُكتَبَ: الشكوى **تحملُ الرحلةَ الملخَّصةَ**
 * لا `null` ولا معرّفاً آخرَ. والفراغاتُ مرنةٌ، والمعنى لا.
 */
export const REPORT_PROBLEM_WIRING =
  /onReportProblem=\{\s*\(\)\s*=>\s*setSupport\(\s*\{\s*orderId:\s*summarized\s*\}\s*\)\s*\}/;

/** مُركِّبُ مدخلِ الاستغاثةِ كما يُكتَبُ في الشاشةِ — اسمٌ واحدٌ في موضعَينِ. */
export const SOS_ENTRY_COMPONENT = "SosEntry";

/**
 * علامةُ **الخطِّ المستقيمِ** في كلِّ لغةٍ — نصٌّ يحملُ رقمَ مسافةٍ بلا واحدةٍ
 * منها نصٌّ يُقرأُ «مسافةً» فيُصدَّقُ ما لم يُقَسْ.
 */
export const STRAIGHT_LINE_MARKERS: Readonly<Record<string, readonly string[]>> = {
  ar: ["الخطِّ المستقيمِ", "خطٍّ مستقيمٍ", "وتر"],
  en: ["straight-line", "straight line"],
  ur: ["سیدھی لکیر"],
};

/** نطاقُ مسافةِ الأثرِ المسجَّلِ — المسموحُ الوحيدُ لألفاظِ القطعِ (`ADR 0208`). */
export const TRAVELLED_TRACE_KEY_PREFIX = `${KEY_PREFIX}travelledTrace.`;

/**
 * علامةُ **الأثرِ المسجَّلِ** في كلِّ لغةٍ — نصٌّ في نطاقِ `travelledTrace.`
 * يحملُ رقمَ مسافةٍ بلا واحدةٍ منها نصٌّ يُقرأُ «مسافةَ طريقٍ» فيُصدَّقُ ما لم
 * يُقَسْ (`ADR 0208` §٧: «يُسمّى في الواجهةِ مسافةَ الأثرِ المسجَّلِ لا
 * مسافةَ الطريقِ»).
 */
export const TRAVELLED_TRACE_MARKERS: Readonly<Record<string, readonly string[]>> = {
  ar: ["الأثرِ المسجَّلِ", "الأثر المسجل"],
  en: ["recorded trace"],
  ur: ["درج شدہ نشان"],
};

/** إحلالاتُ المسافةِ — نصٌّ فيه واحدٌ منها نصُّ مسافةٍ يلزمُه التصريحُ. */
export const DISTANCE_PLACEHOLDERS: readonly string[] = ["{meters}", "{kilometers}"];

/** ألفاظُ ادّعاءِ القطعِ — محظورةٌ في النصِّ وفي الشِّفرةِ. */
export const TRAVELLED_TOKENS: readonly string[] = [
  "travelled",
  "traveled",
  "odometer",
  "trip distance",
  "distance driven",
  "مقطوعة",
  "المقطوعة",
  "مقطوعاً",
  "طيَّ المسافةِ",
];

export interface RideSummaryContractInput {
  /** مِلفّاتُ السطحِ: مسارٌ ⇒ شِفرةٌ **بلا تعليقاتٍ** (التعليقُ يشرحُ المحظورَ). */
  readonly surface: Readonly<Record<string, string>>;
  /** نصُّ هجرةِ الملخَّصِ والوسومِ كما هوَ. */
  readonly sql: string;
  /** نصُّ مِلفِّ النطاقِ كما هوَ. */
  readonly domain: string;
  /** نصُّ نموذجِ العرضِ **بلا تعليقاتٍ**. */
  readonly view: string;
  /** القواميسُ الثلاثةُ مُحلَّلةً: لغةٌ ⇒ (مفتاحٌ ⇒ نصٌّ). */
  readonly translations: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** نصُّ الموجِّهِ `RiderRoot.tsx` **بلا تعليقاتٍ** — القاعدةُ الثامنةُ تقرأُ وصلَه. */
  readonly root: string;
}

const ASCII_WORD = /^[a-z]+$/;

/**
 * يفصلُ حدودَ الجملِ السنَّوريّةِ (`camelCase`) بفراغٍ قبلَ خفضِ الحالةِ.
 *
 * ولمَ هذا لا الخفضُ وحدَه: حاجزُ `UX-022` يُطابِقُ الكلمةَ اللاتينيّةَ بحدودِها
 * كي لا تُقرأَ «shared» «share» — وهذا صوابٌ، لكنَّه **يُفلِتُ**
 * `openSupportTicket` و`onSharePress`، وهما **الشكلُ الذي تُكتَبُ به الشِّفرةُ
 * فعلاً** لا `support`. فلو تُرِكَ لَكانَ الحاجزُ يمسكُ الاسمَ الذي لا يُكتَبُ
 * ويُفلِتُ الذي يُكتَبُ. والفصلُ يجعلُ «openSupportTicket» ثلاثَ كلماتٍ،
 * و«shared» تبقى كلمةً واحدةً — فيُمسَكُ المُخالِفُ ويسلمُ البريءُ.
 */
export function separateCamelCase(text: string): string {
  return text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

/**
 * الكلمةُ اللاتينيّةُ تُطابَقُ **بحدودِها** لا بالاحتواءِ (عينُ حكمِ `UX-022`)
 * وبعدَ فصلِ الحدودِ السنَّوريّةِ: «shared» في مسارِ استيرادٍ ليسَت «share»،
 * و«multiple» ليسَت «tip»، و«openSupportTicket» **هيَ** «support».
 * والعربيّةُ والأُردِيّةُ تُطابَقانِ بالاحتواءِ: سوابقُهما تلتصقُ.
 */
function mentions(text: string, token: string): boolean {
  const needle = token.toLowerCase();
  if (!ASCII_WORD.test(needle)) return text.toLowerCase().includes(needle);
  return new RegExp(`(?<![a-z])${needle}(?![a-z])`).test(separateCamelCase(text));
}

function tokenProblems(
  where: string,
  text: string,
  tokens: readonly string[],
  verdict: string,
): string[] {
  return tokens
    .filter((token) => mentions(text, token))
    .map((token) => `${where}: ${verdict} («${token}»).`);
}

/** مفاتيحُ هذا السطحِ في قاموسٍ. */
function prefixedKeys(dictionary: Readonly<Record<string, string>>): readonly string[] {
  return Object.keys(dictionary).filter((key) => key.startsWith(KEY_PREFIX));
}

/** القاعدة ١ — لا مالَ في السطحِ ولا في مفاتيحِه ولا في نصوصِه الثلاثةِ. */
export function moneyProblems(input: RideSummaryContractInput): readonly string[] {
  const problems: string[] = [];
  for (const [path, source] of Object.entries(input.surface)) {
    problems.push(...tokenProblems(path, source, MONEY_TOKENS, "شِفرةُ السطحِ تذكرُ مالاً وهوَ مُجمَّدٌ"));
  }
  for (const [language, dictionary] of Object.entries(input.translations)) {
    for (const key of prefixedKeys(dictionary)) {
      const value = dictionary[key] ?? "";
      problems.push(
        ...tokenProblems(`${language}:${key}`, key, MONEY_TOKENS, "مفتاحٌ يذكرُ مالاً"),
        ...tokenProblems(`${language}:${key}`, value, MONEY_TOKENS, "نصٌّ يذكرُ مالاً"),
      );
    }
  }
  return problems;
}

/**
 * القاعدة ٢ — لا مسافةَ تُدَّعى مقطوعةً: ثلاثةُ فحوصٍ في موضعٍ واحدٍ لأنَّها
 * كذبةٌ واحدةٌ بثلاثةِ مداخلَ: نصٌّ بلا تصريحٍ، ولفظُ قطعٍ، ومفتاحٌ يحملُ
 * رقمَ مسافةٍ ولا يُصرِّحُ في اسمِه.
 */
export function straightLineProblems(input: RideSummaryContractInput): readonly string[] {
  const problems: string[] = [];
  for (const [language, dictionary] of Object.entries(input.translations)) {
    const markers = STRAIGHT_LINE_MARKERS[language];
    if (markers === undefined) {
      problems.push(`${language}: لا علامةَ «خطٍّ مستقيمٍ» مُعلَنةً لهذه اللغةِ — القاعدةُ لا تُقاسُ.`);
      continue;
    }
    for (const key of prefixedKeys(dictionary)) {
      const value = dictionary[key] ?? "";
      // نطاقُ `travelledTrace.` يُصرِّحُ بالأثرِ المسجَّلِ لا بالخطِّ المستقيمِ —
      // وحدَهُ يَحكُمُه التصريحَ (القاعدةُ التاسعةُ)، فههنا يُستثنى لا يُنسى.
      if (key.startsWith(TRAVELLED_TRACE_KEY_PREFIX)) continue;
      const carriesDistance = DISTANCE_PLACEHOLDERS.some((token) => value.includes(token));
      // العلامةُ تُقابَلُ **بلا حسابِ حالةِ الحرفِ**: «Straight-line» في صدرِ
      // جملةٍ إنجليزيّةٍ هيَ العلامةُ نفسُها، وحاجزٌ يُسقِطُها لِحرفٍ كبيرٍ
      // يُدفَعُ إلى تغييرِ النصِّ إرضاءً له لا صدقاً.
      const declares = markers.some((marker) => value.toLowerCase().includes(marker.toLowerCase()));
      if (carriesDistance && !declares) {
        problems.push(
          `${language}:${key}: نصٌّ يحملُ رقمَ مسافةٍ ولا يُصرِّحُ بأنَّه وترُ خطٍّ مستقيمٍ — ` +
            `والقاعدةُ لا تحفظُ أثرَ مسارٍ، فالرقمُ وحدَه ادّعاءٌ.`,
        );
      }
      // نطاقُ `travelledTrace.` مسارٌ مبنيٌّ (`ADR 0208`): ألفاظُ القطعِ فيهِ
      // مسموحةٌ (وسيُطالِبُه التصريحُ بالأثرِ في القاعدةِ التاسعةِ)، وخارجَهُ
      // محظورةٌ كما كانت — نقلٌ لا حذفٌ.
      if (!key.startsWith(TRAVELLED_TRACE_KEY_PREFIX)) {
        problems.push(
          ...tokenProblems(
            `${language}:${key}`,
            value,
            TRAVELLED_TOKENS,
            "نصٌّ يُسمّي الوترَ مسافةً مقطوعةً",
          ),
        );
      }
    }
  }
  for (const [path, source] of Object.entries(input.surface)) {
    problems.push(
      ...tokenProblems(
        path,
        // الاستثناءُ نفسُه في الشِفرةِ: `travelledTrace` معرِّفُ المسارِ المبنيِّ،
        // فتُمحى مواضعُه قبلَ الفحصِ لا أن يُمحى اللفظُ من المعجمِ.
        source.replace(/travelled[\s_-]*trace/gi, ""),
        TRAVELLED_TOKENS,
        "شِفرةُ السطحِ تذكرُ قطعَ مسافةٍ لا تُقاسُ",
      ),
    );
  }
  const keys = [...input.view.matchAll(/"(rider\.summary\.[A-Za-z0-9._]+)"/g)].map(
    (match) => match[1] ?? "",
  );
  for (const key of keys) {
    if (!/meters|kilometers/i.test(key)) continue;
    // نطاقانِ مسموحانِ لمفاتيحِ المسافةِ: الوترُ (تصريحُ الخطِّ المستقيمِ) والأثرُ
    // المسجَّلُ (تصريحُ الأثرِ — القاعدةُ التاسعةُ) — وكلاهما اسمٌ حاملُ قيدٍ.
    if (
      !key.startsWith(`${KEY_PREFIX}straightLine.`) &&
      !key.startsWith(TRAVELLED_TRACE_KEY_PREFIX)
    ) {
      problems.push(
        `${VIEW_FILE}: مفتاحُ مسافةٍ «${key}» لا يقعُ تحتَ «${KEY_PREFIX}straightLine.» ` +
          `ولا «${TRAVELLED_TRACE_KEY_PREFIX}» — والاسمُ نفسُه حاملُ القيدِ.`,
      );
    }
  }
  return problems;
}

/** يستخرجُ نصوصاً مُفرَدةَ الاقتباسِ من كتلةِ `array[...]` الأولى بعدَ موضعٍ. */
export function sqlTagVocabularies(sql: string): readonly (readonly string[])[] {
  const found: string[][] = [];
  for (const match of sql.matchAll(/<@\s*array\s*\[([^\]]*)\]/g)) {
    const body = match[1] ?? "";
    const tags = [...body.matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1] ?? "");
    if (tags.length > 0) found.push(tags);
  }
  return found;
}

/** يستخرجُ `RATING_TAGS` من مِلفِّ النطاقِ بترتيبِها. */
export function domainTagVocabulary(domain: string): readonly string[] {
  const match = domain.match(/RATING_TAGS\s*=\s*\[([^\]]*)\]/);
  if (match === null) return [];
  return [...(match[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((entry) => entry[1] ?? "");
}

/** القاعدة ٣ — مُعجَمُ الوسومِ واحدٌ حرفاً وترتيباً بينَ النطاقِ والهجرةِ. */
export function tagLexiconProblems(input: RideSummaryContractInput): readonly string[] {
  const problems: string[] = [];
  const domainTags = domainTagVocabulary(input.domain);
  if (domainTags.length === 0) {
    problems.push(`${DOMAIN_FILE}: لم تُقرأْ «RATING_TAGS» — القاعدةُ لا تمرُّ بقائمةٍ فارغةٍ.`);
    return problems;
  }
  const vocabularies = sqlTagVocabularies(input.sql);
  if (vocabularies.length === 0) {
    problems.push(
      `${SUMMARY_SQL_FILE}: لم يُقرأْ مُعجَمُ وسومٍ واحدٌ في الهجرةِ — والقاعدةُ لا تمرُّ بقائمةٍ فارغةٍ.`,
    );
    return problems;
  }
  for (const [index, vocabulary] of vocabularies.entries()) {
    if (vocabulary.join(",") !== domainTags.join(",")) {
      problems.push(
        `${SUMMARY_SQL_FILE}: المُعجَمُ رقمُ ${index + 1} «${vocabulary.join(", ")}» ` +
          `يفترقُ عن مُعجَمِ النطاقِ «${domainTags.join(", ")}».`,
      );
    }
  }
  for (const tag of domainTags) {
    for (const [language, dictionary] of Object.entries(input.translations)) {
      if (!(`${KEY_PREFIX}tag.${tag}` in dictionary)) {
        problems.push(`${language}: وسمٌ بلا نصٍّ «${KEY_PREFIX}tag.${tag}».`);
      }
    }
  }
  return problems;
}

/** يستخرجُ مفاتيحَ `rider.summary.` المُنادَاةَ في السطحِ نصّاً حرفيّاً. */
export function usedKeys(surface: Readonly<Record<string, string>>): ReadonlySet<string> {
  const pattern = /"(rider\.summary\.[A-Za-z0-9._]+)"/g;
  const keys = new Set<string>();
  for (const source of Object.values(surface)) {
    for (const match of source.matchAll(pattern)) {
      const key = match[1];
      if (key !== undefined) keys.add(key);
    }
  }
  return keys;
}

/** القاعدة ٤ — مجموعةُ المفاتيحِ واحدةٌ في الثلاثةِ، وكلُّ مُنادًى موجودٌ. */
export function keyParityProblems(input: RideSummaryContractInput): readonly string[] {
  const problems: string[] = [];
  const sets = new Map<string, ReadonlySet<string>>();
  for (const [language, dictionary] of Object.entries(input.translations)) {
    sets.set(language, new Set(prefixedKeys(dictionary)));
  }
  const languages = [...sets.keys()].sort();
  const reference = languages[0];
  if (reference === undefined) return ["لا قاموسَ مقروءاً: الحاجزُ لا يقيسُ فراغاً."];
  const referenceSet = sets.get(reference) as ReadonlySet<string>;
  if (referenceSet.size === 0) {
    problems.push(`${reference}: لا مفتاحَ بالبادئةِ «${KEY_PREFIX}» — الحاجزُ لا يقيسُ فراغاً.`);
  }
  for (const language of languages.slice(1)) {
    const other = sets.get(language) as ReadonlySet<string>;
    for (const key of referenceSet) {
      if (!other.has(key)) problems.push(`${language}: مفتاحٌ ناقصٌ «${key}».`);
    }
    for (const key of other) {
      if (!referenceSet.has(key)) problems.push(`${reference}: مفتاحٌ ناقصٌ «${key}».`);
    }
  }
  for (const key of usedKeys(input.surface)) {
    for (const [language, dictionary] of Object.entries(input.translations)) {
      if (!(key in dictionary)) {
        problems.push(`${language}: مفتاحٌ يُنادى في السطحِ وليسَ في القاموسِ «${key}».`);
      }
    }
  }
  return problems;
}

/** القاعدة ٥ — لا زرَّ لمسارٍ لم يُبنَ. */
export function unbuiltPathProblems(input: RideSummaryContractInput): readonly string[] {
  const problems: string[] = [];
  for (const [path, source] of Object.entries(input.surface)) {
    problems.push(...tokenProblems(path, source, UNBUILT_PATH_TOKENS, "السطحُ يذكرُ مساراً لم يُبنَ"));
  }
  for (const [language, dictionary] of Object.entries(input.translations)) {
    for (const key of prefixedKeys(dictionary)) {
      problems.push(
        ...tokenProblems(`${language}:${key}`, key, UNBUILT_PATH_TOKENS, "مفتاحٌ لمسارٍ لم يُبنَ"),
        ...tokenProblems(
          `${language}:${key}`,
          key,
          SOS_BUILT_PATH_TOKENS,
          "مفتاحُ استغاثةٍ في نطاقِ الملخصِ — موضعه «rider.sos.» (`PD-020`)",
        ),
      );
    }
  }
  return problems;
}

/**
 * القاعدةُ السابعةُ (`PD-020`) — **مدخلُ الاستغاثةِ يُركّبُ فعلاً**.
 *
 * عينُ حكمِ القاعدةِ الثامنةِ في `active-ride-contract.ts` لسببٍ أثقلَ في الشاشاتِ
 * اللاحقةِ: مَن أنجزَ رحلةً للتوِّ لا يزالُ أقربَ الناسِ إلى الحاجةِ للسلامةِ
 * (نافذةُ ما بعدَ الرحلةِ)، ولو حُذِفَ المدخلُ من شاشةِ الملخصِ لَصارَ مسارُ
 * `PD-020` شِفرةً ميتةً تُحسَبُ إنجازاً — والغيابُ لا يُكتشَفُ إلّا في CI أو
 * على راكبٍ يحتاجُهُ.
 */
export function sosEntryProblems(input: RideSummaryContractInput): readonly string[] {
  const screen = input.surface[SCREEN_FILE] ?? "";
  const problems: string[] = [];
  if (!screen.includes(`<${SOS_ENTRY_COMPONENT}`)) {
    problems.push(
      `${SCREEN_FILE}: مدخلُ الاستغاثةِ «${SOS_ENTRY_COMPONENT}» غيرُ مُركَّبٍ — ` +
        `مسارُ \`PD-020\` مبنيٌّ ولا بابَ لهُ في شاشةِ الملخصِ.`,
    );
  }
  if (!screen.includes("onOpenSos")) {
    problems.push(`${SCREEN_FILE}: الشاشةُ لا تُمرّرُ «onOpenSos» — مدخلٌ بلا بابٍ يفتحُهُ.`);
  }
  return problems;
}

/**
 * القاعدةُ الثامنةُ (`SR-08` · 2026-09-28 · زيادةٌ `ح-8`) — **«الإبلاغُ عن مشكلةٍ»
 * موصولٌ فعلاً لا مُعلَنٌ**.
 *
 * كانَ غيابُه مُصرَّحاً لأنَّ مسارَ التذكرةِ لم يُبنَ؛ ثمَّ بُنيَ (`F2-12` ·
 * `ADR 0114`) وصارَ يُفتَحُ من تفاصيلِ السجلِّ، فبقيَ الغيابُ ههنا **نقصاً**
 * في نصِّ `SR-08` نفسِه. والقاعدةُ الخامسةُ **لم تُخفَّفْ**: السطحُ لا يذكرُ
 * تذكرةً ولا دعماً ولا شكوى — يرفعُ النيّةَ وحدَها، والموجِّهُ يفتحُ السطحَ
 * الذي يملكُ تلك الكلماتِ. وما تقيسُه هذه القاعدةُ أربعةُ أشياءَ لكلٍّ سالبةٌ:
 *   ــ الشاشةُ تقبلُ `onReportProblem?` (اختياريّاً — فلا زرَّ بلا مُستقبِلٍ).
 *   ــ الزرُّ **مشروطٌ** بالمُستقبِلِ (`onReportProblem === undefined`).
 *   ــ نصُّه بمفتاحِ هذا السطحِ `rider.summary.reportProblem`.
 *   ــ الموجِّهُ يُوصِلُه **بالرحلةِ الملخَّصةِ**: `setSupport({ orderId: summarized })`
 *      — لا شكوى عامّةً تُفقِدُ الربطَ، ولا حقلَ معرّفٍ يُملأُ بيدٍ.
 */
export function reportEntryProblems(input: RideSummaryContractInput): readonly string[] {
  const screen = input.surface[SCREEN_FILE] ?? "";
  const problems: string[] = [];
  if (!/onReportProblem\?\s*:/.test(screen)) {
    problems.push(
      `${SCREEN_FILE}: الشاشةُ لا تقبلُ «onReportProblem?» — «الإبلاغُ عن مشكلةٍ» (\`SR-08\`) بلا بابٍ.`,
    );
  }
  if (!screen.includes("onReportProblem === undefined")) {
    problems.push(`${SCREEN_FILE}: زرُّ الإبلاغِ غيرُ مشروطٍ بمُستقبِلٍ — زرٌّ بلا مسارٍ وعدٌ لا عقدٌ.`);
  }
  if (!screen.includes(`"${REPORT_PROBLEM_KEY}"`)) {
    problems.push(`${SCREEN_FILE}: زرُّ الإبلاغِ لا يُنادي «${REPORT_PROBLEM_KEY}».`);
  }
  if (!REPORT_PROBLEM_WIRING.test(input.root)) {
    problems.push(
      `${ROOT_FILE}: الموجِّهُ لا يُوصِلُ «onReportProblem» بسطحِ الدعمِ حاملاً الرحلةَ الملخَّصةَ ` +
        `(\`setSupport({ orderId: summarized })\`).`,
    );
  }
  return problems;
}

/** الأدوارُ التي لا يجوزُ أن تُنفِّذَ دالّةً من دوالِّنا. */
export const REVOKED_ROLES: readonly string[] = ["public", "anon", "authenticated"];

/**
 * القاعدة ٦ — كلُّ دالّةٍ تُنشِئُها الهجرةُ يُنزَعُ تنفيذُها عن الأدوارِ الثلاثةِ
 * **مُسمّاةً**. والاسمُ يُقرأُ معَ بادئةِ المخطَّطِ ودونَها: `public.fn` و`fn`
 * دالّةٌ واحدةٌ، وحاجزٌ يُخدَعُ ببادئةٍ لا يحجُزُ.
 */
export function functionRevokeProblems(input: RideSummaryContractInput): readonly string[] {
  const problems: string[] = [];
  const sql = input.sql.toLowerCase().replace(/\s+/g, " ");
  const created = [
    ...sql.matchAll(/create (?:or replace )?function (?:public\.)?([a-z0-9_]+)\s*\(/g),
  ].map((match) => match[1] ?? "");
  if (created.length === 0) {
    problems.push(
      `${SUMMARY_SQL_FILE}: لم تُقرأْ دالّةٌ واحدةٌ في الهجرةِ — القاعدةُ لا تمرُّ بقائمةٍ فارغةٍ.`,
    );
    return problems;
  }
  for (const name of new Set(created)) {
    const pattern = new RegExp(
      `revoke execute on function (?:public\\.)?${name}\\s*\\([^)]*\\) from ([^;]+);`,
    );
    const match = sql.match(pattern);
    if (match === null) {
      problems.push(
        `${SUMMARY_SQL_FILE}: الهجرةُ تُنشئُ «${name}» ولا تنزعُ تنفيذَها — ` +
          `و«public» يُمنَحُ التنفيذَ تلقائيّاً فتصيرُ الدالّةُ منالاً للمفتاحِ العامِّ.`,
      );
      continue;
    }
    const roles = match[1] ?? "";
    for (const role of REVOKED_ROLES) {
      if (!roles.includes(role)) {
        problems.push(
          `${SUMMARY_SQL_FILE}: نزعُ تنفيذِ «${name}» لا يذكرُ الدورَ «${role}» — نزعٌ ناقصٌ بابٌ مفتوحٌ.`,
        );
      }
    }
  }
  return problems;
}

/** مِلفُّ الشاشةِ — يُفحَصُ تركيبُ سطرِ الأثرِ فيها (`ADR 0208`). */
export const TRACE_SCREEN_FILE = "apps/miniapp/src/surfaces/rider/summary/RideSummaryScreen.tsx";

/**
 * القاعدةُ التاسعةُ (`ADR 0208` · 2026-09-28 · زيادةٌ `ح-8`) — **مسافةُ الأثرِ
 * المسجَّلِ تُصرِّحُ بأثرِها وترسَمُ فعلاً**.
 *
 *   ــ كلُّ نصٍّ في نطاقِ `rider.summary.travelledTrace.` يحملُ رقمَ مسافةٍ
 *      (`{meters}`/`{kilometers}`) يُصرِّحُ بأنَّه أثرٌ مسجَّلٌ — والرقمُ وحدَهُ
 *      يُقرأُ «مسافةَ طريقٍ» فيُصدَّقُ ما لم يُقَسْ.
 *   ــ الشاشةُ تركِّبُ السطرَ فعلاً (`travelledTraceLine` و`travelled.key`):
 *      حذفُهُ يُسقِطُ البناءَ، فلا تصيرُ شِفرةُ القياسِ ميتةً تُحسَبُ إنجازاً.
 */
export function travelledTraceProblems(input: RideSummaryContractInput): readonly string[] {
  const problems: string[] = [];
  for (const [language, dictionary] of Object.entries(input.translations)) {
    const markers = TRAVELLED_TRACE_MARKERS[language];
    if (markers === undefined) {
      problems.push(`${language}: لا علامةَ «أثرٍ مسجَّلٍ» مُعلَنةً لهذه اللغةِ — القاعدةُ لا تُقاسُ.`);
      continue;
    }
    for (const key of prefixedKeys(dictionary)) {
      if (!key.startsWith(TRAVELLED_TRACE_KEY_PREFIX)) continue;
      const value = dictionary[key] ?? "";
      if (!DISTANCE_PLACEHOLDERS.some((token) => value.includes(token))) continue;
      const declares = markers.some((marker) => value.toLowerCase().includes(marker.toLowerCase()));
      if (!declares) {
        problems.push(
          `${language}:${key}: نصٌّ يحملُ رقمَ مسافةٍ في نطاقِ الأثرِ ولا يُصرِّحُ بأنَّه ` +
            `أثرٌ مسجَّلٌ (ADR 0208 §٧) — والرقمُ وحدَه ادّعاءٌ.`,
        );
      }
    }
  }
  const screen = input.surface[TRACE_SCREEN_FILE] ?? "";
  if (!screen.includes("travelledTraceLine")) {
    problems.push(
      `${TRACE_SCREEN_FILE}: الشاشةُ لا تركِّبُ سطرَ مسافةِ الأثرِ المسجَّلِ ` +
        `(«travelledTraceLine») — مسارٌ مبنيٌّ بلا بابٍ يُرسَمُ (ADR 0208).`,
    );
  }
  return problems;
}

/** الحكمُ المُجمَّعُ — القواعدُ بترتيبِها (ستٌّ ثمَّ السابعةُ `PD-020` والثامنةُ `SR-08` والتاسعةُ `ADR 0208`)، وكلُّ مشكلةٍ بموضعِها وسببِها. */
export function rideSummaryContractProblems(input: RideSummaryContractInput): readonly string[] {
  return [
    ...moneyProblems(input),
    ...straightLineProblems(input),
    ...tagLexiconProblems(input),
    ...keyParityProblems(input),
    ...unbuiltPathProblems(input),
    ...sosEntryProblems(input),
    ...reportEntryProblems(input),
    ...functionRevokeProblems(input),
    ...travelledTraceProblems(input),
  ];
}
