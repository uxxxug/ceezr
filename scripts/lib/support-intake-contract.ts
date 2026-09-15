/**
 * الغرض: قواعدُ عقدِ سطحِ الدعمِ والشكوى — أحكامٌ نقيّةٌ تُقاسُ بمدخلاتٍ مصنوعةٍ
 *   (البند `F2-12` · `SR-11`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-support-intake-contract.ts` و`tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: أيُّ دورٍ ثالثٍ يفتحُ تذكرةً — يُزادُ **مدخلاً في
 *   `SUPPORT_ROLES`** ولا تُكتَبُ قواعدُ ثانيةٌ للسؤالِ نفسِه.
 * زِيدَ في: البند `F3-08` · `SD-10` (دعمُ السائقِ) — القواعدُ السبعُ نفسُها
 *   تُقاسُ على **دورَينِ** لا على دورٍ واحدٍ.
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ## لماذا حاجزٌ خاصٌّ لسطحٍ يبدو بسيطاً
 *
 * لأنَّ هذا السطحَ يُخلِفُ **بصمتٍ نافعٍ لنا**. شكوى لا تُفتَحُ يراها صاحبُها
 * فيُعيدُ. أمّا **رمزٌ بلا نصٍّ** فيُعرَضُ مفتاحاً خاماً في اللحظةِ التي يشكو
 * فيها إنسانٌ من عطبٍ — فيصيرُ العطبُ عطبَينِ. و**مرجعٌ لا يُعرَضُ** يُنتِجُ
 * تذاكرَ لا يستطيعُ أحدٌ متابعتَها فتُقرأُ في القياسِ «شكاوى قليلةٌ». والأسوأُ
 * **بابُ إرفاقٍ صوريٌّ**: مَن رفعَ صورةَ إيصالٍ ظنَّ أنَّه سلَّمَ دليلَه.
 *
 * ## القواعدُ السبعُ ولِمَ كلٌّ منها
 *
 *   ١. **لكلِّ صنفٍ وحالةٍ ورمزِ عطبٍ نصٌّ في القواميسِ الثلاثةِ**: المجالُ
 *      مُعلَنٌ في النطاقِ والتطبيقِ، والشاشةُ تُترجِمُ بمفتاحٍ — فرمزٌ بلا نصٍّ
 *      يظهرُ خاماً أو لا يظهرُ.
 *   ٢. **مفاتيحُ `rider.support.` متطابقةٌ في القواميسِ الثلاثةِ**: حاجزُ
 *      `check-i18n.ts` يقرأُ `packages/shared/i18n/*.json` وحدَها **ولا يقرأُ
 *      قواميسَ التطبيقِ المُصغَّرِ** — فالتطابقُ ههنا يُفرَضُ أو لا يُفرَضُ أبداً.
 *   ٣. **مفتاحُ سقوطٍ لرمزٍ مجهولٍ موجودٌ**: خادمٌ أحدثُ من واجهةٍ يُرسِلُ رمزاً
 *      لم يُعرَفْ، وشاشةٌ بلا سقوطٍ تعرضُ فراغاً في موضعِ العطبِ.
 *   ٤. **المرجعُ نصٌّ منطوقٌ لا UUID**: نمطُ النطاقِ يُطابِقُ `WSL-000001`،
 *      والهجرةُ تولِّدُه من متسلسلةٍ لا من `gen_random_uuid()`. ومرجعٌ بـ٣٦ محرفاً
 *      لا يُقالُ في مكالمةٍ ولا يُنسَخُ بلا خطأٍ.
 *   ٥. **المرجعُ يُعرَضُ في الشاشةِ**: إيصالٌ يقولُ «تمَّ الإرسالُ» ولا يعرضُ
 *      رقماً يتركُ الإنسانَ بلا شيءٍ يُطالِبُ به.
 *   ٦. **لا بابَ إرفاقٍ**: لا `type="file"` ولا `FormData` ولا `upload` في
 *      السطحِ. الرفعُ **دَينٌ مُعلَنٌ**، وزرٌّ يرفعُ إلى لا شيءٍ وعدٌ كاذبٌ.
 *   ٧. **كلُّ دالّةٍ في هجرةِ البندِ يُنزَعُ تنفيذُها عن الأدوارِ الثلاثةِ**:
 *      المنحُ لـ`public` ضمنيٌّ في PostgreSQL، فالنسيانُ هوَ الافتراضُ.
 *
 * ## وما لا يفعلُه هذا الحاجزُ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا يحكمُ في جودةِ النصِّ ولا في ترجمتِه**: يفرضُ وجودَه لا صحّتَه
 *      اللغويّةَ. ودقّةُ الأردو والإنجليزيّةِ مراجعةٌ بشريّةٌ مُعلَنةٌ كدَينٍ.
 *   ــ **لا يُشغِّلُ قاعدةً**: يقرأُ نصَّ الهجرةِ. والأثرُ يُقاسُ في `tests/integration`.
 *   ــ **لا يقيسُ تطابقَ نصِّ الراكبِ ونصِّ السائقِ**: المفتاحانِ مِرآةٌ في
 *      البِنيةِ لا في المعنى — «خصمٌ من مستحقّاتي» للسائقِ و«خصمٌ من مستحقّاتِ
 *      سائقٍ» للراكبِ الذي يراها في قائمتِه، وحاجزٌ يُلزِمُ التساويَ يُنتِجُ نصّاً
 *      كاذباً لأحدِهما.
 *   ــ **لا يمنعُ ذكرَ «صورةٍ» في النصِّ**: سطرُ الدَّينِ يقولُ «إرفاقُ صورةٍ لم
 *      يُبنَ» — وهوَ إفصاحٌ واجبٌ. والممنوعُ **آليّةُ** رفعٍ لا ذكرُها.
 */

