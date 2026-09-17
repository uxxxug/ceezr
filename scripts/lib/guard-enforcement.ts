/**
 * # مكتبةُ الحاجزِ: تكافؤُ الإنفاذِ بينَ المشغِّلِ المحلّيِّ وسيرِ CI
 *
 * **المشكلةُ التي أنشأَت هذا الحاجزَ (مقيسةٌ لا مُفترَضةٌ):** سبعةُ حواجزَ كانَت
 * في `package.json → ci` **ولا تُشغَّلُ في أيِّ سيرِ عملٍ**، ووثيقتانِ تدَّعيانِ
 * صراحةً أنَّها «حاجزُ CI قائمٌ». **وحاجزٌ لا يُسقِطُ بناءً بعيداً ليسَ حاجزاً**؛
 * هوَ عادةٌ محلّيّةٌ تنكسرُ بأوّلِ من ينسى.
 *
 * **الاتجاهُ الآخرُ عطبٌ كذلكَ:** حاجزٌ يعملُ في CI ولا يعملُ محلّيًّا يجعلُ
 * الأخضرَ المحلّيَّ **وعداً كاذباً**، فيُدفَعُ العملُ ثمَّ يُكتشَفُ الإخفاقُ بعيداً.
 *
 * **القواعدُ الأربعُ:**
 * 1. كلُّ حاجزٍ في `ci` مرجوعٌ إليهِ في سيرِ عملٍ — أو له إعفاءٌ مكتوبٌ.
 * 2. كلُّ حاجزٍ في سيرِ عملٍ مُشغَّلٌ في `ci` — أو له إعفاءٌ مكتوبٌ.
 * 3. كلُّ `scripts/check-*` على القرصِ مُنادىً في أحدِهما — فملفٌّ لا يُنادى وهمٌ.
 * 4. لا إعفاءَ بائتٌ ولا إعفاءَ بلا سببٍ منطوقٍ.
 *
 * **ما لا يفعلُه عن قصدٍ:** لا يُقرِّرُ أيَّ حاجزٍ يُضافُ ولا يكتبُ سيرَ عملٍ —
 * يقيسُ التكافؤَ فقط. ولا يقبلُ إعفاءً بلا سببٍ، فالإعفاءُ الصامتُ تعطيلٌ مُقنَّعٌ.
 */

/** إعفاءٌ مكتوبٌ: مسارُ الحاجزِ وسببُ استحالةِ تشغيلِه في الجانبِ الآخرِ. */
export type GuardExemption = {
  /** مسارٌ نسبيٌّ من جِذرِ المستودعِ، مثل `scripts/check-x.ts`. */
  readonly script: string;
  /** السببُ منطوقاً. الفراغُ مرفوضٌ — إعفاءٌ بلا سببٍ تعطيلٌ مُقنَّعٌ. */
  readonly reason: string;
};

export type GuardEnforcementInputs = {
  /** حواجزُ يُنادِيها مشغِّلُ `package.json → ci` بعدَ فكِّ الأسماءِ المتداخلةِ. */
  readonly localGuards: readonly string[];
  /** حواجزُ يُنادِيها أيُّ سيرِ عملٍ في `.github/workflows/`. */
  readonly workflowGuards: readonly string[];
  /** ملفّاتُ `scripts/check-*` الموجودةُ على القرصِ. */
  readonly guardsOnDisk: readonly string[];
  /** حواجزُ لا تُنفَّذُ بعيداً بعُذرٍ مكتوبٍ (ولا يُتوقَّعُ أن تُنفَّذَ). */
  readonly localOnlyExemptions: readonly GuardExemption[];
  /** حواجزُ لا تُنفَّذُ محلّيًّا بعُذرٍ مكتوبٍ (سرٌّ · أثرُ وظيفةٍ · سياقُ دفعٍ). */
  readonly remoteOnlyExemptions: readonly GuardExemption[];
  /** ملفّاتٌ على القرصِ لا تُنادى مباشرةً بعُذرٍ مكتوبٍ. */
  readonly uninvokedExemptions: readonly GuardExemption[];
};

export type GuardEnforcementProblem = {
  readonly rule: string;
  readonly detail: string;
};

const MISSING_REMOTELY = "حاجزٌ محلّيٌّ لا يُنفَّذُ في CI";
const MISSING_LOCALLY = "حاجزٌ في CI لا يُشغَّلُ محلّيًّا";
const NEVER_INVOKED = "ملفُّ حاجزٍ لا يُنادى في أيِّ مشغِّلٍ";
const STALE_EXEMPTION = "إعفاءٌ بائتٌ";
const MUTE_EXEMPTION = "إعفاءٌ بلا سببٍ منطوقٍ";
const EMPTY_DISCOVERY = "الكشفُ فارغٌ — لا يُقرأُ نجاحاً";

/** أقلُّ طولٍ يُقبَلُ سبباً: كلمةٌ واحدةٌ لا تُعلِّلُ إعفاءَ حاجزٍ. */
export const MIN_REASON_LENGTH = 40;

