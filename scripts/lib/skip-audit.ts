/**
 * # تدقيقُ التجاوزِ في الاختبارات — وحدةٌ نقيّةٌ
 *
 * **الغرض:** أن يُقرَأ **من الشيفرةِ نفسِها ومن مخرجاتِ المُشغِّلِ نفسِه** أينَ
 * يُتجاوَز اختبارٌ ولماذا، بدلاً من الثقةِ بجملةٍ يكتبها المطوّرُ بيدِه. والوحدةُ
 * نقيّةٌ: لا قرصَ ولا شبكةَ ولا `process.env` — تأخذ نصوصاً وتُعيد أحكاماً، كي
 * تُختبَر بلا بيئةٍ وكي يقرأها الحاجزانِ كلاهما من موضعٍ واحد.
 *
 * **الحالة:** `OPS-009` — مُنفَّذ · مُختبَر.
 *
 * **ينتمي إلى:** البند `OPS-009` «514 اختباراً متجاوَزاً (skip) بلا تصنيف» ·
 * القسم 11-د · وسجلُّ التصنيف `scripts/lib/skip-registry.ts`.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** الحاجزُ `scripts/check-skip-classification.ts`
 * (يطابق الشيفرةَ بالسجلِّ) · والحاجزُ `scripts/check-no-skipped-tests.ts`
 * (يطابق مخرجاتَ التشغيلِ الحقيقيِّ بالسجلِّ) · واختباراتُ الوحدة.
 *
 * **ملاحظات مستقبلية:** لو تعدّدت صيغُ التجاوزِ في bun أو تغيّر سطرُ الملخَّصِ
 * فالتغييرُ ههنا وحدَه. ولو احتيج تحليلٌ نحويٌّ حقيقيٌّ فذلك تبعيّةٌ جديدةٌ في
 * مسارِ CI تُقرَّر بـADR لا تُدَسُّ.
 *
 * **ما لا تفعله هذه الوحدةُ عن قصدٍ — وحدودُها مُعلَنةٌ لا مضمرةٌ:**
 * - **ليست مُحلِّلاً نحوياً.** تُطابِق أنماطاً نصّيّةً على أسطرٍ فُرِّغت تعليقاتُها
 *   بـ`blankComments`. فتجاوزٌ يُبنى بحسابٍ (`describe["sk"+"ip"]`) **يُفلِت** —
 *   وهذا سلبيٌّ كاذبٌ مُعلَنٌ، ومُثبَّتٌ في اختبارٍ كي لا يُنسى.
 * - **لا تقرأ ملفاً ولا YAML بمُحلِّلٍ حقيقيّ.** قراءةُ خطواتِ CI ههنا نصّيّةٌ
 *   مُبَسَّطةٌ تكفي لملفِّ سيرِ عملٍ نكتبه نحن، ولا تصلح YAML عامّاً.
 * - **لا تُقرِّر سياسةً.** القوائمُ المغلقةُ والمدخلاتُ في `skip-registry.ts`،
 *   والفرضُ في الحاجزَين، وههنا الحكمُ فقط.
 * - **لا تعرف عددَ الحالاتِ الحقيقيَّ من الشيفرة.** العددُ في السجلِّ **مقيسٌ يومَ
 *   التصنيف** ولا يُفرَض، لأنّ فرضَه يجعل كلَّ حالةٍ جديدةٍ تُسقِط البناءَ فيُضغَط
 *   على تخفيفِ الحاجزِ — وذلك أسوأُ من رقمٍ قديم.
 */

import { blankComments } from "./blank-comments.ts";
import {
  CRITICAL_PATHS,
  type CriticalPath,
  SKIP_OWNERS,
  type SkipEntry,
  type SkipOwner,
} from "./skip-registry.ts";

/** موضعُ تجاوزٍ مكتشَفٌ في مِلفِّ اختبار. */
export interface SkipSite {
  readonly line: number;
  readonly form: string;
  /** `true` إن كان تجاوزاً لا يعلّقه شرطٌ — وهو ممنوعٌ بلا استثناءٍ في السجلّ. */
  readonly unconditional: boolean;
}

