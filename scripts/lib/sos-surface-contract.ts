/**
 * الغرض: قواعدُ عقدِ سطحِ الاستغاثةِ — أحكامٌ نقيّةٌ تُقاسُ بمدخلاتٍ مصنوعةٍ
 *   (البند `F2-10` · `SR-14` · الحاجز `UX-024`).
 * الحالة: منفَّذٌ فعليّاً — البندانِ `F2-10` و`F12-03`.
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
 * ## القواعدُ السبعُ ولِمَ كلٌّ منها
 *
 *   ١. **لا وعدَ اتّصالٍ**: لا `tel:` ولا `whatsapp` ولا `call` في السطحِ ولا
 *      في نصوصِه. لا مزوِّدَ اتّصالٍ في المستودَعِ، ومَن قرأَ «سنتّصلُ بكَ»
 *      انتظرَ مكالمةً لا تأتي بدلَ أن يطلبَ الطوارئَ العامّةَ بنفسِه.
 *   ٢. **كلُّ رمزِ إفصاحٍ له نصٌّ في القواميسِ الثلاثةِ**: رمزٌ بلا نصٍّ يُعرَضُ
 *      مفتاحاً خاماً — أو لا يُعرَضُ — في السطرِ الذي هوَ **وعدُ الخصوصيّةِ**
 *      كلُّه.
 *   ٣. **`SOS_NO_PHONE_CALL` منشورٌ في كلِّ حالٍ**: أخطرُ سوءِ فهمٍ ممكنٍ أن
 *      يُظَنَّ الزرُّ استدعاءَ شرطةٍ. فالنفيُ يُقالُ صراحةً لا يُترَكُ للظنِّ.
 *      **والمطلوبُ أن ينشُرَه المِلفُّ الذي يُعيدُ تعريفَ `sos_surface_state`
 *      نفسُه** لا أيُّ مِلفٍّ في المجموعةِ: هجرةٌ تاليةٌ تُعيدُ التعريفَ وتُسقِطُ
 *      الرمزَ تُلغي الإفصاحَ ولو بقيَ منشوراً في هجرةٍ أقدمَ — والقاعدةُ تقرأُ
 *      الأخيرَ لا المجموعَ.
 *   ٤. **الحكمُ يُقرأُ من القاعدةِ لا يُحسَبُ في المتصفّحِ**: لا `Date.now` ولا
 *      `new Date` في نموذجِ العرضِ. عُمرُ بلاغٍ محسوبٌ بساعةِ جهازٍ مضبوطةٍ
 *      يدوياً يقولُ «أُرسِلَ قبلَ ساعةٍ» عن بلاغٍ أُرسِلَ قبلَ دقيقةٍ.
 *   ٥. **لا مُعرِّفَ طلبٍ يُرسَلُ من الشاشةِ**: الطلبُ يُحَلُّ في القاعدةِ تحتَ
 *      القفلِ (`ADR 0077`)، ومُعرِّفٌ من شاشةٍ قد يكونُ مُعرِّفَ رحلةِ أمسِ.
 *   ٦. **كلُّ دالّةٍ في كلِّ هجرةٍ من مجموعةِ السطحِ يُنزَعُ تنفيذُها عن الأدوارِ
 *      الثلاثةِ**: المنحُ لـ`public` ضمنيٌّ في PostgreSQL، فالنسيانُ هوَ الحالةُ
 *      الافتراضيّةُ. **والقياسُ لِكلِّ مِلفٍّ في نفسِه**: دالّةٌ تُعادُ بتوقيعٍ
 *      مُختلفٍ دالّةٌ أخرى عندَ PostgreSQL وتبدأُ ممنوحةً لـ`public` من جديدٍ.
 *   ٧. **مَن أنشأَ `claim_safety_incident_delivery` وصَلَ `orders` وصلاً خارجيّاً**:
 *      وصلٌ داخليٌّ على `i.order_id` يُسقِطُ بلاغاً بلا رحلةٍ (`F12-03`) من
 *      جملةِ الإرجاعِ **بعدَ** أن يُختَمَ الصفُّ `sending`، فيبقى عالقاً لا
 *      `pending` يُعادُ ولا خطأٌ يُرى — **نداءٌ يُقَيَّدُ ولا يُسَلَّمُ صمتاً**.
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

/**
 * هجراتُ السطحِ مرتَّبةً زمنيّاً — والأخيرُ هوَ الحاكمُ عندَ PostgreSQL.
 * ولماذا مكتوبةٌ لا مُكتشَفةٌ بنمطٍ: لأنَّ النمطَ يُدخِلُ هجراتٍ لا تُرادُ
 * ويُسقِطُ هجرةً أُعيدَ اسمُها، والـ`F12-03` أرادَ حكماً لِكلِّ مِلفٍّ في نفسِه.
 */
export const SOS_SQL_FILES: readonly string[] = [
  "supabase/migrations/20260908010000_unified_outbox_safety_incident.sql",
  "supabase/migrations/20260914120000_f2_10_sos_surface.sql",
  "supabase/migrations/20260918010000_f12_03_sos_without_a_ride.sql",
];

