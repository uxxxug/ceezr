/**
 * # منطقٌ نقيٌّ: أمرٌ في المشغِّلِ لا يُنادى كما كُتِبَ ليسَ حاجزاً — `D-24`
 *
 * **الغرض:** أن يُقاسَ أنَّ كلَّ أمرٍ في سلسلةِ `package.json → ci` **قابلٌ
 * للنداءِ كما كُتِبَ**: ملفُّهُ موجودٌ، واسمُهُ معرَّفٌ، وإن كانَ يستهلكُ وسيطاً
 * فقد أُعطِيَ وسيطاً.
 *
 * **الحالة:** `D-24` — كُشِفَ بعطبٍ حقيقيٍّ: أُدرِجَ `check-no-skipped-tests.ts`
 * في السلسلةِ بلا وسيطِ سجلٍّ فكانَ يُخفِقُ في كلِّ نداءٍ محلّيٍّ، **ودُمِجَ
 * خضراءَ** لأنَّ CI لا تُشغِّلُ السلسلةَ، ولأنَّ حاجزَ `ADR 0143` يقيسُ
 * **العضويّةَ** (أهوَ مذكورٌ في الجانبَينِ؟) لا **الصلاحيّةَ**.
 *
 * **ما لا يفعلُه هذا المنطقُ عن قصدٍ:**
 * - **لا يُشغِّلُ أمراً.** لا يُدَّعى أنَّ الأمرَ يَنجَحُ؛ يُدَّعى أنَّه **يُنادى
 *   كما كُتِبَ**. والصلاحيّةُ الدلاليّةُ تبقى دَيناً مُعلَناً.
 * - **لا يخترعُ استهلاكاً للوسائطِ.** يُقاسُ الاستهلاكُ من عُرفِ المستودعِ
 *   نفسِه: سطرُ استعمالٍ مطبوعٌ ثمَّ خروجٌ بغيرِ صفرٍ.
 * - **لا يُقرأُ كشفٌ فارغٌ نجاحاً.** سلسلةٌ بلا أوامرَ إخفاقٌ لا خُضرةٌ.
 */

export const MIN_REASON_LENGTH = 40;

/** أمرٌ واحدٌ في السلسلةِ بعدَ التحليلِ. */
export interface RunnerCommand {
  /** الأمرُ كما كُتِبَ في `package.json`. */
  readonly raw: string;
  /** مسارُ ملفِّ السكربتِ إن نادى الأمرُ ملفّاً. */
  readonly scriptPath?: string;
  /** اسمُ سكربتٍ مُسمّىً إن نادى الأمرُ اسماً (`bun run <name>`). */
  readonly namedScript?: string;
  /** عددُ الوسائطِ الممرَّرةِ بعدَ المسارِ. */
  readonly argCount: number;
}

/** إعفاءُ أمرٍ من قاعدةِ الوسائطِ — بسببٍ منطوقٍ لا بصمتٍ. */
export interface ArgumentExemption {
  readonly script: string;
  readonly reason: string;
}

export interface RunnerValidityInputs {
  /** أوامرُ السلسلةِ بعدَ حلِّ الأسماءِ. */
  readonly commands: readonly RunnerCommand[];
  /** ملفّاتُ السكربتاتِ الموجودةُ على القرصِ. */
  readonly existingScriptFiles: readonly string[];
  /** أسماءُ السكربتاتِ المعرَّفةُ في `package.json`. */
  readonly definedNamedScripts: readonly string[];
  /** مساراتُ السكربتاتِ التي تستهلكُ وسيطاً (تُطبِعُ استعمالاً ثمَّ تخرجُ). */
  readonly argumentConsumers: readonly string[];
  /** إعفاءاتٌ منطوقةُ السببِ من قاعدةِ الوسائطِ. */
  readonly argumentExemptions: readonly ArgumentExemption[];
}

export interface RunnerValidityProblem {
  readonly rule: string;
  readonly detail: string;
}

