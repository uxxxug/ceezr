/**
 * الغرض: قواعدُ عقدِ سطحِ الحسابِ وحقَّي البيانةِ — أحكامٌ نقيّةٌ تُقاسُ بمدخلاتٍ
 *   مصنوعةٍ (`SD-12` · البند `F3-08` · زيادةً على `F2-11`).
 * الحالة: منفَّذٌ فعليّاً — البند `SD-12`.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-account-surface-contract.ts` و`tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: أيُّ دورٍ ثالثٍ يمحو حسابَه — **يُزادُ مدخلاً في
 *   `ACCOUNT_ROLES`** ولا تُكتَبُ قواعدُ ثانيةٌ للسؤالِ نفسِه.
 * الحاكم: docs/adr/0126-one-account-core-two-roles.md
 *
 * ## لماذا حاجزٌ خاصٌّ لهذا السطحِ بعينِه
 *
 * لأنَّ هذا السطحَ يُخلِفُ **بصمتٍ نافعٍ لنا، وفي أخطرِ لحظةٍ**. والدليلُ واقعةٌ
 * لا فرضٌ: كانَ `KNOWN_BASES` في سطحِ الراكبِ **خمسةَ أسسٍ** والنطاقُ يُعلِنُ
 * **تسعةً**، وقاعدةُ البياناتِ تُرسِلُ في إيصالِ **كلِّ** حذفٍ سطرَ `identityBar`
 * بأساسِ `BLOCK_AND_STANDING_SURVIVE_ERASURE` — **ونصُّه مكتوبٌ في القواميسِ
 * الثلاثةِ منذُ `ADR 0113`**. فكانَ إنسانٌ يسألُ «لماذا بقيَ حظري؟» فيُجابُ
 * «سببُ إبقاءٍ لا نعرفُ نصَّه بعدُ» **ونحنُ نعرفُه ومكتوبٌ عندَنا**. وكانَ
 * `rider.account.section.identityBar` **غائباً من القواميسِ الثلاثةِ**،
 * والمُترجِمُ يردُّ المفتاحَ نفسَه عندَ الغيابِ — فيُقرأُ على إيصالِ حذفٍ سطرٌ
 * نصُّه حرفيّاً `rider.account.section.identityBar`. ولم يرَ ذلكَ مُصرِّفٌ ولا
 * اختبارٌ ولا حاجزٌ: كلُّ الأدواتِ كانت خضراءَ.
 *
 * وذاكَ هوَ **صنفُ العطبِ الذي لا يكشفُه إلّا حاجزٌ يقرأُ المجالَ من مصدرِه**:
 * لا تصريفٌ يُنكِرُ نقصَ عضوٍ في `Set<string>`، ولا تغطيةٌ تُنكِرُ مفتاحاً
 * ناقصاً، ولا مراجعةٌ بشريّةٌ تُحصي تسعةَ رموزٍ عبرَ ثلاثةِ ملفّاتٍ.
 *
 * ## القواعدُ الثمانُ ولِمَ كلٌّ منها
 *
 *   ١. **لكلِّ أساسِ إبقاءٍ ورفضِ محوٍ ورفضِ تنزيلٍ ورمزِ عطبٍ نصٌّ في القواميسِ
 *      الثلاثةِ لكلِّ دورٍ**: المجالُ مُعلَنٌ في `packages/domain/privacy`
 *      وفي طبقةِ التطبيقِ، والشاشةُ تُترجِمُ بمفتاحٍ — فرمزٌ بلا نصٍّ يُعرَضُ
 *      **مفتاحاً خاماً على إيصالِ حذفٍ**، وهوَ العطبُ الذي وقعَ فعلاً.
 *   ٢. **لكلِّ قسمِ إيصالٍ تذكرُه هجراتُ المحوِ نصٌّ لكلِّ دورٍ**: أسماءُ الأقسامِ
 *      تُقرأُ من **جسمِ الدالّةِ في الهجرةِ** لا من سجلٍّ موازٍ، لأنَّ الذي
 *      يُرسَلُ إلى الشاشةِ هوَ ما تبنيهِ الدالّةُ. وسابقتُه حاجزُ
 *      `check-erasure-policy` الذي يُثبِتُ بذكرِ اسمِ الجدولِ في جسمِ الدالّةِ.
 *   ٣. **مفاتيحُ الحسابِ متطابقةٌ في القواميسِ الثلاثةِ**: حاجزُ `check-i18n.ts`
 *      يقرأُ `packages/shared/i18n/*.json` وحدَها **ولا يقرأُ قواميسَ التطبيقِ
 *      المُصغَّرِ** — فالتطابقُ ههنا يُفرَضُ أو لا يُفرَضُ أبداً.
 *   ٤. **مفتاحُ سقوطٍ للمجهولِ في كلِّ مجالٍ**: خادمٌ أحدثُ من واجهةٍ يُرسِلُ
 *      رمزاً لم يُعرَفْ، وشاشةٌ بلا سقوطٍ تعرضُ فراغاً في موضعِ الحكمِ.
 *   ٥. **سطحُ الدورِ لا يُعيدُ إعلانَ مجالٍ مغلقٍ**: لا يظهرُ رمزُ أساسِ إبقاءٍ
 *      ولا رمزُ رفضٍ **حرفاً** في مِلفّاتِ دورٍ. وهذه هيَ القاعدةُ التي كانَ
 *      نقضُها هوَ العطبَ: نسخةٌ من مجالٍ في سطحٍ تفترقُ عن مصدرِها بلا شكوى.
 *   ٦. **اللبُّ المشتركُ لا يذكرُ بادئةَ دورٍ**: `rider.account.` أو
 *      `driver.account.` في اللبِّ تعني أنَّ اللبَّ صارَ يعرفُ دوراً، وأوّلُ
 *      دورٍ ثالثٍ يجدُه فرعاً في شرطٍ لا وصفاً يُمرَّرُ.
 *   ٧. **بادئةُ كلِّ دورٍ تنتهي بنقطةٍ** ومُعلَنةٌ في مِلفِّ سطحِه: بادئةٌ بلا
 *      نقطةٍ تُلصِقُ مفتاحاً بمفتاحٍ فتُنتِجُ `driver.accountsection.orders`.
 *   ٨. **لا نائبَ مجهولاً في نصوصِ الحسابِ**: كلُّ `{…}` في نصٍّ يجبُ أن يكونَ
 *      من المجموعةِ التي **تستبدلُها الشاشةُ فعلاً**، وإلّا عُرِضَ على إنسانٍ
 *      نصٌّ فيه `{amount}` حرفاً في اللحظةِ التي يُمنَعُ فيها من حقٍّ.
 *
 * ## وما لا يفعلُه هذا الحاجزُ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا يحكمُ في جودةِ النصِّ ولا في ترجمتِه**: يفرضُ وجودَه لا صحّتَه
 *      اللغويّةَ. ودقّةُ الأردو والإنجليزيّةِ مراجعةٌ بشريّةٌ مُعلَنةٌ كدَينٍ.
 *   ــ **لا يُشغِّلُ قاعدةً**: يقرأُ نصَّ الهجرةِ. والأثرُ يُقاسُ في `tests/integration`.
 *   ــ **لا يقيسُ تطابقَ نصِّ الراكبِ ونصِّ السائقِ**: المفتاحانِ مِرآةٌ في
 *      البِنيةِ لا في المعنى — «رحلتُك الجاريةُ» للراكبِ و«مَهمّتُك المُسنَدةُ»
 *      للسائقِ، وحاجزٌ يُلزِمُ التساويَ يُنتِجُ نصّاً كاذباً لأحدِهما.
 *   ــ **لا يُلزِمُ دوراً بقسمٍ لا يُرسَلُ إليه**: يُلزِمُ **اتّحادَ** الأقسامِ
 *      لكلِّ دورٍ عن قصدٍ — لأنَّ الدالّةَ في القاعدةِ قد تُرسِلَ قسماً لدورٍ
 *      غداً بلا تعديلِ واجهةٍ، **ونصٌّ زائدٌ لا يضرُّ ومفتاحٌ خامٌ يضرُّ**.
 */

