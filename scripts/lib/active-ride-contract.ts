/**
 * الغرض: قواعدُ عقدِ شاشةِ الرحلةِ النشطةِ — خمسُ قواعدَ تُقاسُ على نصِّ
 *   المستودعِ لا على نيّةِ كاتبِه (البند `F2-06` · الحاجز `UX-022`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-06`.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-active-ride-contract.ts` و`tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-07` (الإنهاءُ والتقييمُ) و`F2-09` و`F2-10`
 *   حينَ تُبنى مساراتُ المشاركةِ والطوارئِ فتُنقَلُ كلماتُها من المحظورِ إلى
 *   المسموحِ **بتعديلِ هذا المِلفِّ معَ مسارِها** لا بإسكاتِ الحاجزِ.
 *
 * ## لماذا حاجزٌ على شاشةٍ واحدةٍ
 *
 * هذه الشاشةُ هيَ الموضعُ الذي **يُغري** بالكذبِ الصغيرِ: سعرٌ «تقديريٌّ»
 * يُطمئِنُ، ونقطةٌ على خريطةٍ بلا عُمرٍ تبدو حيّةً، وزرُّ طوارئَ يُشعِرُ بالأمانِ
 * ولو لم يكنْ موصولاً. وكلُّ واحدةٍ من هذه تُكتَبُ بحسنِ نيّةٍ في سطرٍ واحدٍ،
 * ولا تُكتشَفُ في مراجعةٍ بشريّةٍ إلّا بحظٍّ. فالقواعدُ الخمسُ مكتوبةٌ ههنا
 * ومقيسةٌ في CI، ونقضُها **يُسقِطُ البناءَ** لا يُسجَّلُ ملاحظةً.
 *
 * ## القواعدُ الخمسُ
 *
 *   ١. **لا مالَ**: لا سعرَ ولا أجرةَ ولا عقوبةَ إلغاءٍ في شِفرةِ السطحِ ولا في
 *      مفاتيحِه ولا في نصوصِه الثلاثةِ (`ADR 0039` §٤ · `DEC-11` · `م13-7`).
 *      وحتّى بنيةٌ فارغةٌ للسعرِ محظورةٌ: حقلٌ فارغٌ اليومَ يُملأُ غداً بلا قرارٍ.
 *   ٢. **لا سائقَ بلا إسنادٍ**: لقطةُ القاعدةِ لا تبنيَ كتلةَ السائقِ إلّا داخلَ
 *      شرطٍ يفحصُ `assigned_driver_id`، والحقلُ **قابلٌ للعدمِ** في العقدِ
 *      والمنفذِ، والشاشةُ تفحصُ عدمَه صراحةً قبلَ رسمِه.
 *   ٣. **لا موضعَ بلا عُمرِه**: كلُّ طبقةٍ تنشرُ إحداثيّةً تنشرُ عُمرَها معَها —
 *      القاعدةُ والعقدُ والشاشةُ والقواميسُ (`BUG-001`).
 *   ٤. **مفاتيحُ ثلاثةٌ متطابقةٌ**: مجموعةُ مفاتيحِ `rider.active.` واحدةٌ في
 *      `ar` و`en` و`ur`، وكلُّ مفتاحٍ يُنادى في السطحِ موجودٌ في الثلاثةِ.
 *   ٥. **لا زرَّ لمسارٍ لم يُبنَ**: لا طوارئَ ولا مشاركةَ ولا اتّصالَ في هذا
 *      السطحِ — مساراتُها `F2-10` و`F2-09`، وزرٌّ لا يفعلُ شيئاً في لحظةِ خطرٍ
 *      أسوأُ من غيابِه.
 *
 * ## ما لا يفعلُه عن قصدٍ — وحدودُه مُعلَنةٌ
 *
 * - **لا يُثبِتُ أنَّ الشاشةَ صادقةٌ عندَ راكبٍ حقيقيٍّ**: يُثبِتُ غيابَ خمسِ
 *   كذباتٍ مُسمَّاةٍ. والتجربةُ الميدانيّةُ بوّابةُ `F2` ولا يُدّعى بلوغُها.
 * - **لا يقرأُ دلالةَ الشِّفرةِ**: يقرأُ نصّاً وعلاماتٍ مُعلَنةً. فمن أرادَ
 *   الاحتيالَ عليه قدرَ، ومن أرادَ الصدقَ لم يُخطئْ سهواً — وذاكَ غرضُه.
 * - **لا يحكمُ في الشكلِ ولا في الوصولِيّةِ**: التغطيةُ النمطيّةُ حاجزُ `UX-021`،
 *   والتباينُ والقارئُ غيرُ مقيسَينِ بعدُ (دَينٌ مُعلَنٌ).
 */

