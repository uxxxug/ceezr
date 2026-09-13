/**
 * الغرض: ميزانُ التوثيقِ **سقّاطةً** لا سقفاً يُرفَعُ: وثيقةٌ جديدةٌ لا تتجاوزُ
 *   سقفَ السطورِ، ووثيقةٌ مُستثناةٌ لا **تنمو**، ومُخرَجٌ خامٌّ جديدٌ لا يسكنُ إلّا
 *   `docs/evidence/archive/`، ومجموعُ التوثيقِ لا يتجاوزُ نسبةً من الكودِ.
 * الحالة: منفّذ فعلياً — `S-4` (ADR 0097)، ومُختبَر في
 *   `tests/unit/check-docs-budget.test.ts`.
 * ينتمي إلى: scripts/lib (منطقٌ نقيٌّ: مُدخلاتٌ تدخلُ ومخالفاتٌ تخرجُ).
 * يُتوقع أن يستخدمه لاحقاً: `scripts/check-docs-budget.ts` وسلسلةُ `ci`.
 *
 * **لماذا سقّاطةٌ لا سقفٌ؟** لأنَّ السقفَ الواحدَ على مستودَعٍ فيهِ وثائقُ سِجِلٍّ
 * ضخمةٌ (`ROADMAP-MASTER` · `SYSTEM_STATE`) لا يمرُّ إلّا بتخفيفِه، والتخفيفُ
 * يُبطِلُه. فالمقبولُ ههنا: ما كانَ كبيراً يُسجَّلُ بعددِه في خطِّ الأساسِ ويُمنَعُ
 * **نموُّه**؛ وما جاءَ جديداً يلتزمُ السقفَ. فالميزانُ يتحسَّنُ ولا يسوءُ، ولا
 * يُحذَفُ دليلٌ لأجلِه (`ح-2`).
 *
 * **ولماذا لا يُحسَبُ خطُّ الأساسِ آلياً عندَ كلِّ جريةٍ؟** لأنَّ ما يُحسَبُ من
 * الحاضرِ يُصدِّقُ الحاضرَ دائماً. خطُّ الأساسِ ملفٌّ مُلتزَمٌ، و`--write` لا
 * **يرفعُ** رقماً ولا يُضيفُ مفتاحاً لوثيقةٍ جديدةٍ متجاوزةٍ: يُنزِلُ ما نقصَ
 * ويُسقِطُ ما حُذِفَ وحسبُ.
 */

/** سقفُ سطورِ وثيقةٍ **جديدةٍ** — ما فوقَه يلزمُه قرارٌ لا سهوٌ. */
export const NEW_DOC_LINE_CAP = 400;

/** أقصى نسبةِ سطورِ التوثيقِ إلى سطورِ الكودِ. الحالُ ~0.55 فالفسحةُ مقصودةٌ. */
export const MAX_DOCS_TO_SOURCE_RATIO = 0.75;

/**
 * **سِجِلّانِ سياديّانِ يُوجِبُ الحُكمُ الزيادةَ فيهما**، فلا سقّاطةَ عليهما:
 * `docs/ROADMAP-MASTER.md` §25 يفرضُ صفَّ سجلٍّ لكلِّ بندٍ يُغلَقُ، و`ح-8` يفرضُ
 * أنَّ التصحيحَ **بالإضافةِ** لا بالمحوِ. فسقّاطةٌ عليهما تُخيِّرُ بينَ خرقِ
 * الحُكمِ وتخفيفِ الحاجزِ — وكلاهُما مرفوضٌ. وهما محكومانِ بقاعدةِ النسبةِ
 * كغيرِهما: سطورُهما تُحسَبُ في المجموعِ.
 */
export const LEDGER_PATHS: readonly string[] = ["docs/ROADMAP-MASTER.md", "docs/SYSTEM_STATE.md"];

/** الموضعُ الوحيدُ الذي يسكنُه المُخرَجُ الخامُّ. */
export const RAW_ARCHIVE_PREFIX = "docs/evidence/archive/";

/** امتداداتُ المُخرَجِ الخامِّ: ليست وثائقَ تُقرَأُ بل مخرجاتٌ تُحفَظُ. */
const RAW_EXTENSIONS = [".txt", ".log", ".out"] as const;

export interface DocFile {
  /** مسارٌ من جذرِ المستودعِ بفواصلَ أماميّةٍ. */
  readonly path: string;
  readonly lines: number;
}

export interface DocsBudgetInputs {
  readonly docs: readonly DocFile[];
  /** مجموعُ سطورِ الكودِ (`apps` · `packages` · `scripts` · `supabase`). */
  readonly sourceLines: number;
  /** خطُّ الأساسِ المُلتزَمُ: مسارٌ ⇒ أقصى عددٍ مسموحٍ به اليومَ. */
  readonly baseline: Readonly<Record<string, number>>;
}

