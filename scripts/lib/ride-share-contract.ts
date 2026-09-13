/**
 * الغرض: قواعدُ عقدِ مشاركةِ الرحلةِ برابطٍ مؤقّتٍ — ثمانِ قواعدَ تُقاسُ على نصِّ
 *   المستودعِ لا على نيّةِ كاتبِه (البند `F2-09` · `SR-13` · الحاجز `UX-023`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-09`. حكمُ CI **غيرُ مقروءٍ** (`B-CI-001`).
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-ride-share-contract.ts` و`tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-10` (الطوارئُ) إن نشرَ حمولةً لغريبٍ — فمعجمُ
 *   الهويّةِ أدناه يصلحُ له كما هوَ، ويُزادُ مِلفُّه إلى `PUBLIC_FILES`.
 *
 * ## لماذا حاجزٌ على رابطٍ يُعطى لغريبٍ
 *
 * كلُّ حقلٍ يُنشَرُ على `/track/:token` يُقرأُ بلا حسابٍ ولا هويّةٍ: مَن ملكَ
 * النصَّ ملكَ الجوابَ. فالخطأُ ههنا ليسَ عطلاً يُشتكى منه، بل **اسمُ راكبةٍ
 * ورقمُ هاتفِها في يدِ مَن أُعطيَ رابطاً مرّةً**. والعلّةُ الأصليّةُ التي وُلِدَ
 * منها هذا البندُ من هذا البابِ: `get_tracking_position` كانت تنشرُ إحداثيّةً
 * **بلا بوّابةِ طزاجةٍ** لحاملِ الرابطِ، وشاشةُ المالكِ (`F2-06`) تحجبُ ما جاوزَ
 * تسعينَ ثانيةً — فكانَ الغريبُ **مُصدَّقاً أكثرَ من صاحبِ الرحلةِ**.
 *
 * ## القواعدُ الثمانِ
 *
 *   ١. **لا هويّةَ في الحمولةِ العامّةِ**: لا اسمَ ولا هاتفَ ولا لوحةَ ولا
 *      نقطتَي رحلةٍ ولا معرّفَ طلبٍ في مِلفّاتِ المسارِ العامِّ.
 *   ٢. **لا موضعَ بلا عُمرِه**: كلُّ طبقةٍ تنشرُ إحداثيّةً تنشرُ عُمرَها معَها.
 *   ٣. **حدُّ العُمرِ حكمٌ واحدٌ**: بذرةُ الهجرةِ واحتياطُها يساويانِ ثابتَ
 *      النطاقِ `DRIVER_POSITION_MAX_AGE_SECONDS` (القاعدة 0.3 و0.6).
 *   ٤. **لا رمزَ في ردِّ قراءةٍ**: الرمزُ يُنشَرُ مرّةً عندَ الإصدارِ وحدَه.
 *   ٥. **حكمُ القاعدةِ واحدٌ**: `tracking_link_view` تُجيبُ للطرفَينِ، ودالّتا
 *      المالكِ والغريبِ تُناديانِها ولا تُكرِّرانِ الحكمَ.
 *   ٦. **مفاتيحُ `rider.share.` ثلاثةٌ متطابقةٌ**، وكلُّ مُنادًى موجودٌ.
 *   ٧. **كلُّ رمزِ إفصاحٍ له نصُّه** في القواميسِ الثلاثةِ.
 *   ٨. **نزعُ تنفيذٍ لكلِّ دالّةٍ** بالأدوارِ الثلاثةِ مُسمّاةً.
 *
 * ## وما لا يفعلُه هذا الحاجزُ عن قصدٍ — وحدودُه مُعلَنةٌ
 *
 * - **لا يُثبِتُ أنَّ الرابطَ ينتهي فعلاً**: الانتهاءُ أثرٌ في قاعدةٍ حقيقيّةٍ،
 *   ويُقاسُ في `tests/integration/ride-share.test.ts` لا ههنا.
 * - **لا يُثبِتُ أنَّ الحمولةَ آمنةٌ**: يُثبِتُ غيابَ حقولٍ **مُسمّاةٍ**. وحقلٌ
 *   باسمٍ لم يُتوقَّعْ يمرُّ — ولذا القاعدةُ ١ تُقرأُ معَ اختبارِ الحمولةِ.
 * - **لا يحكمُ في الشكلِ ولا في الوصولِيّةِ** (دَينٌ مُعلَنٌ كما في `UX-022`).
 */

