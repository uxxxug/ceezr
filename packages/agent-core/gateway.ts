/**
 * الغرض: **نقطة الدخول الوحيدة** لهذه الطبقة. المشروع الأساسي لا يعرف من هذا
 *   المجلّد شيئاً سوى هذا الملف.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.1.
 * ينتمي إلى: packages/agent-core
 * يُتوقع أن يستخدمه لاحقاً: محوِّل رفيع في `apps/gateway` وحده
 * ملاحظات مستقبلية: عند فصل الطبقة إلى خدمة مستقلّة يصير هذا الملف عميل HTTP
 *   بنفس الواجهة تماماً — ولا يتغيّر حرفٌ عند من يستدعيه. هذا هو الغرض من وجوده.
 *
 * ═══ القيدان المعماريان الحاكمان (القسم صفر) ═══
 *
 * 1. **TypeScript لا Python** — اتساقاً مع كامل المستودع.
 * 2. **اتجاه اعتماد واحد**: هذه الطبقة **لا تستورد** من `packages/domain` ولا
 *    `application` ولا `infrastructure` إطلاقاً. تصلها البيانات عبر `EventPayload`
 *    وحده. يفرض هذا سكربت `scripts/check-agent-core-isolation.ts` في CI — ليس
 *    اتفاقاً بل فحصاً يُسقط البناء.
 *
 * ⚠️ **مفتاح التعطيل الشامل**: حين `AGENT_CORE_ENABLED !== "true"` يعود
 * `process` فوراً بقرار «معطَّلة» **بلا تهيئة، ولا قراءة ملف، ولا كتابة سطر**.
 * لا مسار جانبي يتجاوز هذا الفحص. اختبار العزل في `tests/` يُثبته.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createAgentRegistry } from "./agents/registry.ts";
import type { AgentCoreConfig } from "./config.ts";
import { loadConfig } from "./config.ts";
import { createCore } from "./core.ts";
import type { EvaluationReport } from "./evaluation/evaluator.ts";
import { evaluate } from "./evaluation/evaluator.ts";
import { createDecisionLog } from "./experience/decisionLog.ts";
import { createEventStore } from "./experience/eventStore.ts";
import { createExperienceStore } from "./experience/experienceStore.ts";
import { createOutcomeRecorder } from "./experience/outcomeRecorder.ts";
import { disabledResult } from "./fallback.ts";
import { buildKnowledgeIndex } from "./knowledge/knowledgeIndex.ts";
import { loadKnowledge } from "./knowledge/knowledgeLoader.ts";
import { createKnowledgeSearch } from "./knowledge/knowledgeSearch.ts";
import { createApprovalFlow } from "./learning/approvalFlow.ts";
import type { GeneratedCandidate } from "./learning/candidateGenerator.ts";
import { generateCandidates } from "./learning/candidateGenerator.ts";
import { createCandidateStore } from "./learning/candidateStore.ts";
import { createLongTermMemory } from "./memory/longTerm.ts";
import { createMediumTermMemory } from "./memory/mediumTerm.ts";
import { createFileStore, createNullFileStore } from "./memory/storage.ts";
import { nullModel } from "./model/nullModel.ts";
import type { DecisionResult, EventPayload, LearningCandidate, OutcomeVerdict } from "./schemas.ts";

export type AgentCoreLog = (message: string, meta: Record<string, unknown>) => void;

export interface AgentCoreOptions {
  readonly config?: AgentCoreConfig;
  readonly now?: () => Date;
  readonly log?: AgentCoreLog;
  /** يُحقَن في الاختبارات لجعل المعرّفات حتمية. */
  readonly newTraceId?: () => string;
}

/**
 * الواجهة الكاملة التي يراها الخارج. أضيق ما يمكن: كل ما لا يحتاجه المشروع
 * الأساسي لا يُصدَّر، وأخصّها `memoryUpdater` — الكتابة في الذاكرة الطويلة لا
 * تُتاح من خارج مسار الموافقة.
 */
export interface AgentCoreGateway {
  readonly enabled: boolean;
  /** المسار الرئيسي. **لا يرمي أبداً** ويعود دائماً بـ`DecisionResult` كامل. */
  process(event: EventPayload): Promise<DecisionResult>;
  /** تسجيل ما فعله فريق الدعم فعلاً بعد الاقتراح. */
  recordOutcome(traceId: string, verdict: OutcomeVerdict, humanAction: string | null): boolean;
  evaluate(): EvaluationReport;
  generateCandidates(): readonly GeneratedCandidate[];
  listPendingCandidates(): readonly LearningCandidate[];
  approveCandidate(candidateId: string, decidedBy: string): { ok: boolean; reason: string };
  rejectCandidate(
    candidateId: string,
    decidedBy: string,
    note: string,
  ): { ok: boolean; reason: string };
}

const noopLog: AgentCoreLog = () => undefined;

