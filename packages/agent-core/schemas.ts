/**
 * الغرض: كل العقود التي تعبر حدود هذه الطبقة أو تمرّ بين مكوّناتها. ملفٌ واحد لا
 *   ملفات متفرّقة: العقد الذي يُقرأ كاملاً في مكان واحد لا ينحرف طرفاه عن بعضهما.
 * الحالة: منفّذ فعلياً — القسم 3 (طبقة الذكاء المعزولة)، البند ب.1.
 * ينتمي إلى: packages/agent-core
 * يُتوقع أن يستخدمه لاحقاً: كل ملف في هذه الطبقة، ولا شيء خارجها إلا عبر gateway.ts
 * ملاحظات مستقبلية: عند تعدّد الخدمات الموزَّعة يصير لهذه العقود إصدارٌ صريح
 *   (`schema_version`) لأن خدمتين تُنشران في وقتين مختلفين. اليوم خدمة واحدة
 *   تُنشر دفعةً واحدة، فالإصدار حقلٌ يُحمل بلا أن يُقرأ — وحمله بلا قراءة كذبٌ
 *   أسوأ من غيابه. لا يُضاف حتى تُوجد الخدمة الثانية فعلاً.
 *
 * قاعدة حاكمة لهذا الملف: **لا يستورد شيئاً**. لا من domain، ولا application، ولا
 * infrastructure، ولا حتى shared. عزل الطبقة يبدأ من عقودها: عقدٌ يستورد من
 * المشروع الأساسي يجرّ الطبقة كلها إليه بعد ثلاثة ملفات.
 */

// ─── نتيجة عامة: نفس فلسفة المشروع الأساسي، بتعريف مستقلّ لأجل العزل ──────────

export type AgentResult<T, E> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: E;
    };

export function agentOk<T, E = never>(value: T): AgentResult<T, E> {
  return { ok: true, value };
}

export function agentErr<E, T = never>(error: E): AgentResult<T, E> {
  return { ok: false, error };
}

// ─── الحدث الداخل ─────────────────────────────────────────────────────────────

/**
 * أنواع الأحداث المعروفة. **`support_ticket_opened` هو الوحيد المُنتَج فعلياً
 * اليوم**؛ الباقي مُعرَّف كي يُوجَّه إليه لاحقاً بلا تعديل عقد، ومحجوزٌ صراحةً.
 */