import { SUPPORT_PUBLIC_ERROR_CODES } from "../../packages/application/support/intake.ts";
import { DRIVER_SUPPORT_CATEGORIES } from "../../packages/domain/support/driver-support.ts";
import {
  RIDER_SUPPORT_CATEGORIES,
  SUPPORT_TICKET_REFERENCE_PATTERN,
  SUPPORT_TICKET_STATUSES,
} from "../../packages/domain/support/rider-support.ts";

/**
 * مِلفّاتُ سطحِ الدعمِ — مكتوبةً لا مُكتشَفةً بنمطٍ، و**اللبُّ المشتركُ ضمنَها**:
 * بابُ إرفاقٍ يُزرَعُ في اللبِّ يظهرُ في الشاشتَينِ معاً، فحاجزٌ يقرأُ مِلفّاتِ
 * الدورَينِ ولا يقرأُ ما يشتركانِ فيه يمرُّ أخضرَ على أخطرِ موضعٍ.
 */
export const SURFACE_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/support/TicketsScreen.tsx",
  "apps/miniapp/src/surfaces/support/ticket-view.ts",
  "apps/miniapp/src/surfaces/support/ticket-api.ts",
  "apps/miniapp/src/surfaces/support/ticket-contract.ts",
  "apps/miniapp/src/surfaces/rider/support/SupportScreen.tsx",
  "apps/miniapp/src/surfaces/rider/support/support-view.ts",
  "apps/miniapp/src/surfaces/rider/support/support-api.ts",
  "apps/miniapp/src/surfaces/rider/support/support-contract.ts",
  "apps/miniapp/src/surfaces/driver/support/SupportScreen.tsx",
  "apps/miniapp/src/surfaces/driver/support/support-view.ts",
  "apps/miniapp/src/surfaces/driver/support/support-api.ts",
];

