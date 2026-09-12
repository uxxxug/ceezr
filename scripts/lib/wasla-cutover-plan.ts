/**
 * # سجلُّ خطواتِ التحوُّلِ والاسترجاعِ — **مُشتَقٌّ** لا مكتوبٌ
 *
 * **الغرضُ:** أن يكونَ لكلِّ خطوةِ تحوُّلٍ في وَصلةِ MOVE↔CORE ثلاثةُ أشياءَ
 * **مقروءةٌ آليّاً**: رتبتُها في الترتيبِ، و**خطوةُ الاسترجاعِ العكسيّةُ** التي
 * تُردُّ بها، و**مِسبارُ تحقُّقٍ للقراءةِ وحدَها** يُقرأُ به «تمَّت». وأن يكونَ
 * تمرينُ التحوُّلِ **مرفوضاً بالإنشاءِ** ما دامَ حاجزٌ من حواجزِ التمرينِ مفتوحاً،
 * لا مرفوضاً بجملةٍ في وثيقةٍ.
 *
 * **الحالةُ:** `W-9` — زيادةٌ أولى **داخلَ حدودِ `B-5`**. ولا تمرينَ يُجرى ههنا،
 * ولا موجةَ تُنفَّذُ، ولا صفَّ يُكتَبُ. `ADR 0088`.
 *
 * **ينتمي إلى:** البندُ `W-9` · ويقرأُ `wasla-migration-matrix.ts` (مصدرُ الحقيقةِ
 * الوحيدُ للموجاتِ والآليّاتِ ومساراتِ العودةِ) و`wasla-blockers.ts` (`W-8`،
 * مصدرُ حالةِ الحواجزِ الوحيدُ).
 *
 * **يُتوقع أن يستخدمه لاحقاً:** `scripts/check-cutover-plan.ts` (الحاجزُ الساكنُ) ·
 * `scripts/rehearse-cutover.ts` (المُنفِّذُ للقراءةِ وحدَها) · اختباراتُ الوحدةِ.
 *
 * **ما لا يفعلُه هذا الملفُّ عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ:**
 * - **لا يُنشئُ مصدرَ حقيقةٍ ثانياً.** كلُّ خطوةٍ مُشتَقّةٌ من مُدخلِ المصفوفةِ:
 *   الجدولُ والآليّةُ والموجةُ والمُتطلَّباتُ ومسارُ العودةِ والقياسُ. فإن تغيَّرَت
 *   المصفوفةُ تغيَّرَ السجلُّ من نفسِه، ولا موضعَ يُهجَرُ صامتاً (القاعدةُ 0.6).
 * - **لا يُنفِّذُ ولا يكتبُ.** لا SQL كتابةٍ ههنا ألبتّةَ، والمِسبارُ نصٌّ يُتحقَّقُ
 *   من كونِه للقراءةِ وحدَها قبلَ أن يُسلَّمَ.
 * - **لا يقيسُ الإنتاجَ.** `B-1` مفتوحٌ فلا أحجامَ ولا أعدادَ صفوفٍ معروفةٌ، فلا
 *   يُقدَّرُ زمنٌ ولا تُدَّعى نافذةُ توقُّفٍ.
 * - **لا يزعمُ أنَّ العودةَ مُجرَّبةٌ.** إعلانُ العكسِ ليسَ برهانَ العكسِ؛ التمرينُ
 *   الحقيقيُّ يقتضي `B-3` و`DEP-CORE-007`.
 */

import {
  type Blocker,
  isBlockerOpen,
  mentionedBlockerIds,
  UnknownBlockerError,
} from "./wasla-blockers.ts";
import {
  type MatrixEntry,
  MECHANISMS,
  type Mechanism,
  WASLA_MIGRATION_MATRIX,
  WAVES,
} from "./wasla-migration-matrix.ts";

