/**
 * الغرض: قواعدُ عقدِ سطحِ الدعمِ والشكوى — أحكامٌ نقيّةٌ تُقاسُ بمدخلاتٍ مصنوعةٍ
 *   (البند `F2-12` · `SR-11`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-support-intake-contract.ts` و`tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: `SD-10` (دعمُ السائقِ) — تُزادُ مِلفّاتُه ههنا ولا
 *   تُكتَبُ قواعدُ ثانيةٌ للسؤالِ نفسِه.
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
 *   ــ **لا يمنعُ ذكرَ «صورةٍ» في النصِّ**: سطرُ الدَّينِ يقولُ «إرفاقُ صورةٍ لم
 *      يُبنَ» — وهوَ إفصاحٌ واجبٌ. والممنوعُ **آليّةُ** رفعٍ لا ذكرُها.
 */

import { RIDER_SUPPORT_PUBLIC_ERROR_CODES } from "../../packages/application/support/rider-support.ts";
import {
  RIDER_SUPPORT_CATEGORIES,
  SUPPORT_TICKET_REFERENCE_PATTERN,
  SUPPORT_TICKET_STATUSES,
} from "../../packages/domain/support/rider-support.ts";

/** مِلفّاتُ سطحِ الدعمِ — مكتوبةً لا مُكتشَفةً بنمطٍ. */
export const SURFACE_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/rider/support/SupportScreen.tsx",
  "apps/miniapp/src/surfaces/rider/support/support-view.ts",
  "apps/miniapp/src/surfaces/rider/support/support-api.ts",
  "apps/miniapp/src/surfaces/rider/support/support-contract.ts",
];

/** الشاشةُ وحدَها — عليها القاعدةُ ٥ (المرجعُ يُعرَضُ). */
export const SCREEN_FILE = "apps/miniapp/src/surfaces/rider/support/SupportScreen.tsx";

/** هجرةُ البندِ التي تُنشئُ المرجعَ والدالّاتِ. */
export const SUPPORT_SQL_FILE =
  "supabase/migrations/20260914220000_f2_12_support_reference_and_rider_categories.sql";

export const TRANSLATION_FILES: Readonly<Record<string, string>> = {
  ar: "packages/shared/i18n/miniapp/ar.json",
  en: "packages/shared/i18n/miniapp/en.json",
  ur: "packages/shared/i18n/miniapp/ur.json",
};

/** بادئةُ مفاتيحِ هذا السطحِ. */
export const KEY_PREFIX = "rider.support.";

/** مفتاحُ السقوطِ لرمزٍ لا تعرفُه هذه النسخةُ (القاعدة ٣). */
export const FALLBACK_KEYS: readonly string[] = [
  "rider.support.error.UNKNOWN",
  "rider.support.category.unknown",
  "rider.support.status.unknown",
];

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

/**
 * أصنافُ التذاكرِ التي **تُقرأُ ولا تُختارُ**: `subscription` يفتحُها السائقُ من
 * بوتِه، ويراها الراكبُ في «تذاكري» لو كانَ سائقاً. فلها نصٌّ واجبٌ **وليسَ**
 * لها مدخلٌ في نموذجِ الفتحِ — ومَن رآها في القائمةِ بلا نصٍّ ظنَّ العطبَ.
 */
export const READ_ONLY_CATEGORIES: readonly string[] = ["subscription"];

