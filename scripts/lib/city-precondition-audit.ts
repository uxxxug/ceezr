/**
 * # حَكَمُ الشرطِ المسبقِ لمدينةٍ مفعَّلةٍ — `OPS-019` (منطقٌ نقيٌّ)
 *
 * **الغرض:** أن يكونَ «مدينةٌ مفعَّلةٌ لها منطقةُ خدمةٍ مفعَّلةٌ» شرطاً
 * **يَصنعُه** ملفُّ الاختبارِ ويَردُّه، لا شرطاً **يستعيرُه** من ملفٍّ سبقَه في
 * الجولةِ. فالثاني يجعلُ الخضرةَ رهنَ ترتيبِ التشغيلِ لا صحّةِ ما تقيسُ.
 *
 * **الحالة:** `OPS-019` — منطقٌ نقيٌّ بلا قراءةِ قرصٍ ولا `process.exit`، كي
 * تُزرَعَ فيه حالاتُ السقوطِ في اختبارِ وحدةٍ (`ح-7`: حاجزٌ بلا حالةٍ سالبةٍ
 * لا يُحسَبُ مفروضاً).
 *
 * **ينتمي إلى:** الحجزُ `OPS-019` في `ROADMAP.md` · `ADR 0116`.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** `scripts/check-integration-city-precondition.ts`
 * وحدَه؛ وخطوةٌ مسمّاةٌ في `verify` وفي سلسلةِ `ci`.
 *
 * **لماذا حاجزٌ ساكنٌ لا إصلاحٌ وحدَه؟** لأنَّ إصلاحَ ثمانيةِ ملفّاتٍ بلا حاجزٍ
 * يعودُ في التاسعِ: النمطُ الخامُ أقصرُ سطراً ويمرُّ في `tsc` وفي المُدقِّقِ
 * وفي الجولةِ الكاملةِ — **ولا يراه إلّا من يُشغِّلُ الملفَّ منفرداً**. وقد
 * تكرَّرَ فعلاً ثمانيَ مرّاتٍ قبلَ أن يُرى.
 *
 * **ما لا يفعله هذا الحاجزُ عن قصدٍ:**
 * - **لا يُشغِّلُ اختباراً ولا يمسُّ قاعدةً.** يقرأُ نصوصاً ويحكمُ عليها.
 * - **لا يمنعُ قراءةَ `is_active`.** يمنعُ **الاعتمادَ عليها في اختيارِ**
 *   مدينةِ الزرعِ. فتوكيدٌ يقيسُ أنَّ مدينةً صارت مفعَّلةً مقصودٌ ومسموحٌ.
 * - **لا يقرأُ نيّةً.** مسحٌ لفظيٌّ على نصِّ الملفِّ لا تحليلُ تدفُّقٍ؛ وحدُّه
 *   هذا مكتوبٌ في `ADR 0116` §٤ لا مسكوتٌ عنه.
 * - **لا يقبلُ إعفاءً بلا سببٍ ومالكٍ، ولا إعفاءً ميّتاً.** إعفاءٌ لا
 *   يُستعمَلُ ثقبٌ مفتوحٌ بلا مقابلٍ يبقى حتّى يمرَّ منه غداً ملفٌّ حقيقيٌّ.
 */

import { toPosixPath } from "./repo-path.ts";

/** ملفٌّ يُعرَضُ على الحَكَمِ: مسارُه النسبيُّ ونصُّه. */
export type AuditedFile = {
  readonly path: string;
  readonly source: string;
};

/**
 * القاعدةُ التي يجوزُ تعليقُها بإعفاءٍ مُعلَنٍ — **اثنتانِ لا كلٌّ**:
 * `1` الشرطُ المُستعارُ، و`6` القروباتُ في نفسِ عبارةِ التفعيلِ. وما عداهما
 * (ردُّ ما فُعِّلَ · عقدُ المعينِ · صحّةُ السجلِّ · وحدةُ السجلِّ) لا يُعلَّقُ،
 * لأنَّ تعليقَها يُذهِبُ الإنفاذَ لا يُضيِّقُه.
 */
export type ExemptibleRule = 1 | 6;

/**
 * إعفاءٌ مُعلَنٌ: لا يُقبَلُ بلا سببٍ ومالكٍ، ولا بلا قاعدةٍ يُعلِّقُها،
 * ويُخفِقُ إن كانَ ميّتاً.
 *
 * و`rule` مُلزِمٌ بقصدٍ (`OPS-020`): كانَ الإعفاءُ قبلَه مُطلَقاً في سجلٍّ
 * وسِمةً في آخرَ، فإعفاءُ ملفٍّ من قاعدةٍ كانَ يُعفيهِ ضِمناً من أخرى.
 */
