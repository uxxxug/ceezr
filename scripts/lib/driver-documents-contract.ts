/**
 * الغرض: قواعدُ عقدِ وثائقِ السائقِ — سبعُ قواعدَ تُقاسُ على نصِّ المستودعِ لا على
 *   نيّةِ كاتبِه (البند `F3-01` · `SD-01` · `SD-02` · `F12-14`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-01`.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-driver-documents-contract.ts` و`tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: `SD-11` (وثائقُ المركبةِ) — القواعدُ عينُها بأنواعٍ
 *   مَزيدةٍ، ويُزادُ مِلفُّها إلى `SURFACE_FILES` بلا تغييرِ قاعدةٍ.
 * الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
 *
 * ## لِمَ حاجزٌ على وثائقِ سائقٍ
 *
 * لأنَّ ثلاثةَ أعطابٍ ههنا **لا يُمسِكُها اختبارٌ أخضرُ**:
 *
 *   ــ **نوعُ وثيقةٍ يُطلَبُ ولا نصَّ له**: القاعدةُ تحجبُ العملَ بسببٍ اسمُه
 *      `MISSING:medical_exam`، والشاشةُ تعرضُ مفتاحاً خاماً أو فراغاً — فيقرأُ
 *      السائقُ حجباً بلا سببٍ مفهومٍ ويشكو إلى الدعمِ.
 *   ــ **رمزُ رفضٍ يُعادُ من الخادمِ ولا نصَّ له**: عينُ العطبِ من البابِ الآخرِ.
 *   ــ **رمزُ جلسةٍ أو مفتاحُ خدمةٍ يُحمَلُ إلى مضيفِ المخزنِ**: الرفعُ يذهبُ إلى
 *      **مضيفٍ ليسَ لنا**، وترويسةُ تفويضٍ ذاهبةٌ إليه **تُسلِّمُ جلسةَ السائقِ**
 *      أو مفتاحَ الخدمةِ إلى طرفٍ ثالثٍ. والإذنُ الموقَّعُ في العنوانِ يُغني.
 *
 * ## القواعدُ السبعُ
 *
 *   ١. **مفاتيحُ `driver.documents.` ثلاثةٌ متطابقةٌ**، وكلُّ مُنادًى موجودٌ.
 *   ٢. **كلُّ نوعٍ وكلُّ حالةٍ وكلُّ رمزِ حجبٍ له نصُّه** في الثلاثةِ.
 *   ٣. **كلُّ رمزٍ عامٍّ للخطأِ له نصُّه** في الثلاثةِ، ولا رمزَ يُصنَّفُ معروفاً
 *      في السطحِ وهوَ غيرُ منشورٍ من التطبيقِ.
 *   ٤. **نزعُ تنفيذٍ لكلِّ دالّةٍ** بالأدوارِ الثلاثةِ مُسمّاةً.
 *   ٥. **لا تفويضَ ذاهبٌ إلى مضيفِ المخزنِ** من العميلِ.
 *   ٦. **لا مسارَ ولا رمزَ ولا عنوانَ في سجلِّ الخادمِ**.
 *   ٧. **عددُ الأنواعِ واحدٌ** في الهجرةِ والنطاقِ والقاموسِ.
 *
 * ## وما لا يفعلُه هذا الحاجزُ عن قصدٍ — وحدودُه مُعلَنةٌ (`ح-5`)
 *
 * - **لا يُثبِتُ أنَّ الرابطَ الموقَّعَ يعملُ**: التوقيعُ أثرٌ عندَ مزوِّدٍ حقيقيٍّ،
 *   ودليلُه في `docs/evidence/storage/F3-01-SIGNED-UPLOAD-20260915.md` لا ههنا.
 * - **لا يُثبِتُ أنَّ الدلوَ خاصٌّ**: خصوصيّةُ الدلوِ حالةٌ في مشروعٍ حقيقيٍّ
 *   يقيسُها `scripts/provision-object-storage.ts` عندَ التهيئةِ.
 * - **لا يحكمُ في الشكلِ ولا في الوصولِيّةِ** (دَينٌ مُعلَنٌ كما في `UX-022`).
 * - **لا يقرأُ تعليقاً**: يُغذَّى بشِفرةٍ منزوعةِ التعليقاتِ، وإلّا لَسقطَ على
 *   شرحٍ يذكرُ ما يمنعُه — وهذا **إخفاقٌ حقيقيٌّ أمسكَته حالةٌ مبذورةٌ** (`ح-7`).
 */

