/**
 * الغرض: قواعدُ عقدِ بثِّ موقعِ السائقِ — **ثمانُ قواعدَ تُقاسُ على نصِّ
 *   المستودعِ** لا على نيّةِ كاتبِه (البند `F3-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-04`.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-location-broadcast-contract.ts` و`tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: أيُّ بثٍّ دوريٍّ آخرَ — القاعدةُ «المُدّةُ إعدادٌ لا
 *   ثابتٌ» والقاعدةُ «لا ساعةَ في القرارِ» عينُهما.
 * يحرسُه: tests/unit/check-location-broadcast-contract.test.ts
 * الحاكم: docs/adr/0119-a-heartbeat-needs-a-published-reason.md
 *
 * ## لِمَ حاجزٌ على نبضةٍ
 *
 * لأنَّ أربعةَ أعطابٍ ههنا **لا يُمسِكُها اختبارٌ أخضرُ**:
 *
 *   ــ **ثابتُ ثوانٍ يُدَسُّ في العميلِ**: سطرٌ واحدٌ (`?? 30`) يُلغي الإعدادَ في
 *      القاعدةِ بلا أن يسقطَ اختبارٌ، فيصيرُ ضبطُ المُشغِّلِ زينةً ويصيرُ لكلِّ
 *      إصدارٍ من التطبيقِ نبضتُه — أي **حُكمانِ في نظامٍ واحدٍ**.
 *   ــ **غيابٌ يُقرأُ صفراً**: `interval_seconds ?? 0` يجعلُ «لا تبثَّ» بثّاً
 *      متّصلاً، وهذا يُشعِلُ بطاريّةَ سائقٍ ويكتبُ صفوفاً بلا سببٍ.
 *   ــ **سببٌ يُشتَقُّ في الشاشةِ**: `status === "matched"` في العميلِ يُنشِئُ آلةَ
 *      حالاتٍ ثانيةً تتقادَمُ حينَ يُزادُ طَورٌ في القاعدةِ.
 *   ــ **تراجعٌ بلا سقفٍ**: مُضاعَفةٌ متتاليةٌ تُصيِّرُ سائقاً في رحلةٍ يبثُّ مرّةً
 *      في الساعةِ بعدَ انقطاعٍ عابرٍ — وهوَ عطبٌ صامتٌ لا يُشتكى منه.
 *
 * ## القواعدُ الثمانُ
 *
 *   ١. **الكتلةُ تُنشَرُ في الجذرِ في المسارَينِ**: في الهجرةِ عندَ وجودِ مَهمّةٍ
 *      وعندَ غيابِها، وفي البوّابةِ مفتاحاً واحداً، وفي عقدِ العميلِ نوعاً.
 *   ٢. **لا مُدّةَ مُخترَعةً**: لا ارتدادَ إلى رقمٍ ولا ثابتَ ثوانٍ في الشريحةِ.
 *   ٣. **الغيابُ لا يُقرأُ صفراً**: لا `?? 0` ولا `|| 0` على المُدّةِ، والمُهايِئُ
 *      يردُّ `MALFORMED_RESULT` عندَ كتلةٍ مُشوَّهةٍ.
 *   ٤. **القرارُ نقيٌّ**: لا ساعةَ ولا مؤقّتَ ولا شبكةَ في مِلفِّ النطاقِ.
 *   ٥. **السببُ من الخادمِ**: لا اشتقاقَ من `status` في سطحِ البثِّ.
 *   ٦. **تراجعٌ بسقفٍ وأخطاءٌ قاتلةٌ مُسمّاةٌ**: سقفٌ مُصرَّحٌ، وجلسةٌ ساقطةٌ ومَن
 *      ليسَ سائقاً يُوقِفانِ ولا يُعادانِ.
 *   ٧. **مُرسِلٌ واحدٌ إلى مسارِ `F4-01` القائمِ**: لا مسارَ استقبالٍ ثانياً.
 *   ٨. **كلُّ سببِ بثٍّ وكلُّ سببِ سكونٍ له نصُّه** في اللغاتِ الثلاثِ.
 *
 * ## وما لا يفعلُه هذا الحاجزُ عن قصدٍ — وحدودُه مُعلَنةٌ (`ح-5`)
 *
 * - **لا يقيسُ بطاريّةً ولا صدقَ موضعٍ في الميدانِ**: كلاهما غيرُ مقيسٍ ولا
 *   يُدَّعى. وما يُفرَضُ ههنا أنَّ النظامَ **لا يخترعُ نبضةً بلا سببٍ منشورٍ**.
 *   ــ **ولا يُثبِتُ أنَّ البثَّ يعملُ على جهازٍ**: ذاكَ سلوكُ مُضيفٍ لا يُقاسُ
 *      بنصٍّ، واختبارُ الوحدةِ يقيسُ الحكمَ لا المُضيفَ.
 * - **لا يحرسُ إسرافَ عميلٍ عاصٍ**: حدُّ المعدَّلِ في البوّابةِ (`F4-01`) هوَ
 *   الحاكمُ، وهذا الحاجزُ يفرضُ **تعاوناً** لا يمنعُ اعتداءً.
 * - **لا يقرأُ لفظاً في تعليقٍ**: يُغذَّى بشِفرةٍ منزوعةِ التعليقاتِ، وإلّا لَسقطَ
 *   على نثرٍ يُعلِّلُ **نفيَ** الاشتقاقِ أو **غيابَ** الثابتِ.
 */

