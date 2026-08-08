/**
 * الغرض: تنسيق مسار الحدث الكامل — حارس المُدخَل، التوجيه، الوكيل، السياسات،
 *   حارس المُخرَج، التسجيل. **ينسّق وينفّذ مباشرة** بلا وسائط شبكية.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.1.
 * ينتمي إلى: packages/agent-core
 * يُتوقع أن يستخدمه لاحقاً: gateway.ts **وحده**
 * ملاحظات مستقبلية: عند التوزيع يصير `agent.handle(context)` نداءً شبكياً.
 *   **توقيعها لا يتغيّر** — لهذا هي `await` على واجهة، لا استدعاءً مباشراً لدالّة
 *   في هذا الملف. الاستبدال حينها يمسّ `registry` لا `core`.
 *
 * ترتيب المسار ثابت ومقصود، وهو نفسه المذكور في القسم ج من الأمر:
 *   inputGuard → router → agent → confidencePolicy/decisionPolicy → outputGuard
 *
 * ولماذا حارس المُخرَج **بعد** السياسات لا قبلها: السياسات تقرّر هل يُعرض شيء
 * أصلاً، والحارس ينظّف ما تقرّر عرضه. تنظيف نصٍّ لن يُعرض عملٌ ضائع، والأهمّ أن
 * الحارس لو سبقها لصار رفضه يبدو «قراراً» بينما هو فحص سلامة.
 */

import type { AgentRegistry } from "./agents/registry.ts";
import type { AgentContext } from "./agents/types.ts";
import { route } from "./brain/router.ts";
import type { AgentCoreConfig } from "./config.ts";
import type { DecisionLog } from "./experience/decisionLog.ts";
import type { EventStore } from "./experience/eventStore.ts";
import type { ExperienceStore } from "./experience/experienceStore.ts";
import { blockedResult, failureResult, noAgentResult } from "./fallback.ts";
import { inspectInput } from "./guardrails/inputGuard.ts";
import { inspectOutput } from "./guardrails/outputGuard.ts";
import { tokenize } from "./knowledge/knowledgeIndex.ts";
import type { KnowledgeSearch } from "./knowledge/knowledgeSearch.ts";
import type { LongTermMemory } from "./memory/longTerm.ts";
import type { MediumTermMemory } from "./memory/mediumTerm.ts";
import { createShortTermMemory } from "./memory/shortTerm.ts";
import { evaluateConfidence } from "./policies/confidencePolicy.ts";
import { buildDecision } from "./policies/decisionPolicy.ts";
import { enforceExecutionPolicy } from "./policies/executionPolicy.ts";
import type { DecisionResult, EventPayload, ExperienceRecord, ModelAdapter } from "./schemas.ts";

export interface CoreDependencies {
  readonly config: AgentCoreConfig;
  readonly registry: AgentRegistry;
  readonly knowledge: KnowledgeSearch;
  readonly longTerm: LongTermMemory;
  readonly mediumTerm: MediumTermMemory;
  readonly events: EventStore;
  readonly experiences: ExperienceStore;
  readonly decisions: DecisionLog;
  readonly model: ModelAdapter;
  readonly now: () => Date;
  readonly log: (message: string, meta: Record<string, unknown>) => void;
}

export interface Core {
  process(traceId: string, event: EventPayload): Promise<DecisionResult>;
}

/** أقصى عدد توكِنات تُحفظ في النافذة المتوسّطة — يكفي للتعلّم ولا يحفظ نصّاً كاملاً. */
const MAX_STORED_TOKENS = 40;