export type PreconditionExemption = {
  readonly path: string;
  readonly rule: ExemptibleRule;
  readonly reason: string;
  readonly owner: string;
};

/** خرقٌ واحدٌ: قاعدتُه ومسارُه ورسالتُه بالعربيّةِ. */
export type Violation = {
  readonly rule: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly path: string;
  readonly message: string;
};

/** المعينُ الوحيدُ الذي يَصنعُ الشرطَ ويَردُّه. */
export const HELPER_PATH = "tests/support/active-city.ts";

/** أسماءُ ما يُصدِّرُه المعينُ — تُقرأُ ههنا ولا تُكرَّرُ في كلِّ قاعدةٍ. */
export const ENSURE_FN = "ensureActiveCity";
export const RESTORE_FN = "restoreCityBaseline";

/**
 * الأعمدةُ الثلاثةُ التي يوجِبُها قيدُ `cities_active_requires_groups` معَ
 * `is_active = true`. ونزعُ أحدِها من المعينِ يجعلُ كلَّ تفعيلٍ يُخفِقُ على
 * القيدِ — فوجودُها مقيسٌ لا موثوقٌ به.
 */
export const REQUIRED_GROUP_COLUMNS = [
  "telegram_support_group_id",
  "telegram_escalation_group_id",
  "telegram_unsubscribed_drivers_group_id",
] as const;

/**
 * النمطُ المُستعارُ: اختيارُ مدينةٍ بشرطِ `is_active` في عبارةِ `where`.
 * يُطابِقُ `where c.is_active` و`where cities.is_active` و`where c.is_active = true`
 * وما يسبقُها فراغٌ أو سطرٌ جديدٌ — ولا يُطابِقُ `and a.is_active` في وصلةٍ،
 * إذ منطقةُ الخدمةِ المفعَّلةُ شرطٌ في البذرةِ لا شيءٌ يُصنَعُ.
 */
const BORROWED_SELECTOR = /where\s+(?:c|ci|city|cities)\.is_active\b/i;

/** تفعيلُ مدينةٍ: `update cities … set … is_active = true`. */
const ACTIVATION = /update\s+cities[\s\S]{0,400}?is_active\s*=\s*true/i;

/** ردُّ التعطيلِ صراحةً — بديلٌ مقبولٌ عن المعينِ لملفٍّ يملكُ مدينتَه. */
/**
 * ملفٌّ **يملكُ** صفوفَ مدنِه: يُدخِلُها ثمَّ يحذفُها. مثالُه
 * `city-settings-inheritance.test.ts` (رموزُ `ZY1`/`ZY2`) — تفعيلُه توكيدٌ على
 * صفٍّ من صُنعِه، لا استعارةٌ لخطِّ الأساسِ ولا تركٌ له مفعَّلاً.
 *
 * وهذا **حدُّ** الحاجزِ لا ثغرتُه: الفحصُ لفظيٌّ لا تحليلُ تدفُّقٍ، فلا يُثبِتُ
 * أنَّ `where id = ${cityId}` يعني صفَّ الملفِّ لا صفَّ البذرةِ. فالبرهانُ
 * الحقيقيُّ على هذهِ الملفّاتِ هوَ نجاحُها منفردةً من خطِّ أساسٍ نظيفٍ وردُّها
 * إيّاه — وهوَ مقيسٌ في `ROADMAP.md` تحتَ `OPS-019`.
 */
const OWNS_ITS_CITIES = /(insert\s+into\s+cities|delete\s+from\s+cities)/i;

const DEACTIVATION = /is_active\s*=\s*false/i;

/**
 * مسارُ **سجلِّ الإعفاءاتِ الوحيدِ** المشروعِ. تقرؤُه القاعدةُ ٧ كي تُميِّزَ
 * السجلَّ المشروعَ من سجلٍّ ثانٍ يظهرُ لاحقاً. ويُعرَّفُ ههنا لا في ملفِّ
 * السجلِّ كي لا يستوردَ الحَكَمُ سجلَّه فتنعقدَ حلقةُ استيرادٍ.
 */
export const EXEMPTION_REGISTRY_PATH = "scripts/lib/city-precondition-exemptions.ts";

