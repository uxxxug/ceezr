/**
 * الغرض: قواعدُ عقدِ سجلِّ الرحلاتِ وتفاصيلِ رحلةٍ — ثمانِ قواعدَ تُقاسُ على
 *   **نصِّ** المستودعِ لا على نيّةِ كاتبِه (البند `F2-08` · `SR-09` · `SR-10`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-08`.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-ride-history-contract.ts` و`tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-09` (المشاركةُ) حينَ يُبنى مسارُها فتُنقَلُ
 *   كلمتُها من المحظورِ إلى المسموحِ **بتعديلِ هذا المِلفِّ معَ مسارِها**؛
 *   و`F2-12` (تذكرةُ الدعمِ) حينَ يُوصَلُ `open_support_ticket` بسطحٍ فيُرفَعُ
 *   مفتاحُ الغيابِ المُصرَّحِ من `DECLARED_ABSENCE_KEYS` **بعدَ** أن يُبنى الزرُّ.
 *
 * ## لماذا حاجزٌ ثالثٌ وقد وُجِدَ حاجزا `UX-022` و`F2-07`
 *
 * لأنَّ كلَّ حاجزٍ يقيسُ **سطحَه** بمفاتيحِه وهجرتِه، فلو وُسِّعَ حاجزٌ لِسطحٍ
 * ثانٍ لَقُرِئَ فشلُه ولم يُعرَفْ أيُّ سطحٍ نقضَ العقدَ. **والأخطرُ** أنَّ هذا
 * السطحَ يحملُ ثلاثَ كذباتٍ لا تُوجَدُ في سواه:
 *
 *   - **الزمنُ**: سجلٌّ مُجمَّعٌ بالشهرِ. فلو صاغَ السطحُ لحظةً بساعةِ الجهازِ
 *     لَظهرَ حدثٌ تحتَ شهرٍ لم يقع فيه — **وهوَ عطبٌ لا يُخفِقُ به بناءٌ**،
 *     يراهُ راكبٌ بساعةٍ تخالفُ ساعةَ مدينتِه وحدَه.
 *   - **الترقيمُ**: صفحةٌ بإزاحةٍ (`offset`) على جدولٍ يُكتَبُ فيه أثناءَ
 *     التصفُّحِ تُكرِّرُ صفّاً وتُسقِطُ آخرَ **بلا خطأٍ ولا أثرٍ**.
 *   - **الغيابُ**: خريطةٌ وتذكرةُ دعمٍ لم يُبنَيا. وزرٌّ لهما وعدٌ مكسورٌ،
 *     وصمتٌ عنهما غيابٌ مكتومٌ. فالمطلوبُ **نصُّ غيابٍ مُصرَّحٌ** لا هذا ولا ذاك.
 *
 * ## القواعدُ الثمانُ
 *
 *   ١. **لا مالَ**: معجمُ `F2-07` نفسُه — أجرةٌ ولا إيصالَ ولا إكراميّةَ، لا في
 *      الشِّفرةِ ولا في المفاتيحِ ولا في النصوصِ الثلاثةِ (`ADR 0039` §٤ ·
 *      `DEC-11` · `م13-7`). **والمعجمُ يُستوردُ ولا يُنسَخُ** (القاعدة 0.6).
 *   ٢. **لا خريطةَ ولا مسارَ مرسومٌ، والغيابُ مُصرَّحٌ**: لا مزوِّدَ خرائطَ
 *      (`ADR 0007`) ولا أثرَ مسارٍ في المخطَّطِ، فلا اسمَ مزوِّدٍ في الشِّفرةِ ولا
 *      مستطيلَ إيهامٍ — **ويلزمُ** نصُّ غيابٍ مقروءٌ في الألسنةِ الثلاثةِ.
 *   ٣. **لا زرَّ لمسارٍ لم يُبنَ**: معجمُ `F2-07` نفسُه، **إلّا مفاتيحَ الغيابِ
 *      المُصرَّحِ المُعلَنةَ** ههنا بسببٍ ومالكٍ — وهيَ نصوصٌ تُقرأُ لا أزرارٌ
 *      تُضغَطُ، ويلزمُ أن يُناديَها السطحُ فعلاً وإلّا صارَ الاستثناءُ إسكاتاً.
 *   ٤. **لا رقمَ غيرَ مقيسٍ**: لا مدّةَ رحلةٍ ولا مسافةَ ولا إجماليَّ رحلاتٍ —
 *      لا شيءَ من ذلكَ في عقدِ هذا البندِ، ورقمٌ لا مصدرَ له يُخترَعُ في السطحِ.
 *   ٥. **لا ساعةَ جهازٍ**: لا `toLocaleDateString` ولا أخواتُها ولا
 *      `resolvedOptions` في هذا السطحِ — كلُّها تصوغُ بساعةِ الجهازِ صامتةً.
 *      والصياغةُ بمنطقةٍ **تصلُ من القاعدةِ** مُسمَّاةً في كلِّ موضعٍ.
 *   ٦. **ترقيمٌ بمفتاحٍ لا بإزاحةٍ**: لا `offset` في الهجرةِ ولا في السطحِ.
 *   ٧. **مفاتيحُ ثلاثةٌ متطابقةٌ**: مجموعةُ مفاتيحِ هذا السطحِ واحدةٌ في `ar`
 *      و`en` و`ur`، وكلُّ مفتاحٍ يُنادى في السطحِ موجودٌ في الثلاثةِ.
 *   ٨. **لا دالّةَ بلا نزعِ تنفيذٍ**: كلُّ دالّةٍ تُنشِئُها هجرةُ البندِ يُنزَعُ
 *      تنفيذُها عن `public` و`anon` و`authenticated` بالثلاثةِ مُسمّاةً.
 *
 * ## ما لا يفعلُه عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ
 *
 * - **لا يُثبِتُ أنَّ السجلَّ صادقٌ عندَ راكبٍ حقيقيٍّ**: يُثبِتُ غيابَ ثمانِ
 *   كذباتٍ مُسمَّاةٍ. وصدقُ الترقيمِ والمنطقةِ يُقاسُ على قاعدةٍ حقيقيّةٍ في
 *   `tests/integration/ride-history.test.ts` — وهذا حاجزُ نصٍّ لا حاجزُ أثرٍ.
 * - **لا يقرأُ دلالةَ الشِّفرةِ**: يقرأُ نصّاً وعلاماتٍ مُعلَنةً. فمن أرادَ
 *   الاحتيالَ عليه قدرَ، ومن أرادَ الصدقَ لم يُخطئْ سهواً — وذاكَ غرضُه.
 * - **لا يحكمُ في جودةِ الترجمةِ**: يقيسُ وجودَ المفتاحِ لا فصاحتَه.
 * - **لا يفحصُ صلاحيّاتَ قاعدةٍ حيّةٍ**: ذاكَ أثرٌ يُقاسُ بمحرِّكٍ في
 *   `tests/integration/database-privilege-surface.test.ts`.
 */