function exemptedScripts(exemptions: readonly GuardExemption[]): ReadonlySet<string> {
  return new Set(exemptions.map((exemption) => exemption.script));
}

function reasonProblems(
  exemptions: readonly GuardExemption[],
  origin: string,
): GuardEnforcementProblem[] {
  const problems: GuardEnforcementProblem[] = [];
  for (const exemption of exemptions) {
    if (exemption.reason.trim().length < MIN_REASON_LENGTH) {
      problems.push({
        rule: MUTE_EXEMPTION,
        detail:
          `${origin}: \`${exemption.script}\` — السببُ أقصرُ من ${MIN_REASON_LENGTH} حرفاً. ` +
          "الإعفاءُ الصامتُ تعطيلٌ مُقنَّعٌ، فاكتُبْ لِمَ يستحيلُ تشغيلُه في الجانبِ الآخرِ.",
      });
    }
  }
  return problems;
}

/**
 * كلُّ مخالفةٍ في تكافؤِ الإنفاذِ. دالّةٌ خالصةٌ: لا قرصَ ولا شبكةَ — فالقياسُ
 * يُختبَرُ بمُدخَلاتٍ مزروعةٍ (`ح-7`) لا بالمستودعِ كما هوَ وحدَه.
 */
export function guardEnforcementProblems(
  inputs: GuardEnforcementInputs,
): readonly GuardEnforcementProblem[] {
  const problems: GuardEnforcementProblem[] = [];

  if (inputs.localGuards.length === 0 || inputs.workflowGuards.length === 0) {
    problems.push({
      rule: EMPTY_DISCOVERY,
      detail:
        `حواجزُ محلّيّةٌ ${inputs.localGuards.length} · حواجزُ سيرٍ ${inputs.workflowGuards.length}. ` +
        "كشفٌ فارغٌ يعني أنَّ المُحلِّلَ معطوبٌ لا أنَّ التكافؤَ مستقيمٌ.",
    });
    return problems;
  }

  const local = new Set(inputs.localGuards);
  const remote = new Set(inputs.workflowGuards);
  const localOnlyExempt = exemptedScripts(inputs.localOnlyExemptions);
  const remoteOnlyExempt = exemptedScripts(inputs.remoteOnlyExemptions);
  const uninvokedExempt = exemptedScripts(inputs.uninvokedExemptions);

  for (const script of [...local].sort()) {
    if (remote.has(script) || localOnlyExempt.has(script)) continue;
    problems.push({
      rule: MISSING_REMOTELY,
      detail:
        `\`${script}\` يُنادى في \`package.json → ci\` ولا يُنادى في أيِّ سيرِ عملٍ — ` +
        "فلا يُسقِطُ بناءً بعيداً، وحُكْمُ CI لا يراه. أضِفْه خطوةً في سيرٍ أو اكتُبْ إعفاءَه.",
    });
  }

  for (const script of [...remote].sort()) {
    if (local.has(script) || remoteOnlyExempt.has(script)) continue;
    problems.push({
      rule: MISSING_LOCALLY,
      detail:
        `\`${script}\` يُنادى في سيرِ عملٍ ولا يُنادى في \`package.json → ci\` — ` +
        "فالأخضرُ المحلّيُّ يَعِدُ بما لا يفحصُه. أضِفْه إلى المشغِّلِ أو اكتُبْ إعفاءَه.",
    });
  }

  for (const script of [...inputs.guardsOnDisk].sort()) {
    if (local.has(script) || remote.has(script) || uninvokedExempt.has(script)) continue;
    problems.push({
      rule: NEVER_INVOKED,
      detail:
        `\`${script}\` موجودٌ على القرصِ ولا يُنادى في مشغِّلٍ ولا في سيرِ عملٍ — ` +
        "وجودُ الملفِّ ليسَ إنفاذاً.",
    });
  }

  const stale: readonly [readonly GuardExemption[], (script: string) => boolean, string][] = [
    [
      inputs.localOnlyExemptions,
      (script) => !local.has(script) || remote.has(script),
      "إعفاءُ «محلّيٌّ فقط»",
    ],
    [
      inputs.remoteOnlyExemptions,
      (script) => !remote.has(script) || local.has(script),
      "إعفاءُ «بعيدٌ فقط»",
    ],
    [
      inputs.uninvokedExemptions,
      (script) => local.has(script) || remote.has(script),
      "إعفاءُ «لا يُنادى»",
    ],
  ];

  for (const [exemptions, isStale, origin] of stale) {
    for (const exemption of exemptions) {
      if (!isStale(exemption.script)) continue;
      problems.push({
        rule: STALE_EXEMPTION,
        detail:
          `${origin}: \`${exemption.script}\` لم يبقَ له موجِبٌ — الحالةُ تبدَّلَت. ` +
          "الإعفاءُ البائتُ يُخفي انحداراً قادماً، فاحذِفْه من السجلِّ.",
      });
    }
    problems.push(...reasonProblems(exemptions, origin));
  }

  return problems;
}