/**
 * الشاشةُ التي تحملُ القاعدةَ ٥ (المرجعُ يُعرَضُ) — **الشاشةُ المشتركةُ** بعدَ
 * `SD-10`، لا شاشةُ الراكبِ. وشاشةُ الراكبِ اليومَ مُحوِّلٌ نحيفٌ يُمرِّرُ وصفاً
 * إلى اللبِّ ولا يكتبُ حرفاً من العرضِ؛ فقاعدةٌ تقرأُ فيها كلمةَ `reference`
 * تسقطُ على تصحيحٍ صحيحٍ — وذاكَ حاجزٌ يُعلِّمُ نقلَ الشِفرةِ لا جودتَها.
 */
export const SCREEN_FILE = "apps/miniapp/src/surfaces/support/TicketsScreen.tsx";

/**
 * هجرةُ المرجعِ — عليها القاعدةُ ٤ وحدَها (المتسلسلةُ تُنشأُ مرّةً واحدةً في
 * عمرِ المشروعِ، وهجرةٌ لاحقةٌ لا تُعيدُ إنشاءَها).
 */
export const SUPPORT_SQL_FILE =
  "supabase/migrations/20260914220000_f2_12_support_reference_and_rider_categories.sql";

/**
 * كلُّ هجرةٍ تُنشئُ أو تُعيدُ إنشاءَ دالّةِ دعمٍ — عليها القاعدةُ ٧. و`create or
 * replace` **يُعيدُ منحَ التنفيذِ ضمنيّاً**، فهجرةٌ ثانيةٌ تُعيدُ كتابةَ دالّةٍ
 * سابقةٍ ولا تنزعُ تنفيذَها تفتحُ بابَ الأولى من جديدٍ.
 */
export const SUPPORT_SQL_FILES: readonly string[] = [
  SUPPORT_SQL_FILE,
  "supabase/migrations/20260916020000_f3_08_driver_support_tickets.sql",
];

export const TRANSLATION_FILES: Readonly<Record<string, string>> = {
  ar: "packages/shared/i18n/miniapp/ar.json",
  en: "packages/shared/i18n/miniapp/en.json",
  ur: "packages/shared/i18n/miniapp/ur.json",
};

/**
 * أصنافٌ **تُقرأُ ولا تُختارُ** في مِلفِّ دورٍ: التذكرةُ يفتحُها الدورُ الآخرُ
 * ويراها هذا في «تذاكري» لأنَّ مجالَ القراءةِ أوسعُ من مجالِ الكتابةِ (إنسانٌ
 * واحدٌ راكبٌ وسائقٌ معاً). فلها نصٌّ واجبٌ **وليسَ** لها مدخلٌ في نموذجِ الفتحِ،
 * ومَن رآها في قائمتِه بلا نصٍّ ظنَّ العطبَ.
 */
export interface SupportRoleScope {
  /** اسمٌ يُقرأُ في رسالةِ الخرقِ. */
  readonly label: string;
  /** بادئةُ مفاتيحِ هذا الدورِ في قواميسِ التطبيقِ المُصغَّرِ. */
  readonly keyPrefix: string;
  /** أصنافٌ يختارُها هذا الدورُ في نموذجِ الفتحِ. */
  readonly selectable: readonly string[];
  /** أصنافٌ يقرؤها ولا يختارُها. */
  readonly readOnly: readonly string[];
}

/** الدورانِ اللذانِ يفتحانِ تذكرةً اليومَ — مصدرُ الأصنافِ هوَ النطاقُ. */
export const SUPPORT_ROLES: readonly SupportRoleScope[] = [
  {
    label: "الراكبُ",
    keyPrefix: "rider.support.",
    selectable: RIDER_SUPPORT_CATEGORIES,
    // `subscription` كانَ الاستثناءَ الوحيدَ قبلَ `SD-10`؛ ثمَّ صارَ للسائقِ
    // ثلاثةُ أصنافٍ أخرى يراها الراكبُ في قائمتِه لو كانَ سائقاً.
    readOnly: ["subscription", "deduction", "rider_conduct", "vehicle"],
  },
  {
    label: "السائقُ",
    keyPrefix: "driver.support.",
    selectable: DRIVER_SUPPORT_CATEGORIES,
    readOnly: ["ride_dispute", "lost_item", "driver_conduct"],
  },
];