import {
  MONEY_TOKENS,
  REVOKED_ROLES,
  SOS_BUILT_PATH_TOKENS,
  SOS_ENTRY_COMPONENT,
  separateCamelCase,
  UNBUILT_PATH_TOKENS,
} from "./ride-summary-contract.ts";

/** مِلفّاتُ السطحِ المقروءةُ — مكتوبةً لا مُكتشَفةً، فزيادةُ مِلفٍّ تُزادُ ههنا. */
export const SURFACE_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/rider/history/RideHistoryScreen.tsx",
  "apps/miniapp/src/surfaces/rider/history/RideDetailScreen.tsx",
  "apps/miniapp/src/surfaces/rider/history/ride-history-view.ts",
  "apps/miniapp/src/surfaces/rider/history/ride-history-api.ts",
  "apps/miniapp/src/surfaces/rider/history/ride-history-contract.ts",
];

export const HISTORY_SQL_FILE =
  "supabase/migrations/20260914030000_f2_08_ride_history_and_event_log.sql";
export const TRANSLATION_FILES: Readonly<Record<string, string>> = {
  ar: "packages/shared/i18n/miniapp/ar.json",
  en: "packages/shared/i18n/miniapp/en.json",
  ur: "packages/shared/i18n/miniapp/ur.json",
};