import {
  ERASURE_REFUSALS,
  EXPORT_REFUSALS,
  RETENTION_BASES,
} from "../../packages/domain/privacy/data-rights.ts";

/** الدورُ: بادئتُه ومِلفُّ سطحِه الذي يجبُ أن يُعلِنَها. */
export interface AccountRole {
  readonly keyPrefix: string;
  readonly specFile: string;
}

/**
 * الأدوارُ التي لها سطحُ حسابٍ. **دورٌ ثالثٌ يُزادُ ههنا** فتُقاسُ عليهِ القواعدُ
 * الثمانُ كلُّها بلا سطرٍ جديدٍ.
 */
export const ACCOUNT_ROLES: readonly AccountRole[] = [
  {
    keyPrefix: "rider.account.",
    specFile: "apps/miniapp/src/surfaces/rider/account/account-view.ts",
  },
  {
    keyPrefix: "driver.account.",
    specFile: "apps/miniapp/src/surfaces/driver/account/account-view.ts",
  },
];

/** مِلفّاتُ اللبِّ المشتركِ — لا يجوزُ أن يُذكَرَ فيها دورٌ. */
export const CORE_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/account/AccountRights.tsx",
  "apps/miniapp/src/surfaces/account/account-view.ts",
  "apps/miniapp/src/surfaces/account/account-api.ts",
  "apps/miniapp/src/surfaces/account/account-contract.ts",
];