/** بادئةُ مفاتيحِ الراكبِ — تُركَت لأنَّ مِلفّاتٍ أخرى تستوردُها بالاسمِ. */
export const KEY_PREFIX = "rider.support.";

/** مفاتيحُ السقوطِ لرمزٍ لا تعرفُه هذه النسخةُ — لكلِّ دورٍ نسخةٌ (القاعدة ٣). */
export const FALLBACK_SUFFIXES: readonly string[] = [
  "error.UNKNOWN",
  "category.unknown",
  "status.unknown",
];

export const FALLBACK_KEYS: readonly string[] = SUPPORT_ROLES.flatMap((role) =>
  FALLBACK_SUFFIXES.map((suffix) => `${role.keyPrefix}${suffix}`),
);

/** آليّاتُ الرفعِ — ممنوعةٌ في السطحِ (القاعدة ٦). */
export const UPLOAD_TOKENS: readonly string[] = [
  'type="file"',
  "FormData",
  "multipart/form-data",
  "createObjectURL",
  "uploadAttachment",
];

/** الأدوارُ التي لا يجوزُ أن تُنفِّذَ دالّةً من دوالِّنا (القاعدة ٧). */
export const REVOKED_ROLES: readonly string[] = ["public", "anon", "authenticated"];

/** أصنافُ الراكبِ التي تُقرأُ ولا تُختارُ — يُقرأُ من `SUPPORT_ROLES`. */
export const READ_ONLY_CATEGORIES: readonly string[] = SUPPORT_ROLES[0]?.readOnly ?? [];

export interface SupportIntakeContractInput {
  /** مِلفّاتُ السطحِ: مسارٌ ⇒ شِفرةٌ **بلا تعليقاتٍ**. */
  readonly surface: Readonly<Record<string, string>>;
  /** نصُّ هجرةِ المرجعِ كما هوَ (القاعدة ٤). */
  readonly sql: string;
  /** نصُّ كلِّ هجرةِ دعمٍ: مسارٌ ⇒ نصٌّ (القاعدة ٧). */
  readonly sqlByPath: Readonly<Record<string, string>>;
  /** القواميسُ الثلاثةُ مُحلَّلةً: لغةٌ ⇒ (مفتاحٌ ⇒ نصٌّ). */
  readonly translations: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** الأدوارُ ومجالُ كلِّ دورٍ — لا دورٌ واحدٌ مضمَرٌ. */
  readonly roles: readonly SupportRoleScope[];
  /** الحالاتُ كما نشرَها النطاقُ. */
  readonly statuses: readonly string[];
  /** رموزُ العطبِ كما نشرَها التطبيقُ. */
  readonly errorCodes: readonly string[];
  /** نمطُ المرجعِ كما نشرَه النطاقُ. */
  readonly referencePattern: RegExp;
}

function mentions(text: string, token: string): boolean {
  return text.toLowerCase().includes(token.toLowerCase());
}