/**
 * بادئاتُ مفاتيحِ هذا السطحِ. و`rider.home.history.` منها لأنَّ مدخلَ السجلِّ
 * مرسومٌ في الرئيسةِ: مفتاحٌ يُنادى ولا يُقاسُ بابٌ خلفيٌّ للنصِّ.
 */
export const KEY_PREFIXES: readonly string[] = ["rider.history.", "rider.home.history."];

/** غيابٌ مُصرَّحٌ: مفتاحُ نصٍّ يُقرأُ، بسببٍ ومالكٍ وما يرفعُه. */
export interface DeclaredAbsence {
  /** مفتاحُ النصِّ كما يُنادى في السطحِ. */
  readonly key: string;
  /** لمَ هوَ نصٌّ لا زرٌّ. */
  readonly reason: string;
  /** من يملكُ المدخلَ. */
  readonly owner: string;
  /** ما الذي يرفعُه من ههنا — بندٌ أو قرارٌ، لا رأيٌ. */
  readonly liftedBy: string;
}

/**
 * مفاتيحُ الغيابِ المُصرَّحِ — **مستثناةٌ من القاعدتَينِ ٢ و٣ وحدَهما**، ولا
 * مدخلَ ههنا بلا سببٍ ومالكٍ ورافعٍ، وإلّا صارَ السجلُّ بابَ إسكاتٍ.
 */
export const DECLARED_ABSENCE_KEYS: readonly DeclaredAbsence[] = [
  {
    key: "rider.history.detail.noMap",
    reason:
      "لا مزوِّدَ خرائطَ في المشروعِ (`ADR 0007`) ولا أثرَ مسارٍ محفوظٌ في المخطَّطِ. فرسمُ مستطيلٍ أو خطٍّ بينَ نقطتَينِ يُريهِ الراكبُ مساراً سارَه وهوَ لم يُقَسْ. والنصُّ يقولُ الغيابَ صراحةً فلا يُظَنُّ عطباً في التحميلِ.",
    owner: "منفّذ المستودع",
    liftedBy: "قرارٌ مستقبليٌّ يعتمدُ مزوِّدَ خرائطَ ويحفظُ أثرَ المسارِ",
  },
  {
    key: "rider.history.detail.noSupport",
    reason:
      "`open_support_ticket` موجودةٌ في القاعدةِ ولم يُوصَلْ لها مسارٌ ولا سطحٌ، و`SR-11` محجوزٌ للبندِ `F2-12`. فزرُّ «مشكلةٌ في هذه الرحلةِ» اليومَ زرٌّ لا يفعلُ شيئاً — وعدٌ لا عقدٌ.",
    owner: "منفّذ المستودع",
    liftedBy: "F2-12 · SR-11",
  },
];

/**
 * معجمُ الخرائطِ والمساراتِ المرسومةِ — اسمُ مزوِّدٍ أو بنيةُ رسمٍ في هذا
 * السطحِ تعني أنَّ أحداً بنى ما لا مصدرَ له.
 *
 * **وليسَ فيه `map` مُجرَّدةً عن قصدٍ**: `Array.prototype.map` تُكتَبُ في كلِّ
 * شاشةٍ تُصَيِّرُ قائمةً، فحظرُ اللفظِ يُسقِطُ البناءَ على شيءٍ ليسَ خريطةً — وحاجزٌ
 * يُسقِطُ البريءَ يُحَلَّلُ غداً بإسكاتِه كلِّه. فالمقيسُ **أسماءُ المزوِّدينَ وبنى
 * الرسمِ** وهيَ ما لا يُكتَبُ إلّا قصداً.
 */