/** أسماءُ إعداداتِ المُدَدِ الثلاثِ — **في القاعدةِ وحدَها** لا في العميلِ. */
export const SETTING_KEYS: readonly string[] = [
  "location_broadcast_seconds_available",
  "location_broadcast_seconds_matched",
  "location_broadcast_seconds_on_trip",
];

/** أسبابُ البثِّ الثلاثةُ — مجالٌ مغلقٌ يُفحَصُ في الطرفَينِ وفي النصوصِ. */
export const BROADCAST_REASONS: readonly string[] = ["AVAILABLE", "TO_PICKUP", "ON_TRIP"];

/** أسبابُ السكونِ — لكلٍّ منها نصٌّ، فسائقٌ ساكنٌ يعرفُ لِمَ سَكَنَ. */
export const STOP_REASONS: readonly string[] = [
  "NO_REASON_TO_BROADCAST",
  "INTERVAL_NOT_CONFIGURED",
  "LOCATION_UNSUPPORTED",
  "PERMISSION_NOT_GRANTED",
  "SESSION_LOST",
  "NOT_A_DRIVER",
];

/** رموزٌ لا تُصلِحُها إعادةٌ — تُوقِفُ ولا تُضاعِفُ مُهلةً. */
export const FATAL_CODES: readonly string[] = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "DRIVER_NOT_REGISTERED",
];

export const DOMAIN_FILE = "packages/domain/driver/location-broadcast.ts";
export const STORE_FILE = "packages/infrastructure/driver/driver-job-store.ts";
export const ROUTE_FILE = "apps/gateway/src/routes/driver-job.ts";
export const MIGRATION_FILE =
  "supabase/migrations/20260915120000_f3_04_location_broadcast_policy.sql";
export const RECEIVER_ROUTE_PATH = "/v1/driver/location";

/** مِلفّاتُ سطحِ البثِّ — مكتوبةً لا مُكتشَفةً بنمطٍ. */
export const SURFACE_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/driver/location/LocationBroadcast.tsx",
  "apps/miniapp/src/surfaces/driver/location/broadcast-api.ts",
];

export const CONTRACT_FILE = "apps/miniapp/src/surfaces/driver/job/job-contract.ts";

export const TRANSLATION_FILES: Readonly<Record<string, string>> = {
  ar: "packages/shared/i18n/miniapp/ar.json",
  en: "packages/shared/i18n/miniapp/en.json",
  ur: "packages/shared/i18n/miniapp/ur.json",
};

