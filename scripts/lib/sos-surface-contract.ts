/**
 * الغرض: قواعدُ عقدِ سطحِ الاستغاثةِ — أحكامٌ نقيّةٌ تُقاسُ بمدخلاتٍ مصنوعةٍ
 *   (البند `F2-10` · `SR-14` · الحاجز `UX-024`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-10`.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-sos-surface-contract.ts` و`tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: سطحُ السائقِ — تُزادُ مِلفّاتُه إلى `SURFACE_FILES`
 *   ولا تُكتَبُ قواعدُ ثانيةٌ للسؤالِ نفسِه.
 * الحاكم: docs/adr/0111-sos-surface-is-a-judged-card-not-a-button.md
 *
 * ## لماذا حاجزٌ خاصٌّ لسطحٍ واحدٍ
 *
 * لأنَّ هذا السطحَ يُخلِفُ **صامتاً**. بطاقةُ مشاركةٍ لا تعملُ يكتشفُها صاحبُها
 * في دقيقةٍ ويشكو. وبطاقةُ استغاثةٍ لا تعملُ لا يكتشفُها أحدٌ حتّى يحتاجَها
 * إنسانٌ مرّةً واحدةً — وحينَها لا يفتحُ تذكرةً. فما لا يُقاسُ آليّاً ههنا لا
 * يُقاسُ أبداً.
 *
 * ## القواعدُ الستُّ ولِمَ كلٌّ منها
 *
 *   ١. **لا وعدَ اتّصالٍ**: لا `tel:` ولا `whatsapp` ولا `call` في السطحِ ولا
 *      في نصوصِه. لا مزوِّدَ اتّصالٍ في المستودَعِ، ومَن قرأَ «سنتّصلُ بكَ»
 *      انتظرَ مكالمةً لا تأتي بدلَ أن يطلبَ الطوارئَ العامّةَ بنفسِه.
 *   ٢. **كلُّ رمزِ إفصاحٍ له نصٌّ في القواميسِ الثلاثةِ**: رمزٌ بلا نصٍّ يُعرَضُ
 *      مفتاحاً خاماً — أو لا يُعرَضُ — في السطرِ الذي هوَ **وعدُ الخصوصيّةِ**
 *      كلُّه.
 *   ٣. **`SOS_NO_PHONE_CALL` منشورٌ في كلِّ حالٍ**: أخطرُ سوءِ فهمٍ ممكنٍ أن
 *      يُظَنَّ الزرُّ استدعاءَ شرطةٍ. فالنفيُ يُقالُ صراحةً لا يُترَكُ للظنِّ.
 *   ٤. **الحكمُ يُقرأُ من القاعدةِ لا يُحسَبُ في المتصفّحِ**: لا `Date.now` ولا
 *      `new Date` في نموذجِ العرضِ. عُمرُ بلاغٍ محسوبٌ بساعةِ جهازٍ مضبوطةٍ
 *      يدوياً يقولُ «أُرسِلَ قبلَ ساعةٍ» عن بلاغٍ أُرسِلَ قبلَ دقيقةٍ.
 *   ٥. **لا مُعرِّفَ طلبٍ يُرسَلُ من الشاشةِ**: الطلبُ يُحَلُّ في القاعدةِ تحتَ
 *      القفلِ (`ADR 0077`)، ومُعرِّفٌ من شاشةٍ قد يكونُ مُعرِّفَ رحلةِ أمسِ.
 *   ٦. **كلُّ دالّةٍ في الهجرةِ يُنزَعُ تنفيذُها عن الأدوارِ الثلاثةِ**: المنحُ
 *      لـ`public` ضمنيٌّ في PostgreSQL، فالنسيانُ هوَ الحالةُ الافتراضيّةُ.
 *
 * ## وما لا يفعلُه هذا الحاجزُ عن قصدٍ
 *
 *   ــ **لا يحكمُ في جودةِ النصِّ**: يفرضُ **وجودَه** لا بلاغتَه.
 *   ــ **لا يُشغِّلُ قاعدةً**: يقرأُ نصَّ الهجرةِ. والأثرُ يُقاسُ في `tests/`.
 *   ــ **لا يمنعُ ذكرَ الطوارئِ العامّةِ في النصِّ**: «اتّصلْ بالطوارئِ
 *      العامّةِ» **مطلوبٌ** — والقاعدةُ ١ تمنعُ رابطاً يتّصلُ لا نصيحةً بأن
 *      يتّصلَ الإنسانُ بنفسِه. والفرقُ أنَّ الأولى وعدٌ منّا والثانيةَ إرشادٌ له.
 */