/** مِلفّاتُ سطحِ الدورِ — لا يجوزُ أن يُعادَ فيها إعلانُ مجالٍ مغلقٍ. */
export const ROLE_SURFACE_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/rider/account/AccountScreen.tsx",
  "apps/miniapp/src/surfaces/rider/account/account-view.ts",
  "apps/miniapp/src/surfaces/rider/account/account-api.ts",
  "apps/miniapp/src/surfaces/rider/account/account-contract.ts",
  "apps/miniapp/src/surfaces/driver/account/AccountScreen.tsx",
  "apps/miniapp/src/surfaces/driver/account/account-view.ts",
];

/** هجراتُ المحوِ التي تبني الإيصالَ — منها تُقرأُ أسماءُ الأقسامِ. */
export const ERASURE_SQL_FILES: readonly string[] = [
  "supabase/migrations/20260914180000_f2_11_account_data_rights.sql",
  "supabase/migrations/20260916030000_sd_12_driver_account_erasure.sql",
];

export const TRANSLATION_FILES: Readonly<Record<string, string>> = {
  ar: "packages/shared/i18n/miniapp/ar.json",
  en: "packages/shared/i18n/miniapp/en.json",
  ur: "packages/shared/i18n/miniapp/ur.json",
};

/**
 * رموزُ الحدِّ التي لها نصٌّ — **مقابِلةٌ لاتّحادِ `DataRightsPublicErrorCode`**.
 * تُكتَبُ ههنا لا تُستوردُ لأنَّ الاتّحادَ نوعٌ يذوبُ عندَ التصريفِ، والحاجزُ
 * يحتاجُ قيماً تُعَدُّ. **والقاعدةُ الأولى تُقابِلُها بنصوصِ الدورَينِ**، فرمزٌ
 * يُزادُ في الطبقةِ ولا يُزادُ ههنا يبقى بلا نصٍّ — ولذا يُقاسُ التطابقُ في
 * اختبارِ وحدةٍ على النوعِ نفسِه.
 */
export const ACCOUNT_ERROR_CODES: readonly string[] = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "PRIVACY_STORE_NOT_AVAILABLE",
  "CONFIRMATION_REQUIRED",
];

/**
 * النوّابُ التي تستبدلُها الشاشةُ فعلاً. **قائمةٌ مغلقةٌ**: نائبٌ ليسَ فيها
 * يُعرَضُ حرفاً على إنسانٍ.
 */
export const ALLOWED_PLACEHOLDERS: readonly string[] = [
  "orders",
  "amount",
  "rows",
  "sections",
  "file",
  "date",
  "word",
];

