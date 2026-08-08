/**
 * الغرض: تركيب القرار النهائي من الاقتراح وأحكام السياسات — نقطةٌ واحدة تُبنى
 *   فيها `DecisionResult`، فلا يختلف شكلها بين مسار ومسار.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/policies
 * يُتوقع أن يستخدمه لاحقاً: core.ts
 * ملاحظات مستقبلية: عند تعدّد الوكلاء على حدث واحد يصير هنا دمج اقتراحاتٍ
 *   متنافسة. **العقد `DecisionResult` هو نفسه** — يتغيّر ما يُدمج لا ما يُعاد.
 *
 * لماذا مكان واحد للتركيب: لأن `DecisionResult` هو ما يعبر حدود الطبقة. لو بُني
 * في خمسة مواضع لاختلفت خمسة مسارات في حقلٍ صغير — والحقل الصغير الذي يختلف هو
 * `allowedToolLevel`.
 */

import type { AgentProposal, DecisionResult, EventPayload } from "../schemas.ts";
import type { ConfidenceVerdict } from "./confidencePolicy.ts";
import type { ExecutionPolicyVerdict } from "./executionPolicy.ts";

export interface DecisionInput {
  readonly traceId: string;
  readonly event: EventPayload;
  readonly proposal: AgentProposal;
  readonly confidence: ConfidenceVerdict;
  readonly execution: ExecutionPolicyVerdict;
  readonly durationMs: number;
}

/**
 * ترتيب الأحكام مقصود: **الصلاحية أولاً ثم الثقة.** اقتراحٌ تجاوز سقف الصلاحية
 * يُحجب حتى لو كانت ثقته كاملة — بل **خصوصاً** حينها، لأن اقتراحاً واثقاً يطلب
 * صلاحية لا يملكها أخطر من اقتراح متردّد.
 */
export function buildDecision(input: DecisionInput): DecisionResult {
  const { traceId, event, proposal, confidence, execution, durationMs } = input;

  const base = {
    traceId,
    eventId: event.eventId,
    agentId: proposal.agentId,
    classification: proposal.classification,
    evidence: proposal.evidence,
    missingData: proposal.missingData,
    durationMs,
  } as const;

  if (!execution.allowed) {
    return {
      ...base,
      status: "blocked",
      recommendedAction: null,
      confidence: confidence.effectiveConfidence,
      allowedToolLevel: "NONE",
      reason: execution.reason,
    };
  }

  if (!confidence.sufficient) {
    return {
      ...base,
      status: "insufficient_confidence",
      // لا يُعرض نصٌّ لم يبلغ العتبة: عرضه «مع تحفّظ» يجعل التحفّظ سطراً يُتجاوز
      // بالقراءة السريعة، بينما القرار الصريح بعدم العرض لا يُتجاوز.
      recommendedAction: null,
      confidence: confidence.effectiveConfidence,
      allowedToolLevel: "NONE",
      reason: confidence.reason,
    };
  }

  return {
    ...base,
    status: "suggested",
    recommendedAction: proposal.recommendedAction,
    confidence: confidence.effectiveConfidence,
    allowedToolLevel: execution.grantedLevel,
    reason: null,
  };
}