/**
 * حواجزُ **التمرينِ** — القائمةُ المغلقةُ التي يرفضُ التمرينُ ما دامَ واحدٌ منها
 * مفتوحاً. ولكلِّ واحدٍ سببٌ يخصُّ التمرينَ بعينِه لا سبباً عامّاً:
 * - `B-5`: لا إقرارَ إطلاقٍ إنتاجيٍّ، فالتحوُّلُ نفسُه غيرُ مأذونٍ.
 * - `B-3`: لا بيئةَ CORE ولا قاعدةَ، فلا وجهةَ يُحوَّلُ إليها.
 * - `DEP-CORE-007`: لا بيئةَ مشتركةً، فكلُّ تسويةٍ `UNVERIFIABLE` (`W-8`).
 * - `B-1`: جردُ الإنتاجِ مجهولٌ، فالتمرينُ على أحجامٍ مجهولةٍ يقيسُ غيرَ ما سيقعُ.
 */
export const REHEARSAL_GATE_BLOCKERS = ["B-5", "B-3", "DEP-CORE-007", "B-1"] as const;
export type RehearsalGateBlocker = (typeof REHEARSAL_GATE_BLOCKERS)[number];

/**
 * الطورُ: قائمةٌ **مغلقةٌ**. والترتيبُ ههنا هوَ ترتيبُ التنفيذِ داخلَ الموجةِ،
 * والاسترجاعُ يقرأُهُ **معكوساً**.
 */
export const CUTOVER_PHASES = ["expand", "dual-read", "cutover", "contract"] as const;
export type CutoverPhase = (typeof CUTOVER_PHASES)[number];

/** خطوةُ استرجاعٍ واحدةٌ — عكسُ خطوةِ تحوُّلٍ واحدةٍ بعينِها. */
export interface RollbackStep {
  /** معرّفُ الخطوةِ التي تُردُّ. */
  readonly inverseOf: string;
  /** الإجراءُ، مقروءاً من `rollback` في المصفوفةِ — لا مُختلَقاً ههنا. */
  readonly action: string;
  /** شكلُ الآليّةِ العامُّ، مقروءاً من `MECHANISMS`. */
  readonly shape: string;
  /**
   * هل الاسترجاعُ يقتضي استعادةَ بياناتٍ من نسخةٍ (لا مجرَّدَ إرجاعِ قارئٍ)؟
   * مُشتَقٌّ من الطورِ: التقليصُ وحدَه ينزعُ شيئاً قائماً.
   */
  readonly requiresDataRestore: boolean;
}

/** مِسبارُ تحقُّقٍ — **للقراءةِ وحدَها**، ونصُّه يُتحقَّقُ منه قبلَ أن يُسلَّمَ. */
export interface VerificationProbe {
  readonly statement: string;
  /** ما يُقرأُ به «تمَّت»، مقروءاً من `verification` في المصفوفةِ. */
  readonly readsAs: string;
}

/** خطوةُ تحوُّلٍ واحدةٌ. */
export interface CutoverStep {
  readonly id: string;
  readonly table: string;
  readonly mechanism: Mechanism;
  readonly wave: number;
  readonly phase: CutoverPhase;
  /** رتبةٌ كلّيّةٌ في الترتيبِ — فريدةٌ، متصاعدةٌ، ولا فراغَ فيها. */
  readonly order: number;
  readonly rollback: RollbackStep;
  readonly probe: VerificationProbe;
  /** معرّفاتُ الحواجزِ التي تحجبُ هذه الخطوةَ: مُتطلَّباتُ الصفِّ وشرطُ الموجةِ. */
  readonly blockedBy: readonly string[];
}

/**
 * الطورُ المُشتَقُّ من الآليّةِ. قائمةٌ **مغلقةٌ**: آليّةٌ لا طورَ لها تُسقِطُ
 * الاشتقاقَ بخطأٍ ولا تُصنَّفُ `cutover` افتراضاً — فالافتراضُ ههنا يُخفي آليّةً
 * جديدةً لم يُفكَّرْ في استرجاعِها.
 */