/**
 * عبارةُ SQL المحيطةُ بموضعِ التفعيلِ: من أقربِ ``sql` `` قبلَه إلى أوّلِ
 * `` ` `` بعدَه. الحدُّ الأدنى الذي يكفي للحكمِ — فالقروباتُ إن ضُبِطَت ضُبِطَت
 * في نفسِ العبارةِ، وضبطُها في عبارةٍ منفصلةٍ بعدَها لا ينفعُ لأنَّ القيدَ
 * يُفحَصُ فوراً.
 *
 * مَنقولةٌ كما هيَ من `scripts/check-test-city-activation.ts` في `OPS-020`
 * (`ح-8`: نقلٌ لا حذفٌ).
 */
export function statementAround(source: string, activationIndex: number): string {
  const opener = source.lastIndexOf("sql`", activationIndex);
  const start = opener === -1 ? Math.max(0, activationIndex - 400) : opener;
  const closer = source.indexOf("`", activationIndex);
  const end = closer === -1 ? Math.min(source.length, activationIndex + 400) : closer;
  return source.slice(start, end);
}

/**
 * القاعدةُ ٦ لملفٍّ واحدٍ: كلُّ `is_active = true` على `cities` تُضبَطُ معَه
 * الأعمدةُ الثلاثةُ في **نفسِ** العبارةِ. تُعادُ الخروقُ بلا إعفاءٍ — والإعفاءُ
 * يُطبَّقُ في الحَكَمِ كي تُقاسَ حياةُ الإعفاءِ بما يُنتِجُه الملفُّ فعلاً.
 *
 * ويُقرأُ النصُّ **خاماً** لا منزوعَ التعليقِ، كما كانَ في الحاجزِ القديمِ —
 * فتغييرُ ذلكَ توسيعٌ لا نقلٌ.
 */
export function auditActivationStatements(file: AuditedFile): readonly Violation[] {
  const violations: Violation[] = [];
  const pattern = /is_active\s*=\s*true/g;
  let match = pattern.exec(file.source);
  while (match !== null) {
    const statement = statementAround(file.source, match.index);
    // `update cities` وحدَها معنيّةٌ؛ جداولُ أخرى فيها `is_active` لا قيدَ لها.
    if (/update\s+cities/i.test(statement)) {
      const missing = REQUIRED_GROUP_COLUMNS.filter((column) => !statement.includes(column));
      if (missing.length > 0) {
        const line = file.source.slice(0, match.index).split("\n").length;
        violations.push({
          rule: 6,
          path: file.path,
          message:
            `تفعيلُ مدينةٍ بلا قروباتِها في نفسِ العبارةِ (السطرُ ${String(line)}) — ناقصٌ: ` +
            `${missing.join("، ")}. فنجاحُه رهنُ ترتيبِ اكتشافِ الملفّاتِ لا صحّةِ ما يفحصُه؛ ` +
            `اضبِطْها في نفسِ عبارةِ \`update cities\`: ` +
            `\`telegram_support_group_id = coalesce(telegram_support_group_id, -1001)\`. ` +
            `العبارةُ: ${statement.replace(/\s+/g, " ").trim().slice(0, 160)}`,
        });
      }
    }
    match = pattern.exec(file.source);
  }
  return violations;
}

/**
 * علاماتُ **موضوعِ** عقدِ تفعيلِ المدينةِ. تقرؤُها القاعدةُ ٧ كي تفرِّقَ بينَ
 * سجلٍّ يُعلِّقُ **هذا** العقدَ وسجلٍّ لموضوعٍ آخرَ تماماً (سوالبُ مبذورةٌ
 * · سجلُّ تخطٍ · ضوابطُ أمنٍ)، فالثاني ليسَ تكراراً لمصدرِ حقيقتِنا ولا شأنَ
 * لهذا الحاجزِ به.
 *
 * وهذا **حدُّ القاعدةِ مُعلَناً**: سجلٌّ يُعلِّقُ العقدَ بلا ذِكرِ واحدةٍ من
 * هذهِ العلاماتِ لا تراه القاعدةُ ٧ — ولكنَّ سجلّاً كذلكَ لا يُقرأُ أصلاً من
 * موضوعِهِ، ومراجعتُه تراه من نفسِ الموضعِ.
 */