import { SOS_DISCLOSURE_CODES } from "../../packages/domain/safety/sos-surface.ts";

/** مِلفّاتُ سطحِ الاستغاثةِ — مكتوبةً لا مُكتشَفةً بنمطٍ. */
export const SURFACE_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/rider/sos/SosCard.tsx",
  "apps/miniapp/src/surfaces/rider/sos/sos-view.ts",
  "apps/miniapp/src/surfaces/rider/sos/sos-api.ts",
  "apps/miniapp/src/surfaces/rider/sos/sos-contract.ts",
];

/** نموذجُ العرضِ وحدَه — عليه القاعدةُ ٤ (لا ساعةَ جهازٍ). */
export const VIEW_FILE = "apps/miniapp/src/surfaces/rider/sos/sos-view.ts";

/** مِلفُّ النداءِ وحدَه — عليه القاعدةُ ٥ (لا مُعرِّفَ في المسارِ). */
export const API_FILE = "apps/miniapp/src/surfaces/rider/sos/sos-api.ts";

export const SOS_SQL_FILE = "supabase/migrations/20260914120000_f2_10_sos_surface.sql";
export const SOS_ROUTE_FILE = "apps/gateway/src/routes/safety.ts";
export const DOMAIN_FILE = "packages/domain/safety/sos-surface.ts";

export const TRANSLATION_FILES: Readonly<Record<string, string>> = {
  ar: "packages/shared/i18n/miniapp/ar.json",
  en: "packages/shared/i18n/miniapp/en.json",
  ur: "packages/shared/i18n/miniapp/ur.json",
};

/** بادئةُ مفاتيحِ هذا السطحِ. */
export const KEY_PREFIX = "rider.sos.";

/**
 * رموزُ وعدِ الاتّصالِ — **ممنوعةٌ في الشِفرةِ وفي النصِّ**. و«اتصل/اتّصل»
 * ليسا ههنا: النصُّ العربيُّ يقولُ «اتّصلْ بالطوارئِ العامّةِ» وهوَ **إرشادٌ
 * واجبٌ** لا وعدٌ منّا (انظرْ رأسَ المِلفِّ). والممنوعُ آليّةُ اتّصالٍ لا ذكرُه.
 */
export const CALL_TOKENS: readonly string[] = [
  "tel:",
  "whatsapp",
  "wa.me",
  "callDriver",
  "placeCall",
  "dialer",
];

/** الرمزُ الذي لا يجوزُ أن يغيبَ عن أيِّ حالٍ (القاعدة ٣). */
export const MANDATORY_DISCLOSURE = "SOS_NO_PHONE_CALL";

/** ساعةُ الجهازِ — ممنوعةٌ في نموذجِ العرضِ (القاعدة ٤). */
export const DEVICE_CLOCK_TOKENS: readonly string[] = ["Date.now", "new Date", "performance.now"];

/** الأدوارُ التي لا يجوزُ أن تُنفِّذَ دالّةً من دوالِّنا. */
export const REVOKED_ROLES: readonly string[] = ["public", "anon", "authenticated"];

export interface SosSurfaceContractInput {
  /** مِلفّاتُ السطحِ: مسارٌ ⇒ شِفرةٌ **بلا تعليقاتٍ** (التعليقُ يشرحُ المحظورَ). */
  readonly surface: Readonly<Record<string, string>>;
  /** نصُّ هجرةِ الاستغاثةِ كما هوَ. */
  readonly sql: string;
  /** نصُّ مِلفِّ مسارِ السلامةِ **بلا تعليقاتٍ**. */
  readonly route: string;
  /** القواميسُ الثلاثةُ مُحلَّلةً: لغةٌ ⇒ (مفتاحٌ ⇒ نصٌّ). */
  readonly translations: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** رموزُ الإفصاحِ كما نشرَها النطاقُ. */
  readonly disclosureCodes: readonly string[];
}