export interface SupportIntakeContractInput {
  /** مِلفّاتُ السطحِ: مسارٌ ⇒ شِفرةٌ **بلا تعليقاتٍ**. */
  readonly surface: Readonly<Record<string, string>>;
  /** نصُّ هجرةِ البندِ كما هوَ. */
  readonly sql: string;
  /** القواميسُ الثلاثةُ مُحلَّلةً: لغةٌ ⇒ (مفتاحٌ ⇒ نصٌّ). */
  readonly translations: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** الأصنافُ كما نشرَها النطاقُ. */
  readonly categories: readonly string[];
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

/** القاعدة ١ — لكلِّ صنفٍ وحالةٍ ورمزٍ نصٌّ في كلِّ قاموسٍ. */
export function textCoverageProblems(input: SupportIntakeContractInput): readonly string[] {
  const problems: string[] = [];
  const groups: readonly { readonly label: string; readonly keys: readonly string[] }[] = [
    {
      label: "صنفُ شكوى",
      keys: [...input.categories, ...READ_ONLY_CATEGORIES].map((c) => `${KEY_PREFIX}category.${c}`),
    },
    { label: "حالةُ تذكرةٍ", keys: input.statuses.map((s) => `${KEY_PREFIX}status.${s}`) },
    { label: "رمزُ عطبٍ", keys: input.errorCodes.map((c) => `${KEY_PREFIX}error.${c}`) },
  ];
  // مجالٌ فارغٌ يجعلُ القاعدةَ تمرُّ زوراً — والفراغُ خللُ قراءةٍ لا براءةٌ.
  if (
    input.categories.length === 0 ||
    input.statuses.length === 0 ||
    input.errorCodes.length === 0
  ) {
    problems.push("لم يُقرأْ صنفٌ أو حالةٌ أو رمزُ عطبٍ واحدٌ — القاعدةُ لا تمرُّ بمجالٍ فارغٍ.");
    return problems;
  }
  for (const group of groups) {
    for (const key of group.keys) {
      for (const [language, dictionary] of Object.entries(input.translations)) {
        if (!(key in dictionary)) {
          problems.push(
            `${language}: ${group.label} بلا نصٍّ («${key}») — ` +
              `يُعرَضُ مفتاحاً خاماً في اللحظةِ التي يشكو فيها إنسانٌ.`,
          );
        }
      }
    }
  }
  return problems;
}

/** القاعدة ٢ — مفاتيحُ البادئةِ متطابقةٌ في القواميسِ الثلاثةِ. */
export function keyParityProblems(input: SupportIntakeContractInput): readonly string[] {
  const problems: string[] = [];
  const languages = Object.keys(input.translations);
  if (languages.length < 2) {
    return ["لم يُقرأْ قاموسانِ على الأقلِّ — قاعدةُ التطابقِ لا تمرُّ بقاموسٍ واحدٍ."];
  }
  const keysOf = (language: string): ReadonlySet<string> =>
    new Set(
      Object.keys(input.translations[language] ?? {}).filter((k) => k.startsWith(KEY_PREFIX)),
    );
  const reference = keysOf("ar");
  if (reference.size === 0) {
    return ["القاموسُ العربيُّ بلا مفتاحِ دعمٍ واحدٍ — القاعدةُ لا تمرُّ بمرجعٍ فارغٍ."];
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
  return problems;
}

/** القاعدة ٣ — مفاتيحُ السقوطِ موجودةٌ في كلِّ قاموسٍ. */
export function fallbackKeyProblems(input: SupportIntakeContractInput): readonly string[] {
  const problems: string[] = [];
  for (const key of FALLBACK_KEYS) {
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

/** القاعدة ٧ — كلُّ دالّةٍ في الهجرةِ يُنزَعُ تنفيذُها عن الأدوارِ الثلاثةِ. */
export function functionRevokeProblems(input: SupportIntakeContractInput): readonly string[] {
  const problems: string[] = [];
  const sql = input.sql.toLowerCase().replace(/\s+/g, " ");
  // الاسمُ يُقرأُ **بلا مُخطَّطٍ**: `public.f(...)` و`f(...)` دالّةٌ واحدةٌ، وحاجزٌ
  // يقرأُ الأوّلَ ولا يقرأُ الثانيَ يمرُّ أخضرَ على هجرةٍ لم تنزعْ شيئاً.
  const created = [
    ...sql.matchAll(/create (?:or replace )?function (?:public\.)?([a-z0-9_]+)\s*\(/g),
  ].map((match) => match[1] ?? "");
  if (created.length === 0) {
    problems.push(`${SUPPORT_SQL_FILE}: لم تُقرأْ دالّةٌ واحدةٌ — القاعدةُ لا تمرُّ بقائمةٍ فارغةٍ.`);
    return problems;
  }
  for (const name of new Set(created)) {
    const pattern = new RegExp(
      `revoke execute on function (?:public\\.)?${name}\\s*\\([^)]*\\) from ([^;]+);`,
    );
    const match = sql.match(pattern);
    if (match === null) {
      problems.push(
        `${SUPPORT_SQL_FILE}: الهجرةُ تُنشئُ «${name}» ولا تنزعُ تنفيذَها — ` +
          `و«public» يُمنَحُ التنفيذَ تلقائيّاً فتصيرُ الدالّةُ منالاً للمفتاحِ العامِّ.`,
      );
      continue;
    }
    const roles = match[1] ?? "";
    for (const role of REVOKED_ROLES) {
      if (!roles.includes(role)) {
        problems.push(
          `${SUPPORT_SQL_FILE}: نزعُ تنفيذِ «${name}» لا يذكرُ «${role}» — نزعٌ ناقصٌ بابٌ مفتوحٌ.`,
        );
      }
    }
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
export const ERROR_CODES: readonly string[] = RIDER_SUPPORT_PUBLIC_ERROR_CODES;
export const REFERENCE_PATTERN: RegExp = SUPPORT_TICKET_REFERENCE_PATTERN;