const SUBJECT_MARKERS: readonly RegExp[] = [
  /cities_active_requires_groups/i,
  /update\s+cities/i,
  /telegram_(?:support|escalation|unsubscribed_drivers)_group_id/i,
  /\bis_active\b[\s\S]{0,80}\bcities\b/i,
  /\bcities\b[\s\S]{0,80}\bis_active\b/i,
];

/**
 * القاعدةُ ٧: سجلُّ إعفاءاتٍ **ثانٍ لعقدِ تفعيلِ المدينةِ**. ملفٌ في
 * `scripts/` — غيرُ السجلِّ المشروعِ — يذكرُ موضوعَ العقدِ **و**يجمعُ مساراتِ
 * ملفّاتِ اختبارٍ في مصفوفةٍ أو `Set` هوَ سجلٌّ موازٍ بحكمِ الأمرِ الواقعِ، وهوَ
 * الداءُ الذي أنشأَ `OPS-020` أصلاً (كانَ `INTENTIONAL_BARE_ACTIVATION` في
 * `check-test-city-activation.ts` معَ منطقِ الحكمِ نفسِه).
 *
 * **وموضوعُ السجلِّ شرطٌ لا زينةٌ**: من دونِه تقرأُ القاعدةُ أحدَ عشرَ
 * سجلّاً قائماً لمواضيعَ أخرى (سوالبُ مبذورةٌ · تخطٍ · ضوابطُ أمنٍ) خرقاً —
 * وقِيسَ ذلكَ فعلاً على المستودعِ حينَ كانَ الشرطُ الشكلَ وحدَه.
 */
export function auditExemptionRegistryUniqueness(
  scriptFiles: readonly AuditedFile[],
): readonly Violation[] {
  const violations: Violation[] = [];
  const TEST_PATH = /tests\/(?:integration|e2e|unit)\/[\w.\-/]+\.test\.ts/;
  const COLLECTION =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)[^=\n]*=\s*(?:new\s+Set\s*\(\s*)?\[([\s\S]*?)\]/g;
  for (const file of scriptFiles) {
    if (file.path === EXEMPTION_REGISTRY_PATH) continue;
    const body = stripComments(file.source);
    if (!SUBJECT_MARKERS.some((marker) => marker.test(body))) continue;
    let match = COLLECTION.exec(body);
    while (match !== null) {
      const name = match[1] ?? "";
      const literal = match[2] ?? "";
      if (TEST_PATH.test(literal)) {
        violations.push({
          rule: 7,
          path: file.path,
          message:
            `سجلُّ إعفاءاتٍ **ثانٍ**: \`${name}\` يجمعُ مساراتِ ملفّاتِ اختبارٍ خارجَ ` +
            `\`${EXEMPTION_REGISTRY_PATH}\`. وحكمانِ على موضوعٍ واحدٍ بسجلَّينِ هوَ عينُ ` +
            `\`OPS-020\`: يُعدَّلُ أحدُهما وينسى الآخرُ. يُنقَلُ المُدخلُ إلى السجلِّ ` +
            `الواحدِ بسببِه ومالكِه وقاعدتِه.`,
        });
      }
      match = COLLECTION.exec(body);
    }
  }
  return violations;
}

/** يُنزَعُ التعليقُ كي لا يُحكَمَ على شرحٍ يذكرُ النمطَ ليُحذِّرَ منه. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * يحكمُ على ملفّاتِ التكاملِ ومعينِها. يُعيدُ الخروقَ ولا يطبعُ ولا يُخرِجُ.
 *
 * `integrationFiles` ملفّاتُ `tests/integration/*.test.ts`، و`helper` نصُّ
 * المعينِ أو `undefined` إن غابَ — وغيابُه خرقٌ بذاتِه لا صمتٌ.
 */
export type CityPreconditionInput = {
  readonly integrationFiles: readonly AuditedFile[];
  /**
   * كلُّ ملفّاتِ الاختبارِ التي يحكُمُ عليها عقدُ التفعيلِ (`tests/integration`
   * و`tests/e2e` و`tests/unit`) — نطاقُ القاعدةِ ٦. **حقلٌ مُلزِمٌ لا اختياريٌّ**:
   * نداءٌ يَنسى ملفّاتِه يُنتِجُ أخضرَ بلا محروسٍ، وذاكَ ما تمنعُه القاعدةُ ٦
   * بردِّها خرقاً على مجموعةٍ فارغةٍ.
   */
  readonly activationFiles: readonly AuditedFile[];
  /** ملفّاتُ `scripts/` كما هيَ على القرصِ — نطاقُ القاعدةِ ٧. */
  readonly scriptFiles: readonly AuditedFile[];
  readonly helper: string | undefined;
  readonly exemptions: readonly PreconditionExemption[];
};