const RULE_MISSING_FILE = "أمرٌ في المشغِّلِ يشيرُ إلى ملفٍّ لا وجودَ لهُ";
const RULE_UNDEFINED_NAME = "أمرٌ في المشغِّلِ يُنادي اسماً غيرَ معرَّفٍ";
const RULE_MISSING_ARGUMENT = "أمرٌ يستهلكُ وسيطاً ولا يُمرَّرُ لهُ وسيطٌ";
const RULE_STALE_EXEMPTION = "إعفاءٌ بائتٌ";
const RULE_MUTE_EXEMPTION = "إعفاءٌ بلا سببٍ منطوقٍ";
const RULE_EMPTY = "الكشفُ فارغٌ — لا يُقرأُ نجاحاً";

/**
 * يُعيدُ كلَّ خللٍ في صلاحيّةِ نداءِ أوامرِ المشغِّلِ. القائمةُ الفارغةُ تعني
 * سلامةً **بشرطِ أن يكونَ الكشفُ غيرَ فارغٍ** — وذلكَ مفحوصٌ هنا لا مفترَضٌ.
 */
export function runnerValidityProblems(inputs: RunnerValidityInputs): RunnerValidityProblem[] {
  const problems: RunnerValidityProblem[] = [];

  if (inputs.commands.length === 0) {
    problems.push({
      rule: RULE_EMPTY,
      detail:
        "لم يُقرأْ أمرٌ واحدٌ من سلسلةِ `package.json → ci`: محلِّلٌ مكسورٌ أو سلسلةٌ مفقودةٌ، لا مشغِّلٌ سليمٌ.",
    });
    return problems;
  }
  if (inputs.existingScriptFiles.length === 0) {
    problems.push({
      rule: RULE_EMPTY,
      detail: "لم يُقرأْ ملفُّ سكربتٍ واحدٌ من القرصِ: كشفٌ فارغٌ لا يُقرأُ نجاحاً.",
    });
    return problems;
  }

  const onDisk = new Set(inputs.existingScriptFiles);
  const named = new Set(inputs.definedNamedScripts);
  const consumers = new Set(inputs.argumentConsumers);
  const exempted = new Map(inputs.argumentExemptions.map((e) => [e.script, e.reason]));

  for (const exemption of inputs.argumentExemptions) {
    if (exemption.reason.trim().length < MIN_REASON_LENGTH) {
      problems.push({
        rule: RULE_MUTE_EXEMPTION,
        detail: `الإعفاءُ «${exemption.script}» سببُهُ أقصرُ من ${MIN_REASON_LENGTH} حرفاً: إعفاءٌ بلا سببٍ منطوقٍ إسكاتٌ.`,
      });
    }
  }

  const invoked = new Set<string>();
  for (const command of inputs.commands) {
    if (command.namedScript !== undefined && !named.has(command.namedScript)) {
      problems.push({
        rule: RULE_UNDEFINED_NAME,
        detail: `الأمرُ «${command.raw}» يُنادي «${command.namedScript}» ولا تعريفَ لهُ في \`package.json\`.`,
      });
      continue;
    }
    const path = command.scriptPath;
    if (path === undefined) continue;
    invoked.add(path);

    if (!onDisk.has(path)) {
      problems.push({
        rule: RULE_MISSING_FILE,
        detail: `الأمرُ «${command.raw}» يشيرُ إلى «${path}» ولا وجودَ لهُ على القرصِ.`,
      });
      continue;
    }
    if (consumers.has(path) && command.argCount === 0 && !exempted.has(path)) {
      problems.push({
        rule: RULE_MISSING_ARGUMENT,
        detail: `«${path}» يُطبِعُ سطرَ استعمالٍ ثمَّ يخرجُ بغيرِ صفرٍ حينَ لا وسيطَ، والأمرُ «${command.raw}» لا يُمرِّرُ وسيطاً: نداءٌ يُخفِقُ دائماً.`,
      });
    }
  }

  for (const exemption of inputs.argumentExemptions) {
    if (!invoked.has(exemption.script)) {
      problems.push({
        rule: RULE_STALE_EXEMPTION,
        detail: `الإعفاءُ «${exemption.script}» لا يُقابِلُه أمرٌ في السلسلةِ: إعفاءٌ بائتٌ يُخفي تغييراً لاحقاً.`,
      });
    }
  }

  return problems;
}

/** وصفٌ سطريٌّ للطباعةِ. */
export function describeRunnerValidityProblem(problem: RunnerValidityProblem): string {
  return `✗ ${problem.rule}: ${problem.detail}`;
}