/** اسمُ دالّةِ مطالبةِ التسليمِ — موضوعُ القاعدةِ ٧. */
export const DELIVERY_CLAIM_FUNCTION = "claim_safety_incident_delivery";

/** اسمُ حَكَمِ السطحِ — موضوعُ القاعدةِ ٣. */
export const SURFACE_STATE_FUNCTION = "sos_surface_state";
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
  /**
   * هجراتُ السطحِ: مسارٌ ⇒ نصٌّ كما هوَ. **خريطةٌ لا نصٌّ موصولٌ**: قاعدةٌ
   * تُقاسُ على المجموعِ تمرُّ بنزعٍ مكتوبٍ في هجرةٍ أخرى عن توقيعٍ آخرَ.
   */
  readonly sqlFiles: Readonly<Record<string, string>>;
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
  /**
   * وفي القاعدةِ أيضاً: مجالٌ يعرفُ الرمزَ ودالّةٌ لا تنشرُه **لا تُفصِحُ عن شيءٍ**.
   * والمطلوبُ من **كلِّ مِلفٍّ يُعيدُ تعريفَ الحَكَمِ**، لا من مجموعِ المِلفّاتِ:
   * مَن أعادَ التعريفَ وأسقطَ الرمزَ ألغى الإفصاحَ حقّاً، ولو بقيَ مكتوباً في
   * هجرةٍ أقدمَ لا تُشَغَّلُ بعدَها.
   */
  const definers = Object.entries(input.sqlFiles).filter(([, sql]) =>
    definesFunction(sql, SURFACE_STATE_FUNCTION),
  );
  if (definers.length === 0) {
    problems.push(
      `${SOS_SQL_FILES.join(" · ")}: لم يُقرأْ مِلفٌّ يُعرِّفُ «${SURFACE_STATE_FUNCTION}» — ` +
        `والقاعدةُ لا تمرُّ بمجموعةٍ لا حَكَمَ فيها.`,
    );
    return problems;
  }
  for (const [path, sql] of definers) {
    if (!sql.includes(MANDATORY_DISCLOSURE)) {
      problems.push(
        `${path}: يُعيدُ تعريفَ «${SURFACE_STATE_FUNCTION}» ولا ينشُرُ «${MANDATORY_DISCLOSURE}» — ` +
          `المجالُ يعرفُ الرمزَ والقاعدةُ لا تُرسِلُه، فالسطرُ لا يُعرَضُ أبداً.`,
      );
    }
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

/**
 * نصٌّ مُسطَّحٌ **بلا تعليقاتٍ** وبمسافةٍ واحدةٍ. والتعليقُ يُمحى لأنَّ رأسَ هجرةِ
 * الـ`F12-03` يشرحُ العطبَ القديمَ بنصِّه (`join orders o on …`)، وحاجزٌ يسقطُ على
 * شرحِ العطبِ يُعلِّمُ كاتبَه أن **لا يشرحَ** — وذاكَ أسوأُ من ألّا يكونَ حاجزٌ.
 */
function flatten(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** هل يُنشئُ هذا النصُّ دالّةً بهذا الاسمِ؟ — قراءةٌ واحدةٌ تقرأُها قاعدتانِ. */
function definesFunction(sql: string, name: string): boolean {
  return new RegExp(`create (?:or replace )?function ${name}\\s*\\(`).test(flatten(sql));
}

/**
 * جسمُ دالّةٍ مُسمَّاةٍ وحدَه — من `create … function name(` إلى `$$ language`.
 * ولماذا الجسمُ لا المِلفُّ كلُّه: المِلفُّ نفسُه يوصِلُ `orders` وصلاً داخليّاً في
 * `trigger_sos` **بحقٍّ** (رحلةٌ قائمةٌ لها طلبٌ)، فحاجزٌ يقرأُ المِلفَّ يُدينُ
 * الصوابَ ويُجبِرُ على استثناءٍ — والاستثناءُ يُبطِلُ القاعدةَ.
 */
function functionBody(sql: string, name: string): string {
  const flat = flatten(sql);
  const start = flat.search(new RegExp(`create (?:or replace )?function ${name}\\s*\\(`));
  if (start < 0) return "";
  const rest = flat.slice(start);
  const end = rest.search(/\$\$ language/);
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * القاعدة ٦ — كلُّ دالّةٍ تُنشَأُ في هجرةٍ يُنزَعُ تنفيذُها عن الأدوارِ الثلاثةِ
 * **في الهجرةِ نفسِها** لا في أختٍ لها.
 */
export function functionRevokeProblems(input: SosSurfaceContractInput): readonly string[] {
  const problems: string[] = [];
  const entries = Object.entries(input.sqlFiles);
  if (entries.length === 0) {
    problems.push("لم تُقرأْ هجرةٌ واحدةٌ — القاعدةُ لا تمرُّ بخريطةٍ فارغةٍ.");
    return problems;
  }
  for (const [path, source] of entries) {
    const sql = flatten(source);
    const created = [...sql.matchAll(/create (?:or replace )?function ([a-z0-9_]+)\s*\(/g)].map(
      (match) => match[1] ?? "",
    );
    if (created.length === 0) {
      problems.push(`${path}: لم تُقرأْ دالّةٌ واحدةٌ في الهجرةِ — القاعدةُ لا تمرُّ بقائمةٍ فارغةٍ.`);
      continue;
    }
    for (const name of new Set(created)) {
      const pattern = new RegExp(`revoke execute on function ${name}\\s*\\([^)]*\\) from ([^;]+);`);
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
          problems.push(
            `${path}: نزعُ تنفيذِ «${name}» لا يذكرُ الدورَ «${role}» — نزعٌ ناقصٌ بابٌ مفتوحٌ.`,
          );
        }
      }
    }
  }
  return problems;
}

/**
 * القاعدة ٧ — مطالبةُ التسليمِ توصِلُ `orders` **وصلاً خارجيّاً**.
 *
 * ولماذا يُقاسُ نصُّ الهجرةِ لا أثرُها: الأثرُ مقيسٌ في تكاملٍ على PostgreSQL
 * حقيقيّةٍ، ولكنَّ تكاملاً يقيسُ **ما يُسَلَّمُ** ولا يمنعُ أن يُقلَبَ الوصلُ غداً
 * داخليّاً في هجرةٍ جديدةٍ **مع حذفِ حالةِ الاختبارِ في الدفعةِ نفسِها**. والنصُّ
 * ههنا يُقالُ فيه مرّةً واحدةً لا اجتهادَ فيه.
 */
export function deliveryOuterJoinProblems(input: SosSurfaceContractInput): readonly string[] {
  const problems: string[] = [];
  /**
   * الحكمُ على **آخرِ** مَن عرَّفَ الدالّةَ لا على كلِّ مَن عرَّفَها: الهجرةُ التي
   * أنشأتها أوّلَ مرّةٍ (`20260908010000`) كتبَت وصلاً داخليّاً — وذاك تاريخٌ
   * مُطبَّقٌ لا يُعادُ كتابتُه (`ح-8`: يُصحَّحُ بالإضافةِ)، وPostgreSQL تُنفِّذُ
   * التعريفَ الأخيرَ. فالمقياسُ: أحدثُ تعريفٍ يوصِلُ خارجيّاً، وأيُّ هجرةٍ
   * تاليةٍ تُعيدُ الوصلَ داخليّاً تُصبِحُ هيَ الأخيرةَ وتسقطُ ههنا.
   */
  const definers = SOS_SQL_FILES.filter((path) => {
    const sql = input.sqlFiles[path];
    return sql !== undefined && definesFunction(sql, DELIVERY_CLAIM_FUNCTION);
  });
  const governing = definers.at(-1);
  if (governing === undefined) {
    problems.push(
      `${SOS_SQL_FILES.join(" · ")}: لم يُقرأْ مِلفٌّ يُعرِّفُ «${DELIVERY_CLAIM_FUNCTION}» — ` +
        `والقاعدةُ لا تمرُّ بمجموعةٍ لا مطالبةَ تسليمٍ فيها.`,
    );
    return problems;
  }
  const body = functionBody(input.sqlFiles[governing] ?? "", DELIVERY_CLAIM_FUNCTION);
  // وصلٌ داخليٌّ صريحٌ أو مُضمَرٌ: `join orders` غيرُ مسبوقٍ بـ`left`/`full`.
  if (/(?<!left )(?<!left outer )(?<!full )(?<!full outer )join orders\b/.test(body)) {
    problems.push(
      `${governing}: «${DELIVERY_CLAIM_FUNCTION}» توصِلُ «orders» وصلاً داخليّاً — ` +
        `وبلاغٌ بلا رحلةٍ (\`F12-03\`) يُختَمُ «sending» ثمَّ يُسقِطُهُ الوصلُ، ` +
        `فيبقى عالقاً لا يُسَلَّمُ ولا يُعادُ ولا يُرى — وذاكَ نداءٌ يُفقَدُ صمتاً.`,
    );
  }
  if (!/left join orders\b/.test(body)) {
    problems.push(
      `${governing}: «${DELIVERY_CLAIM_FUNCTION}» لا توصِلُ «orders» وصلاً خارجيّاً — ` +
        `والوصلُ الخارجيُّ هوَ ما يجعلُ بلاغاً بلا رحلةٍ يُسَلَّمُ لا يُخفى.`,
    );
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
    ...deliveryOuterJoinProblems(input),
  ];
}

/** رموزُ الإفصاحِ كما نشرَها النطاقُ — مصدرٌ واحدٌ لا نسخةٌ مكتوبةٌ ههنا. */
export const DISCLOSURE_CODES: readonly string[] = SOS_DISCLOSURE_CODES;
