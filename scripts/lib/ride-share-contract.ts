/**
 * الغرض: قواعدُ عقدِ مشاركةِ الرحلةِ برابطٍ مؤقّتٍ — عشرُ قواعدَ تُقاسُ على نصِّ
 *   المستودعِ لا على نيّةِ كاتبِه (البند `F2-09` · `F12-04` · `SR-13` ·
 *   الحاجز `UX-023`).
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

/**
 * ## ولماذا صارَ الحكمُ على **آخرِ مُعرِّفٍ** لا على هجرةٍ واحدةٍ (`F12-04`)
 *
 * كانَ هذا الحاجزُ يقرأُ هجرةَ `F2-09` وحدَها. وهجرةٌ لاحقةٌ تُعيدُ تعريفَ
 * `get_tracking_position` كانت تمرُّ **بلا قياسٍ ألبتّةَ**: الحاجزُ يقيسُ نصّاً
 * لم يعُدْ هوَ الدالّةَ العاملةَ في القاعدةِ. فالمقروءُ الآنَ **مجموعةُ هجراتٍ
 * مُسمّاةٌ**، والحكمُ على **آخرِ `create or replace` لكلِّ دالّةٍ** — وهيَ عينُ
 * التقنيةِ التي أُقرَّت في القاعدةِ ٧ من حاجزِ الاستغاثةِ (`F12-03`).
 *
 * ## القاعدتانِ الجديدتانِ (`F12-04`)
 *
 *   ٩. **الحياةُ حكمٌ لا رايةٌ**: قارئا الرابطِ يُنادِيانِ حَكَمَ الحياةِ
 *      `tracking_link_lifetime`، ولا يُحكَمُ بالحياةِ من `expires_at > now()`
 *      وحدَه في أيِّ جسمٍ.
 *   ١٠. **مهلةُ ما بعدَ الرحلةِ حكمٌ واحدٌ**: البذرةُ = الاحتياطُ = ثابتُ
 *      النطاقِ `TRACKING_LINK_GRACE_MINUTES`.
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

/**
 * هجراتُ المشاركةِ **بترتيبِ تطبيقِها** (الطابعُ الزمنيُّ يرتّبُها). ومَن أعادَ
 * تعريفَ دالّةٍ من دوالِّ المشاركةِ في هجرةٍ جديدةٍ **يزيدُ مِلفَّه ههنا**، وإلّا
 * أسقطَته القاعدةُ ٥ أو ٩ بأنَّ الدالّةَ غيرُ مُنشَأةٍ في المقروءِ.
 */
export const SHARE_SQL_FILES: readonly string[] = [
  "supabase/migrations/20260814150000_trip_tracking_tokens.sql",
  "supabase/migrations/20260914060000_f2_09_ride_share_link_view.sql",
  "supabase/migrations/20260918020000_f12_04_share_lasts_until_the_ride_ends.sql",
];
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
/** حَكَمُ الحياةِ (`F12-04`): «أما زالَت المشاركةُ حيّةً؟» جوابٌ واحدٌ للطرفَينِ. */
export const LIVENESS_JUDGE = "tracking_link_lifetime";

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
  /** هجراتُ المشاركةِ: مسارٌ ⇒ نصٌّ كما هوَ (مرتّبةً بالطابعِ الزمنيِّ). */
  readonly sqlFiles: Readonly<Record<string, string>>;
  /** نصُّ مِلفِّ مساراتِ الرحلاتِ **بلا تعليقاتٍ** (فيه مسارُ القراءةِ). */
  readonly route: string;
  /** نصُّ نطاقِ المشاركةِ (قوائمُ الإفصاحِ). */
  readonly domain: string;
  /** قيمةُ `DRIVER_POSITION_MAX_AGE_SECONDS` كما قُرِئَت من النطاقِ. */
  readonly maxAgeSeconds: number | null;
  /** قيمةُ `TRACKING_LINK_GRACE_MINUTES` كما قُرِئَت من النطاقِ (`F12-04`). */
  readonly graceMinutes: number | null;
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

/**
 * جسمُ **آخرِ مُعرِّفٍ** لدالّةٍ في المقروءِ كلِّه: يُمَرُّ على المِلفّاتِ بترتيبِها
 * ويُؤخَذُ آخرُ `create or replace function <name>(`، ثمَّ يُقطَعُ الجسمُ عندَ
 * «$$ language» وعندَ الدالّةِ التاليةِ — كي لا يُحسَبَ ذِكرٌ في ذيلِ الهجرةِ
 * (`revoke execute on function ...`) نداءً في جسمٍ (`ح-7` أمسكَت هذا سابقاً).
 */