/** مِلفّاتُ السطحِ المقروءةُ — مكتوبةً لا مُكتشَفةً، فزيادةُ مِلفٍّ تُزادُ ههنا. */
export const SURFACE_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/rider/active/ActiveRideScreen.tsx",
  "apps/miniapp/src/surfaces/rider/active/active-ride-view.ts",
  "apps/miniapp/src/surfaces/rider/active/active-ride-api.ts",
  "apps/miniapp/src/surfaces/rider/active/active-ride-contract.ts",
];

export const SNAPSHOT_SQL_FILE =
  "supabase/migrations/20260913235000_f2_06_active_ride_snapshot.sql";
export const PORTS_FILE = "packages/application/transport/active-ride-ports.ts";
export const CONTRACT_FILE = "apps/miniapp/src/surfaces/rider/active/active-ride-contract.ts";
export const SCREEN_FILE = "apps/miniapp/src/surfaces/rider/active/ActiveRideScreen.tsx";
export const TRANSLATION_FILES: Readonly<Record<string, string>> = {
  ar: "packages/shared/i18n/miniapp/ar.json",
  en: "packages/shared/i18n/miniapp/en.json",
  ur: "packages/shared/i18n/miniapp/ur.json",
};

/** بادئةُ مفاتيحِ هذا السطحِ. */
export const KEY_PREFIX = "rider.active.";

/**
 * معجمُ المالِ — إنجليزيّاً وعربيّاً. وكلمةُ «مجّاناً» ليسَت ههنا: نفيُ المالِ
 * ليسَ مالاً، و«الإلغاءُ مجّانيٌّ قبلَ الإسنادِ» حكمٌ إجرائيٌّ لا سعرٌ… إلّا أنَّ
 * صياغتَنا اختارَت «يمكنُك الإلغاءُ الآنَ» فلا تحتاجُ الكلمةَ أصلاً.
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
];

/** معجمُ المساراتِ التي لم تُبنَ — زرٌّ لها اليومَ زرٌّ كاذبٌ. */
export const UNBUILT_PATH_TOKENS: readonly string[] = [
  "sos",
  "emergency",
  "panic",
  "share",
  "whatsapp",
  "tel:",
  "callDriver",
  "طوارئ",
  "استغاثة",
  "مشاركة",
  "شارك",
  "اتصل",
  "اتّصل",
];