const PHASE_BY_MECHANISM: Readonly<Record<Mechanism, CutoverPhase>> = {
  NONE: "expand",
  READ_THROUGH_CORE: "dual-read",
  EVENT_PROJECTION: "dual-read",
  HANDOVER_WITH_OPAQUE_REFERENCE: "cutover",
  COLUMN_SPLIT: "contract",
  DELEGATE_TO_CORE_CHANNEL: "cutover",
  SPLIT_TABLE: "expand",
};

/** يُرمى عندَ اشتقاقٍ مستحيلٍ — ولا يُرَدُّ خطوةٌ ناقصةٌ. */
export class CutoverDerivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CutoverDerivationError";
  }
}

function identifierIsSafe(table: string): boolean {
  return /^[a-z][a-z0-9_]{2,62}$/.test(table);
}

/**
 * مِسبارٌ للقراءةِ وحدَها: وجودُ الجدولِ وعددُ صفوفِه. ولا مُعامِلَ فيه من خارجٍ —
 * اسمُ الجدولِ يُتحقَّقُ منه قبلَ التركيبِ، فإن لم يكنْ معرِّفاً مقبولاً رُميَ
 * الخطأُ ولم يُركَّبْ نصٌّ.
 */
function probeFor(table: string): string {
  if (!identifierIsSafe(table)) {
    throw new CutoverDerivationError(`اسمُ جدولٍ لا يُقبَلُ معرِّفاً: «${table}» — ولا يُركَّبُ نصُّ مِسبارٍ منه`);
  }
  return (
    "select (select count(*) from information_schema.tables where table_schema = 'public' " +
    `and table_name = '${table}') as declared, (select count(*) from public.${table}) as rows`
  );
}

/**
 * هل النصُّ للقراءةِ وحدَها؟ **الفشلُ مغلقٌ**: كلُّ ما ليسَ `select`/`explain`
 * صريحاً يُرَدُّ، وكلُّ كلمةِ كتابةٍ تُرَدُّ، وكلُّ فاصلةٍ منقوطةٍ تُرَدُّ (فلا
 * جملةَ ثانيةً تُلحَقُ).
 */
export function isReadOnlyStatement(statement: string): boolean {
  const text = statement.trim().toLowerCase();
  if (text.length === 0) return false;
  if (text.includes(";")) return false;
  if (text.includes("--") || text.includes("/*")) return false;
  if (!(text.startsWith("select ") || text.startsWith("explain "))) return false;
  // الكلماتُ تُطابَقُ **كلماتٍ كاملةً** لا سلاسلَ جزئيّةً. والفرقُ قِيسَ لا فُرِضَ:
  // المطابقةُ الجزئيّةُ كانت تردُّ مِسبارَ `telegram_update_jobs` لأنَّ اسمَه يحملُ
  // «update» — فترفضُ قراءةً سليمةً، ثمَّ يُخفَّفُ الحاجزُ لأجلِ عطبٍ في نفسِه.
  // و`_` حرفُ كلمةٍ في هذا التعبيرِ، فالمعرِّفُ رمزٌ واحدٌ لا رمزانِ.
  const forbidden = [
    "insert",
    "update",
    "delete",
    "drop",
    "truncate",
    "alter",
    "create",
    "grant",
    "revoke",
    "copy",
    "merge",
    "call",
    "do",
    "vacuum",
    "refresh",
    "set",
    "lock",
    "commit",
    "rollback",
    "pg_sleep",
    "nextval",
    "setval",
    "dblink",
    "pg_read_file",
    "pg_write_file",
    "lo_import",
    "lo_export",
  ];
  const tokens = new Set(text.split(/[^a-z0-9_]+/u).filter((token) => token.length > 0));
  if (forbidden.some((word) => tokens.has(word))) return false;
  // قفلُ الصفوفِ ليسَ كلمةً واحدةً، ويُقرأُ قراءةً وهوَ يكتبُ قفلاً.
  return !/\bfor\s+(update|share|no\s+key\s+update)\b/u.test(text);
}