export function auditCityPrecondition(input: CityPreconditionInput): readonly Violation[] {
  const violations: Violation[] = [];
  /** المفتاحُ قاعدةٌ ومسارٌ معاً: إعفاءٌ من قاعدةٍ لا يُعفي من أخرى (`OPS-020`). */
  // والمسارُ مُوحَّدُ الفاصلِ: إعفاءٌ مكتوبٌ بـ`/` وملفٌّ يأتي بـ`\` على Windows
  // ينتجُ عنهما سقوطٌ كاذبٌ على جهازِ المالكِ وحدَه — وقد وقعَ فعلاً.
  const key = (rule: ExemptibleRule, path: string): string =>
    `${String(rule)}::${toPosixPath(path)}`;
  const exemptByRule = new Map(input.exemptions.map((e) => [key(e.rule, e.path), e]));

  // ــ القاعدةُ ٤: المعينُ موجودٌ ويستوفي قيدَ القاعدةِ ــ
  // تُحكَمُ أوّلاً لأنَّ القواعدَ الثلاثَ الأولى تُحيلُ إليه.
  if (input.helper === undefined) {
    violations.push({
      rule: 4,
      path: HELPER_PATH,
      message: `المعينُ ${HELPER_PATH} غائبٌ — والقواعدُ تُحيلُ إليه، فغيابُه يُسقِطُ الإنفاذَ كلَّه لا قاعدةً.`,
    });
  } else {
    const helperBody = stripComments(input.helper);
    for (const fn of [ENSURE_FN, RESTORE_FN]) {
      if (!new RegExp(`export\\s+async\\s+function\\s+${fn}\\b`).test(helperBody)) {
        violations.push({
          rule: 4,
          path: HELPER_PATH,
          message: `المعينُ لا يُصدِّرُ \`${fn}\` — فكلُّ ملفٍّ يستورِدُه ينكسرُ، والحاجزُ يقولُ ذلكَ قبلَ المُشغِّلِ.`,
        });
      }
    }
    for (const col of REQUIRED_GROUP_COLUMNS) {
      if (!helperBody.includes(col)) {
        violations.push({
          rule: 4,
          path: HELPER_PATH,
          message:
            `المعينُ لا يذكرُ العمودَ \`${col}\`، وقيدُ \`cities_active_requires_groups\` ` +
            `يوجِبُ الأعمدةَ الثلاثةَ معَ \`is_active = true\` — فتفعيلٌ بدونِه يُخفِقُ على القيدِ.`,
        });
      }
    }
    if (!helperBody.includes("previous.isActive")) {
      violations.push({
        rule: 4,
        path: HELPER_PATH,
        message:
          `المعينُ لا يَردُّ \`is_active\` من **اللقطةِ** (\`previous.isActive\`) — فهوَ يُفعِّلُ ولا يَردُّ، ` +
          `وتركُ المدينةِ مفعَّلةً يُورِّثُ لِمَن بعدَه شرطاً لم يطلُبْه.`,
      });
    }
  }

  for (const file of input.integrationFiles) {
    const body = stripComments(file.source);
    const exemption = exemptByRule.get(key(1, file.path));

    // ــ القاعدةُ ١: لا اختيارَ مدينةٍ بشرطِ `is_active` ــ
    if (BORROWED_SELECTOR.test(body)) {
      if (exemption === undefined) {
        violations.push({
          rule: 1,
          path: file.path,
          message:
            `شرطٌ مسبقٌ **مُستعارٌ**: المدينةُ تُختارُ بـ\`where …is_active\`، والبذرةُ تُنشئُ ` +
            `مدنَ الإطلاقِ معطَّلةً (\`F2-05\`) — فالملفُّ يُخفِقُ منفرداً وينجحُ إن سبقَه غيرُه. ` +
            `يُختارُ بالرمزِ عبرَ \`${ENSURE_FN}\` من \`${HELPER_PATH}\`.`,
        });
      }
    } else if (exemption !== undefined) {
      // ــ القاعدةُ ٥: لا إعفاءَ ميّتاً ــ
      violations.push({
        rule: 5,
        path: file.path,
        message: `إعفاءٌ **ميّتٌ**: الملفُّ لا يحملُ النمطَ المُستعارَ، فالإعفاءُ ثقبٌ مفتوحٌ بلا مقابلٍ — يُنزَعُ من السجلِّ.`,
      });
    }

    // ــ القاعدةُ ٢: من فعَّلَ مدينةً ردَّها ــ
    if (
      ACTIVATION.test(body) &&
      !body.includes(RESTORE_FN) &&
      !DEACTIVATION.test(body) &&
      !OWNS_ITS_CITIES.test(body)
    ) {
      violations.push({
        rule: 2,
        path: file.path,
        message:
          `يُفعِّلُ مدينةً ولا يَردُّها: لا \`${RESTORE_FN}\` ولا \`is_active = false\` في الملفِّ — ` +
          `فيُورِّثُ لِمَن بعدَه شرطاً لم يطلُبْه، وهوَ الداءُ نفسُه معكوساً.`,
      });
    }

    // ــ القاعدةُ ٣: من استعملَ المعينَ ردَّ بهِ ــ
    if (body.includes(`${ENSURE_FN}(`) && !body.includes(`${RESTORE_FN}(`)) {
      violations.push({
        rule: 3,
        path: file.path,
        message: `يُنادي \`${ENSURE_FN}\` ولا يُنادي \`${RESTORE_FN}\` — فنصفُ العقدِ منفَّذٌ، والردُّ هوَ نصفُه الآخرُ.`,
      });
    }
  }

  // ــ القاعدةُ ٦: القروباتُ الثلاثةُ في نفسِ عبارةِ التفعيلِ ــ
  // منقولةٌ من `scripts/check-test-city-activation.ts` في `OPS-020` كما هيَ.
  // والمجموعةُ الفارغةُ خرقٌ: حاجزٌ بلا محروسٍ أخضرٌ كاذبٌ.
  if (input.activationFiles.length === 0) {
    violations.push({
      rule: 6,
      path: "tests/",
      message:
        "لا ملفَّ اختبارٍ واحدٌ في نطاقِ عقدِ التفعيلِ — والمجموعةُ الفارغةُ تُقرأُ نجاحاً وهيَ غيابُ محروسٍ.",
    });
  }
  const liveRule6 = new Set<string>();
  for (const file of input.activationFiles) {
    const found = auditActivationStatements(file);
    if (found.length === 0) continue;
    liveRule6.add(toPosixPath(file.path));
    if (exemptByRule.get(key(6, file.path)) === undefined) violations.push(...found);
  }

  // ــ القاعدةُ ٧: سجلُّ إعفاءاتٍ ثانٍ في `scripts/` ــ
  violations.push(...auditExemptionRegistryUniqueness(input.scriptFiles));

  // ــ القاعدةُ ٥: إعفاءٌ يشيرُ إلى ملفٍّ لا وجودَ له، أو بلا سببٍ ومالكٍ، أو ميّتٌ ــ
  const integrationPaths = new Set(input.integrationFiles.map((f) => toPosixPath(f.path)));
  const activationPaths = new Set(input.activationFiles.map((f) => toPosixPath(f.path)));
  for (const exemption of input.exemptions) {
    const knownPaths = exemption.rule === 1 ? integrationPaths : activationPaths;
    const exemptedPath = toPosixPath(exemption.path);
    const scope = exemption.rule === 1 ? "`tests/integration`" : "نطاقِ عقدِ التفعيلِ";
    if (!knownPaths.has(exemptedPath)) {
      violations.push({
        rule: 5,
        path: exemption.path,
        message: `إعفاءٌ لملفٍّ **لا وجودَ له** في ${scope} — مسارٌ متقادمٌ يُنزَعُ لا يُترَكُ.`,
      });
    } else if (exemption.rule === 6 && !liveRule6.has(exemptedPath)) {
      violations.push({
        rule: 5,
        path: exemption.path,
        message:
          `إعفاءٌ **ميّتٌ** من القاعدةِ ٦: الملفُّ لا يُفعِّلُ مدينةً بلا قروباتِها، ` +
          `فالإعفاءُ ثقبٌ مفتوحٌ بلا مقابلٍ — يُنزَعُ من السجلِّ.`,
      });
    }
    if (exemption.reason.trim() === "" || exemption.owner.trim() === "") {
      violations.push({
        rule: 5,
        path: exemption.path,
        message: `إعفاءٌ بلا سببٍ أو بلا مالكٍ — والإعفاءُ المجهولُ لا يُراجَعُ فلا يُقبَلُ.`,
      });
    }
  }

  return violations;
}
