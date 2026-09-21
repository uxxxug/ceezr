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
/**
 * هجرةُ الردِّ — عليها القاعدةُ ٨ معَ القاعدةِ ٧. وهيَ الموضعُ الذي يُقرَأُ منه
 * أنَّ الردَّ لا يقتضي سائقاً وأنَّه يُوجِبُ نصّاً: دعوى «الشكوى تُجاب» تُقرَأُ
 * من القاعدةِ لا من نصِّ وثيقةٍ.
 */
export const ANSWER_SQL_FILE =
  "supabase/migrations/20260921230000_step10_support_answer_resolution.sql";

export const SUPPORT_SQL_FILES: readonly string[] = [
  SUPPORT_SQL_FILE,
  "supabase/migrations/20260916020000_f3_08_driver_support_tickets.sql",
  // الخطوةُ ١٠ — تُعيدُ إنشاءَ `resolve_support_ticket` و`claim_notification_delivery`.
  ANSWER_SQL_FILE,
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

/**
 * القاعدةُ ٨ — ثوابتُها. كلُّها **بنصِّها الكاملِ لا بسابقةٍ**: سماحٌ بسابقةٍ
 * يُجيزُ مفتاحاً مختلفاً يبدأُ بها، وفحصٌ بسابقةٍ يمرُّ على غيرِ المقصودِ.
 */
export const BOT_DICTIONARY_FILES: Readonly<Record<string, string>> = {
  ar: "packages/shared/i18n/ar.json",
  en: "packages/shared/i18n/en.json",
  ur: "packages/shared/i18n/ur.json",
};

/** نصُّ الاستلامِ — وهوَ **الوعدُ** الذي يُقاسُ مسارُه. */
export const INTAKE_PROMISE_KEY = "support.ticket_created";

/**
 * لكلِّ فعلٍ مفتاحُ نصِّه. والمُقابَلةُ مكتوبةٌ ههنا ومُقاسٌ ذِكرُها في المُبلِّغِ:
 * فعلٌ يُزادُ في النطاقِ ولا نصَّ له يُسقِطُ البناءَ ولا يمرُّ صامتاً.
 */
/**
 * مفتاحُ نصِّ الردِّ مُفرَدٌ باسمِه لا يُنالُ بفهرسةِ خريطةٍ: الفهرسةُ تُعطي
 * `string | undefined`، ومقياسٌ يقرأُ قاموساً بمفتاحٍ `undefined` يقرأُ `undefined`
 * **فيمرُّ صامتاً** حيثُ كانَ يجبُ أن يسقُطَ. فالاسمُ المفرَدُ أمانٌ لا أناقةٌ.
 */
export const ANSWER_RESOLUTION_KEY = "support.resolved_answered";

export const SUPPORT_RESOLUTION_KEYS: Readonly<Record<string, string>> = {
  activate: "support.resolved_activated",
  terminate: "support.resolved_terminated",
  reject: "support.resolved_rejected",
  answer: ANSWER_RESOLUTION_KEY,
};

/** موضعُ المكتوبِ في نصِّ الردِّ — غيابُه يعني إطاراً بلا مضمونٍ. */
export const ANSWER_PLACEHOLDER = "{answer}";

/** ما يجبُ أن يُمرَّرَ في المُبلِّغِ ليُملأَ الموضعُ. */
export const ANSWER_NOTE_REFERENCE = "input.note";

export const ANSWER_NOTE_ERROR = "ANSWER_NOTE_REQUIRED";
export const NO_DRIVER_ERROR = "TICKET_HAS_NO_DRIVER";
export const ANSWER_ACTION_LITERAL = "'answer'";
export const CLAIM_RESOLUTION_LITERAL = "'resolution', v_resolution";
export const ANSWER_HANDLER = "handleAnswerCommand";
export const ANSWER_COMMAND_CASE = 'case "/answer":';
export const ACTIONS_PUSH = "actions.push(";
export const ANSWER_QUOTED = '"answer"';

/** مِلفّاتُ القاعدةِ ٨ — تُقرَأُ بمسارِها، وتعذُّرُ قراءةِ أيِّها يُسقِطُ البناءَ. */
export const ANSWER_PATH_FILES: Readonly<Record<string, string>> = {
  notifier: "packages/infrastructure/notification/telegram-support-notifier.ts",
  supportDialog: "packages/application/bots/support-dialog.ts",
  driverDialog: "packages/application/bots/driver-dialog.ts",
  ticketEntity: "packages/domain/dispute/entity.ts",
};

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
  /**
   * القاعدةُ ٨ — مدخلاتُها. قواميسُ **البوتِ** لا قواميسُ التطبيقِ المُصغَّرِ:
   * التبليغُ بالقرارِ يُرسَلُ رسالةَ تلغرامَ خاصّةً، فنصُّه في قاموسِ البوتِ.
   * و`null` تعني «لم يُقرأْ» فتسقُطُ القاعدةُ صريحاً (`ADR 0167`) — لا تمرُّ.
   */
  readonly botDictionaries: Readonly<Record<string, Readonly<Record<string, string>> | null>>;
  /** نصُّ مُبلِّغِ القرارِ — منه يُقرَأُ أنَّ النصَّ المكتوبَ يُمرَّرُ فعلاً. */
  readonly notifierSource: string | null;
  /** نصُّ مُوزِّعِ الدعمِ — منه يُقرَأُ أنَّ مَسلَكَ الردِّ موجودٌ ومُوصَّلٌ. */
  readonly supportDialogSource: string | null;
  /** نصُّ مُوزِّعِ السائقِ — قروبُ الدعمِ يُخدَمُ ببوتِه، فالأمرُ يُوصَّلُ فيه. */
  readonly driverDialogSource: string | null;
  /** نصُّ كِيانِ التذكرةِ — منه يُقرَأُ أنَّ الردَّ لا يُعرَضُ زرّاً. */
  readonly ticketEntitySource: string | null;
  /** نصُّ هجرةِ الردِّ — منه يُقرَأُ الفعلُ ولا سائقَ ولا نصَّ فارغاً. */
  readonly answerSql: string | null;
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

/**
 * القاعدة ٨ — **الوعدُ بردٍّ يقتضي مسارَ ردٍّ** (الخطوةُ ١٠).
 *
 * ولمَ قاعدةٌ لا مراجعةٌ: نصُّ الاستلامِ كانَ يَعِدُ «سيصلك الردّ هنا في هذه
 * المحادثة» منذُ المرحلةِ 2.4، وكانَ عمودُ `resolution` يُكتَبُ ولا يُقرَأُ، وكانَ
 * التبليغُ يُبنى من الفعلِ وحدَه. فالوعدُ قائمٌ والمسارُ معدومٌ **وكلُّ حاجزٍ
 * أخضرُ** — إذ لا حاجزَ يسألُ: أيصلُ المكتوبُ صاحبَه؟ وهذا صنفُ العطبِ نفسُه
 * الذي عُولِجَ في الخطوةِ ٩، وموضعُه ههنا الردُّ لا الدفعُ.
 *
 * وسبعُ مقاييسَ، كلُّها تُقرَأُ من الشِفرةِ والقاعدةِ لا من وثيقةٍ:
 *   أ) الوعدُ نفسُه: `support.ticket_created` نصٌّ غيرُ فارغٍ في اللغاتِ الثلاثِ.
 *   ب) لكلِّ فعلٍ من `SUPPORT_RESOLUTION_KEYS` نصٌّ غيرُ فارغٌ في الثلاثِ، ومفتاحُه
 *      مذكورٌ بنصِّه في المُبلِّغِ — نصٌّ لا يُنادى بهِ أحدٌ نصٌّ لا وجودَ له.
 *   ج) **نصُّ الردِّ يحملُ موضعَ المكتوبِ** `{answer}` في الثلاثِ، والمُبلِّغُ
 *      يُمرِّرُ `input.note` إليه. وهذا هوَ المقياسُ الذي كانَ معدوماً.
 *   د) القاعدةُ تُوجِبُ النصَّ: `ANSWER_NOTE_REQUIRED` في هجرةِ الردِّ.
 *   هـ) الردُّ **لا يقتضي سائقاً**: سطرُ `TICKET_HAS_NO_DRIVER` لا يذكرُ `answer`.
 *   و) المكتوبُ يُقرَأُ حيّاً: حمولةُ الالتقاطِ تحملُ `'resolution'`.
 *   ز) مَسلَكُ الردِّ موجودٌ ومُوصَّلٌ (`handleAnswerCommand` و`case "/answer"`)،
 *      **ولا يُعرَضُ زرّاً** في `availableActions` — زرٌّ لا يحملُ نصّاً لا يَرُدُّ.
 *
 * ولا تقيسُ جودةَ ردٍّ ولا أنَّ صاحبَ التذكرةِ قرأَه (`ADR 0099`): تقيسُ أنَّ
 * للمكتوبِ طريقاً إليه، لا أنَّه بلغَه ولا أنَّه أنصفَه.
 */
export function answerPathProblems(input: SupportIntakeContractInput): readonly string[] {
  const problems: string[] = [];
  const languages = Object.keys(input.botDictionaries);
  if (languages.length === 0) {
    return ["لم يُقرأْ قاموسُ بوتٍ واحدٌ — القاعدةُ لا تمرُّ بمجالٍ فارغٍ."];
  }

  const requiredKeys = [INTAKE_PROMISE_KEY, ...Object.values(SUPPORT_RESOLUTION_KEYS)];
  for (const language of languages) {
    const dictionary = input.botDictionaries[language];
    if (dictionary === undefined || dictionary === null) {
      problems.push(`قاموسُ البوتِ «${language}» لم يُقرأْ — وحاجزٌ يمرُّ حيثُ لا يقرأُ أسوأُ من حاجزٍ غائبٍ.`);
      continue;
    }
    for (const key of requiredKeys) {
      const text = dictionary[key];
      if (text === undefined || text.trim() === "") {
        problems.push(
          `قاموسُ البوتِ «${language}»: «${key}» غائبٌ أو فارغٌ — ` +
            `وقرارٌ يصلُ صاحبَه بمفتاحٍ لا نصَّ له يصلُه مفتاحاً.`,
        );
      }
    }
    const answerText = dictionary[ANSWER_RESOLUTION_KEY];
    if (answerText !== undefined && !answerText.includes(ANSWER_PLACEHOLDER)) {
      problems.push(
        `قاموسُ البوتِ «${language}»: «${ANSWER_RESOLUTION_KEY}» لا يحملُ ` +
          `«${ANSWER_PLACEHOLDER}» — فالإطارُ يصلُ والمكتوبُ يبقى في الجدولِ، وهوَ العطبُ بعينِه.`,
      );
    }
  }

  const notifier = input.notifierSource;
  if (notifier === null) {
    problems.push("مُبلِّغُ القرارِ لم يُقرأْ — القاعدةُ تسقُطُ ولا تمرُّ (ADR 0167).");
  } else {
    for (const key of Object.values(SUPPORT_RESOLUTION_KEYS)) {
      if (!notifier.includes(`"${key}"`)) {
        problems.push(`مُبلِّغُ القرارِ لا يذكرُ «${key}» بنصِّه — ونصٌّ لا يُنادى بهِ أحدٌ لا وجودَ له.`);
      }
    }
    if (!notifier.includes(ANSWER_NOTE_REFERENCE)) {
      problems.push(
        `مُبلِّغُ القرارِ لا يُمرِّرُ «${ANSWER_NOTE_REFERENCE}» — ` +
          `فموضعُ «${ANSWER_PLACEHOLDER}» يُملأُ فراغاً أو لا يُملأُ، والوعدُ بالردِّ يبقى وعداً.`,
      );
    }
  }

  const sql = input.answerSql;
  if (sql === null) {
    problems.push("هجرةُ الردِّ لم تُقرأْ — القاعدةُ تسقُطُ ولا تمرُّ (ADR 0167).");
  } else {
    if (!sql.includes(ANSWER_NOTE_ERROR)) {
      problems.push(
        `هجرةُ الردِّ لا تذكرُ «${ANSWER_NOTE_ERROR}» — ` +
          `وردٌّ بلا نصٍّ يُقفِلُ تذكرةً ويُسجِّلُ «مُجابةٌ» ولم يُجَبْ.`,
      );
    }
    if (!sql.includes(ANSWER_ACTION_LITERAL)) {
      problems.push(`هجرةُ الردِّ لا تذكرُ الفعلَ «${ANSWER_ACTION_LITERAL}» — فلا فعلَ يُجابُ به أصلاً.`);
    }
    /**
     * شرطُ اقتضاءِ السائقِ يُقرَأُ **جملةً لا سطراً**: `if p_action in (…) then`
     * في سطرٍ و`TICKET_HAS_NO_DRIVER` في الذي يليه، فقاعدةٌ تشترطُ اجتماعَهما في
     * سطرٍ واحدٍ **لا تسقُطُ أبداً** — وحاجزٌ عاجزٌ عن السقوطِ حاجزٌ لا وجودَ له.
     * فيُرجَعُ من موضعِ الرمزِ إلى أقربِ `if` قبلَه: ذاكَ هوَ الشرطُ الحاكمُ.
     */
    let searchFrom = 0;
    for (;;) {
      const at = sql.indexOf(NO_DRIVER_ERROR, searchFrom);
      if (at === -1) break;
      searchFrom = at + NO_DRIVER_ERROR.length;
      const conditionStart = sql.lastIndexOf("if ", at);
      if (conditionStart === -1) continue;
      const condition = sql.slice(conditionStart, at);
      if (condition.includes(ANSWER_ACTION_LITERAL)) {
        problems.push(
          `هجرةُ الردِّ تشترطُ سائقاً للردِّ في «${condition.split("\n")[0]?.trim() ?? ""}» — ` +
            `وتذكرةُ راكبٍ لا سائقَ لها، فلا مخرجَ لشكواهُ إلّا الرفضُ.`,
        );
      }
    }
    if (!sql.includes(CLAIM_RESOLUTION_LITERAL)) {
      problems.push(
        `هجرةُ الردِّ لا تُلحِقُ «${CLAIM_RESOLUTION_LITERAL}» بحمولةِ الالتقاطِ — ` +
          `فالمكتوبُ لا يبلغُ المُبلِّغَ ولو كانَ في الجدولِ.`,
      );
    }
  }

  const dialog = input.supportDialogSource;
  if (dialog === null) {
    problems.push("مُوزِّعُ الدعمِ لم يُقرأْ — القاعدةُ تسقُطُ ولا تمرُّ (ADR 0167).");
  } else if (!dialog.includes(`${ANSWER_HANDLER}(`)) {
    problems.push(
      `مُوزِّعُ الدعمِ لا يُعرِّفُ «${ANSWER_HANDLER}» — ` +
        `وفعلٌ في القاعدةِ لا مَسلَكَ له فعلٌ لا يستعملُه أحدٌ.`,
    );
  }

  const driver = input.driverDialogSource;
  if (driver === null) {
    problems.push("مُوزِّعُ السائقِ لم يُقرأْ — القاعدةُ تسقُطُ ولا تمرُّ (ADR 0167).");
  } else if (!driver.includes(ANSWER_COMMAND_CASE)) {
    problems.push(
      `مُوزِّعُ السائقِ لا يُوصِّلُ «${ANSWER_COMMAND_CASE}» — ` +
        `ومَسلَكٌ مكتوبٌ غيرُ مُوصَّلٍ لا يُنادى، وقروبُ الدعمِ يُخدَمُ ببوتِ السائقِ.`,
    );
  }

  const entity = input.ticketEntitySource;
  if (entity === null) {
    problems.push("كِيانُ التذكرةِ لم يُقرأْ — القاعدةُ تسقُطُ ولا تمرُّ (ADR 0167).");
  } else {
    for (const line of entity.split("\n")) {
      if (line.includes(ACTIONS_PUSH) && line.includes(ANSWER_QUOTED)) {
        problems.push(
          `كِيانُ التذكرةِ يعرضُ الردَّ زرّاً في «${line.trim()}» — ` +
            `وزرُّ تلغرامَ لا يحملُ نصّاً، فزرُّ ردٍّ يُقفِلُ بردٍّ فارغٍ أو يسقُطُ.`,
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
    ...answerPathProblems(input),
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