/** الاسترجاعُ يستعيدُ بياناتٍ في طورِ التقليصِ وحدَه — وذلكَ مُشتَقٌّ لا مُعلَنٌ. */
function requiresDataRestore(phase: CutoverPhase): boolean {
  return phase === "contract";
}

function waveBlockers(wave: number): readonly string[] {
  const definition = WAVES.find((entry) => entry.wave === wave);
  if (definition === undefined) {
    throw new CutoverDerivationError(`موجةٌ غيرُ مُعلَنةٍ في المصفوفةِ: ${wave}`);
  }
  return [...mentionedBlockerIds(definition.entryCondition)];
}

/**
 * يُشتَقُّ السجلُّ كاملاً من المصفوفةِ. الموجةُ 0 **تُستثنى** لأنَّها لا تلمسُ
 * صفّاً — وذلكَ مُقرَّرٌ في المصفوفةِ نفسِها لا رأيٌ ههنا.
 */
export function deriveCutoverPlan(
  matrix: readonly MatrixEntry[] = WASLA_MIGRATION_MATRIX,
): readonly CutoverStep[] {
  const steps: CutoverStep[] = [];
  const migrating = matrix
    .filter((entry) => entry.wave > 0)
    .slice()
    .sort((left, right) => left.wave - right.wave || left.table.localeCompare(right.table));

  let order = 0;
  for (const entry of migrating) {
    const phase = PHASE_BY_MECHANISM[entry.mechanism];
    if (phase === undefined) {
      throw new CutoverDerivationError(
        `آليّةٌ بلا طورٍ مُعلَنٍ: ${entry.mechanism} (الجدولُ ${entry.table})`,
      );
    }
    const definition = MECHANISMS.find((candidate) => candidate.id === entry.mechanism);
    if (definition === undefined) {
      throw new CutoverDerivationError(`آليّةٌ غيرُ مُعرَّفةٍ: ${entry.mechanism}`);
    }
    if (entry.rollback.trim().length === 0 || entry.verification.trim().length === 0) {
      throw new CutoverDerivationError(
        `مُدخلٌ بلا مسارِ عودةٍ أو بلا قياسٍ: ${entry.table} — ولا خطوةَ تُشتَقُّ منهُ`,
      );
    }
    order += 1;
    const id = `${entry.wave}.${String(order).padStart(3, "0")}-${entry.table}`;
    const blockedBy = [
      ...new Set(
        [...entry.prerequisites, ...waveBlockers(entry.wave)].map((raw) =>
          raw.replaceAll("`", "").trim(),
        ),
      ),
    ].sort();
    steps.push({
      id,
      table: entry.table,
      mechanism: entry.mechanism,
      wave: entry.wave,
      phase,
      order,
      rollback: {
        inverseOf: id,
        action: entry.rollback,
        shape: definition.rollbackShape,
        requiresDataRestore: requiresDataRestore(phase),
      },
      probe: { statement: probeFor(entry.table), readsAs: entry.verification },
      blockedBy,
    });
  }
  if (steps.length === 0) {
    throw new CutoverDerivationError("لا خطوةَ واحدةً — قراءةُ المصفوفةِ معطوبةٌ");
  }
  return steps;
}

/** ترتيبُ الاسترجاعِ: **عكسُ** ترتيبِ التحوُّلِ، بلا استثناءٍ ولا إعادةِ ترتيبٍ. */
export function rollbackOrder(steps: readonly CutoverStep[]): readonly RollbackStep[] {
  return steps
    .slice()
    .sort((left, right) => right.order - left.order)
    .map((step) => step.rollback);
}