/** مِلفّاتُ سطحِ الوثائقِ في التطبيقِ المصغَّرِ — مكتوبةً لا مُكتشَفةً بنمطٍ. */
export const SURFACE_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/driver/documents/DocumentsScreen.tsx",
  "apps/miniapp/src/surfaces/driver/documents/documents-view.ts",
  "apps/miniapp/src/surfaces/driver/documents/documents-api.ts",
  "apps/miniapp/src/surfaces/driver/documents/documents-contract.ts",
];

/** المِلفُّ الذي يرفعُ إلى مضيفِ المخزنِ — القاعدة ٥ تقرؤه وحدَه. */
export const CLIENT_UPLOAD_FILE = "apps/miniapp/src/surfaces/driver/documents/documents-api.ts";

export const ROUTE_FILE = "apps/gateway/src/routes/driver-documents.ts";
export const DOMAIN_FILE = "packages/domain/driver/driver-documents.ts";
export const APPLICATION_FILE = "packages/application/driver/driver-documents.ts";
export const FUNCTIONS_SQL_FILE =
  "supabase/migrations/20260915000400_f3_01_driver_document_functions.sql";
export const TABLE_SQL_FILE = "supabase/migrations/20260915000000_f3_01_driver_documents.sql";

export const TRANSLATION_FILES: Readonly<Record<string, string>> = {
  ar: "packages/shared/i18n/miniapp/ar.json",
  en: "packages/shared/i18n/miniapp/en.json",
  ur: "packages/shared/i18n/miniapp/ur.json",
};

/** بادئةُ مفاتيحِ هذا السطحِ. */
export const KEY_PREFIX = "driver.documents.";

/** الأدوارُ التي لا يجوزُ أن تُنفِّذَ دالّةً من دوالِّنا. */
export const REVOKED_ROLES: readonly string[] = ["public", "anon", "authenticated"];

/**
 * ما لا يُحمَلُ إلى مضيفِ المخزنِ من العميلِ. وأسماءٌ **بحدودِها** لا كلماتٌ
 * عامّةٌ: «key» وحدَها تقعُ في كلِّ شِفرةٍ، و«service_role_key» لا تقعُ إلّا قصداً.
 */
export const FORBIDDEN_CLIENT_TOKENS: readonly string[] = [
  "authorization",
  "apikey",
  "service_role",
  "serviceRole",
  "getSession",
  "accessToken",
];

/** ما لا يُكتَبُ في سجلِّ الخادمِ — مسارٌ أو رمزٌ أو عنوانٌ موقَّعٌ. */
export const FORBIDDEN_LOG_FIELDS: readonly string[] = [
  "object_path",
  "objectPath",
  "upload_url",
  "uploadUrl",
  "upload_token",
  "uploadToken",
];