/** القاعدة ١ — لكلِّ صنفٍ وحالةٍ ورمزٍ نصٌّ في كلِّ قاموسٍ، **لكلِّ دورٍ**. */
export function textCoverageProblems(input: SupportIntakeContractInput): readonly string[] {
  const problems: string[] = [];
  // مجالٌ فارغٌ يجعلُ القاعدةَ تمرُّ زوراً — والفراغُ خللُ قراءةٍ لا براءةٌ.
  if (input.roles.length === 0 || input.statuses.length === 0 || input.errorCodes.length === 0) {
    problems.push("لم يُقرأْ دورٌ أو حالةٌ أو رمزُ عطبٍ واحدٌ — القاعدةُ لا تمرُّ بمجالٍ فارغٍ.");
    return problems;
  }
  for (const role of input.roles) {
    if (role.selectable.length === 0) {
      problems.push(`${role.label}: لم يُقرأْ صنفٌ واحدٌ يُختارُ — القاعدةُ لا تمرُّ بمجالٍ فارغٍ.`);
      continue;
    }
    const groups: readonly { readonly label: string; readonly keys: readonly string[] }[] = [
      {
        label: "صنفُ شكوى",
        keys: [...role.selectable, ...role.readOnly].map((c) => `${role.keyPrefix}category.${c}`),
      },
      { label: "حالةُ تذكرةٍ", keys: input.statuses.map((s) => `${role.keyPrefix}status.${s}`) },
      { label: "رمزُ عطبٍ", keys: input.errorCodes.map((c) => `${role.keyPrefix}error.${c}`) },
    ];
    for (const group of groups) {
      for (const key of group.keys) {
        for (const [language, dictionary] of Object.entries(input.translations)) {
          if (!(key in dictionary)) {
            problems.push(
              `${language} · ${role.label}: ${group.label} بلا نصٍّ («${key}») — ` +
                `يُعرَضُ مفتاحاً خاماً في اللحظةِ التي يشكو فيها إنسانٌ.`,
            );
          }
        }
      }
    }
  }
  return problems;
}

/** القاعدة ٢ — مفاتيحُ كلِّ بادئةٍ متطابقةٌ في القواميسِ الثلاثةِ. */
export function keyParityProblems(input: SupportIntakeContractInput): readonly string[] {
  const problems: string[] = [];
  const languages = Object.keys(input.translations);
  if (languages.length < 2) {
    return ["لم يُقرأْ قاموسانِ على الأقلِّ — قاعدةُ التطابقِ لا تمرُّ بقاموسٍ واحدٍ."];
  }
  if (input.roles.length === 0) {
    return ["لم يُقرأْ دورٌ واحدٌ — قاعدةُ التطابقِ لا تمرُّ بمجالٍ فارغٍ."];
  }
  for (const role of input.roles) {
    const keysOf = (language: string): ReadonlySet<string> =>
      new Set(
        Object.keys(input.translations[language] ?? {}).filter((k) => k.startsWith(role.keyPrefix)),
      );
    const reference = keysOf("ar");
    if (reference.size === 0) {
      problems.push(
        `${role.label}: القاموسُ العربيُّ بلا مفتاحٍ واحدٍ ببادئةِ «${role.keyPrefix}» — ` +
          `القاعدةُ لا تمرُّ بمرجعٍ فارغٍ.`,
      );
      continue;
    }
    for (const language of languages) {
      if (language === "ar") continue;
      const keys = keysOf(language);
      for (const key of reference) {
        if (!keys.has(key)) problems.push(`${language}: مفتاحٌ ناقصٌ «${key}» مقابلَ العربيّةِ.`);
      }
      for (const key of keys) {
        if (!reference.has(key)) problems.push(`${language}: مفتاحٌ زائدٌ «${key}» لا مقابلَ له.`);
      }
    }
  }
  return problems;
}

/** القاعدة ٣ — مفاتيحُ السقوطِ موجودةٌ في كلِّ قاموسٍ. */
export function fallbackKeyProblems(input: SupportIntakeContractInput): readonly string[] {
  const problems: string[] = [];
  const keys = input.roles.flatMap((role) =>
    FALLBACK_SUFFIXES.map((suffix) => `${role.keyPrefix}${suffix}`),
  );
  for (const key of keys) {
    for (const [language, dictionary] of Object.entries(input.translations)) {
      if (!(key in dictionary)) {
        problems.push(
          `${language}: لا مفتاحَ سقوطٍ «${key}» — ` +
            `وخادمٌ أحدثُ من واجهةٍ يُرسِلُ رمزاً مجهولاً فيُعرَضُ فراغٌ موضعَ العطبِ.`,
        );
      }
    }
  }
  return problems;
}