export interface BudgetProblem {
  readonly rule: "new-doc-cap" | "ratchet" | "raw-outside-archive" | "ratio" | "stale-baseline";
  readonly detail: string;
}

export function isRawOutput(path: string): boolean {
  return RAW_EXTENSIONS.some((extension) => path.endsWith(extension));
}

/**
 * يُعيدُ المخالفاتِ — فارغةً حينَ يكونُ الميزانُ مُستقيماً. ولا يقرأُ قرصاً:
 * يُحقَنُ المُدخلُ فيُقاسُ سقوطُه بخرقٍ مزروعٍ.
 */
export function docsBudgetProblems(inputs: DocsBudgetInputs): readonly BudgetProblem[] {
  const problems: BudgetProblem[] = [];
  const seen = new Set<string>();

  for (const doc of inputs.docs) {
    seen.add(doc.path);
    if (LEDGER_PATHS.includes(doc.path)) continue;
    const allowance = inputs.baseline[doc.path];

    if (allowance === undefined) {
      // الأرشيفُ موضعُ حفظٍ لا موضعُ قراءةٍ: مُخرَجُه الخامُّ لا سقفَ سطورٍ له،
      // ولهذا وحدَه استُثني — والاستثناءُ مُعلَنٌ ومقيسٌ لا مضمرٌ.
      const inArchive = doc.path.startsWith(RAW_ARCHIVE_PREFIX);
      if (doc.lines > NEW_DOC_LINE_CAP && !inArchive) {
        problems.push({
          rule: "new-doc-cap",
          detail:
            `${doc.path}: ${doc.lines} سطراً وسقفُ الوثيقةِ الجديدةِ ${NEW_DOC_LINE_CAP} — ` +
            `والصوابُ اختصارُها أو تقسيمُها بمعنىً، لا إضافةُ مفتاحٍ في خطِّ الأساسِ: ` +
            `\`--write\` لا يرفعُ رقماً ولا يُضيفُ متجاوزاً.`,
        });
      }
      if (isRawOutput(doc.path) && !inArchive) {
        problems.push({
          rule: "raw-outside-archive",
          detail:
            `${doc.path}: مُخرَجٌ خامٌّ خارجَ \`${RAW_ARCHIVE_PREFIX}\` — ` +
            `المُخرَجُ يُحفَظُ ولا يُنشَرُ وسطَ ما يُقرَأُ (ADR 0094 §3).`,
        });
      }
      continue;
    }

    if (doc.lines > allowance) {
      problems.push({
        rule: "ratchet",
        detail:
          `${doc.path}: نمَت من ${allowance} إلى ${doc.lines} سطراً — ` +
          `وثيقةٌ مُستثناةٌ تنقصُ ولا تنمو (سقّاطةٌ لا سقفٌ).`,
      });
    }
  }

  for (const path of Object.keys(inputs.baseline)) {
    if (seen.has(path)) continue;
    problems.push({
      rule: "stale-baseline",
      detail:
        `${path}: في خطِّ الأساسِ ولا وجودَ له — والصوابُ \`--write\` ليُسقِطَ المفتاحَ، ` +
        `فخطُّ أساسٍ يذكرُ معدوماً يُخفي نموّاً في غيرِه.`,
    });
  }

  const docsLines = inputs.docs.reduce((sum, doc) => sum + doc.lines, 0);
  if (inputs.sourceLines > 0) {
    const ratio = docsLines / inputs.sourceLines;
    if (ratio > MAX_DOCS_TO_SOURCE_RATIO) {
      problems.push({
        rule: "ratio",
        detail:
          `التوثيقُ ${docsLines} سطراً والكودُ ${inputs.sourceLines} سطراً ` +
          `(نسبةٌ ${ratio.toFixed(3)}) والسقفُ ${MAX_DOCS_TO_SOURCE_RATIO} — ` +
          `والوثيقةُ وسيلةٌ لا تسليمٌ (ADR 0094 §3).`,
      });
    }
  }

  return problems;
}

/**
 * خطُّ أساسٍ مُحدَّثٌ **نزولاً وحسبُ**: يُنزِلُ ما نقصَ، ويُسقِطُ ما حُذِفَ، ولا
 * يرفعُ رقماً ولا يُضيفُ مفتاحاً. فلا يُستعمَلُ `--write` لتمريرِ نموٍّ.
 */
export function ratchetBaseline(inputs: DocsBudgetInputs): Record<string, number> {
  const next: Record<string, number> = {};
  const current = new Map(inputs.docs.map((doc) => [doc.path, doc.lines]));
  for (const [path, allowance] of Object.entries(inputs.baseline)) {
    const lines = current.get(path);
    if (lines === undefined) continue;
    next[path] = Math.min(allowance, lines);
  }
  return next;
}