/** مِلفّاتُ المسارِ العامِّ — ما يُقرأُ بلا حسابٍ. مكتوبةً لا مُكتشَفةً. */
export const PUBLIC_FILES: readonly string[] = [
  "apps/gateway/src/routes/public-tracking.ts",
  "apps/gateway/src/public/tracking-page.ts",
];

/** مِلفّاتُ سطحِ المشاركةِ عندَ المالكِ. */
export const SHARE_SURFACE_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/rider/share/RideShareCard.tsx",
  "apps/miniapp/src/surfaces/rider/share/ride-share-view.ts",
  "apps/miniapp/src/surfaces/rider/share/ride-share-api.ts",
  "apps/miniapp/src/surfaces/rider/share/ride-share-contract.ts",
];

export const SHARE_SQL_FILE = "supabase/migrations/20260914060000_f2_09_ride_share_link_view.sql";
export const SHARE_ROUTE_FILE = "apps/gateway/src/routes/rides.ts";
export const DOMAIN_FILE = "packages/domain/transport/ride-share.ts";
export const AGE_CONSTANT_FILE = "packages/domain/transport/active-ride.ts";
export const TRANSLATION_FILES: Readonly<Record<string, string>> = {
  ar: "packages/shared/i18n/miniapp/ar.json",
  en: "packages/shared/i18n/miniapp/en.json",
  ur: "packages/shared/i18n/miniapp/ur.json",
};

/** بادئةُ مفاتيحِ هذا السطحِ. */
export const KEY_PREFIX = "rider.share.";

/** اسمُ الحكمِ الواحدِ في القاعدةِ. */
export const JUDGE_VIEW = "tracking_link_view";
/** الدالّتانِ اللتانِ يجبُ أن تُناديانِه: جوابُ الغريبِ وجوابُ المالكِ. */
export const JUDGE_CALLERS: readonly string[] = ["get_tracking_position", "rider_ride_share_state"];

/**
 * معجمُ الهويّةِ — ما لا يُنشَرُ لحاملِ رابطٍ. وأسماءُ الحقولِ لا الكلماتُ
 * العامّةُ: «name» وحدَها تقعُ في كلِّ شِفرةٍ، و«rider_name» لا تقعُ إلّا قصداً.
 */
export const IDENTITY_TOKENS: readonly string[] = [
  "rider_name",
  "riderName",
  "driver_name",
  "driverName",
  "rider_phone",
  "riderPhone",
  "driver_phone",
  "driverPhone",
  "phone_number",
  "phoneNumber",
  "plate_number",
  "plateNumber",
  "pickup_lat",
  "pickupLat",
  "dropoff_lat",
  "dropoffLat",
  "order_id",
];

/** رمزٌ لا يُنشَرُ في ردِّ قراءةٍ — الإصدارُ وحدَه ينشرُه. */
export const TOKEN_FIELDS: readonly string[] = ["token", "share_token", "shareToken"];

export interface RideShareContractInput {
  /** مِلفّاتُ المسارِ العامِّ: مسارٌ ⇒ شِفرةٌ **بلا تعليقاتٍ**. */
  readonly publicFiles: Readonly<Record<string, string>>;
  /** مِلفّاتُ سطحِ المشاركةِ **بلا تعليقاتٍ**. */
  readonly surface: Readonly<Record<string, string>>;
  /** نصُّ هجرةِ المشاركةِ كما هوَ. */
  readonly sql: string;
  /** نصُّ مِلفِّ مساراتِ الرحلاتِ **بلا تعليقاتٍ** (فيه مسارُ القراءةِ). */
  readonly route: string;
  /** نصُّ نطاقِ المشاركةِ (قوائمُ الإفصاحِ). */
  readonly domain: string;
  /** قيمةُ `DRIVER_POSITION_MAX_AGE_SECONDS` كما قُرِئَت من النطاقِ. */
  readonly maxAgeSeconds: number | null;
  /** القواميسُ الثلاثةُ مُحلَّلةً. */
  readonly translations: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** رموزُ الإفصاحِ المنشورةُ: ما يُكشَفُ وما يُحجَبُ. */
  readonly disclosure: { readonly shown: readonly string[]; readonly hidden: readonly string[] };
}

const ASCII_WORD = /^[a-z_]+$/;