/**
 * الصيغُ الممنوعةُ منعاً مطلقاً: لا يُفتَح لها بابُ تسجيلٍ.
 *
 * `only` تُسقِط بقيّةَ الملفِّ صامتةً فتُنتِج تقريراً أخضرَ عن حزمةٍ لم تعمل.
 * و`todo` و`failing` تُسجِّلان نيّةً لا اختباراً، ومكانُ النيّةِ خارطةُ الطريقِ لا
 * حزمةُ الاختبار.
 */
const ABSOLUTELY_FORBIDDEN = ["only", "todo", "failing", "todoIf"] as const;

/** صيغُ التعليقِ بشرطٍ: مقبولةٌ **إن سُجِّلت**. */
const CONDITIONAL_FORMS = ["if", "skipIf"] as const;

const SITE_PATTERN = /\b(describe|it|test)\s*\.\s*(skip|only|todo|failing|skipIf|todoIf|if)\b/g;

/**
 * يقرأ مواضعَ التجاوزِ في نصِّ ملفٍّ واحد.
 *
 * والقاعدةُ في `.skip`: مقبولةٌ إن كانت **اختياراً** (`cond ? describe.skip :
 * describe`)، مرفوضةٌ إن كانت **نداءً** (`describe.skip("...")`) — لأنّ النداءَ
 * تجاوزٌ دائمٌ لا يُفعِّله شرطٌ، فلا يصحّ أن يُغطّيه سجلُّ تصنيفٍ يزعم شرطَ تفعيل.
 */
export function findSkipSites(source: string): readonly SkipSite[] {
  const blanked = blankComments(source);
  const sites: SkipSite[] = [];
  const lines = blanked.split("\n");
  for (const [index, rawLine] of lines.entries()) {
    SITE_PATTERN.lastIndex = 0;
    let match = SITE_PATTERN.exec(rawLine);
    while (match !== null) {
      const kind = match[2] as string;
      const after = rawLine.slice(match.index + match[0].length).trimStart();
      const isCall = after.startsWith("(");
      const forbidden = (ABSOLUTELY_FORBIDDEN as readonly string[]).includes(kind);
      const conditional =
        (CONDITIONAL_FORMS as readonly string[]).includes(kind) || (kind === "skip" && !isCall);
      sites.push({
        line: index + 1,
        form: `${match[1]}.${kind}`,
        unconditional: forbidden || !conditional,
      });
      match = SITE_PATTERN.exec(rawLine);
    }
  }
  return sites;
}

/** خطوةُ CI كما تُقرَأ نصّيّاً من ملفِّ سيرِ العمل. */
export interface CiStep {
  readonly name: string;
  readonly env: readonly string[];
  readonly run: string;
}

const STEP_NAME_PATTERN = /^(\s*)-\s+name:\s*(.+?)\s*$/;
const ENV_KEY_PATTERN = /^\s*([A-Z][A-Z0-9_]*):/;
const RUN_PATTERN = /^\s*run:\s*(.*)$/;

/**
 * يقرأ خطواتِ ملفِّ سيرِ العملِ قراءةً نصّيّةً مُبَسَّطةً: الاسمُ، ومفاتيحُ `env`،
 * ونصُّ `run`. والحدُّ مُعلَنٌ في رأسِ الملفّ: هذه ليست قراءةَ YAML.
 */