export const MAP_TOKENS: readonly string[] = [
  "mapbox",
  "maplibre",
  "leaflet",
  "openstreetmap",
  "googlemaps",
  "staticmap",
  "tilelayer",
  "polyline",
  "geojson",
  "خريطة",
  "الخريطة",
  "خارطة",
  "مسار مرسوم",
];

/**
 * معجمُ الأرقامِ غيرِ المقيسةِ في هذا العقدِ — مدّةٌ ومسافةٌ وإجماليٌّ. ولا
 * واحدَ منها يُنشَرُ في `rider_ride_history` ولا `rider_ride_detail`، فظهورُه
 * في السطحِ معناه أنَّه حُسِبَ ههنا (`ح-5`).
 */
export const UNMEASURED_NUMBER_TOKENS: readonly string[] = [
  "duration",
  "elapsed",
  "distance",
  "meters",
  "kilometers",
  "mileage",
  "eta",
  "المدة",
  "المدّة",
  "مسافة",
  "المسافة",
  "إجمالي",
  "الإجمالي",
  "مجموع",
];

/**
 * دوالُّ الصياغةِ التي تأخذُ منطقةَ الجهازِ صامتةً — تُطابَقُ **باسمِها
 * كاملاً** لا بحدودِ كلمةٍ، فهيَ أسماءٌ لا ألفاظٌ.
 */
export const DEVICE_CLOCK_CALLS: readonly string[] = [
  "toLocaleDateString",
  "toLocaleTimeString",
  "toLocaleString",
  "resolvedOptions",
  "getTimezoneOffset",
];

/** ألفاظُ الترقيمِ بالإزاحةِ — محظورةٌ في الهجرةِ وفي السطحِ. */
export const OFFSET_PAGING_TOKENS: readonly string[] = ["offset", "page_number", "pagenumber"];

export interface RideHistoryContractInput {
  /** مِلفّاتُ السطحِ: مسارٌ ⇒ شِفرةٌ **بلا تعليقاتٍ** (التعليقُ يشرحُ المحظورَ). */
  readonly surface: Readonly<Record<string, string>>;
  /** نصُّ هجرةِ السجلِّ والتفاصيلِ كما هوَ. */
  readonly sql: string;
  /** القواميسُ الثلاثةُ مُحلَّلةً: لغةٌ ⇒ (مفتاحٌ ⇒ نصٌّ). */
  readonly translations: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

const ASCII_WORD = /^[a-z]+$/;

/**
 * الكلمةُ اللاتينيّةُ تُطابَقُ **بحدودِها** بعدَ فصلِ الحدودِ السنَّوريّةِ (عينُ
 * حكمِ `F2-07` · `UX-022`)، والعربيّةُ بالاحتواءِ لأنَّ سوابقَها تلتصقُ.
 */
export function mentions(text: string, token: string): boolean {
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
  return Object.keys(dictionary).filter((key) =>
    KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
}

/**
 * يُفرِّغُ مفاتيحَ الغيابِ المُصرَّحِ من نصٍّ قبلَ مطابقةِ معجمٍ عليه.
 *
 * ولمَ لزمَ: `"rider.history.detail.noSupport"` **نصُّ مفتاحٍ** في الشِّفرةِ،
 * فلو تُرِكَ لَقرأَه الحاجزُ ذكراً لِـ«support» فأسقطَ السطحَ على غيابٍ صرَّحَ
 * به. والتفريغُ يُبقي الطولَ كي يبقى ما حولَه مقروءاً على حالِه.
 */
export function blankDeclaredAbsences(text: string): string {
  let out = text;
  for (const absence of DECLARED_ABSENCE_KEYS) {
    out = out.split(absence.key).join(" ".repeat(absence.key.length));
  }
  return out;
}

/** يستخرجُ مفاتيحَ هذا السطحِ المُنادَاةَ نصّاً حرفيّاً. */
export function usedKeys(surface: Readonly<Record<string, string>>): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const source of Object.values(surface)) {
    for (const match of source.matchAll(/"(rider\.[A-Za-z0-9._]+)"/g)) {
      const key = match[1];
      if (key === undefined) continue;
      if (KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) keys.add(key);
    }
  }
  return keys;
}