const ASCII_WORD = /^[a-z_]+$/i;

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

/** القاعدة ١ — لا وعدَ اتّصالٍ، لا في الشِفرةِ ولا في النصِّ. */
export function callPromiseProblems(input: SosSurfaceContractInput): readonly string[] {
  const problems: string[] = [];
  for (const [path, source] of Object.entries(input.surface)) {
    problems.push(...tokenProblems(path, source, CALL_TOKENS, "سطحُ الاستغاثةِ يَعِدُ باتّصالٍ لا يقعُ"));
  }
  problems.push(
    ...tokenProblems(SOS_ROUTE_FILE, input.route, CALL_TOKENS, "مسارُ الاستغاثةِ يذكرُ اتّصالاً"),
  );
  for (const [language, dictionary] of Object.entries(input.translations)) {
    for (const [key, text] of Object.entries(dictionary)) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      problems.push(
        ...tokenProblems(`${language}:${key}`, text, CALL_TOKENS, "نصُّ استغاثةٍ يَعِدُ باتّصالٍ"),
      );
    }
  }
  return problems;
}

/** القاعدة ٢ — كلُّ رمزِ إفصاحٍ له نصٌّ في القواميسِ الثلاثةِ جميعاً. */
export function disclosureTextProblems(input: SosSurfaceContractInput): readonly string[] {
  const problems: string[] = [];
  // قائمةٌ فارغةٌ تجعلُ القاعدةَ تمرُّ زوراً: النطاقُ ينشرُ رموزاً، فغيابُها
  // خللٌ في القراءةِ لا براءةٌ.
  if (input.disclosureCodes.length === 0) {
    problems.push(`${DOMAIN_FILE}: لم يُقرأْ رمزُ إفصاحٍ واحدٌ — القاعدةُ لا تمرُّ بقائمةٍ فارغةٍ.`);
    return problems;
  }
  for (const code of input.disclosureCodes) {
    const key = `${KEY_PREFIX}disclosure.${code}`;
    for (const [language, dictionary] of Object.entries(input.translations)) {
      if (!(key in dictionary)) {
        problems.push(
          `${language}: رمزُ إفصاحٍ «${code}» بلا نصٍّ («${key}») — ` +
            `وعدُ الخصوصيّةِ يُعرَضُ مفتاحاً خاماً أو لا يُعرَضُ.`,
        );
      }
    }
  }
  return problems;
}

/** القاعدة ٣ — نفيُ الاتّصالِ رمزٌ منشورٌ من القاعدةِ في كلِّ حالٍ. */
export function mandatoryDisclosureProblems(input: SosSurfaceContractInput): readonly string[] {
  const problems: string[] = [];
  if (!input.disclosureCodes.includes(MANDATORY_DISCLOSURE)) {
    problems.push(
      `${DOMAIN_FILE}: الرمزُ «${MANDATORY_DISCLOSURE}» ليسَ في مجالِ الإفصاحِ — ` +
        `ومَن ظنَّ أنَّ الضغطةَ تستدعي شرطةً انتظرَ نجدةً لا تأتي.`,
    );
  }
  // وفي الهجرةِ أيضاً: مجالٌ يعرفُ الرمزَ وقاعدةٌ لا تنشرُه **لا يُفصِحُ عن شيءٍ**.
  if (!input.sql.includes(MANDATORY_DISCLOSURE)) {
    problems.push(
      `${SOS_SQL_FILE}: الهجرةُ لا تنشرُ «${MANDATORY_DISCLOSURE}» — ` +
        `المجالُ يعرفُ الرمزَ والقاعدةُ لا تُرسِلُه، فالسطرُ لا يُعرَضُ أبداً.`,
    );
  }
  return problems;
}

/** القاعدة ٤ — العُمرُ يصلُ مقيساً من القاعدةِ ولا يُحسَبُ بساعةِ الجهازِ. */
export function deviceClockProblems(input: SosSurfaceContractInput): readonly string[] {
  const view = input.surface[VIEW_FILE];
  if (view === undefined) {
    return [`${VIEW_FILE}: لم يُقرأْ نموذجُ العرضِ — القاعدةُ لا تمرُّ بمِلفٍّ غائبٍ.`];
  }
  return tokenProblems(
    VIEW_FILE,
    view,
    DEVICE_CLOCK_TOKENS,
    "نموذجُ العرضِ يقرأُ ساعةَ الجهازِ — والعُمرُ يصلُ مقيساً بساعةِ القاعدةِ",
  );
}