/**
 * تُطابَقُ الرموزُ اللاتينيّةُ **بحدودِها** لا بالاحتواءِ (عينُ حُجّةِ `UX-022`):
 * حاجزٌ يسقطُ على اسمٍ بريءٍ يُستثنى منه، وحاجزٌ يُستثنى منه لا يحمي شيئاً.
 */
function mentions(text: string, token: string): boolean {
  const lower = text.toLowerCase();
  const needle = token.toLowerCase();
  if (!ASCII_WORD.test(needle)) return lower.includes(needle);
  return new RegExp(`(?<![a-z_])${needle}(?![a-z_])`).test(lower);
}

function tokenProblems(
  where: string,
  text: string,
  tokens: readonly string[],
  verdict: string,
): string[] {
  return tokens
    .filter((token) => mentions(text, token))
    .map((t) => `${where}: ${verdict} («${t}»).`);
}

/** القاعدة ١ — لا هويّةَ في الحمولةِ العامّةِ. */
export function identityLeakProblems(input: RideShareContractInput): readonly string[] {
  const problems: string[] = [];
  for (const [path, source] of Object.entries(input.publicFiles)) {
    problems.push(...tokenProblems(path, source, IDENTITY_TOKENS, "مسارٌ عامٌّ يذكرُ حقلَ هويّةٍ"));
  }
  return problems;
}

/** القاعدة ٢ — لا موضعَ بلا عُمرِه، في القاعدةِ والمسارِ العامِّ والسطحِ. */
export function shareAgeProblems(input: RideShareContractInput): readonly string[] {
  const problems: string[] = [];
  const sql = input.sql.toLowerCase();
  if (sql.includes("'lat'") && !sql.includes("age_seconds")) {
    problems.push(`${SHARE_SQL_FILE}: القاعدةُ تنشرُ إحداثيّةً بلا «age_seconds».`);
  }
  for (const [path, source] of Object.entries(input.publicFiles)) {
    if (/\blat\b/.test(source) && !/age_?[sS]econds/.test(source)) {
      problems.push(`${path}: حمولةٌ عامّةٌ فيها إحداثيّةٌ بلا عُمرِها.`);
    }
  }
  for (const [path, source] of Object.entries(input.surface)) {
    if (/\blat\b/.test(source) && !/age[sS]econds|ageKey/.test(source)) {
      problems.push(`${path}: سطحُ المشاركةِ يذكرُ إحداثيّةً بلا عُمرِها.`);
    }
  }
  return problems;
}

/** القاعدة ٣ — حدُّ العُمرِ حكمٌ واحدٌ: البذرةُ والاحتياطُ = ثابتُ النطاقِ. */
export function maxAgeParityProblems(input: RideShareContractInput): readonly string[] {
  const problems: string[] = [];
  const expected = input.maxAgeSeconds;
  if (expected === null) {
    return [
      `${AGE_CONSTANT_FILE}: تعذَّرَت قراءةُ «DRIVER_POSITION_MAX_AGE_SECONDS» — لا حكمَ بلا مرجعٍ.`,
    ];
  }
  const seed = input.sql.match(/'driver_position_max_age_seconds',\s*'(\d+)'/);
  if (seed === null) {
    problems.push(
      `${SHARE_SQL_FILE}: لا بذرةَ لـ«driver_position_max_age_seconds» — الإعدادُ غيرُ منشورٍ.`,
    );
  } else if (Number(seed[1]) !== expected) {
    problems.push(
      `${SHARE_SQL_FILE}: البذرةُ «${seed[1]}» تخالفُ ثابتَ النطاقِ «${expected}» — ` +
        `حكمانِ للطزاجةِ: واحدٌ للمالكِ وآخرُ لحاملِ الرابطِ.`,
    );
  }
  const fallback = input.sql.match(/v_max_age\s*:=\s*(\d+)\s*;/);
  if (fallback === null) {
    problems.push(`${SHARE_SQL_FILE}: لا احتياطَ لحدِّ العُمرِ — إعدادٌ غائبٌ يُسقِطُ البوّابةَ كلَّها.`);
  } else if (Number(fallback[1]) !== expected) {
    problems.push(
      `${SHARE_SQL_FILE}: احتياطُ الحدِّ «${fallback[1]}» يخالفُ ثابتَ النطاقِ «${expected}».`,
    );
  }
  return problems;
}