/** القاعدة ٤ — المرجعُ منطوقٌ: نمطُ النطاقِ ومصدرُه في الهجرةِ. */
export function referenceShapeProblems(input: SupportIntakeContractInput): readonly string[] {
  const problems: string[] = [];
  const spoken = "WSL-000123";
  const uuid = "3f1c8a0e-1b2d-4c3e-8a9b-0d1e2f3a4b5c";
  if (!input.referencePattern.test(spoken)) {
    problems.push(
      `نمطُ المرجعِ لا يُطابِقُ «${spoken}» — والمرجعُ الذي لا يُقالُ في مكالمةٍ ليسَ مرجعاً (ADR 0114).`,
    );
  }
  if (input.referencePattern.test(uuid)) {
    problems.push("نمطُ المرجعِ يقبلُ UUID — و٣٦ محرفاً لا تُنسَخُ بلا خطأٍ ولا تُنطَقُ في مكالمةٍ.");
  }
  const sql = input.sql.toLowerCase();
  if (!sql.includes("support_ticket_reference_seq")) {
    problems.push(
      `${SUPPORT_SQL_FILE}: لا متسلسلةَ مرجعٍ — ومرجعٌ بلا متسلسلةٍ يُولَّدُ عشوائيّاً فيطولُ أو يتكرَّرُ.`,
    );
  }
  if (!sql.includes("unique") && !sql.includes("nextval")) {
    problems.push(`${SUPPORT_SQL_FILE}: لا توليدَ من متسلسلةٍ ولا تفرُّدَ للمرجعِ.`);
  }
  if (/reference[^;]*gen_random_uuid/.test(sql)) {
    problems.push(`${SUPPORT_SQL_FILE}: المرجعُ يُولَّدُ UUID — وذاكَ نقضُ ADR 0114 في مصدرِه.`);
  }
  return problems;
}

/** القاعدة ٥ — المرجعُ يُعرَضُ في الشاشةِ. */
export function referenceDisplayProblems(input: SupportIntakeContractInput): readonly string[] {
  const screen = input.surface[SCREEN_FILE];
  if (screen === undefined) {
    return [`${SCREEN_FILE}: لم تُقرأْ الشاشةُ — القاعدةُ لا تمرُّ بمِلفٍّ غائبٍ.`];
  }
  const problems: string[] = [];
  if (!mentions(screen, "reference")) {
    problems.push(
      `${SCREEN_FILE}: الشاشةُ لا تعرضُ المرجعَ — ` +
        `و«تمَّ الإرسالُ» بلا رقمٍ يتركُ الإنسانَ بلا شيءٍ يُطالِبُ به.`,
    );
  }
  return problems;
}

/** القاعدة ٦ — لا بابَ إرفاقٍ في السطحِ. */
export function uploadAffordanceProblems(input: SupportIntakeContractInput): readonly string[] {
  const problems: string[] = [];
  for (const [path, source] of Object.entries(input.surface)) {
    for (const token of UPLOAD_TOKENS) {
      if (mentions(source, token)) {
        problems.push(
          `${path}: بابُ إرفاقٍ («${token}») والرفعُ دَينٌ مُعلَنٌ — ` +
            `ومَن رفعَ صورةَ إيصالٍ إلى لا شيءٍ ظنَّ أنَّه سلَّمَ دليلَه.`,
        );
      }
    }
  }
  return problems;
}