export const KEY_PREFIX = "driver.location.";

export interface LocationBroadcastContractInput {
  /** مسارٌ ⇒ شِفرةُ سطحٍ **بلا تعليقاتٍ**. */
  readonly surface: Readonly<Record<string, string>>;
  /** نصُّ النطاقِ النقيِّ **بلا تعليقاتٍ**. */
  readonly domain: string;
  /** نصُّ المُهايِئِ **بلا تعليقاتٍ**. */
  readonly store: string;
  /** نصُّ مِلفِّ مساراتِ المَهمّةِ **بلا تعليقاتٍ**. */
  readonly route: string;
  /** نصُّ عقدِ العميلِ **بلا تعليقاتٍ**. */
  readonly contract: string;
  /** نصُّ الهجرةِ **بلا تعليقاتٍ ولا أوصافِ كائناتٍ**. */
  readonly migrationSql: string;
  /** لغةٌ ⇒ قاموسٌ. */
  readonly translations: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

function surfaceText(input: LocationBroadcastContractInput): string {
  return Object.values(input.surface).join("\n");
}

/** كلُّ نصِّ الشريحةِ — للقواعدِ التي تمنعُ لفظاً في الشريحةِ كلِّها. */
function sliceText(input: LocationBroadcastContractInput): string {
  return [
    surfaceText(input),
    input.domain,
    input.store,
    input.route,
    input.contract,
    input.migrationSql,
  ].join("\n");
}

/** ١) الكتلةُ تُنشَرُ في الجذرِ في المسارَينِ، وتُقرأُ في العميلِ. */
export function publishedBlockProblems(input: LocationBroadcastContractInput): readonly string[] {
  const problems: string[] = [];

  const occurrences = input.migrationSql.split("'location_broadcast'").length - 1;
  if (occurrences < 2) {
    problems.push(
      `الهجرةُ «${MIGRATION_FILE}» تنشُرُ «location_broadcast» ${occurrences} مرّةً؛ والمَخرجانِ اثنانِ (بمَهمّةٍ وبلا مَهمّةٍ) — ومَخرجٌ بلا كتلةٍ يجعلُ سائقاً متاحاً لا يبثُّ أبداً وهوَ عطبٌ لا يُشتكى منه.`,
    );
  }
  if (input.migrationSql.includes("'job', jsonb_build_object(\n      'location_broadcast'")) {
    problems.push(
      `الكتلةُ منشورةٌ داخلَ «job» في «${MIGRATION_FILE}» — وموضعُها الجذرُ: سائقٌ متاحٌ بلا مَهمّةٍ يبثُّ، و«job = null» لا تعني «لا نبضةَ».`,
    );
  }
  for (const key of SETTING_KEYS) {
    if (!input.migrationSql.includes(key)) {
      problems.push(
        `الإعدادُ «${key}» غيرُ مبذورٍ في «${MIGRATION_FILE}» — ومُدّةٌ بلا صفٍّ في «platform_settings» تُقرأُ سكوناً فلا يبثُّ سائقٌ في تلكَ الحالِ ألبتّةَ.`,
      );
    }
  }
  if (!input.route.includes("location_broadcast")) {
    problems.push(
      `البوّابةُ «${ROUTE_FILE}» لا تنشُرُ «location_broadcast» — وحكمُ القاعدةِ لا يبلغُ العميلَ إلّا بها.`,
    );
  }
  if (!input.contract.includes("location_broadcast")) {
    problems.push(
      `عقدُ العميلِ «${CONTRACT_FILE}» لا يصفُ «location_broadcast» — وحقلٌ يُنشَرُ ولا يُوصَفُ يُقرأُ بالتخمينِ.`,
    );
  }
  if (!input.contract.includes("interval_seconds")) {
    problems.push(
      `عقدُ العميلِ «${CONTRACT_FILE}» لا يصفُ «interval_seconds» — والمُدّةُ هيَ الحكمُ، ولا ختمَ انتهاءٍ يُطرَحُ بساعةِ جهازٍ.`,
    );
  }
  if (input.route.includes("expires_at") || surfaceText(input).includes("expires_at")) {
    problems.push(
      `«expires_at» في البثِّ يجعلُ ساعةَ الجهازِ حَكَماً — والمنشورُ مُدّةٌ (interval_seconds) لا ختمُ انتهاءٍ.`,
    );
  }
  return problems;
}

/**
 * رقمُ ثوانٍ يُدَسُّ في العميلِ. **والفحصُ سطريٌّ لا موضعيٌّ**: `interval ?? 30`
 * و`const intervalSeconds = published ?? 30` فسادُهما واحدٌ، ومَن فحصَ الجارَ
 * المُباشِرَ للمُعامِلِ وحدَه يُفلِتُ الثانيَ بمُتغيِّرٍ وسيطٍ.
 */
const NUMERIC_FALLBACK = /(\?\?|\|\|)\s*-?\d/;

function intervalLinesWith(code: string, pattern: RegExp): readonly string[] {
  return code.split("\n").filter((line) => /interval|delay/i.test(line) && pattern.test(line));
}

/** ٢) لا مُدّةَ مُخترَعةً في العميلِ ولا في النطاقِ. */
export function inventedIntervalProblems(input: LocationBroadcastContractInput): readonly string[] {
  const problems: string[] = [];
  for (const [path, code] of Object.entries(input.surface)) {
    if (intervalLinesWith(code, NUMERIC_FALLBACK).length > 0) {
      problems.push(
        `«${path}» يرتدُّ بالمُدّةِ إلى رقمٍ مكتوبٍ — وثابتُ ثوانٍ في العميلِ يُلغي إعدادَ المدينةِ ويجعلُ لكلِّ إصدارٍ نبضتَه، أي حُكمَينِ في نظامٍ واحدٍ.`,
      );
    }
    for (const key of SETTING_KEYS) {
      if (code.includes(key)) {
        problems.push(
          `«${path}» يذكرُ اسمَ الإعدادِ «${key}» — أسماءُ الإعداداتِ تُقرأُ في القاعدةِ وحدَها، وعميلٌ يعرفُها يوشكُ أن يقرأَها بنفسِه ويصيرَ مصدرَ حقيقةٍ ثانياً.`,
        );
      }
    }
  }
  if (intervalLinesWith(input.domain, NUMERIC_FALLBACK).length > 0) {
    problems.push(
      `«${DOMAIN_FILE}» يرتدُّ بالمُدّةِ إلى رقمٍ — والغيابُ في هذا النطاقِ يُطاعُ سكوناً لا يُكمَّلُ بافتراضٍ.`,
    );
  }
  return problems;
}

/** ٣) الغيابُ لا يُقرأُ صفراً، والكتلةُ المُشوَّهةُ تُسقِطُ القراءةَ. */
export function absenceHonestyProblems(input: LocationBroadcastContractInput): readonly string[] {
  const problems: string[] = [];
  const text = sliceText(input);
  if (intervalLinesWith(text, /(\?\?|\|\|)\s*0\b/).length > 0) {
    problems.push(
      `المُدّةُ تُرتَدُّ إلى صفرٍ في الشريحةِ — وصفرٌ يُقرأُ «بثّاً متّصلاً» لا «لا تبثَّ»، فيصيرُ الغيابُ أعلى كلفةً من الحضورِ («ADR 0023»).`,
    );
  }
  if (!input.store.includes("MALFORMED_RESULT") || !input.store.includes("readBroadcastPolicy")) {
    problems.push(
      `المُهايِئُ «${STORE_FILE}» لا يتحقّقُ من الكتلةِ ويردُّ «MALFORMED_RESULT» — وكتلةٌ مُشوَّهةٌ تُقرأُ «لا تبثَّ» تُسكِتُ البثَّ كلَّه بلا أن يُلاحَظَ.`,
    );
  }
  if (!input.migrationSql.includes("'interval_seconds', null")) {
    problems.push(
      `الهجرةُ «${MIGRATION_FILE}» لا تنشُرُ «interval_seconds» عَدَماً في حالٍ واحدةٍ على الأقلِّ — وإعدادٌ غائبٌ يجبُ أن يُقرأَ سكوناً مُعلَناً (فشلٌ مغلقٌ) لا مُدّةً مُخترَعةً.`,
    );
  }
  return problems;
}

/** ٤) القرارُ نقيٌّ: لا ساعةَ ولا مؤقّتَ ولا شبكةَ في النطاقِ. */
export function purityProblems(input: LocationBroadcastContractInput): readonly string[] {
  const banned = ["Date.now", "new Date(", "setTimeout", "setInterval", "fetch(", "navigator."];
  const problems: string[] = [];
  for (const token of banned) {
    if (input.domain.includes(token)) {
      problems.push(
        `«${DOMAIN_FILE}» يستعملُ «${token}» — وقرارُ النبضةِ يجبُ أن يكونَ دالّةً نقيّةً: حالٌ خفيٌّ فيه يجعلُ التراجعَ وسقفَه غيرَ مقيسَينِ إلّا بمُهلٍ حقيقيّةٍ تُصنَّفُ «متقطّعةً» ثمَّ تُسكَتُ.`,
      );
    }
  }
  return problems;
}

/** ٥) السببُ من الخادمِ لا من مقارنةِ حالةٍ في الشاشةِ. */
export function reasonSourceProblems(input: LocationBroadcastContractInput): readonly string[] {
  const problems: string[] = [];
  for (const [path, code] of Object.entries(input.surface)) {
    if (/status\s*===/.test(code)) {
      problems.push(
        `«${path}» يقارنُ «status» — والسببُ حكمُ الخادمِ (reason)، ومقارنةٌ ههنا تُنشِئُ آلةَ حالاتٍ ثانيةً تتقادَمُ حينَ يُزادُ طَورٌ في القاعدةِ.`,
      );
    }
    if (/(in_progress|"matched")/.test(code)) {
      problems.push(
        `«${path}» يذكرُ حالةَ طلبٍ حرفاً — سطحُ البثِّ يقرأُ السببَ ولا يعرفُ حالاتِ الطلبِ ألبتّةَ.`,
      );
    }
  }
  for (const reason of BROADCAST_REASONS) {
    if (!input.migrationSql.includes(`'${reason}'`)) {
      problems.push(
        `السببُ «${reason}» غيرُ منشورٍ من الهجرةِ «${MIGRATION_FILE}» — وسببٌ يعرفُه العميلُ ولا تقولُه القاعدةُ سببٌ مُشتَقٌّ في المكانِ الخطأِ.`,
      );
    }
  }
  return problems;
}

/** ٦) تراجعٌ بسقفٍ، وأخطاءٌ قاتلةٌ تُوقِفُ ولا تُعادُ. */
export function backoffProblems(input: LocationBroadcastContractInput): readonly string[] {
  const problems: string[] = [];
  if (!input.domain.includes("MAX_BACKOFF_DOUBLINGS") || !input.domain.includes("Math.min")) {
    problems.push(
      `«${DOMAIN_FILE}» بلا سقفٍ مُصرَّحٍ للتراجعِ — ومُضاعَفةٌ بلا حدٍّ تُصيِّرُ سائقاً في رحلةٍ يبثُّ مرّةً في الساعةِ بعدَ انقطاعٍ عابرٍ.`,
    );
  }
  for (const code of FATAL_CODES) {
    if (!input.domain.includes(code)) {
      problems.push(
        `الرمزُ القاتلُ «${code}» غيرُ مذكورٍ في «${DOMAIN_FILE}» — وإعادةُ المحاولةِ عليه تكتبُ سجلَّ فشلٍ أبديّاً ولا تُصلِحُ شيئاً.`,
      );
    }
  }
  if (!input.domain.includes("STOP")) {
    problems.push(`«${DOMAIN_FILE}» لا يُصدِرُ حكمَ «STOP» — وسكونٌ لا يُقالُ حكماً يُقرأُ انتظاراً أبديّاً.`);
  }
  return problems;
}

/** ٧) مُرسِلٌ واحدٌ إلى مسارِ `F4-01` القائمِ، ولا مسارَ استقبالٍ ثانياً. */
export function singleSenderProblems(input: LocationBroadcastContractInput): readonly string[] {
  const problems: string[] = [];
  const text = surfaceText(input);
  const senders = text.split("apiFetch<").length - 1;
  if (senders !== 1) {
    problems.push(
      `سطحُ البثِّ فيه ${senders} مُرسِلاً — والمُرسِلُ واحدٌ إلى «${RECEIVER_ROUTE_PATH}»: مُرسِلانِ يعنيانِ نبضتَينِ بمُدّتَينِ وحدَّ معدَّلٍ يُستهلَكُ مرّتَينِ.`,
    );
  }
  if (!text.includes(RECEIVER_ROUTE_PATH)) {
    problems.push(
      `سطحُ البثِّ لا يُرسِلُ إلى «${RECEIVER_ROUTE_PATH}» — والمُستقبِلُ قائمٌ من «F4-01» بحدِّ معدَّلٍ وحُكمٍ، ومسارٌ ثانٍ يعنى كاتبَينِ للموقعِ.`,
    );
  }
  const otherLocationRoute = /"\/v1\/driver\/(?!location")[a-z-]*location/i;
  if (otherLocationRoute.test(text)) {
    problems.push(`سطحُ البثِّ يذكرُ مسارَ موقعٍ آخرَ — ولا يُخترَعُ مُستقبِلٌ ثانٍ لموقعِ السائقِ.`);
  }
  return problems;
}