export const EVENT_TYPES = [
  "support_ticket_opened",
  // ── محجوزة، لا يُنتجها أحد اليوم ولا يستقبلها وكيل ──────────────────────────
  "operational_anomaly_detected",
  "fraud_signal_raised",
  "growth_opportunity_spotted",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * ما يصل الطبقة من المشروع الأساسي — **وهو كل ما يصلها**. لا كائنات دومين، ولا
 * اتصال قاعدة، ولا منفذ. البيانات مسطَّحة عمداً: أي حقل مركَّب هنا يعني أن الطبقة
 * صارت تعرف شكل الدومين، فيصير تغيير الدومين كسراً لها.
 */
export interface EventPayload {
  readonly eventId: string;
  readonly eventType: EventType;
  /** لحظة وقوع الحدث في المشروع الأساسي، ISO 8601. */
  readonly occurredAt: string;
  /** من أين جاء — يدخل في قرار التوجيه، ويُسجَّل في التجربة. */
  readonly source: string;
  /** نصّ الحدث الحرّ: نصّ التذكرة هنا. قد يكون فارغاً لأحداث لا نصّ لها. */
  readonly text: string;
  /**
   * حقول إضافية مسطَّحة (نوع التذكرة، رمز المدينة…). **قيمها بدائية فقط** — لا
   * كائنات متداخلة، فالمتداخل يُغري بتمرير الدومين كاملاً عبر هذا الباب.
   */
  readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
}

// ─── الأولوية والتوجيه ────────────────────────────────────────────────────────

export const PRIORITY_LEVELS = ["critical", "high", "normal", "low"] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

export function isPriorityLevel(value: string): value is PriorityLevel {
  return (PRIORITY_LEVELS as readonly string[]).includes(value);
}

export interface PriorityVerdict {
  readonly level: PriorityLevel;
  /** لماذا هذه الأولوية — يُسجَّل، لأن قراراً بلا سبب لا يُراجَع. */
  readonly rationale: string;
  /** هل يستحقّ تصعيداً بشرياً فورياً؟ اليوم `false` دائماً (brain/escalation معلَّق). */
  readonly requiresHumanEscalation: boolean;
}

export interface RoutingDecision {
  /** `null` = لا وكيل لهذا النوع. ليس خطأً: أنواع محجوزة بلا وكيل حالة متوقَّعة. */
  readonly agentId: string | null;
  readonly priority: PriorityVerdict;
  readonly rationale: string;
}

// ─── مستويات الأداة: العمود الفقري لسياسة «اقتراح لا تنفيذ» ───────────────────

/**
 * الترتيب مقصود ومُعتمَد عليه في المقارنات: كل مستوى يشمل ما دونه صلاحيةً.
 * - `NONE`: لا يلمس شيئاً خارج نفسه.
 * - `READ`: يقرأ ولا يكتب.
 * - `SUGGEST`: يُنتج نصّاً يقرؤه إنسان ويقرّر. **السقف المسموح اليوم.**
 * - `EXECUTE`: يُغيّر حالة المنصّة بنفسه. **مرفوض برمجياً اليوم** (executionPolicy).
 */
export const TOOL_LEVELS = ["NONE", "READ", "SUGGEST", "EXECUTE"] as const;
export type ToolLevel = (typeof TOOL_LEVELS)[number];

export function toolLevelRank(level: ToolLevel): number {
  return TOOL_LEVELS.indexOf(level);
}

/**
 * سقف الصلاحية في هذه المرحلة، **مصدر حقيقة واحد** يقرؤه executionPolicy
 * و`toolRegistry` و`executionGuard` معاً. رفعه يجب أن يكون تعديل سطرٍ واحد يُرى
 * في المراجعة، لا رقماً منثوراً في خمسة ملفات يُرفع في أحدها وينسى في الباقي.
 */
export const MAX_ALLOWED_TOOL_LEVEL: ToolLevel = "SUGGEST";

// ─── قرار الوكيل ──────────────────────────────────────────────────────────────

export interface EvidenceItem {
  /** من أين جاء الدليل: `knowledge:<id>` أو `memory:keyword` أو `event:text`. */
  readonly source: string;
  readonly excerpt: string;
  readonly score: number;
}

/**
 * ما يُنتجه الوكيل قبل مرور السياسات عليه. الثقة عددٌ في [0,1] — والوكيل **لا
 * يقرّر بنفسه** هل ثقته كافية: ذلك عمل `confidencePolicy`. الفصل مقصود كي لا
 * يكون من ينتج الحكم هو من يُجيزه.
 */
export interface AgentProposal {
  readonly agentId: string;
  /** تصنيف الحدث كما رآه الوكيل. `null` = لم يستطع التصنيف. */
  readonly classification: string | null;
  readonly recommendedAction: string;
  readonly confidence: number;
  readonly requestedToolLevel: ToolLevel;
  readonly evidence: readonly EvidenceItem[];
  /** ما نقص الوكيلَ ليقرّر بثقة أعلى — يملؤه `missingDataDetector`. */
  readonly missingData: readonly string[];
}

export const DECISION_STATUSES = [
  /** اقتراح صالح للعرض على إنسان. */
  "suggested",
  /** الثقة دون العتبة، أو نقصت بيانات جوهرية. لا يُعرض اقتراح. */
  "insufficient_confidence",
  /** لا وكيل لهذا الحدث، أو الوكيل لم يجد ما يقوله. */
  "no_decision",
  /** حارسٌ رفض المُدخَل أو المُخرَج. */
  "blocked",
  /** عطل داخلي — عولج بـ fallback ولم يُرمَ للخارج. */
  "failed",
] as const;

export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/**
 * ما يخرج من `gateway.ts` — **وهو كل ما يخرج**. المشروع الأساسي لا يرى شيئاً من
 * داخل الطبقة غير هذا الشكل.
 */
export interface DecisionResult {
  readonly traceId: string;
  readonly eventId: string;
  readonly status: DecisionStatus;
  readonly agentId: string | null;
  readonly classification: string | null;
  /** النصّ المقترح لفريق الدعم. `null` مع أي حالة غير `suggested`. */
  readonly recommendedAction: string | null;
  readonly confidence: number;
  /** الصلاحية المسموح بها فعلاً بعد السياسات — لا التي طلبها الوكيل. */
  readonly allowedToolLevel: ToolLevel;
  readonly evidence: readonly EvidenceItem[];
  readonly missingData: readonly string[];
  /** سبب مقروء لحالة غير `suggested`. `null` مع `suggested`. */
  readonly reason: string | null;
  readonly durationMs: number;
}

// ─── الذاكرة ──────────────────────────────────────────────────────────────────

export interface KeywordEntry {
  readonly keyword: string;
  readonly label: string;
  readonly weight: number;
  /** كم مرة أثبت هذا المدخل نفسه — يدخل في ترجيح المرشحات لاحقاً. */
  readonly hits: number;
  readonly updatedAt: string;
}

export interface EntityEntry {
  readonly name: string;
  readonly kind: string;
  readonly aliases: readonly string[];
  readonly updatedAt: string;
}

export interface StateEntry {
  readonly key: string;
  readonly value: string;
  readonly updatedAt: string;
}

/** لقطة الذاكرة طويلة المدى كما تُقرأ في قرارٍ واحد. للقراءة فقط عمداً. */
export interface LongTermSnapshot {
  readonly keywords: readonly KeywordEntry[];
  readonly entities: readonly EntityEntry[];
  readonly state: readonly StateEntry[];
}

// ─── التجربة والتقييم ─────────────────────────────────────────────────────────

export interface ExperienceRecord {
  readonly traceId: string;
  readonly eventId: string;
  readonly eventType: EventType;
  readonly agentId: string | null;
  readonly status: DecisionStatus;
  readonly classification: string | null;
  readonly confidence: number;
  readonly recommendedAction: string | null;
  readonly recordedAt: string;
  readonly durationMs: number;
}

export const OUTCOME_VERDICTS = [
  /** فريق الدعم تصرّف وفق الاقتراح. */
  "accepted",
  /** تصرّف على خلافه. */
  "rejected",
  /** لم يُلتفت إليه أصلاً — وهذا ليس رفضاً، والخلط بينهما يُفسد التعلّم. */
  "ignored",
] as const;

export type OutcomeVerdict = (typeof OUTCOME_VERDICTS)[number];

export function isOutcomeVerdict(value: string): value is OutcomeVerdict {
  return (OUTCOME_VERDICTS as readonly string[]).includes(value);
}

export interface OutcomeRecord {
  readonly traceId: string;
  readonly verdict: OutcomeVerdict;
  /** ما فعله الإنسان فعلاً، إن عُرف. */
  readonly humanAction: string | null;
  readonly recordedAt: string;
}

export interface EvaluationSummary {
  readonly total: number;
  readonly suggested: number;
  readonly withOutcome: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly ignored: number;
  /** `accepted / withOutcome`. `null` حين لا نتيجة واحدة — لا صفر. */
  readonly acceptanceRate: number | null;
  readonly averageConfidence: number | null;
  /** فجوة المعايرة: متوسط الثقة ناقص نسبة القبول. موجبٌ = ثقة زائدة. */
  readonly calibrationGap: number | null;
}

// ─── التعلّم ──────────────────────────────────────────────────────────────────

/**
 * **العقد أوسع من التنفيذ عمداً.** اليوم لا يُولَّد ولا يُعتمَد إلا `keyword`
 * و`entity`. `policy` و`code` مُعرَّفان كي لا يتغيّر شكل المرشَّح حين يأتي دورهما،
 * و`approvalFlow` يرفضهما صراحةً اليوم لا يتجاهلهما بصمت.
 */
export const CANDIDATE_TYPES = ["keyword", "entity", "policy", "code"] as const;
export type CandidateType = (typeof CANDIDATE_TYPES)[number];

/** ما يُولَّد ويُعتمَد فعلاً اليوم. ما عداه يُرفض عند الاعتماد. */
export const IMPLEMENTED_CANDIDATE_TYPES: readonly CandidateType[] = ["keyword", "entity"];

/**
 * `approved` و`applied` مفصولان عمداً: الأول قرارٌ بشري وقع، والثاني كتابةٌ في
 * الذاكرة نجحت. مرشَّحٌ عالقٌ على `approved` يعني أن إنساناً وافق ولم تُطبَّق
 * موافقته — حالةٌ **يجب أن تُرى وتُصحَّح**، ودمجُ الحالتين كان سيُخفيها تماماً.
 */
export const CANDIDATE_STATUSES = ["pending", "approved", "applied", "rejected"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export interface LearningCandidate {
  readonly candidateId: string;
  readonly candidateType: CandidateType;
  readonly status: CandidateStatus;
  /** المقترَح نفسه: الكلمة المفتاحية أو اسم الكيان. */
  readonly subject: string;
  /** التصنيف الذي تدلّ عليه. */
  readonly label: string;
  /** كم تجربة تدعمه — العدد وحده لا يكفي للاعتماد، لكنه شرطه الأول. */
  readonly supportCount: number;
  readonly rationale: string;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
}

// ─── النموذج ──────────────────────────────────────────────────────────────────

/**
 * طلب النموذج بكل ما سيحتاجه الموجّه متعدد المزوّدين لاحقاً (القسم أ.5). الحقول
 * الاختيارية **غير مقروءة اليوم** — `nullModel` يتجاهلها كلها — لكنها في العقد
 * الآن كي لا يتغيّر توقيع كل مُستدعٍ يوم يأتي المزوّد الحقيقي.
 */
export interface ModelRequest {
  readonly purpose: string;
  readonly prompt: string;
  /** مزوّد بعينه. `undefined` = يختار الموجّه. لا يُقرأ اليوم. */
  readonly provider?: string;
  /** سقف الكلفة لهذا الاستدعاء وحده. لا يُقرأ اليوم. */
  readonly budgetUnits?: number;
  /** مهلة زمنية بالمللي ثانية. لا يُقرأ اليوم. */
  readonly timeoutMs?: number;
  /** حساسية المحتوى — تُقيّد اختيار المزوّد لاحقاً. لا يُقرأ اليوم. */
  readonly sensitivity?: "low" | "high";
}

export interface ModelResponse {
  /** `false` = لا نموذج متاح. **الحالة الوحيدة اليوم.** */
  readonly available: boolean;
  readonly text: string | null;
  readonly provider: string | null;
  /** الكلفة الفعلية المقيسة. `null` حين لا استدعاء وقع. */
  readonly costUnits: number | null;
  readonly latencyMs: number;
}

export interface ModelAdapter {
  readonly name: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}