export function createCore(dependencies: CoreDependencies): Core {
  const { config, registry, knowledge, longTerm, mediumTerm, events, experiences, decisions } =
    dependencies;

  return {
    process: async (traceId, event) => {
      const startedAt = Date.now();
      const shortTerm = createShortTermMemory();

      try {
        // ── 1. حارس المُدخَل: أوّل شيء على الإطلاق ─────────────────────────
        const input = inspectInput(event, {
          maxTextLength: config.maxInputLength,
          maxAttributes: 32,
          maxAttributeLength: 512,
        });
        if (!input.allowed) {
          const decision = blockedResult(
            traceId,
            event.eventId,
            input.reason ?? "رفض حارس المُدخَل",
            Date.now() - startedAt,
          );
          decisions.record(decision, shortTerm.notes());
          return decision;
        }
        const sanitized = input.sanitized;
        for (const adjustment of input.adjustments) shortTerm.note(`مُدخَل: ${adjustment}`);

        events.record(traceId, sanitized);

        // ── 2. العقل: أولوية وتوجيه، لا تنفيذ ──────────────────────────────
        const routing = route(sanitized, registry);
        shortTerm.note(`توجيه: ${routing.rationale}`);

        if (routing.agentId === null) {
          const decision = noAgentResult(
            traceId,
            sanitized.eventId,
            sanitized.eventType,
            Date.now() - startedAt,
          );
          decisions.record(decision, shortTerm.notes());
          return decision;
        }

        const agent = registry.byId(routing.agentId);
        if (agent === undefined) {
          const decision = noAgentResult(
            traceId,
            sanitized.eventId,
            sanitized.eventType,
            Date.now() - startedAt,
          );
          decisions.record(decision, shortTerm.notes());
          return decision;
        }

        // ── 3. الوكيل ───────────────────────────────────────────────────────
        // ⚠️ نقطة الاستبدال المستقبلية: `agent.handle` تصير نداءً شبكياً بلا أن
        // يتغيّر شيء هنا. لهذا لا يُمرَّر لها اتصال ولا إعداد — بل سياق مسطَّح.
        const context: AgentContext = {
          traceId,
          event: sanitized,
          shortTerm,
          longTerm,
          knowledge,
          model: dependencies.model,
        };
        const raw = await agent.handle(context);

        // ── 4. حارس المُخرَج ────────────────────────────────────────────────
        const output = inspectOutput(raw, {
          maxLength: config.maxOutputLength,
          maxEvidence: 5,
          maxExcerptLength: 240,
        });
        if (!output.allowed) {
          const decision = blockedResult(
            traceId,
            sanitized.eventId,
            output.reason ?? "رفض حارس المُخرَج",
            Date.now() - startedAt,
          );
          decisions.record(decision, shortTerm.notes());
          return decision;
        }
        for (const adjustment of output.adjustments) shortTerm.note(`مُخرَج: ${adjustment}`);
        const proposal = output.sanitized;

        // ── 5. السياسات ─────────────────────────────────────────────────────
        const execution = enforceExecutionPolicy(proposal);
        if (execution.violation) {
          // انتهاك سقف الصلاحية يُسجَّل بمستوى ظاهر: لا يقع في هذه المرحلة، ووقوعه
          // يعني أن وكيلاً عُدِّل بلا انتباه — وهذا ما يجب أن يُرى فوراً لا لاحقاً.
          dependencies.log("agent_core.tool_level_violation", {
            traceId,
            agentId: proposal.agentId,
            requested: proposal.requestedToolLevel,
          });
        }
        const confidence = evaluateConfidence(proposal, config.confidenceThreshold);
        shortTerm.note(`ثقة: ${confidence.reason}`);

        const decision = buildDecision({
          traceId,
          event: sanitized,
          proposal,
          confidence,
          execution,
          durationMs: Date.now() - startedAt,
        });

        // ── 6. التسجيل ──────────────────────────────────────────────────────
        const recordedAt = dependencies.now().toISOString();
        const experience: ExperienceRecord = {
          traceId,
          eventId: sanitized.eventId,
          eventType: sanitized.eventType,
          agentId: decision.agentId,
          status: decision.status,
          classification: decision.classification,
          confidence: decision.confidence,
          recommendedAction: decision.recommendedAction,
          recordedAt,
          durationMs: decision.durationMs,
        };
        experiences.record(experience);
        decisions.record(decision, shortTerm.notes());

        mediumTerm.append({
          traceId,
          eventType: sanitized.eventType,
          agentId: decision.agentId,
          classification: decision.classification,
          status: decision.status,
          confidence: decision.confidence,
          matchedKeywords: proposal.evidence
            .filter((item) => item.source === "memory:keyword")
            .map((item) => item.excerpt.split("»")[0]?.replace("«", "").trim() ?? "")
            .filter((keyword) => keyword !== ""),
          tokens: tokenize(sanitized.text).slice(0, MAX_STORED_TOKENS),
          textLength: sanitized.text.length,
          recordedAt,
        });

        return decision;
      } catch (error) {
        // آخر سدّ. لا استثناء يعبر من هنا إلى `gateway` فضلاً عن المشروع الأساسي.
        dependencies.log("agent_core.process_failure", {
          traceId,
          detail: error instanceof Error ? error.message : String(error),
        });
        return failureResult(traceId, event.eventId, error, Date.now() - startedAt);
      } finally {
        // **يُفنى دائماً** — في النجاح والفشل والرفض. هذا ما يجعل «قصيرة المدى»
        // خاصيةً في البنية لا وعداً في التوثيق.
        shortTerm.dispose();
      }
    },
  };
}