/** رفضُ التمرينِ: قيمةٌ **تُقرأُ**، لا استثناءٌ يُلتقَطُ ويُهمَلُ. */
export interface RehearsalRefused {
  readonly outcome: "REFUSED";
  /** الحواجزُ المفتوحةُ التي أوجبَت الرفضَ — مقروءةٌ من سجلِّ `W-8`. */
  readonly openGates: readonly string[];
  readonly reason: string;
}

/** نتيجةُ تمرينٍ للقراءةِ وحدَها — **ولا حالةَ «تمَّ التحوُّلُ» ألبتّةَ**. */
export interface ReadOnlyRehearsal {
  readonly outcome: "READ_ONLY_PROBED";
  readonly probed: number;
  readonly refusedGates: readonly string[];
  /**
   * مُعلَنٌ صريحاً في القيمةِ نفسِها: هذا ليسَ تمريناً للتحوُّلِ. فمن قرأَ النتيجةَ
   * وحدَها بلا سياقٍ لا يستطيعُ أن يقرأَها إنجازاً.
   */
  readonly rehearsalCompleted: false;
}

export type RehearsalOutcome = RehearsalRefused | ReadOnlyRehearsal;

export function isRehearsalRefused(value: RehearsalOutcome): value is RehearsalRefused {
  return value.outcome === "REFUSED";
}

/**
 * الحواجزُ المفتوحةُ من حواجزِ التمرينِ، مقروءةً من سجلِّ `W-8`. ومعرّفٌ غيرُ
 * مُعلَنٍ في `ROADMAP.md` **يُقرأُ حاجزاً مفتوحاً** لا حاجزاً مُغلَقاً: الجهلُ
 * ليسَ إذناً.
 */
export function openRehearsalGates(blockers: readonly Blocker[]): readonly string[] {
  const open: string[] = [];
  for (const id of REHEARSAL_GATE_BLOCKERS) {
    try {
      if (isBlockerOpen(id, blockers)) open.push(id);
    } catch (error) {
      if (error instanceof UnknownBlockerError) {
        open.push(id);
        continue;
      }
      throw error;
    }
  }
  return open;
}

/**
 * **الرفضُ بالإنشاءِ.** ما دامَ حاجزٌ من حواجزِ التمرينِ مفتوحاً فلا سبيلَ إلى
 * قيمةٍ غيرِ `REFUSED`، ولا مُعامِلَ تجاوزٍ ولا وضعَ «قسريٍّ». وحينَ تُغلَقُ
 * كلُّها لا يُقالُ «تمَّ التحوُّلُ» أيضاً: أقصى ما يُرَدُّ `READ_ONLY_PROBED`،
 * لأنَّ هذا المِلفَّ لا يكتبُ صفّاً ولا يستطيعُ أن يشهدَ على تحوُّلٍ.
 */
export function rehearseReadOnly(
  steps: readonly CutoverStep[],
  blockers: readonly Blocker[],
): RehearsalOutcome {
  const openGates = openRehearsalGates(blockers);
  if (openGates.length > 0) {
    return {
      outcome: "REFUSED",
      openGates,
      reason:
        `تمرينُ التحوُّلِ مرفوضٌ بالإنشاءِ: ${openGates.join("، ")} مفتوحةٌ في ` +
        "`ROADMAP.md`. ولا وجهةَ تُحوَّلُ إليها ولا أحجامَ معروفةً ولا إقرارَ إطلاقٍ، " +
        "فأيُّ «أخضرَ» ههنا يكونُ شاهداً على غيرِ ما سيقعُ.",
    };
  }
  const notReadOnly = steps.filter((step) => !isReadOnlyStatement(step.probe.statement));
  if (notReadOnly.length > 0) {
    return {
      outcome: "REFUSED",
      openGates: [],
      reason: `مِسبارٌ ليسَ للقراءةِ وحدَها: ${notReadOnly.map((step) => step.id).join("، ")}`,
    };
  }
  return {
    outcome: "READ_ONLY_PROBED",
    probed: steps.length,
    refusedGates: [],
    rehearsalCompleted: false,
  };
}