export function parseCiSteps(workflow: string): readonly CiStep[] {
  const steps: CiStep[] = [];
  let name: string | null = null;
  let env: string[] = [];
  let run: string[] = [];
  let mode: "none" | "env" | "run" = "none";

  const flush = (): void => {
    if (name !== null) {
      steps.push({ name, env: [...env], run: run.join("\n") });
    }
  };

  for (const rawLine of workflow.split("\n")) {
    if (/^\s*#/.test(rawLine)) {
      continue;
    }
    const stepMatch = STEP_NAME_PATTERN.exec(rawLine);
    if (stepMatch !== null) {
      flush();
      name = stepMatch[2] as string;
      env = [];
      run = [];
      mode = "none";
      continue;
    }
    if (name === null) {
      continue;
    }
    if (/^\s*env:\s*$/.test(rawLine)) {
      mode = "env";
      continue;
    }
    const runMatch = RUN_PATTERN.exec(rawLine);
    if (runMatch !== null) {
      mode = "run";
      const inline = runMatch[1] as string;
      if (inline !== "" && inline !== "|" && inline !== ">" && inline !== "|-") {
        run.push(inline);
      }
      continue;
    }
    if (mode === "env") {
      const envMatch = ENV_KEY_PATTERN.exec(rawLine);
      if (envMatch !== null) {
        env.push(envMatch[1] as string);
        continue;
      }
      if (rawLine.trim() !== "") {
        mode = "none";
      }
      continue;
    }
    if (mode === "run" && rawLine.trim() !== "") {
      run.push(rawLine.trim());
    }
  }
  flush();
  return steps;
}

/** ملخَّصُ تشغيلٍ حقيقيٍّ كما يطبعه المُشغِّل. */
export interface TestLogReading {
  readonly pass: number | null;
  readonly skip: number | null;
  readonly fail: number | null;
  /** أسماءُ الحالاتِ المتجاوَزةِ مُسنَدةً إلى ملفّها كما طبعه المُشغِّل. */
  readonly skippedByFile: ReadonlyMap<string, readonly string[]>;
  /** حالاتٌ متجاوَزةٌ طُبِعت قبلَ أيِّ عنوانِ ملفٍّ — لا تُسنَد، فلا تُغتفَر. */
  readonly unattributed: readonly string[];
}

const FILE_HEADER_PATTERN = /^(\S+\.test\.tsx?):$/;
const SKIP_LINE_PATTERN = /^\(skip\)\s+(.*)$/;
const SUMMARY_PATTERN = /^\s*(\d+)\s+(pass|skip|fail)\s*$/;
/**
 * سطرُ الكتلةِ المجمَّعةِ التي يطبعها المُشغِّلُ **في آخرِ التشغيلِ كلِّه**، لا تحتَ ملفٍّ.
 * وما بعدَه لا يُسنَد إلى عنوانِ الملفِّ الأخيرِ، لأنّه ليس تحتَه.
 */
const SKIP_BLOCK_PATTERN = /^\s*\d+\s+tests?\s+skipped:\s*$/;
/** بادئاتُ تجميعِ سجلّاتِ GitHub Actions: يطبعها المُشغِّلُ عندَ اكتشافِ البيئةِ. */
const GROUP_PREFIX_PATTERN = /^::(?:group|endgroup)::/;
/** رموزُ ANSI للتلوينِ — تُزال قبلَ أيِّ مطابقةٍ، فالحكمُ على النصِّ لا على اللونِ. */
/**
 * ويُبنى نمطُ ANSI من رمزِ الحرفِ لا من حرفِ التحكُّمِ حرفيّاً في النصِّ المصدريِّ:
 * حرفُ تحكُّمٍ مكتوبٌ في نمطٍ يُخفي نفسَه على القارئِ ويُنبِّه الفاحصَ بحقٍّ.
 */