/** القاعدة ٧ — كلُّ دالّةٍ في **كلِّ** هجرةِ دعمٍ يُنزَعُ تنفيذُها عن الأدوارِ الثلاثةِ. */
export function functionRevokeProblems(input: SupportIntakeContractInput): readonly string[] {
  const problems: string[] = [];
  const files = Object.entries(input.sqlByPath);
  if (files.length === 0) {
    problems.push("لم تُقرأْ هجرةٌ واحدةٌ — القاعدةُ لا تمرُّ بقائمةٍ فارغةٍ.");
    return problems;
  }
  for (const [path, text] of files) {
    const sql = text.toLowerCase().replace(/\s+/g, " ");
    // الاسمُ يُقرأُ **بلا مُخطَّطٍ**: `public.f(...)` و`f(...)` دالّةٌ واحدةٌ، وحاجزٌ
    // يقرأُ الأوّلَ ولا يقرأُ الثانيَ يمرُّ أخضرَ على هجرةٍ لم تنزعْ شيئاً.
    const created = [
      ...sql.matchAll(/create (?:or replace )?function (?:public\.)?([a-z0-9_]+)\s*\(/g),
    ].map((match) => match[1] ?? "");
    if (created.length === 0) {
      // هجرةُ أصنافٍ (قِيَمُ `enum`) لا تُنشئُ دالّةً — وذاكَ ليسَ خرقاً؛ الخرقُ
      // أن تُنشئَ ولا تنزعَ. فالفراغُ ههنا يُقاسُ على مستوى القائمةِ كلِّها أعلاه.
      continue;
    }
    for (const name of new Set(created)) {
      const pattern = new RegExp(
        `revoke execute on function (?:public\\.)?${name}\\s*\\([^)]*\\) from ([^;]+);`,
      );
      const match = sql.match(pattern);
      if (match === null) {
        problems.push(
          `${path}: الهجرةُ تُنشئُ «${name}» ولا تنزعُ تنفيذَها — ` +
            `و«public» يُمنَحُ التنفيذَ تلقائيّاً فتصيرُ الدالّةُ منالاً للمفتاحِ العامِّ.`,
        );
        continue;
      }
      const roles = match[1] ?? "";
      for (const role of REVOKED_ROLES) {
        if (!roles.includes(role)) {
          problems.push(`${path}: نزعُ تنفيذِ «${name}» لا يذكرُ «${role}» — نزعٌ ناقصٌ بابٌ مفتوحٌ.`);
        }
      }
    }
  }
  const anyCreated = files.some(([, text]) => /create (?:or replace )?function/i.test(text));
  if (!anyCreated) {
    problems.push("لم تُقرأْ دالّةٌ واحدةٌ في هجراتِ الدعمِ — القاعدةُ لا تمرُّ بقائمةٍ فارغةٍ.");
  }
  return problems;
}

/** الحكمُ الجامعُ — قائمةُ خرقٍ مقروءةٍ، فارغةٌ إن لم يكنْ خرقٌ. */
export function supportIntakeContractProblems(
  input: SupportIntakeContractInput,
): readonly string[] {
  return [
    ...textCoverageProblems(input),
    ...keyParityProblems(input),
    ...fallbackKeyProblems(input),
    ...referenceShapeProblems(input),
    ...referenceDisplayProblems(input),
    ...uploadAffordanceProblems(input),
    ...functionRevokeProblems(input),
  ];
}

/** المجالاتُ كما نشرَها النطاقُ والتطبيقُ — مصدرٌ واحدٌ لا نسخةٌ ههنا. */
export const CATEGORIES: readonly string[] = RIDER_SUPPORT_CATEGORIES;
export const STATUSES: readonly string[] = SUPPORT_TICKET_STATUSES;
/**
 * رموزُ العطبِ **واحدةٌ للدورَينِ**: اللبُّ المشتركُ (`packages/application/support/intake.ts`)
 * يُصدِرُها، ورمزٌ يُضافُ لأحدِ الدورَينِ دونَ نصٍّ للآخرِ يسقطُ هذا الحاجزُ.
 */
export const ERROR_CODES: readonly string[] = SUPPORT_PUBLIC_ERROR_CODES;
export const REFERENCE_PATTERN: RegExp = SUPPORT_TICKET_REFERENCE_PATTERN;