export interface ActiveRideContractInput {
  /** مِلفّاتُ السطحِ: مسارٌ ⇒ شِفرةٌ **بلا تعليقاتٍ** (التعليقُ يشرحُ المحظورَ). */
  readonly surface: Readonly<Record<string, string>>;
  /** نصُّ هجرةِ اللقطةِ كما هوَ. */
  readonly sql: string;
  /** نصُّ منفذِ التطبيقِ. */
  readonly ports: string;
  /** نصُّ عقدِ العميلِ. */
  readonly contract: string;
  /** نصُّ الشاشةِ **بلا تعليقاتٍ**. */
  readonly screen: string;
  /** القواميسُ الثلاثةُ مُحلَّلةً: لغةٌ ⇒ (مفتاحٌ ⇒ نصٌّ). */
  readonly translations: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

const ASCII_WORD = /^[a-z]+$/;

/**
 * الكلمةُ اللاتينيّةُ تُطابَقُ **بحدودِها** لا بالاحتواءِ: «shared» في مسارِ
 * استيرادٍ ليسَت «share» زرَّ مشاركةٍ، و«sar» ليسَت كلَّ ما فيه هذه الحروفُ.
 * ولو طُوبِقَ بالاحتواءِ لَسقطَ البناءُ على اسمِ مِلفٍّ بريءٍ فصارَ الحاجزُ عبئاً
 * يُستثنى منه — وحاجزٌ يُستثنى منه لا يحمي شيئاً.
 *
 * والعربيّةُ تُطابَقُ بالاحتواءِ: سوابقُها تلتصقُ (ال، و، بِـ)، والتشكيلُ يفصلُ
 * الحروفَ فلا يقعُ التطابقُ العَرَضيُّ الذي يقعُ في اللاتينيّةِ.
 */
function mentions(text: string, token: string): boolean {
  const lower = text.toLowerCase();
  const needle = token.toLowerCase();
  if (!ASCII_WORD.test(needle)) return lower.includes(needle);
  return new RegExp(`(?<![a-z])${needle}(?![a-z])`).test(lower);
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

/** القاعدة ١ — لا مالَ في السطحِ ولا في مفاتيحِه ولا في نصوصِه. */
export function moneyProblems(input: ActiveRideContractInput): readonly string[] {
  const problems: string[] = [];
  for (const [path, source] of Object.entries(input.surface)) {
    problems.push(...tokenProblems(path, source, MONEY_TOKENS, "شِفرةُ السطحِ تذكرُ مالاً وهوَ مُجمَّدٌ"));
  }
  for (const [language, dictionary] of Object.entries(input.translations)) {
    for (const [key, value] of Object.entries(dictionary)) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      problems.push(
        ...tokenProblems(`${language}:${key}`, key, MONEY_TOKENS, "مفتاحٌ يذكرُ مالاً"),
        ...tokenProblems(`${language}:${key}`, value, MONEY_TOKENS, "نصٌّ يذكرُ مالاً"),
      );
    }
  }
  return problems;
}

/** القاعدة ٢ — لا سائقَ بلا إسنادٍ: بالقاعدةِ والعقدِ والمنفذِ والشاشةِ. */
export function driverGateProblems(input: ActiveRideContractInput): readonly string[] {
  const problems: string[] = [];
  const sql = input.sql.toLowerCase();
  if (!sql.includes("assigned_driver_id is not null")) {
    problems.push(
      `${SNAPSHOT_SQL_FILE}: لقطةُ القاعدةِ لا تفحصُ «assigned_driver_id is not null»، فقد تنشرُ سائقاً لم يُسنَدْ.`,
    );
  }
  if (!/'driver'/.test(sql) && !/"driver"/.test(sql)) {
    problems.push(`${SNAPSHOT_SQL_FILE}: لا كتلةَ «driver» في اللقطةِ — العقدُ يَدَّعي ما لا يُنشَرُ.`);
  }
  if (!/readonly driver:[^;]*\|\s*null/.test(input.ports.replace(/\s+/g, " "))) {
    problems.push(`${PORTS_FILE}: حقلُ «driver» غيرُ قابلٍ للعدمِ في المنفذِ.`);
  }
  if (!/readonly driver:[^;]*\|\s*null/.test(input.contract.replace(/\s+/g, " "))) {
    problems.push(`${CONTRACT_FILE}: حقلُ «driver» غيرُ قابلٍ للعدمِ في العقدِ.`);
  }
  if (!input.screen.includes("view.driver === null")) {
    problems.push(`${SCREEN_FILE}: الشاشةُ لا تفحصُ «view.driver === null» صراحةً قبلَ رسمِ السائقِ.`);
  }
  return problems;
}

/** القاعدة ٣ — لا موضعَ بلا عُمرِه: في كلِّ طبقةٍ تنشرُ إحداثيّةً. */
export function positionAgeProblems(input: ActiveRideContractInput): readonly string[] {
  const problems: string[] = [];
  const sql = input.sql.toLowerCase();
  if (sql.includes("'position'") && !sql.includes("age_seconds")) {
    problems.push(`${SNAPSHOT_SQL_FILE}: اللقطةُ تنشرُ موضعاً بلا «age_seconds».`);
  }
  const contract = input.contract.replace(/\s+/g, " ");
  if (/readonly lat: number/.test(contract) && !/readonly ageSeconds: number/.test(contract)) {
    problems.push(`${CONTRACT_FILE}: العقدُ ينشرُ إحداثيّةً بلا «ageSeconds».`);
  }
  const screen = input.screen;
  if (screen.includes("ar__position-point") && !screen.includes("ar__position-age")) {
    problems.push(`${SCREEN_FILE}: الشاشةُ ترسمُ نقطةً بلا سطرِ عُمرِها.`);
  }
  for (const [language, dictionary] of Object.entries(input.translations)) {
    const hasPoint = `${KEY_PREFIX}position.point` in dictionary;
    const hasAge =
      `${KEY_PREFIX}position.ageSeconds` in dictionary &&
      `${KEY_PREFIX}position.ageMinutes` in dictionary;
    if (hasPoint && !hasAge) {
      problems.push(`${language}: نصُّ النقطةِ موجودٌ ونصُّ عُمرِها غائبٌ.`);
    }
  }
  return problems;
}

/** يستخرجُ مفاتيحَ `rider.active.` المُنادَاةَ في السطحِ نصّاً حرفيّاً. */
export function usedKeys(surface: Readonly<Record<string, string>>): ReadonlySet<string> {
  const pattern = /"(rider\.active\.[A-Za-z0-9._]+)"/g;
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
export function keyParityProblems(input: ActiveRideContractInput): readonly string[] {
  const problems: string[] = [];
  const sets = new Map<string, ReadonlySet<string>>();
  for (const [language, dictionary] of Object.entries(input.translations)) {
    sets.set(
      language,
      new Set(Object.keys(dictionary).filter((key) => key.startsWith(KEY_PREFIX))),
    );
  }
  const languages = [...sets.keys()].sort();
  const reference = languages[0];
  if (reference === undefined) return ["لا قاموسَ مقروءاً: الحاجزُ لا يقيسُ فراغاً."];
  const referenceSet = sets.get(reference) as ReadonlySet<string>;
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
export function unbuiltPathProblems(input: ActiveRideContractInput): readonly string[] {
  const problems: string[] = [];
  for (const [path, source] of Object.entries(input.surface)) {
    problems.push(
      ...tokenProblems(
        path,
        source,
        UNBUILT_PATH_TOKENS,
        "السطحُ يذكرُ مساراً لم يُبنَ (`F2-09`/`F2-10`)",
      ),
    );
  }
  for (const [language, dictionary] of Object.entries(input.translations)) {
    for (const key of Object.keys(dictionary)) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      problems.push(
        ...tokenProblems(`${language}:${key}`, key, UNBUILT_PATH_TOKENS, "مفتاحٌ لمسارٍ لم يُبنَ"),
      );
    }
  }
  return problems;
}

/** الأدوارُ التي لا يجوزُ أن تُنفِّذَ دالّةً من دوالِّنا. */
export const REVOKED_ROLES: readonly string[] = ["public", "anon", "authenticated"];

/**
 * القاعدة ٦ — كلُّ دالّةٍ تُنشَأُ في الهجرةِ يُنزَعُ تنفيذُها عن الأدوارِ
 * العامّةِ، **وبالأدوارِ الثلاثةِ مُسمّاةً لا بواحدٍ منها**.
 *
 * ولمَ قاعدةٌ ساكنةٌ ومعَها اختبارُ صلاحيّاتٍ على قاعدةٍ حقيقيّةٍ أصلاً: لأنَّ
 * ذاكَ يقيسُ **الأثرَ** ولا يُقاسُ إلّا بمحرِّكٍ وأدوارٍ، وهذه تقرأُ **النصَّ**
 * فتُمسَكُ محلّيّاً في ثوانٍ. ولأنَّ المنحَ ضمنيٌّ (`public` يُمنَحُ تلقائيّاً)
 * فالنسيانُ **هوَ** الحالةُ الافتراضيّةُ لا الشاذّةُ — وحاجزٌ لا يمسكُ
 * الافتراضيَّ لا يحجُزُ شيئاً.
 */
export function functionRevokeProblems(input: ActiveRideContractInput): readonly string[] {
  const problems: string[] = [];
  const sql = input.sql.toLowerCase().replace(/\s+/g, " ");
  const created = [...sql.matchAll(/create (?:or replace )?function ([a-z0-9_]+)\s*\(/g)].map(
    (match) => match[1] ?? "",
  );
  // قائمةٌ فارغةٌ تجعلُ القاعدةَ تمرُّ زوراً: هجرةُ اللقطةِ تُنشئُ دالّةً واحدةً
  // على الأقلِّ، فغيابُها خللٌ في القراءةِ لا براءةٌ.
  if (created.length === 0) {
    problems.push(
      `${SNAPSHOT_SQL_FILE}: لم تُقرأْ دالّةٌ واحدةٌ في الهجرةِ — القاعدةُ لا تمرُّ بقائمةٍ فارغةٍ.`,
    );
    return problems;
  }
  for (const name of new Set(created)) {
    const pattern = new RegExp(`revoke execute on function ${name}\\s*\\([^)]*\\) from ([^;]+);`);
    const match = sql.match(pattern);
    if (match === null) {
      problems.push(
        `${SNAPSHOT_SQL_FILE}: الهجرةُ تُنشئُ «${name}» ولا تنزعُ تنفيذَها — ` +
          `و«public» يُمنَحُ التنفيذَ تلقائيّاً فتصيرُ الدالّةُ منالاً للمفتاحِ العامِّ.`,
      );
      continue;
    }
    const roles = match[1] ?? "";
    for (const role of REVOKED_ROLES) {
      if (!roles.includes(role)) {
        problems.push(
          `${SNAPSHOT_SQL_FILE}: نزعُ تنفيذِ «${name}» لا يذكرُ الدورَ «${role}» — نزعٌ ناقصٌ بابٌ مفتوحٌ.`,
        );
      }
    }
  }
  return problems;
}

/** الحكمُ المُجمَّعُ — ستُّ قواعدَ بترتيبِها، وكلُّ مشكلةٍ بموضعِها وسببِها. */
export function activeRideContractProblems(input: ActiveRideContractInput): readonly string[] {
  return [
    ...moneyProblems(input),
    ...driverGateProblems(input),
    ...positionAgeProblems(input),
    ...keyParityProblems(input),
    ...unbuiltPathProblems(input),
    ...functionRevokeProblems(input),
  ];
}