const ESCAPE_CHARACTER = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-9;]*m`, "g");

/** يُجرِّد السطرَ من اللونِ ومن بادئةِ التجميعِ، فيُقرأ نصّاً واحداً في البيئتَين. */
function normalizeLogLine(rawLine: string): string {
  return rawLine.replace(/\r$/, "").replace(ANSI_PATTERN, "").replace(GROUP_PREFIX_PATTERN, "");
}

/**
 * يقرأ مخرجاتِ `bun test` قراءةً واحدةً: الملخَّصَ وإسنادَ كلِّ حالةٍ متجاوَزةٍ
 * إلى ملفِّها. والمُشغِّل قد يُكرِّر السطرَ نفسَه، فالإسنادُ **مجموعةٌ** لا عدّاد.
 *
 * والإسنادُ **بعنوانِ الحزمةِ أوّلاً** لا بعنوانِ الملفِّ الذي سبقَ السطرَ. والسببُ
 * عيبٌ حقيقيٌّ سقط فيه هذا القارئُ في أوّلِ تشغيلٍ مُدارٍ: المُشغِّلُ في بيئةِ
 * GitHub Actions يطبع `::group::<ملف>` بادئةً، **ويجمع كلَّ الحالاتِ المتجاوَزةِ
 * في كتلةٍ واحدةٍ في آخرِ التشغيلِ** بعدَ آخرِ ملفٍّ — فالإسنادُ بالعنوانِ السابقِ
 * ينسب تجاوزَ ملفٍّ إلى ملفٍّ آخرَ **ويُسقِط البناءَ بمخالفةٍ مُختلَقةٍ**. وعنوانُ
 * الحزمةِ مطبوعٌ في السطرِ نفسِه في الصيغتَين، فهو الإسنادُ الذي لا يتعلَّق بالترتيب.
 *
 * @param suiteToFile خريطةُ عنوانِ حزمةٍ إلى ملفِّها، مبنيّةٌ من السجلِّ المغلقِ.
 *   وغيابُها يُعيد القارئَ إلى الإسنادِ بالعنوانِ السابقِ وحدَه.
 */
export function parseTestLog(
  log: string,
  suiteToFile?: ReadonlyMap<string, string>,
): TestLogReading {
  const byFile = new Map<string, Set<string>>();
  const unattributed: string[] = [];
  let current: string | null = null;
  let inSkipBlock = false;
  const totals = new Map<string, number>();

  for (const rawLine of log.split("\n")) {
    const line = normalizeLogLine(rawLine);
    if (SKIP_BLOCK_PATTERN.test(line)) {
      inSkipBlock = true;
      current = null;
      continue;
    }
    const header = FILE_HEADER_PATTERN.exec(line.trim());
    if (header !== null) {
      current = header[1] as string;
      inSkipBlock = false;
      continue;
    }
    const skipMatch = SKIP_LINE_PATTERN.exec(line);
    if (skipMatch !== null) {
      const testName = (skipMatch[1] as string).trim();
      const suite = (testName.split(" > ")[0] as string).trim();
      const bySuite = suiteToFile?.get(suite);
      const file = bySuite ?? (inSkipBlock ? null : current);
      if (file === null || file === undefined) {
        unattributed.push(testName);
      } else {
        const set = byFile.get(file) ?? new Set<string>();
        set.add(testName);
        byFile.set(file, set);
      }
      continue;
    }
    const summary = SUMMARY_PATTERN.exec(line);
    if (summary !== null) {
      const value = Number.parseInt(summary[1] as string, 10);
      const key = summary[2] as string;
      totals.set(key, (totals.get(key) ?? 0) + value);
    }
  }

  const skippedByFile = new Map<string, readonly string[]>();
  for (const [file, names] of byFile) {
    skippedByFile.set(file, [...names].sort());
  }
  return {
    pass: totals.has("pass") ? (totals.get("pass") as number) : null,
    skip: totals.has("skip") ? (totals.get("skip") as number) : null,
    fail: totals.has("fail") ? (totals.get("fail") as number) : null,
    skippedByFile,
    unattributed,
  };
}

/**
 * يبني خريطةَ «عنوانُ حزمةٍ ← ملفُّها» من السجلِّ المغلقِ، وهي أساسُ إسنادِ كلِّ
 * حالةٍ متجاوَزةٍ إلى ملفِّها في {@link parseTestLog}. وعنوانٌ مكرَّرٌ في ملفَّين
 * يُعيد الخريطةَ **ناقصةً بلا إشعارٍ**، فيُعاد المكرَّرُ صريحاً ليصير مخالفةً في
 * {@link auditRegistry} لا سلوكاً صامتاً.
 */
export function buildSuiteIndex(registry: readonly SkipEntry[]): {
  readonly index: ReadonlyMap<string, string>;
  readonly duplicates: readonly string[];
} {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const entry of registry) {
    for (const suite of entry.suites) {
      const previous = seen.get(suite);
      if (previous !== undefined && previous !== entry.file) {
        duplicates.push(`${suite} (${previous} · ${entry.file})`);
        continue;
      }
      seen.set(suite, entry.file);
    }
  }
  return { index: seen, duplicates };
}

/** ما يحتاجه الحكمُ على السجلّ — كلُّه مُمرَّرٌ، فالوحدةُ لا تقرأ شيئاً بنفسِها. */
export interface RegistryAuditInput {
  readonly registry: readonly SkipEntry[];
  /** نصُّ كلِّ ملفِّ اختبارٍ في المستودع، مُسنَداً إلى مسارِه النسبيّ. */
  readonly sources: ReadonlyMap<string, string>;
  readonly ciSteps: readonly CiStep[];
  /** خرائطُ سكربتات `package.json` إلى مساراتِها: `test:integration` ← `tests/integration`. */
  readonly scriptPaths: ReadonlyMap<string, string>;
}

const MIN_PROSE = 40;

/** مسالكُ الاختبارِ التي تُشغِّلها خطوةٌ ما، مقروءةً من نصِّ `run`. */
function stepScopes(step: CiStep, scriptPaths: ReadonlyMap<string, string>): readonly string[] {
  const scopes: string[] = [];
  for (const [script, path] of scriptPaths) {
    if (step.run.includes(script)) {
      scopes.push(path);
    }
  }
  for (const match of step.run.matchAll(/bun\s+test\s+([^\s|;&]+)/g)) {
    const candidate = match[1] as string;
    if (!candidate.startsWith("-")) {
      scopes.push(candidate);
    }
  }
  return scopes;
}

/**
 * يحكم على السجلِّ في مقابلِ الشيفرةِ وملفِّ سيرِ العمل، ويُعيد قائمةَ المخالفات.
 * قائمةٌ فارغةٌ تعني الموافقةَ — ولا تعني «لا تجاوزَ»، بل «كلُّ تجاوزٍ مُصنَّفٌ».
 */
export function auditRegistry(input: RegistryAuditInput): readonly string[] {
  const violations: string[] = [];
  const { registry, sources, ciSteps, scriptPaths } = input;

  /**
   * تفرُّدُ عنوانِ الحزمةِ ليس ترتيباً: إسنادُ الحالاتِ المتجاوَزةِ في سجلِّ التشغيلِ
   * يقوم عليه (انظر {@link parseTestLog})، فعنوانانِ متطابقانِ في ملفَّين يجعلان
   * الإسنادَ خاطئاً بلا إشعارٍ.
   */
  for (const duplicate of buildSuiteIndex(registry).duplicates) {
    violations.push(`عنوانُ حزمةٍ مكرَّرٌ بين ملفَّين — الإسنادُ في سجلِّ التشغيلِ يقوم عليه: ${duplicate}`);
  }

  const discovered = new Map<string, readonly SkipSite[]>();
  for (const [file, source] of sources) {
    const sites = findSkipSites(source);
    if (sites.length > 0) {
      discovered.set(file, sites);
    }
    for (const site of sites) {
      if (site.unconditional) {
        violations.push(
          `تجاوزٌ غيرُ مشروطٍ ممنوعٌ بلا استثناءٍ: ${file}:${site.line} (${site.form}) — ` +
            `لا يُغطّيه سجلُّ تصنيفٍ لأنّ لا شرطَ تفعيلٍ له.`,
        );
      }
    }
  }

  if (registry.length === 0) {
    violations.push("سجلُّ التصنيفِ فارغٌ — حاجزٌ يمرّ على سجلٍّ فارغٍ لا يحرس شيئاً.");
  }
  if (discovered.size === 0) {
    violations.push(
      "لم يُكتشَف أيُّ موضعِ تجاوزٍ في المستودع — وذلك يعني أنّ الكشفَ نفسَه معطوبٌ " +
        "لا أنّ المستودعَ نظيفٌ، فالسجلُّ يُعلِن مواضعَ قائمةً.",
    );
  }

  const seen = new Set<string>();
  for (const entry of registry) {
    if (seen.has(entry.file)) {
      violations.push(`مدخلٌ مكرَّرٌ في السجلّ: ${entry.file}`);
    }
    seen.add(entry.file);

    const source = sources.get(entry.file);
    if (source === undefined) {
      violations.push(`مدخلٌ في السجلِّ لملفٍّ غيرِ موجودٍ: ${entry.file}`);
      continue;
    }
    if (!discovered.has(entry.file)) {
      violations.push(
        `مدخلٌ بائتٌ: ${entry.file} لم يبقَ فيه موضعُ تجاوزٍ — يُحذَف من السجلِّ ` +
          `كي لا يبقى السجلُّ يصف ماضياً.`,
      );
    }
    if (entry.suites.length === 0) {
      violations.push(`${entry.file}: لا حزمةَ مُعلَنةً (suites فارغة).`);
    }
    if (entry.skipped < 1) {
      violations.push(`${entry.file}: عددُ الحالاتِ المتجاوَزةِ المقيسُ يجب أن يكون ١ أو أكثر.`);
    }
    if (!/^[A-Z][A-Z0-9_]*$/.test(entry.gate)) {
      violations.push(`${entry.file}: اسمُ متغيّرِ البيئةِ الحاكمِ غيرُ سليمٍ: ${entry.gate}`);
    } else if (!source.includes(`process.env.${entry.gate}`)) {
      violations.push(
        `${entry.file}: السجلُّ يزعم أنّ الشرطَ ${entry.gate} والملفُّ لا يقرؤها — ` +
          `تصنيفٌ يخالف الشيفرةَ أسوأُ من لا تصنيف.`,
      );
    }
    if (entry.reason.trim().length < MIN_PROSE) {
      violations.push(`${entry.file}: السببُ أقصرُ من أن يكون سبباً.`);
    }
    if (entry.activation.trim().length < MIN_PROSE) {
      violations.push(`${entry.file}: شرطُ التفعيلِ أقصرُ من أن يكون شرطاً قابلاً للتنفيذ.`);
    }
    if (!(SKIP_OWNERS as readonly string[]).includes(entry.owner as SkipOwner)) {
      violations.push(`${entry.file}: مالكٌ خارجَ القائمةِ المغلقة: ${entry.owner}`);
    }
    if (
      entry.criticalPath !== null &&
      !(CRITICAL_PATHS as readonly string[]).includes(entry.criticalPath as CriticalPath)
    ) {
      violations.push(`${entry.file}: مسارٌ حرجٌ خارجَ القائمةِ المغلقة: ${entry.criticalPath}`);
    }

    if (entry.runsIn === null) {
      if (entry.criticalPath !== null) {
        violations.push(
          `${entry.file}: تجاوزٌ على مسارٍ حرجٍ (${entry.criticalPath}) لا يعمل في أيِّ ` +
            `موضعٍ — وهذا بعينِه ما يمنعه البندُ OPS-009 قبلَ الإطلاق.`,
        );
      }
      if (entry.whyNotRun === null || entry.whyNotRun.trim().length < MIN_PROSE) {
        violations.push(
          `${entry.file}: لا مُشغِّلَ له ولا بيانَ مكتوبٌ لسببِ ذلك — التجاوزُ الدائمُ ` +
            `يُعلَن أو يُشغَّل، ولا يُترَك صامتاً.`,
        );
      }
      continue;
    }

    if (entry.whyNotRun !== null) {
      violations.push(`${entry.file}: له مُشغِّلٌ مُعلَنٌ ومعه بيانُ «لا يعمل» — تناقضٌ في السجلّ.`);
    }
    const step = ciSteps.find((candidate) => candidate.name === entry.runsIn);
    if (step === undefined) {
      violations.push(
        `${entry.file}: يزعم أنّه يعمل في خطوةٍ لا وجودَ لها في ملفِّ سيرِ العمل: ` + `«${entry.runsIn}»`,
      );
      continue;
    }
    if (!step.env.includes(entry.gate)) {
      violations.push(
        `${entry.file}: الخطوةُ «${step.name}» لا تضبط ${entry.gate}، فالاختبارُ ` +
          `يُتجاوَز فيها أيضاً وهي مُعلَنةٌ مُشغِّلاً له.`,
      );
    }
    const scopes = stepScopes(step, scriptPaths);
    if (!scopes.some((scope) => entry.file.startsWith(scope))) {
      violations.push(
        `${entry.file}: الخطوةُ «${step.name}» لا تُشغِّل هذا المسارَ ` +
          `(تُشغِّل: ${scopes.join(" · ") || "لا شيء"}).`,
      );
    }
  }

  for (const file of discovered.keys()) {
    if (!seen.has(file)) {
      violations.push(
        `تجاوزٌ غيرُ مُصنَّفٍ: ${file} — يُسجَّل في scripts/lib/skip-registry.ts بسببٍ ` +
          `وشرطِ تفعيلٍ ومالكٍ، أو يُحذَف التجاوز.`,
      );
    }
  }

  return violations;
}

/** حكمٌ على تشغيلٍ حقيقيٍّ: أيُّ تجاوزٍ فيه غيرُ مُعلَنٍ أنّه لا مُشغِّلَ له فهو إخفاق. */
export function auditRun(
  reading: TestLogReading,
  registry: readonly SkipEntry[],
): readonly string[] {
  const violations: string[] = [];
  /**
   * والمُشغِّلُ **لا يطبع سطرَ `skip` إن لم يتجاوَز شيئاً** — فغيابُه يعني صفراً لا
   * يعني غيابَ ملخَّصٍ. أمّا غيابُ سطرِ `pass` فغيابُ ملخَّصٍ حقيقيٌّ: لم يُقرأ تشغيلٌ.
   */
  if (reading.pass === null) {
    violations.push("مخرجاتُ التشغيلِ لا تحتوي ملخَّصاً (pass) — لا يُستنتَج من غيابِ الدليلِ نجاحٌ.");
    return violations;
  }
  const skipTotal = reading.skip ?? 0;
  if (reading.pass === 0) {
    violations.push("لم تنجح حالةٌ واحدةٌ في هذا التشغيل — حزمةٌ لم تعمل لا تُقرَأ خُضرةً.");
  }
  for (const name of reading.unattributed) {
    violations.push(`حالةٌ متجاوَزةٌ بلا ملفٍّ مُسنَدٍ إليها: ${name}`);
  }
  const allowed = new Map<string, SkipEntry>();
  for (const entry of registry) {
    if (entry.runsIn === null) {
      allowed.set(entry.file, entry);
    }
  }
  let budget = 0;
  for (const [file, names] of reading.skippedByFile) {
    const entry = allowed.get(file);
    if (entry === undefined) {
      violations.push(
        `تُجوِّزَ ${names.length} حالةً في ${file} داخلَ تشغيلٍ يُفترَض أن يُشغِّلها — ` +
          `شرطُ تفعيلِها غيرُ مضبوطٍ في هذه الوظيفة.`,
      );
      continue;
    }
    budget += entry.skipped;
  }
  /**
   * ولا يُقارَن الملخَّصُ بعددِ **الأسماءِ** المُسنَدةِ: أسماءُ الحالاتِ قد تتكرّر فتنطوي
   * في مجموعةٍ واحدةٍ، فتُقرَأ ناقصةً بلا مخالفةٍ حقيقيّةٍ. والمقارنةُ الصحيحةُ بسقفٍ
   * **مقيسٍ** في السجلِّ: تجاوزٌ يزيد على المقيسِ يعني أنّ في الملفِّ المُعلَنِ حالاتٍ
   * جديدةً لم تُصنَّف، فيُحدَّث السجلُّ لا يُخفَّف الحاجزُ.
   */
  if (skipTotal > budget && violations.length === 0) {
    violations.push(
      `الملخَّصُ يقول ${skipTotal} متجاوَزةً والسقفُ المقيسُ للملفّاتِ المُعلَنةِ ${budget} — ` +
        `فرقٌ لا يُفسَّر، ولا يُمرَّر ما لا يُفسَّر.`,
    );
  }
  return violations;
}
