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

/** ملفٌّ يُعرَضُ على الحَكَمِ: مسارُه النسبيُّ ونصُّه. */
export type AuditedFile = {
  readonly path: string;
  readonly source: string;
};

/** إعفاءٌ مُعلَنٌ: لا يُقبَلُ بلا سببٍ ومالكٍ، ويُخفِقُ إن كانَ ميّتاً. */
export type PreconditionExemption = {
  readonly path: string;
  readonly reason: string;
  readonly owner: string;
};

/** خرقٌ واحدٌ: قاعدتُه ومسارُه ورسالتُه بالعربيّةِ. */
export type Violation = {
  readonly rule: 1 | 2 | 3 | 4 | 5;
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
  readonly helper: string | undefined;
  readonly exemptions: readonly PreconditionExemption[];
};

export function auditCityPrecondition(input: CityPreconditionInput): readonly Violation[] {
  const violations: Violation[] = [];
  const exemptByPath = new Map(input.exemptions.map((e) => [e.path, e]));

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
    const exemption = exemptByPath.get(file.path);

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

  // ــ القاعدةُ ٥: إعفاءٌ يشيرُ إلى ملفٍّ لا وجودَ له، أو بلا سببٍ ومالكٍ ــ
  const knownPaths = new Set(input.integrationFiles.map((f) => f.path));
  for (const exemption of input.exemptions) {
    if (!knownPaths.has(exemption.path)) {
      violations.push({
        rule: 5,
        path: exemption.path,
        message: `إعفاءٌ لملفٍّ **لا وجودَ له** في \`tests/integration\` — مسارٌ متقادمٌ يُنزَعُ لا يُترَكُ.`,
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