/** القاعدة ٥ — لا مُعرِّفَ طلبٍ يُرسَلُ من الشاشةِ (`ADR 0077`). */
export function orderIdInPathProblems(input: SosSurfaceContractInput): readonly string[] {
  const api = input.surface[API_FILE];
  if (api === undefined) {
    return [`${API_FILE}: لم يُقرأْ مِلفُّ النداءِ — القاعدةُ لا تمرُّ بمِلفٍّ غائبٍ.`];
  }
  const problems: string[] = [];
  // مسارٌ فيه قالبٌ (`${...}`) يعني مُعرِّفاً يُركَّبُ في العميلِ.
  if (/["'`]\/v1\/safety\/sos[^"'`]*\$\{/.test(api)) {
    problems.push(
      `${API_FILE}: مسارُ الاستغاثةِ يُركِّبُ قيمةً من العميلِ — ` +
        `والطلبُ يُحَلُّ في القاعدةِ تحتَ القفلِ (\`ADR 0077\`)، ومُعرِّفٌ من شاشةٍ قد يكونُ رحلةَ أمسِ.`,
    );
  }
  if (mentions(api, "orderId") || mentions(api, "order_id")) {
    problems.push(`${API_FILE}: النداءُ يذكرُ مُعرِّفَ طلبٍ — سطحُ الاستغاثةِ لا يُمرِّرُ رحلةً (\`ADR 0077\`).`);
  }
  return problems;
}

/** القاعدة ٦ — كلُّ دالّةٍ تُنشَأُ في الهجرةِ يُنزَعُ تنفيذُها عن الأدوارِ الثلاثةِ. */
export function functionRevokeProblems(input: SosSurfaceContractInput): readonly string[] {
  const problems: string[] = [];
  const sql = input.sql.toLowerCase().replace(/\s+/g, " ");
  const created = [...sql.matchAll(/create (?:or replace )?function ([a-z0-9_]+)\s*\(/g)].map(
    (match) => match[1] ?? "",
  );
  if (created.length === 0) {
    problems.push(`${SOS_SQL_FILE}: لم تُقرأْ دالّةٌ واحدةٌ في الهجرةِ — القاعدةُ لا تمرُّ بقائمةٍ فارغةٍ.`);
    return problems;
  }
  for (const name of new Set(created)) {
    const pattern = new RegExp(`revoke execute on function ${name}\\s*\\([^)]*\\) from ([^;]+);`);
    const match = sql.match(pattern);
    if (match === null) {
      problems.push(
        `${SOS_SQL_FILE}: الهجرةُ تُنشئُ «${name}» ولا تنزعُ تنفيذَها — ` +
          `و«public» يُمنَحُ التنفيذَ تلقائيّاً فتصيرُ الدالّةُ منالاً للمفتاحِ العامِّ.`,
      );
      continue;
    }
    const roles = match[1] ?? "";
    for (const role of REVOKED_ROLES) {
      if (!roles.includes(role)) {
        problems.push(
          `${SOS_SQL_FILE}: نزعُ تنفيذِ «${name}» لا يذكرُ الدورَ «${role}» — نزعٌ ناقصٌ بابٌ مفتوحٌ.`,
        );
      }
    }
  }
  return problems;
}

/** الحكمُ الجامعُ — قائمةُ خرقٍ مقروءةٍ، فارغةٌ إن لم يكنْ خرقٌ. */
export function sosSurfaceContractProblems(input: SosSurfaceContractInput): readonly string[] {
  return [
    ...callPromiseProblems(input),
    ...disclosureTextProblems(input),
    ...mandatoryDisclosureProblems(input),
    ...deviceClockProblems(input),
    ...orderIdInPathProblems(input),
    ...functionRevokeProblems(input),
  ];
}

/** رموزُ الإفصاحِ كما نشرَها النطاقُ — مصدرٌ واحدٌ لا نسخةٌ مكتوبةٌ ههنا. */
export const DISCLOSURE_CODES: readonly string[] = SOS_DISCLOSURE_CODES;