/** القاعدة ٤ — لا رمزَ في ردِّ قراءةٍ. */
export function tokenExposureProblems(input: RideShareContractInput): readonly string[] {
  const problems: string[] = [];
  const read = input.route.match(/app\.get\("\/v1\/rides\/:id\/share"[\s\S]*?\n {2}\}\);/);
  if (read === null) {
    return [`${SHARE_ROUTE_FILE}: لم يُقرأْ مسارُ «GET /v1/rides/:id/share» — الحاجزُ لا يمرُّ بفراغٍ.`];
  }
  problems.push(
    ...tokenProblems(
      `${SHARE_ROUTE_FILE}:GET share`,
      read[0],
      TOKEN_FIELDS,
      "ردُّ القراءةِ ينشرُ رمزاً — والرمزُ يُنشَرُ مرّةً عندَ الإصدارِ وحدَه",
    ),
  );
  return problems;
}

/** القاعدة ٥ — حكمُ القاعدةِ واحدٌ: الدالّتانِ تُناديانِ الحَكَمَ نفسَه. */
export function singleJudgeProblems(input: RideShareContractInput): readonly string[] {
  const problems: string[] = [];
  const sql = input.sql.toLowerCase().replace(/\s+/g, " ");
  if (!sql.includes(`create or replace function ${JUDGE_VIEW}(`)) {
    problems.push(`${SHARE_SQL_FILE}: الحَكَمُ «${JUDGE_VIEW}» غيرُ مُنشَأٍ.`);
    return problems;
  }
  for (const caller of JUDGE_CALLERS) {
    const body = sql.split(`create or replace function ${caller}(`)[1];
    if (body === undefined) {
      problems.push(`${SHARE_SQL_FILE}: الدالّةُ «${caller}» غيرُ مُنشَأةٍ في هذه الهجرةِ.`);
      continue;
    }
    // **جسمُ الدالّةِ وحدَه**: يُقطَعُ عندَ «$$ language» وعندَ الدالّةِ التاليةِ.
    // ولولا هذا القطعُ لَمرَّت القاعدةُ زوراً بسطرِ `revoke execute on function
    // tracking_link_view(uuid)` في ذيلِ الهجرةِ — ذِكرٌ للحَكَمِ لا نداءٌ له.
    // وهذا **إخفاقٌ أمسكَته حالةٌ سلبيّةٌ مبذورةٌ** قبلَ أن يُدفَعَ (`ح-7`).
    const untilEnd = body.split("$$ language")[0] ?? "";
    const upToNext = untilEnd.split("create or replace function ")[0] ?? "";
    if (!upToNext.includes(`${JUDGE_VIEW}(`)) {
      problems.push(
        `${SHARE_SQL_FILE}: «${caller}» لا تُنادي «${JUDGE_VIEW}» — ` +
          `حكمانِ للطزاجةِ يفترقانِ يوماً، ويومَها يُصدَّقُ الغريبُ أكثرَ من المالكِ.`,
      );
    }
  }
  return problems;
}

/** يستخرجُ مفاتيحَ `rider.share.` المُنادَاةَ في السطحِ نصّاً حرفيّاً. */
export function usedShareKeys(surface: Readonly<Record<string, string>>): ReadonlySet<string> {
  const pattern = /"(rider\.share\.[A-Za-z0-9._]+)"/g;
  const keys = new Set<string>();
  for (const source of Object.values(surface)) {
    for (const match of source.matchAll(pattern)) {
      const key = match[1];
      if (key !== undefined) keys.add(key);
    }
  }
  return keys;
}