/** الأقسامُ التي تُضيفُها القاعدةُ ولا جدولَ لها باسمِها في الهجرةِ. */
const SECTION_NAME_PATTERN =
  /'(?<name>[A-Za-z][A-Za-z0-9]*)'\s*,\s*(?:jsonb_build_object|jsonb_agg|coalesce|v_[a-z_]+|case\b|\(\s*select\b|\d+\b)/gi;
const RETAINED_SECTION_PATTERN = /'section'\s*,\s*'(?<name>[A-Za-z][A-Za-z0-9]*)'/g;

/**
 * أسماءُ الأقسامِ ليست كلُّ نصٍّ مُفرَدٍ في الهجرةِ: الدالّةُ تبني حقولاً أخرى
 * (`rows` · `basis` · `subject` …). فهذه **تُستثنى بأسمائِها** لأنَّها حقولُ
 * بِنيةٍ لا أقسامٌ، واستثناؤها مكتوبٌ كي يُقرأَ لا مُستنبَطٌ بنمطٍ.
 */
const NOT_A_SECTION: ReadonlySet<string> = new Set([
  "rows",
  "basis",
  "section",
  "subject",
  "phone",
  "role",
  "city",
  "currency",
  "receipt",
  "user",
  "erased",
  "anonymized",
  "retained",
  "erasedAt",
  "exportedAt",
  "sections",
  "name",
  "id",
  "ok",
  "refusal",
  // حقولُ بِنيةٍ داخلَ قسمٍ مُسقَّفٍ — `driverLocationHistory` يُعلِنُ سقفَه
  // وترتيبَه في الحزمةِ نفسِها (`ح-5`)، وهما وصفُ القسمِ لا قسمانِ.
  "cap",
  "newestFirst",
]);

/** أقسامُ الإيصالِ المقروءةُ من نصوصِ الهجراتِ — مشتقّةٌ لا مكتوبةٌ. */
export function receiptSectionsFromSql(
  sqlByPath: Readonly<Record<string, string>>,
): readonly string[] {
  const found = new Set<string>();
  for (const sql of Object.values(sqlByPath)) {
    for (const match of sql.matchAll(SECTION_NAME_PATTERN)) {
      const name = match.groups?.name;
      if (name !== undefined && !NOT_A_SECTION.has(name)) found.add(name);
    }
    for (const match of sql.matchAll(RETAINED_SECTION_PATTERN)) {
      const name = match.groups?.name;
      if (name !== undefined && !NOT_A_SECTION.has(name)) found.add(name);
    }
  }
  return [...found].sort();
}

export interface AccountSurfaceContractInput {
  /** نصُّ كلِّ مِلفٍّ من اللبِّ، مفاتيحُه المساراتُ. التعليقاتُ مُبيَّضةٌ. */
  readonly core: Readonly<Record<string, string>>;
  /** نصُّ كلِّ مِلفٍّ من أسطحِ الأدوارِ. التعليقاتُ مُبيَّضةٌ. */
  readonly roleSurfaces: Readonly<Record<string, string>>;
  readonly sqlByPath: Readonly<Record<string, string>>;
  readonly translations: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly roles: readonly AccountRole[];
  readonly retentionBases: readonly string[];
  readonly erasureRefusals: readonly string[];
  readonly exportRefusals: readonly string[];
  readonly errorCodes: readonly string[];
  readonly allowedPlaceholders: readonly string[];
}

/** المجالاتُ المغلقةُ كما يُعلِنُها النطاقُ — لا نسخةَ ثانيةَ لها ههنا. */
export const DOMAIN_RETENTION_BASES: readonly string[] = Object.values(RETENTION_BASES);
export const DOMAIN_ERASURE_REFUSALS: readonly string[] = Object.values(ERASURE_REFUSALS);
export const DOMAIN_EXPORT_REFUSALS: readonly string[] = Object.values(EXPORT_REFUSALS);

function missingText(
  translations: AccountSurfaceContractInput["translations"],
  key: string,
): readonly string[] {
  const gaps: string[] = [];
  for (const [language, dictionary] of Object.entries(translations)) {
    const text = dictionary[key];
    if (text === undefined || text.trim() === "") gaps.push(language);
  }
  return gaps;
}

/**
 * الحكمُ. **يردُّ قائمةَ مشاكلَ لا يُسقِطُ العمليّةَ**: كي يُقاسَ بمدخلاتٍ
 * مصنوعةٍ في اختبارِ وحدةٍ — والقاعدةُ التي لا حالةَ سلبيّةَ لها **غيرُ
 * مُنفَذةٍ** (`ح-7`).
 */
export function accountSurfaceContractProblems(
  input: AccountSurfaceContractInput,
): readonly string[] {
  const problems: string[] = [];
  const sections = receiptSectionsFromSql(input.sqlByPath);

  if (sections.length === 0) {
    problems.push("القاعدةُ ٢: لم يُقرَأْ أيُّ قسمِ إيصالٍ من الهجراتِ — النمطُ أو المسارُ خطأٌ.");
  }

  for (const role of input.roles) {
    const p = role.keyPrefix;

    // ── القاعدةُ ٧: بادئةٌ تنتهي بنقطةٍ ومُعلَنةٌ في مِلفِّ سطحِها ──
    if (!p.endsWith(".")) {
      problems.push(`القاعدةُ ٧: البادئةُ «${p}» لا تنتهي بنقطةٍ، فتُلصِقُ مفتاحاً بمفتاحٍ.`);
    }
    const specSource = input.roleSurfaces[role.specFile];
    if (specSource === undefined) {
      problems.push(`القاعدةُ ٧: مِلفُّ وصفِ الدورِ «${role.specFile}» غيرُ مقروءٍ.`);
    } else if (!specSource.includes(`keyPrefix: "${p}"`)) {
      problems.push(
        `القاعدةُ ٧: «${role.specFile}» لا يُعلِنُ \`keyPrefix: "${p}"\` — الوصفُ والحاجزُ يفترقانِ.`,
      );
    }

    // ── القاعدةُ ١: لكلِّ رمزٍ نصٌّ ──
    const closed: readonly (readonly [string, readonly string[]])[] = [
      [`${p}basis.`, input.retentionBases],
      [`${p}erasure.refusal.`, input.erasureRefusals],
      [`${p}export.refusal.`, input.exportRefusals],
      [`${p}error.`, input.errorCodes],
    ];
    for (const [keyBase, codes] of closed) {
      for (const code of codes) {
        const gaps = missingText(input.translations, `${keyBase}${code}`);
        if (gaps.length > 0) {
          problems.push(`القاعدةُ ١: «${keyBase}${code}» بلا نصٍّ في: ${gaps.join(" · ")}.`);
        }
      }
      // ── القاعدةُ ٤: سقوطٌ للمجهولِ ──
      const unknownGaps = missingText(input.translations, `${keyBase}UNKNOWN`);
      if (unknownGaps.length > 0) {
        problems.push(`القاعدةُ ٤: «${keyBase}UNKNOWN» بلا نصٍّ في: ${unknownGaps.join(" · ")}.`);
      }
    }

    // ── القاعدةُ ٢: لكلِّ قسمِ إيصالٍ نصٌّ ──
    for (const section of sections) {
      const gaps = missingText(input.translations, `${p}section.${section}`);
      if (gaps.length > 0) {
        problems.push(`القاعدةُ ٢: «${p}section.${section}» بلا نصٍّ في: ${gaps.join(" · ")}.`);
      }
    }

    // ── القاعدةُ ٣: تطابقُ مفاتيحِ الدورِ في القواميسِ الثلاثةِ ──
    const perLanguage = Object.entries(input.translations).map(
      ([language, dictionary]) =>
        [language, new Set(Object.keys(dictionary).filter((key) => key.startsWith(p)))] as const,
    );
    const [reference, ...rest] = perLanguage;
    if (reference !== undefined) {
      for (const [language, keys] of rest) {
        for (const key of reference[1]) {
          if (!keys.has(key))
            problems.push(`القاعدةُ ٣: «${key}» في ${reference[0]} وغائبٌ في ${language}.`);
        }
        for (const key of keys) {
          if (!reference[1].has(key)) {
            problems.push(`القاعدةُ ٣: «${key}» في ${language} وغائبٌ في ${reference[0]}.`);
          }
        }
      }
    }
  }

  // ── القاعدةُ ٥: سطحُ الدورِ لا يُعيدُ إعلانَ مجالٍ مغلقٍ ──
  const closedCodes: readonly string[] = [
    ...input.retentionBases,
    ...input.erasureRefusals,
    ...input.exportRefusals,
  ];
  for (const [path, source] of Object.entries(input.roleSurfaces)) {
    for (const code of closedCodes) {
      if (source.includes(`"${code}"`) || source.includes(`'${code}'`)) {
        problems.push(
          `القاعدةُ ٥: «${path}» يذكرُ «${code}» حرفاً — المجالُ المغلقُ يُقرأُ من النطاقِ ولا يُنسَخُ في سطحٍ.`,
        );
      }
    }
  }

  // ── القاعدةُ ٦: اللبُّ لا يذكرُ بادئةَ دورٍ ──
  for (const [path, source] of Object.entries(input.core)) {
    for (const role of input.roles) {
      if (source.includes(`"${role.keyPrefix}`) || source.includes(`'${role.keyPrefix}`)) {
        problems.push(`القاعدةُ ٦: «${path}» يذكرُ بادئةَ «${role.keyPrefix}» — اللبُّ لا يعرفُ دوراً.`);
      }
    }
  }

  // ── القاعدةُ ٨: لا نائبَ مجهولاً ──
  const allowed = new Set(input.allowedPlaceholders);
  for (const [language, dictionary] of Object.entries(input.translations)) {
    for (const [key, text] of Object.entries(dictionary)) {
      if (!input.roles.some((role) => key.startsWith(role.keyPrefix))) continue;
      for (const match of text.matchAll(/\{(?<name>[A-Za-z][A-Za-z0-9]*)\}/g)) {
        const name = match.groups?.name;
        if (name !== undefined && !allowed.has(name)) {
          problems.push(`القاعدةُ ٨: «${key}» في ${language} فيهِ نائبٌ مجهولٌ «{${name}}».`);
        }
      }
    }
  }

  return problems;
}