/** بوّابة معطَّلة: كل دالّة تعود بالحدّ الأدنى، ولا شيء يُقرأ ولا يُكتب. */
function disabledGateway(newTraceId: () => string): AgentCoreGateway {
  return {
    enabled: false,
    process: async (event) => disabledResult(newTraceId(), event.eventId),
    recordOutcome: () => false,
    evaluate: () => ({
      summary: {
        total: 0,
        suggested: 0,
        withOutcome: 0,
        accepted: 0,
        rejected: 0,
        ignored: 0,
        acceptanceRate: null,
        averageConfidence: null,
        calibrationGap: null,
      },
      verdict: "insufficient_data",
      findings: ["الطبقة معطَّلة"],
    }),
    generateCandidates: () => [],
    listPendingCandidates: () => [],
    approveCandidate: () => ({ ok: false, reason: "الطبقة معطَّلة" }),
    rejectCandidate: () => ({ ok: false, reason: "الطبقة معطَّلة" }),
  };
}

export function createAgentCore(options: AgentCoreOptions = {}): AgentCoreGateway {
  const config = options.config ?? loadConfig();
  const now = options.now ?? (() => new Date());
  const log = options.log ?? noopLog;
  const newTraceId = options.newTraceId ?? (() => randomUUID());

  // ⚠️ الفحص الأول والوحيد قبل أي تهيئة. لا قراءة معرفة، ولا فتح ملف، ولا مجلّد
  // يُنشأ. طبقةٌ معطَّلة يجب ألّا تترك أثراً واحداً على النظام.
  if (!config.enabled) return disabledGateway(newTraceId);

  const memoryStore = config.persistenceEnabled
    ? createFileStore(join(config.runtimeRoot, "memory"), log)
    : createNullFileStore();
  const experienceStore = config.persistenceEnabled
    ? createFileStore(join(config.runtimeRoot, "experience"), log)
    : createNullFileStore();
  const learningStore = config.persistenceEnabled
    ? createFileStore(join(config.runtimeRoot, "learning"), log)
    : createNullFileStore();

  const longTerm = createLongTermMemory(memoryStore, now);
  const mediumTerm = createMediumTermMemory(memoryStore, config.mediumTermMaxLines);

  // المعرفة تُحمَّل مرّة واحدة عند الإقلاع: ملفاتها في المستودع فلا تتغيّر بين نشرتين.
  const documents = loadKnowledge(config.knowledgeRoot, log);
  log("agent_core.knowledge_loaded", { count: documents.length });
  const knowledge = createKnowledgeSearch(buildKnowledgeIndex(documents));

  const events = createEventStore(experienceStore, config.mediumTermMaxLines, now);
  const experiences = createExperienceStore(experienceStore, config.mediumTermMaxLines);
  const decisions = createDecisionLog(experienceStore, config.mediumTermMaxLines, now);
  const outcomes = createOutcomeRecorder(experienceStore, config.mediumTermMaxLines, now);

  const candidates = createCandidateStore(learningStore);
  const approvals = createApprovalFlow(candidates, longTerm, now);

  const core = createCore({
    config,
    registry: createAgentRegistry(),
    knowledge,
    longTerm,
    mediumTerm,
    events,
    experiences,
    decisions,
    model: nullModel,
    now,
    log,
  });

  return {
    enabled: true,

    process: async (event) => {
      // `trace_id` بسيط: UUID واحد يربط الحدث بقراره بتجربته بنتيجته. لا نظام
      // تتبّع موزّع ولا سياق مُمرَّر — خدمة واحدة لا تحتاج أكثر من معرّف واحد.
      const traceId = newTraceId();
      return core.process(traceId, event);
    },

    recordOutcome: (traceId, verdict, humanAction) => {
      outcomes.record(traceId, verdict, humanAction);
      return true;
    },

    evaluate: () => evaluate(experiences.all(), outcomes.all()),

    generateCandidates: () => {
      const generated = generateCandidates({
        entries: mediumTerm.all(),
        outcomes: outcomes.all(),
        memory: longTerm,
        minSupport: config.minSupportForCandidate,
        now,
      });
      // المؤهَّل وحده يُخزَّن للمراجعة؛ غير المؤهَّل يعود في القائمة بسببه ولا
      // يُحفظ. قائمةُ مراجعةٍ فيها ما لا يستحقّ تُوافَق عليها بالجملة فتبطل.
      for (const entry of generated) {
        if (entry.eligible) candidates.upsert(entry.candidate);
      }
      return generated;
    },

    listPendingCandidates: () => approvals.listPending(),
    approveCandidate: (candidateId, decidedBy) => {
      const outcome = approvals.approve(candidateId, decidedBy);
      return { ok: outcome.ok, reason: outcome.reason };
    },
    rejectCandidate: (candidateId, decidedBy, note) => {
      const outcome = approvals.reject(candidateId, decidedBy, note);
      return { ok: outcome.ok, reason: outcome.reason };
    },
  };
}