/** القاعدة ٦ — مجموعةُ المفاتيحِ واحدةٌ في الثلاثةِ، وكلُّ مُنادًى موجودٌ. */
export function shareKeyParityProblems(input: RideShareContractInput): readonly string[] {
  const problems: string[] = [];
  const sets = new Map<string, ReadonlySet<string>>();
  for (const [language, dictionary] of Object.entries(input.translations)) {
    sets.set(language, new Set(Object.keys(dictionary).filter((k) => k.startsWith(KEY_PREFIX))));
  }
  const languages = [...sets.keys()].sort();
  const reference = languages[0];
  if (reference === undefined) return ["لا قاموسَ مقروءاً: الحاجزُ لا يقيسُ فراغاً."];
  const referenceSet = sets.get(reference) as ReadonlySet<string>;
  if (referenceSet.size === 0) {
    return [`${reference}: لا مفتاحَ واحداً بالبادئةِ «${KEY_PREFIX}» — سطحٌ بلا نصٍّ.`];
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
  for (const key of usedShareKeys(input.surface)) {
    for (const [language, dictionary] of Object.entries(input.translations)) {
      if (!(key in dictionary)) {
        problems.push(`${language}: مفتاحٌ يُنادى في السطحِ وليسَ في القاموسِ «${key}».`);
      }
    }
  }
  return problems;
}

/**
 * القاعدة ٧ — كلُّ رمزِ إفصاحٍ له نصُّه في الثلاثةِ.
 *
 * وهذه هيَ القاعدةُ التي تجعلُ **زيادةَ حقلٍ في الحمولةِ العامّةِ تُسقِطُ
 * البناءَ**: مَن زادَ حقلاً زادَ رمزَه في `SHARE_DISCLOSED`، ومَن زادَ الرمزَ
 * لزِمَه نصُّه في ثلاثِ لغاتٍ. فلا يُنشَرُ شيءٌ لغريبٍ وصاحبُه لا يُخبَرُ به.
 */
export function disclosureTextProblems(input: RideShareContractInput): readonly string[] {
  const problems: string[] = [];
  const codes = [...input.disclosure.shown, ...input.disclosure.hidden];
  if (codes.length === 0) {
    return [`${DOMAIN_FILE}: قائمتا الإفصاحِ فارغتانِ — الحاجزُ لا يمرُّ بفراغٍ.`];
  }
  for (const code of codes) {
    for (const [language, dictionary] of Object.entries(input.translations)) {
      const key = `${KEY_PREFIX}disclosure.${code}`;
      if (!(key in dictionary)) {
        problems.push(`${language}: رمزُ إفصاحٍ بلا نصٍّ «${key}» — يُنشَرُ ولا يُقالُ لصاحبِه.`);
      }
    }
  }
  return problems;
}

/** الأدوارُ التي لا يجوزُ أن تُنفِّذَ دالّةً من دوالِّنا. */
export const REVOKED_ROLES: readonly string[] = ["public", "anon", "authenticated"];

/** القاعدة ٨ — نزعُ تنفيذٍ لكلِّ دالّةٍ، بالأدوارِ الثلاثةِ مُسمّاةً. */
export function shareRevokeProblems(input: RideShareContractInput): readonly string[] {
  const problems: string[] = [];
  const sql = input.sql.toLowerCase().replace(/\s+/g, " ");
  const created = [...sql.matchAll(/create (?:or replace )?function ([a-z0-9_]+)\s*\(/g)].map(
    (match) => match[1] ?? "",
  );
  if (created.length === 0) {
    return [`${SHARE_SQL_FILE}: لم تُقرأْ دالّةٌ واحدةٌ — القاعدةُ لا تمرُّ بقائمةٍ فارغةٍ.`];
  }
  for (const name of new Set(created)) {
    const match = sql.match(
      new RegExp(`revoke execute on function ${name}\\s*\\([^)]*\\) from ([^;]+);`),
    );
    if (match === null) {
      problems.push(`${SHARE_SQL_FILE}: «${name}» بلا نزعِ تنفيذٍ — و«public» يُمنَحُ التنفيذَ تلقائيّاً.`);
      continue;
    }
    const roles = match[1] ?? "";
    for (const role of REVOKED_ROLES) {
      if (!roles.includes(role)) {
        problems.push(
          `${SHARE_SQL_FILE}: نزعُ تنفيذِ «${name}» لا يذكرُ «${role}» — نزعٌ ناقصٌ بابٌ مفتوحٌ.`,
        );
      }
    }
  }
  return problems;
}

/** الحكمُ المُجمَّعُ — ثمانِ قواعدَ بترتيبِها، وكلُّ مشكلةٍ بموضعِها وسببِها. */
export function rideShareContractProblems(input: RideShareContractInput): readonly string[] {
  return [
    ...identityLeakProblems(input),
    ...shareAgeProblems(input),
    ...maxAgeParityProblems(input),
    ...tokenExposureProblems(input),
    ...singleJudgeProblems(input),
    ...shareKeyParityProblems(input),
    ...disclosureTextProblems(input),
    ...shareRevokeProblems(input),
  ];
}