/** القاعدة ١ — لا مالَ في السطحِ ولا في مفاتيحِه ولا في نصوصِه الثلاثةِ. */
export function moneyProblems(input: RideHistoryContractInput): readonly string[] {
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

/** القاعدة ٢ — لا خريطةَ ولا مسارَ مرسومٌ، والغيابُ مُصرَّحٌ بنصٍّ في الثلاثةِ. */
export function mapAbsenceProblems(input: RideHistoryContractInput): readonly string[] {
  const problems: string[] = [];
  for (const [path, source] of Object.entries(input.surface)) {
    problems.push(
      ...tokenProblems(
        path,
        blankDeclaredAbsences(source),
        MAP_TOKENS,
        "السطحُ يذكرُ خريطةً أو مساراً مرسوماً ولا مزوِّدَ ولا أثرَ مسارٍ",
      ),
    );
  }
  for (const [language, dictionary] of Object.entries(input.translations)) {
    if (!(`${KEY_PREFIXES[0]}detail.noMap` in dictionary)) {
      problems.push(
        `${language}: لا نصَّ لغيابِ الخريطةِ «${KEY_PREFIXES[0]}detail.noMap» — ` +
          `وغيابٌ بلا تصريحٍ يُقرأُ عطباً في التحميلِ.`,
      );
    }
  }
  return problems;
}

/** القاعدة ٣ — لا زرَّ لمسارٍ لم يُبنَ، عدا مفاتيحِ الغيابِ المُصرَّحِ. */
export function unbuiltPathProblems(input: RideHistoryContractInput): readonly string[] {
  const problems: string[] = [];
  for (const [path, source] of Object.entries(input.surface)) {
    problems.push(
      ...tokenProblems(
        path,
        blankDeclaredAbsences(source),
        UNBUILT_PATH_TOKENS,
        "السطحُ يذكرُ مساراً لم يُبنَ",
      ),
    );
  }
  const declared = new Set(DECLARED_ABSENCE_KEYS.map((absence) => absence.key));
  for (const [language, dictionary] of Object.entries(input.translations)) {
    for (const key of prefixedKeys(dictionary)) {
      if (declared.has(key)) continue;
      problems.push(
        ...tokenProblems(`${language}:${key}`, key, UNBUILT_PATH_TOKENS, "مفتاحٌ لمسارٍ لم يُبنَ"),
        ...tokenProblems(
          `${language}:${key}`,
          key,
          SOS_BUILT_PATH_TOKENS,
          "مفتاحُ استغاثةٍ في نطاقِ السجلِّ — موضعه «rider.sos.» (`PD-020`)",
        ),
      );
    }
  }
  // استثناءٌ لا يُنادى استثناءٌ مَيْتٌ يُخفي معجماً كاملاً عن القياسِ.
  const called = usedKeys(input.surface);
  for (const absence of DECLARED_ABSENCE_KEYS) {
    if (!called.has(absence.key)) {
      problems.push(
        `${absence.key}: مفتاحُ غيابٍ مُصرَّحٍ لا يُناديهِ سطحٌ — ` +
          `فالاستثناءُ يرفعُ المعجمَ عن القياسِ ولا يُعرَضُ للراكبِ نصٌّ. (${absence.liftedBy})`,
      );
    }
    for (const [language, dictionary] of Object.entries(input.translations)) {
      if (!(absence.key in dictionary)) {
        problems.push(`${language}: مفتاحُ غيابٍ مُصرَّحٍ بلا نصٍّ «${absence.key}».`);
      }
    }
  }
  return problems;
}

/** القاعدة ٤ — لا رقمَ غيرَ مقيسٍ في السطحِ ولا في مفاتيحِه. */
export function unmeasuredNumberProblems(input: RideHistoryContractInput): readonly string[] {
  const problems: string[] = [];
  for (const [path, source] of Object.entries(input.surface)) {
    problems.push(
      ...tokenProblems(
        path,
        source,
        UNMEASURED_NUMBER_TOKENS,
        "السطحُ يذكرُ رقماً لا يُنشَرُ في عقدِ هذا البندِ",
      ),
    );
  }
  for (const [language, dictionary] of Object.entries(input.translations)) {
    for (const key of prefixedKeys(dictionary)) {
      problems.push(
        ...tokenProblems(
          `${language}:${key}`,
          key,
          UNMEASURED_NUMBER_TOKENS,
          "مفتاحٌ يَعِدُ برقمٍ غيرِ مقيسٍ",
        ),
      );
    }
  }
  return problems;
}

/** القاعدة ٥ — لا ساعةَ جهازٍ: الصياغةُ بمنطقةٍ تصلُ من القاعدةِ مُسمَّاةً. */
export function deviceClockProblems(input: RideHistoryContractInput): readonly string[] {
  const problems: string[] = [];
  for (const [path, source] of Object.entries(input.surface)) {
    for (const call of DEVICE_CLOCK_CALLS) {
      if (!source.includes(call)) continue;
      problems.push(
        `${path}: «${call}» يصوغُ بساعةِ الجهازِ صامتاً — ` +
          `فيظهرُ حدثٌ تحتَ شهرٍ لم يقع فيه عندَ راكبٍ بساعةٍ تخالفُ ساعةَ مدينتِه، ولا بناءٌ يُخفِقُ به.`,
      );
    }
  }
  return problems;
}

/** القاعدة ٦ — ترقيمٌ بمفتاحٍ لا بإزاحةٍ، في الهجرةِ وفي السطحِ. */
export function offsetPagingProblems(input: RideHistoryContractInput): readonly string[] {
  const problems: string[] = [];
  const verdict = "ترقيمٌ بإزاحةٍ على جدولٍ يُكتَبُ فيه أثناءَ التصفُّحِ يُكرِّرُ صفّاً ويُسقِطُ آخرَ بلا خطأٍ";
  problems.push(...tokenProblems(HISTORY_SQL_FILE, input.sql, OFFSET_PAGING_TOKENS, verdict));
  for (const [path, source] of Object.entries(input.surface)) {
    problems.push(...tokenProblems(path, source, OFFSET_PAGING_TOKENS, verdict));
  }
  return problems;
}

/** القاعدة ٧ — مجموعةُ المفاتيحِ واحدةٌ في الثلاثةِ، وكلُّ مُنادًى موجودٌ. */
export function keyParityProblems(input: RideHistoryContractInput): readonly string[] {
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
    problems.push(`${reference}: لا مفتاحَ ببادئاتِ هذا السطحِ — الحاجزُ لا يقيسُ فراغاً.`);
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

/** القاعدة ٨ — كلُّ دالّةٍ تُنشِئُها الهجرةُ يُنزَعُ تنفيذُها عن الأدوارِ الثلاثةِ. */
export function functionRevokeProblems(input: RideHistoryContractInput): readonly string[] {
  const problems: string[] = [];
  const sql = input.sql.toLowerCase().replace(/\s+/g, " ");
  const created = [
    ...sql.matchAll(/create (?:or replace )?function (?:public\.)?([a-z0-9_]+)\s*\(/g),
  ].map((match) => match[1] ?? "");
  if (created.length === 0) {
    problems.push(
      `${HISTORY_SQL_FILE}: لم تُقرأْ دالّةٌ واحدةٌ في الهجرةِ — القاعدةُ لا تمرُّ بقائمةٍ فارغةٍ.`,
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
        `${HISTORY_SQL_FILE}: الهجرةُ تُنشئُ «${name}» ولا تنزعُ تنفيذَها — ` +
          `و«public» يُمنَحُ التنفيذَ تلقائيّاً فتصيرُ الدالّةُ منالاً للمفتاحِ العامِّ.`,
      );
      continue;
    }
    const roles = match[1] ?? "";
    for (const role of REVOKED_ROLES) {
      if (!roles.includes(role)) {
        problems.push(
          `${HISTORY_SQL_FILE}: نزعُ تنفيذِ «${name}» لا يذكرُ الدورَ «${role}» — نزعٌ ناقصٌ بابٌ مفتوحٌ.`,
        );
      }
    }
  }
  return problems;
}

/** الحكمُ المُجمَّعُ — ثمانِ قواعدَ بترتيبِها، وكلُّ مشكلةٍ بموضعِها وسببِها. */
export function rideHistoryContractProblems(input: RideHistoryContractInput): readonly string[] {
  return [
    ...moneyProblems(input),
    ...mapAbsenceProblems(input),
    ...unbuiltPathProblems(input),
    ...sosEntryProblems(input),
    ...unmeasuredNumberProblems(input),
    ...deviceClockProblems(input),
    ...offsetPagingProblems(input),
    ...keyParityProblems(input),
    ...functionRevokeProblems(input),
  ];
}

/**
 * ## إضافةُ البند `PD-020` (2026-09-20) — مدخلُ الاستغاثةِ من شاشتَي السجلِّ
 *
 * السجلُّ والتفاصيلُ من «الأسطحِ التسعةِ» التي عليها مدخلُ الاستغاثةِ (`PD-020`):
 * نافذةُ ما بعدَ الرحلةِ تُدرَكُ من التفاصيلِ كما تُدرَكُ من اللقطةِ النشطةِ.
 * فالرموزُ الخمسةُ انتقلَت من معجمِ المحظورِ في `ride-summary-contract.ts`
 * (نقلٌ لا حذفٌ · ح-2)، وحراستُها ههنا انقلبَت: المدخلُ المبنيُّ **يجبُ أن
 * يُركّبَ** في الشاشتينِ، ومَن حذفَهُ سقطَ بناؤُهُ ولا يمرُّ الحذفُ صامتاً.
 */
export const SOS_ENTRY_SCREEN_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/rider/history/RideHistoryScreen.tsx",
  "apps/miniapp/src/surfaces/rider/history/RideDetailScreen.tsx",
];

/** القاعدةُ التاسعةُ (`PD-020`) — مدخلُ الاستغاثةِ يُركّبُ في شاشتَي السجلِّ فعلاً. */
export function sosEntryProblems(input: RideHistoryContractInput): readonly string[] {
  const problems: string[] = [];
  for (const path of SOS_ENTRY_SCREEN_FILES) {
    const screen = input.surface[path] ?? "";
    if (!screen.includes(`<${SOS_ENTRY_COMPONENT}`)) {
      problems.push(
        `${path}: مدخلُ الاستغاثةِ «${SOS_ENTRY_COMPONENT}» غيرُ مُركَّبٍ — ` +
          `مسارُ \`PD-020\` مبنيٌّ ولا بابَ لهُ في هذه الشاشةِ.`,
      );
    }
    if (!screen.includes("onOpenSos")) {
      problems.push(`${path}: الشاشةُ لا تُمرّرُ «onOpenSos» — مدخلٌ بلا بابٍ يفتحُهُ.`);
    }
  }
  return problems;
}