export interface DriverDocumentsContractInput {
  /** مِلفّاتُ السطحِ: مسارٌ ⇒ شِفرةٌ **بلا تعليقاتٍ**. */
  readonly surface: Readonly<Record<string, string>>;
  /** نصُّ مِلفِّ المساراتِ **بلا تعليقاتٍ**. */
  readonly route: string;
  /** نصُّ هجرةِ الدوالِّ كما هوَ. */
  readonly functionsSql: string;
  /** نصُّ هجرةِ الجدولِ والأنواعِ كما هوَ. */
  readonly tableSql: string;
  /** أنواعُ الوثائقِ كما يُصدِرُها النطاقُ. */
  readonly documentTypes: readonly string[];
  /** حالاتُ الوثيقةِ كما يُصدِرُها النطاقُ. */
  readonly documentStatuses: readonly string[];
  /** رموزُ الحجبِ كما يُصدِرُها النطاقُ. */
  readonly blockCodes: readonly string[];
  /** الرموزُ العامّةُ للخطأِ كما تُصدِرُها طبقةُ التطبيقِ. */
  readonly publicErrorCodes: readonly string[];
  /** القواميسُ الثلاثةُ مُحلَّلةً. */
  readonly translations: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

const ASCII_WORD = /^[a-z_]+$/i;

/**
 * تُمسَحُ تعليقاتُ SQL قبلَ قراءةِ التعدادِ والنزعِ. وليسَ هذا ترتيباً:
 * أحدُ أسماءِ الأنواعِ مشروحٌ بعربيّةٍ فيها قوسٌ مُغلَقٌ — فقراءةُ التعدادِ
 * تقفُ عندَه ويمرُّ **نوعانِ بلا نصٍّ** خفيَّينِ. وقعَ فعلاً في أوّلِ تشغيلٍ.
 */
export function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

function mentions(text: string, token: string): boolean {
  const lower = text.toLowerCase();
  const needle = token.toLowerCase();
  if (!ASCII_WORD.test(needle)) return lower.includes(needle);
  return new RegExp(`(?<![a-z_])${needle}(?![a-z_])`).test(lower);
}

/** يستخرجُ مفاتيحَ السطحِ المُنادَاةَ نصّاً حرفيّاً. */
export function usedDocumentKeys(surface: Readonly<Record<string, string>>): ReadonlySet<string> {
  const pattern = /"(driver\.documents\.[A-Za-z0-9._]+)"/g;
  const keys = new Set<string>();
  for (const source of Object.values(surface)) {
    for (const match of source.matchAll(pattern)) {
      const key = match[1];
      if (key !== undefined) keys.add(key);
    }
  }
  return keys;
}

/** القاعدة ١ — مجموعةُ المفاتيحِ واحدةٌ في الثلاثةِ، وكلُّ مُنادًى موجودٌ. */
export function keyParityProblems(input: DriverDocumentsContractInput): readonly string[] {
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
  for (const key of usedDocumentKeys(input.surface)) {
    for (const [language, dictionary] of Object.entries(input.translations)) {
      if (!(key in dictionary)) {
        problems.push(`${language}: مفتاحٌ يُنادى في السطحِ وليسَ في القاموسِ «${key}».`);
      }
    }
  }
  return problems;
}

function requireKeys(
  input: DriverDocumentsContractInput,
  keys: readonly string[],
  verdict: string,
): string[] {
  const problems: string[] = [];
  for (const key of keys) {
    for (const [language, dictionary] of Object.entries(input.translations)) {
      if (!(key in dictionary)) problems.push(`${language}: ${verdict} «${key}».`);
    }
  }
  return problems;
}

/**
 * القاعدة ٢ — كلُّ نوعٍ وحالةٍ ورمزِ حجبٍ له نصُّه في الثلاثةِ.
 *
 * وهذه هيَ القاعدةُ التي تجعلُ **زيادةَ نوعِ وثيقةٍ تُسقِطُ البناءَ** حتّى
 * يُكتَبَ نصُّها بثلاثِ لغاتٍ: فلا يُحجَبُ عملُ سائقٍ بسببٍ لا يُقرأُ.
 */
export function documentTextProblems(input: DriverDocumentsContractInput): readonly string[] {
  if (input.documentTypes.length === 0 || input.blockCodes.length === 0) {
    return [`${DOMAIN_FILE}: قوائمُ النطاقِ فارغةٌ — الحاجزُ لا يمرُّ بفراغٍ.`];
  }
  return [
    ...requireKeys(
      input,
      input.documentTypes.map((type) => `${KEY_PREFIX}type.${type}`),
      "نوعُ وثيقةٍ بلا نصٍّ",
    ),
    ...requireKeys(
      input,
      input.documentStatuses.map((status) => `${KEY_PREFIX}status.${status}`),
      "حالةُ وثيقةٍ بلا نصٍّ",
    ),
    ...requireKeys(
      input,
      [
        ...input.blockCodes.map((code) => `${KEY_PREFIX}block.${code}`),
        `${KEY_PREFIX}block.UNKNOWN`,
      ],
      "رمزُ حجبٍ بلا نصٍّ",
    ),
    // الغيابُ حالةٌ يراها السائقُ أكثرَ من كلِّ حالةٍ منشورةٍ.
    ...requireKeys(input, [`${KEY_PREFIX}status.missing`], "حالةُ الغيابِ بلا نصٍّ"),
  ];
}

/** رموزُ الخطأِ التي يُصنِّفُها السطحُ معروفةً — تُقرأُ من مجموعةِ العرضِ نصّاً. */
export function knownErrorCodesInSurface(
  surface: Readonly<Record<string, string>>,
): ReadonlySet<string> {
  const source = surface["apps/miniapp/src/surfaces/driver/documents/documents-view.ts"] ?? "";
  const block = source.match(/KNOWN_ERRORS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
  const codes = new Set<string>();
  if (block === null) return codes;
  for (const entry of (block[1] ?? "").matchAll(/"([A-Z_]+)"/g)) {
    const code = entry[1];
    if (code !== undefined) codes.add(code);
  }
  return codes;
}

/**
 * القاعدة ٣ — كلُّ رمزٍ عامٍّ له نصُّه، ولا رمزَ «معروفٌ» في السطحِ خارجَ ما
 * يُصدِرُه التطبيقُ فعلاً (وزيادةُ رمزٍ في التطبيقِ بلا نصٍّ = سائقٌ يقرأُ
 * «تعثَّرَ الطلبُ» عن رفضٍ له سببٌ مُسمّىً).
 */
export function errorTextProblems(input: DriverDocumentsContractInput): readonly string[] {
  if (input.publicErrorCodes.length === 0) {
    return [`${APPLICATION_FILE}: قائمةُ الرموزِ العامّةِ فارغةٌ — الحاجزُ لا يمرُّ بفراغٍ.`];
  }
  const problems = requireKeys(
    input,
    [
      ...input.publicErrorCodes.map((code) => `${KEY_PREFIX}error.${code}`),
      `${KEY_PREFIX}error.UNKNOWN`,
    ],
    "رمزُ خطأٍ بلا نصٍّ",
  );
  const published = new Set([...input.publicErrorCodes, "UPLOAD_FAILED"]);
  for (const code of knownErrorCodesInSurface(input.surface)) {
    if (!published.has(code)) {
      problems.push(
        `documents-view.ts: الرمزُ «${code}» يُصنَّفُ معروفاً ولا يُصدِرُه التطبيقُ — ` +
          `نصٌّ لا يُعرَضُ أبداً يُخفي أنَّ رمزاً حقيقيّاً بلا نصٍّ.`,
      );
    }
  }
  return problems;
}

/** القاعدة ٤ — نزعُ تنفيذٍ لكلِّ دالّةٍ، بالأدوارِ الثلاثةِ مُسمّاةً. */
export function revokeProblems(input: DriverDocumentsContractInput): readonly string[] {
  const problems: string[] = [];
  const sql = stripSqlComments(input.functionsSql).toLowerCase().replace(/\s+/g, " ");
  const created = [...sql.matchAll(/create (?:or replace )?function ([a-z0-9_]+)\s*\(/g)].map(
    (match) => match[1] ?? "",
  );
  if (created.length === 0) {
    return [`${FUNCTIONS_SQL_FILE}: لم تُقرأْ دالّةٌ واحدةٌ — القاعدةُ لا تمرُّ بقائمةٍ فارغةٍ.`];
  }
  for (const name of new Set(created)) {
    const match = sql.match(
      new RegExp(`revoke (?:all|execute) on function ${name}\\s*\\([^)]*\\) from ([^;]+);`),
    );
    if (match === null) {
      problems.push(
        `${FUNCTIONS_SQL_FILE}: «${name}» بلا نزعِ تنفيذٍ — و«public» يُمنَحُ التنفيذَ تلقائيّاً.`,
      );
      continue;
    }
    const roles = match[1] ?? "";
    for (const role of REVOKED_ROLES) {
      if (!roles.includes(role)) {
        problems.push(
          `${FUNCTIONS_SQL_FILE}: نزعُ تنفيذِ «${name}» لا يذكرُ «${role}» — نزعٌ ناقصٌ بابٌ مفتوحٌ.`,
        );
      }
    }
  }
  return problems;
}

/**
 * القاعدة ٥ — لا تفويضَ ذاهبٌ إلى مضيفِ المخزنِ، ولا مسارَ يُبنى في العميلِ.
 *
 * والمسارُ يُبنى في القاعدةِ وحدَها (`drivers/<driver_id>/<doc_type>/<uuid>`):
 * عميلٌ يبنيه يبني ما يُردُّ عليه `OBJECT_PATH_NOT_MINE` — أو يُطابِقُ بادئةَ
 * غيرِه يوماً.
 */
export function clientUploadProblems(input: DriverDocumentsContractInput): readonly string[] {
  const problems: string[] = [];
  const source = input.surface[CLIENT_UPLOAD_FILE];
  if (source === undefined) {
    return [`${CLIENT_UPLOAD_FILE}: غيرُ مقروءٍ — الحاجزُ لا يمرُّ بغيابِ مِلفٍّ.`];
  }
  for (const token of FORBIDDEN_CLIENT_TOKENS) {
    if (mentions(source, token)) {
      problems.push(
        `${CLIENT_UPLOAD_FILE}: يذكرُ «${token}» — الرفعُ يذهبُ إلى مضيفٍ ليسَ لنا، ` +
          `وترويسةُ تفويضٍ إليه تُسلِّمُ جلسةَ السائقِ أو مفتاحَ الخدمةِ لطرفٍ ثالثٍ.`,
      );
    }
  }
  if (/["'`]drivers\//.test(source)) {
    problems.push(`${CLIENT_UPLOAD_FILE}: يبني مسارَ كائنٍ بنفسِه — المسارُ حكمُ القاعدةِ وحدَها.`);
  }
  return problems;
}

/** القاعدة ٦ — لا مسارَ ولا رمزَ ولا عنوانَ في سجلِّ الخادمِ. */
export function logHygieneProblems(input: DriverDocumentsContractInput): readonly string[] {
  const problems: string[] = [];
  const calls = [...input.route.matchAll(/deps\.log\?\.\(([\s\S]*?)\}\);/g)];
  if (calls.length === 0) {
    return [`${ROUTE_FILE}: لا سطرَ سجلٍّ مقروءاً — الحاجزُ لا يمرُّ بفراغٍ.`];
  }
  for (const call of calls) {
    const body = call[1] ?? "";
    for (const field of FORBIDDEN_LOG_FIELDS) {
      if (mentions(body, field)) {
        problems.push(
          `${ROUTE_FILE}: سطرُ سجلٍّ يكتبُ «${field}» — إذنٌ موقَّعٌ في سجلٍّ ` +
            `يبقى صالحاً لمن قرأَ السجلَّ، والسجلُّ يُقرأُ أكثرَ من الردِّ.`,
        );
      }
    }
  }
  return problems;
}

/** القاعدة ٧ — عددُ الأنواعِ واحدٌ في الهجرةِ والنطاقِ والقاموسِ. */
export function typeParityProblems(input: DriverDocumentsContractInput): readonly string[] {
  const problems: string[] = [];
  const enumBlock = stripSqlComments(input.tableSql).match(
    /create type driver_document_type as enum \(([\s\S]*?)\)/i,
  );
  if (enumBlock === null) {
    return [`${TABLE_SQL_FILE}: لم يُقرأْ نوعُ «driver_document_type» — لا مرجعَ للأنواعِ.`];
  }
  const inSql = new Set(
    [...(enumBlock[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? ""),
  );
  for (const type of input.documentTypes) {
    if (!inSql.has(type)) {
      problems.push(`${DOMAIN_FILE}: النوعُ «${type}» ليسَ في تعدادِ القاعدةِ — نوعٌ لا يُقبَلُ صفّاً.`);
    }
  }
  for (const type of inSql) {
    if (!input.documentTypes.includes(type)) {
      problems.push(
        `${TABLE_SQL_FILE}: النوعُ «${type}» في القاعدةِ وليسَ في النطاقِ — ` +
          `القاعدةُ تحجبُ بسببٍ لا تعرفُه الشاشةُ.`,
      );
    }
  }
  return problems;
}

/** الحكمُ المُجمَّعُ — سبعُ قواعدَ بترتيبِها، وكلُّ مشكلةٍ بموضعِها وسببِها. */
export function driverDocumentsContractProblems(
  input: DriverDocumentsContractInput,
): readonly string[] {
  return [
    ...keyParityProblems(input),
    ...documentTextProblems(input),
    ...errorTextProblems(input),
    ...revokeProblems(input),
    ...clientUploadProblems(input),
    ...logHygieneProblems(input),
    ...typeParityProblems(input),
  ];
}