export interface FunctionBody {
  readonly path: string;
  readonly body: string;
}

export function lastDefiner(
  sqlFiles: Readonly<Record<string, string>>,
  name: string,
): FunctionBody | null {
  let found: FunctionBody | null = null;
  for (const path of Object.keys(sqlFiles).sort()) {
    const sql = (sqlFiles[path] ?? "").toLowerCase().replace(/\s+/g, " ");
    const parts = sql.split(`create or replace function ${name}(`);
    if (parts.length < 2) continue;
    const tail = parts[parts.length - 1] ?? "";
    const untilEnd = tail.split("$$ language")[0] ?? "";
    const body = untilEnd.split("create or replace function ")[0] ?? "";
    found = { path, body };
  }
  return found;
}

/** كلُّ دالّةٍ مُعرَّفةٍ في المقروءِ ⇒ آخرُ مِلفٍّ عرَّفَها. */
export function definedFunctions(
  sqlFiles: Readonly<Record<string, string>>,
): ReadonlyMap<string, string> {
  const owners = new Map<string, string>();
  for (const path of Object.keys(sqlFiles).sort()) {
    const sql = (sqlFiles[path] ?? "").toLowerCase().replace(/\s+/g, " ");
    for (const match of sql.matchAll(/create (?:or replace )?function ([a-z0-9_]+)\s*\(/g)) {
      const name = match[1];
      if (name !== undefined) owners.set(name, path);
    }
  }
  return owners;
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
  // **على آخرِ مُعرِّفٍ لكلِّ دالّةٍ**: تعريفٌ قديمٌ نشرَ إحداثيّةً بلا عُمرٍ ثمَّ
  // أُصلِحَ في هجرةٍ لاحقةٍ **ليسَ عطباً قائماً**، والحكمُ على العاملِ في القاعدةِ.
  for (const [name, path] of definedFunctions(input.sqlFiles)) {
    const definer = lastDefiner(input.sqlFiles, name);
    if (definer === null) continue;
    if (definer.body.includes("'lat'") && !definer.body.includes("age_seconds")) {
      problems.push(`${path}: «${name}» تنشرُ إحداثيّةً بلا «age_seconds».`);
    }
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

/**
 * قياسُ تطابقِ إعدادٍ رقميٍّ: بذرتُه في الهجراتِ واحتياطُه في الشِفرةِ = ثابتُ
 * النطاقِ. **ولا مِلفَّ يُستثنى**: بذرةٌ مخالفةٌ في هجرةٍ لاحقةٍ تُسقِطُ الحكمَ
 * كما تُسقِطُه في الأولى، وغيابُ البذرةِ كلَّها إعدادٌ غيرُ منشورٍ.
 */
function settingParityProblems(
  sqlFiles: Readonly<Record<string, string>>,
  options: {
    readonly settingKey: string;
    readonly fallbackVariable: string;
    readonly expected: number;
    readonly constantName: string;
    readonly why: string;
  },
): string[] {
  const problems: string[] = [];
  const seedPattern = new RegExp(`'${options.settingKey}',\\s*'(\\d+)'`, "g");
  const fallbackPattern = new RegExp(`${options.fallbackVariable}\\s*:=\\s*(\\d+)\\s*;`, "g");
  let seeds = 0;
  let fallbacks = 0;
  for (const path of Object.keys(sqlFiles).sort()) {
    const text = sqlFiles[path] ?? "";
    for (const match of text.matchAll(seedPattern)) {
      seeds += 1;
      if (Number(match[1]) !== options.expected) {
        problems.push(
          `${path}: بذرةُ «${options.settingKey}» = «${match[1]}» تخالفُ ثابتَ النطاقِ ` +
            `«${options.constantName}» = «${options.expected}» — ${options.why}`,
        );
      }
    }
    for (const match of text.matchAll(fallbackPattern)) {
      fallbacks += 1;
      if (Number(match[1]) !== options.expected) {
        problems.push(
          `${path}: احتياطُ «${options.fallbackVariable}» = «${match[1]}» يخالفُ ` +
            `«${options.constantName}» = «${options.expected}» — ${options.why}`,
        );
      }
    }
  }
  if (seeds === 0) {
    problems.push(
      `${Object.keys(sqlFiles).sort()[0] ?? "?"}: لا بذرةَ لـ«${options.settingKey}» في هجراتِ ` +
        `المشاركةِ — الإعدادُ غيرُ منشورٍ فيُقرأُ الاحتياطُ أبداً.`,
    );
  }
  if (fallbacks === 0) {
    problems.push(
      `لا احتياطَ لـ«${options.fallbackVariable}» في هجراتِ المشاركةِ — إعدادٌ غائبٌ ` +
        `يُسقِطُ الحكمَ كلَّه إلى عَدَمٍ.`,
    );
  }
  return problems;
}

/** القاعدة ٣ — حدُّ العُمرِ حكمٌ واحدٌ: البذرةُ والاحتياطُ = ثابتُ النطاقِ. */
export function maxAgeParityProblems(input: RideShareContractInput): readonly string[] {
  const expected = input.maxAgeSeconds;
  if (expected === null) {
    return [
      `${AGE_CONSTANT_FILE}: تعذَّرَت قراءةُ «DRIVER_POSITION_MAX_AGE_SECONDS» — لا حكمَ بلا مرجعٍ.`,
    ];
  }
  return settingParityProblems(input.sqlFiles, {
    settingKey: "driver_position_max_age_seconds",
    fallbackVariable: "v_max_age",
    expected,
    constantName: "DRIVER_POSITION_MAX_AGE_SECONDS",
    why: "حكمانِ للطزاجةِ: واحدٌ للمالكِ وآخرُ لحاملِ الرابطِ.",
  });
}

/**
 * القاعدة ١٠ (`F12-04`) — **مهلةُ ما بعدَ الرحلةِ حكمٌ واحدٌ**.
 *
 * ثلاثةُ مواضعَ تقولُ «كم يبقى الرابطُ بعدَ نهايةِ الرحلةِ»: بذرةُ الإعدادِ،
 * واحتياطُ الدالّةِ حينَ يغيبُ الإعدادُ، وثابتُ النطاقِ الذي تُقاسُ به الشاشةُ
 * والاختباراتُ. وافتراقُها **يُقاسُ عندَ صاحبِ الرحلةِ**: جملةٌ تقولُ «ثمَّ ربعُ
 * ساعةٍ» ورابطٌ يموتُ بعدَ خمسِ دقائقَ.
 */
export function graceParityProblems(input: RideShareContractInput): readonly string[] {
  const expected = input.graceMinutes;
  if (expected === null) {
    return [`${DOMAIN_FILE}: تعذَّرَت قراءةُ «TRACKING_LINK_GRACE_MINUTES» — لا حكمَ بلا مرجعٍ.`];
  }
  return settingParityProblems(input.sqlFiles, {
    settingKey: "tracking_link_grace_minutes",
    fallbackVariable: "v_grace",
    expected,
    constantName: "TRACKING_LINK_GRACE_MINUTES",
    why: "وعدٌ في الشاشةِ ومهلةٌ في القاعدةِ يفترقانِ.",
  });
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
  return judgeCallProblems(input, {
    judge: JUDGE_VIEW,
    why: "حكمانِ للطزاجةِ يفترقانِ يوماً، ويومَها يُصدَّقُ الغريبُ أكثرَ من المالكِ.",
  });
}

/**
 * دوالُّ **تحرِّكُ السقفَ** ولا تُجيبُ قارئاً: مُستثنياتٌ مكتوبةٌ بأسمائِها
 * وسببِها. و`expire_tracking_tokens` وظيفةٌ دوريّةٌ تُقرِّبُ `expires_at` إلى
 * جوابِ الحَكَمِ (نهايةُ الرحلةِ + المهلةُ) — فهيَ **تنظيفٌ وتقاربٌ**، ولو
 * لزِمَها الحَكَمُ لَدارَت في حلقةٍ: تسألُه عن صفوفٍ تسألُ عنها كي تُصلِحَها.
 * وهيَ لا تنشرُ موضعاً ولا تُجيبُ حاملَ رابطٍ، فلا يقعُ بها العطبُ المقصودُ.
 */
export const CEILING_WRITERS: readonly string[] = ["expire_tracking_tokens"];

/**
 * الدوالُّ الأمينةُ على الحياةِ: مَن نادى الحَكَمَ مباشرةً، ثمَّ مَن نادى
 * أميناً — إلى الإغلاقِ. **والنداءُ بواسطةٍ أمانةٌ لا تحايلٌ**: القاعدةُ 0-6
 * تنهى عن تكرارِ مصدرِ الحقيقةِ، فإلزامُ كلِّ قارئٍ بنداءٍ مباشرٍ كانَ سيُنتِجَ
 * نسختَينِ من الحكمِ نفسِه — وهوَ عينُ ما جاءَ هذا البندُ يُبطِلُه.
 */
export function livenessHonestFunctions(
  sqlFiles: Readonly<Record<string, string>>,
): ReadonlySet<string> {
  const bodies = new Map<string, string>();
  for (const name of definedFunctions(sqlFiles).keys()) {
    const definer = lastDefiner(sqlFiles, name);
    if (definer !== null) bodies.set(name, definer.body);
  }
  const honest = new Set<string>();
  for (const [name, body] of bodies) {
    if (body.includes(`${LIVENESS_JUDGE}(`)) honest.add(name);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, body] of bodies) {
      if (honest.has(name)) continue;
      for (const trusted of honest) {
        if (body.includes(`${trusted}(`)) {
          honest.add(name);
          grew = true;
          break;
        }
      }
    }
  }
  return honest;
}

/**
 * القاعدة ٩ (`F12-04`) — **الحياةُ حكمٌ لا رايةٌ**.
 *
 * `expires_at` **سقفٌ** يُكتَبُ مرّةً عندَ الإصدارِ (اثنتا عشرةَ ساعةً)، ولا
 * يُقرَّبُ إلى «نهايةِ الرحلةِ + المهلةِ» إلّا بوظيفةٍ دوريّةٍ. فمَن حكمَ
 * بالحياةِ من `expires_at > now()` وحدَه **نشرَ موضعَ سائقٍ ساعاتٍ بعدَ نهايةِ
 * الرحلةِ إن تأخّرَت الوظيفةُ** — ونقضَ `ADR 0115` «الحجبُ ساعةٌ لا رايةٌ».
 * فالحياةُ تُحسَبُ من حالِ الرحلةِ في `tracking_link_lifetime`، والوظيفةُ
 * الدوريّةُ **تنظيفٌ لا حقيقةٌ**.
 */
export function livenessJudgeProblems(input: RideShareContractInput): readonly string[] {
  const problems: string[] = [
    ...judgeCallProblems(input, {
      judge: LIVENESS_JUDGE,
      why: "حياةُ الرابطِ تُقرأُ من سقفٍ لا من حالِ الرحلةِ — ونقضُ ذاكَ موضعٌ يُنشَرُ بعدَ نهايةِ الرحلةِ.",
    }),
  ];

  // **ولا جسمَ يحكمُ بالسقفِ وحدَه**: مَن ذكرَ `expires_at > now()` لزِمَه حَكَمُ
  // الحياةِ — مباشرةً أو بدالّةٍ أمينةٍ يُنادِيها — فالسقفُ شرطٌ لازمٌ لا كافٍ.
  const honest = livenessHonestFunctions(input.sqlFiles);
  for (const [name, path] of definedFunctions(input.sqlFiles)) {
    if (CEILING_WRITERS.includes(name)) continue;
    const definer = lastDefiner(input.sqlFiles, name);
    if (definer === null) continue;
    if (!/expires_at\s*>\s*now\(\)/.test(definer.body)) continue;
    if (honest.has(name)) continue;
    problems.push(
      `${path}: «${name}» تحكمُ بالحياةِ من «expires_at > now()» بلا «${LIVENESS_JUDGE}» — ` +
        `والسقفُ شرطٌ لازمٌ لا كافٍ: رحلةٌ انتهَت ومهلتُها مضَت والسقفُ باقٍ ساعاتٍ.`,
    );
  }
  return problems;
}

/** قياسُ نداءِ حَكَمٍ واحدٍ من قارئَي الرابطِ — على **آخرِ مُعرِّفٍ** لكلٍّ منهما. */
function judgeCallProblems(
  input: RideShareContractInput,
  options: { readonly judge: string; readonly why: string },
): string[] {
  const problems: string[] = [];
  if (lastDefiner(input.sqlFiles, options.judge) === null) {
    return [`هجراتُ المشاركةِ: الحَكَمُ «${options.judge}» غيرُ مُنشَأٍ في المقروءِ.`];
  }
  for (const caller of JUDGE_CALLERS) {
    const definer = lastDefiner(input.sqlFiles, caller);
    if (definer === null) {
      problems.push(`هجراتُ المشاركةِ: الدالّةُ «${caller}» غيرُ مُنشَأةٍ في المقروءِ.`);
      continue;
    }
    const honest =
      definer.body.includes(`${options.judge}(`) ||
      (options.judge === LIVENESS_JUDGE && livenessHonestFunctions(input.sqlFiles).has(caller));
    if (!honest) {
      problems.push(
        `${definer.path}: «${caller}» (آخرُ تعريفٍ) لا تُنادي «${options.judge}» — ${options.why}`,
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

/**
 * نزعٌ **مكتوبٌ بالتوليدِ**: هجرةُ `20260814` تنزعُ التنفيذَ في حلقةٍ
 * (`execute format('revoke all on function %s from public', v_sig)`) على قائمةِ
 * تواقيعَ نصّيّةٍ. وهذا نزعٌ حقيقيٌّ في القاعدةِ، فرفضُه لأنَّه ليسَ حرفيّاً كانَ
 * سيكونَ **حكماً على شكلِ الكتابةِ لا على الأثرِ** — والحاجزُ يقيسُ الأثرَ.
 * فيُقبَلُ إذا وُجِدَ توقيعُ الدالّةِ نصّاً في القائمةِ **ووُجِدَ النزعُ للأدوارِ**.
 */
function dynamicRevokeMatch(sql: string, name: string): RegExpMatchArray | null {
  const signature = new RegExp(`'${name}\\s*\\([^']*\\)'`).test(sql);
  if (!signature) return null;
  const roles = REVOKED_ROLES.filter((role) =>
    new RegExp(`revoke all on function %s from ${role}`).test(sql),
  );
  if (roles.length === 0) return null;
  return [`(بالتوليدِ) ${name}`, roles.join(", ")] as unknown as RegExpMatchArray;
}

/** الأدوارُ التي لا يجوزُ أن تُنفِّذَ دالّةً من دوالِّنا. */
export const REVOKED_ROLES: readonly string[] = ["public", "anon", "authenticated"];

/**
 * القاعدة ٨ — نزعُ تنفيذٍ لكلِّ دالّةٍ، بالأدوارِ الثلاثةِ مُسمّاةً.
 *
 * والنزعُ يُطلَبُ **في المِلفِّ الذي عرَّفَ الدالّةَ آخرَ مرّةٍ**: إعادةُ تعريفٍ
 * تُبقي المِنَحَ القديمةَ، لكنَّ هجرةً تُنشِئُ دالّةً بتوقيعٍ جديدٍ تُمنَحُ
 * `public` تلقائيّاً — فالنزعُ يُكتَبُ حيثُ يُكتَبُ التعريفُ.
 */
export function shareRevokeProblems(input: RideShareContractInput): readonly string[] {
  const problems: string[] = [];
  const owners = definedFunctions(input.sqlFiles);
  if (owners.size === 0) {
    return ["هجراتُ المشاركةِ: لم تُقرأْ دالّةٌ واحدةٌ — القاعدةُ لا تمرُّ بقائمةٍ فارغةٍ."];
  }
  const ordered = Object.keys(input.sqlFiles).sort();
  for (const [name, path] of owners) {
    // النزعُ يُقبَلُ في مِلفِّ التعريفِ **أو في هجرةٍ لاحقةٍ**: تصحيحٌ بالإضافةِ
    // (`ح-8`) — ودالّةٌ قديمةٌ نُزِعَ تنفيذُها اليومَ منزوعةٌ فعلاً في القاعدةِ.
    const since = ordered.slice(ordered.indexOf(path));
    const sql = since
      .map((file) => input.sqlFiles[file] ?? "")
      .join("\n")
      .toLowerCase()
      .replace(/\s+/g, " ");
    const match =
      sql.match(new RegExp(`revoke execute on function ${name}\\s*\\([^)]*\\) from ([^;]+);`)) ??
      dynamicRevokeMatch(sql, name);
    if (match === null) {
      problems.push(`${path}: «${name}» بلا نزعِ تنفيذٍ — و«public» يُمنَحُ التنفيذَ تلقائيّاً.`);
      continue;
    }
    const roles = match[1] ?? "";
    for (const role of REVOKED_ROLES) {
      if (!roles.includes(role)) {
        problems.push(`${path}: نزعُ تنفيذِ «${name}» لا يذكرُ «${role}» — نزعٌ ناقصٌ بابٌ مفتوحٌ.`);
      }
    }
  }
  return problems;
}

/** الحكمُ المُجمَّعُ — عشرُ قواعدَ بترتيبِها، وكلُّ مشكلةٍ بموضعِها وسببِها. */
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
    ...livenessJudgeProblems(input),
    ...graceParityProblems(input),
  ];
}