/** ٨) كلُّ سببِ بثٍّ وسكونٍ له نصُّه في اللغاتِ الثلاثِ. */
export function textCoverageProblems(input: LocationBroadcastContractInput): readonly string[] {
  const problems: string[] = [];
  const required = [
    `${KEY_PREFIX}on`,
    `${KEY_PREFIX}onEvery`,
    `${KEY_PREFIX}openSettings`,
    ...BROADCAST_REASONS.map((reason) => `${KEY_PREFIX}reason.${reason}`),
    ...STOP_REASONS.map((why) => `${KEY_PREFIX}stop.${why}`),
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
  if (!(arabic[`${KEY_PREFIX}onEvery`] ?? "").includes("{seconds}")) {
    problems.push(
      `نصُّ «${KEY_PREFIX}onEvery» بلا «{seconds}» — والمُدّةُ المنشورةُ تُقالُ للسائقِ رقماً، وإلّا صارَ الإعلانُ عن البثِّ بلا مقدارٍ.`,
    );
  }
  for (const why of STOP_REASONS) {
    if (!surfaceText(input).includes(why) && !input.domain.includes(why)) {
      problems.push(
        `سببُ السكونِ «${why}» لا يظهرُ في السطحِ ولا في النطاقِ — وسببٌ له نصٌّ ولا يُصدِرُه حُكمٌ نصٌّ ميْتٌ يُوهِمُ تغطيةً.`,
      );
    }
  }
  return problems;
}

export function locationBroadcastContractProblems(
  input: LocationBroadcastContractInput,
): readonly string[] {
  return [
    ...publishedBlockProblems(input),
    ...inventedIntervalProblems(input),
    ...absenceHonestyProblems(input),
    ...purityProblems(input),
    ...reasonSourceProblems(input),
    ...backoffProblems(input),
    ...singleSenderProblems(input),
    ...textCoverageProblems(input),
  ];
}
