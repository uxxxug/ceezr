/**
 * الغرض: عقد الوكيل الواحد. كل وكيل — الحقيقي اليوم والمحجوز غداً — يلتزم به.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.3.
 * ينتمي إلى: packages/agent-core/agents
 * يُتوقع أن يستخدمه لاحقاً: كل وكيل، وregistry.ts، وcore.ts
 * ملاحظات مستقبلية: عند مليار مستخدم يصير كل وكيل عملية مستقلّة، ويصير
 *   `handle` نداءً شبكياً. **توقيع الدالة هو نفسه حينها** — لهذا هو `async`
 *   ويأخذ سياقاً مسطَّحاً ولا يمسّ شيئاً عالمياً: استبداله بنداء شبكي يوم يأتي
 *   ذلك اليوم لا يغيّر حرفاً في `core.ts`.
 */

import type { KnowledgeSearch } from "../knowledge/knowledgeSearch.ts";
import type { LongTermMemory } from "../memory/longTerm.ts";
import type { ShortTermMemory } from "../memory/shortTerm.ts";
import type { AgentProposal, EventPayload, EventType, ModelAdapter } from "../schemas.ts";

/**
 * ما يُعطى للوكيل. **يُعطى ولا يأخذ**: الوكيل لا يفتح ملفاً ولا يقرأ إعداداً ولا
 * يصل قاعدة. كل ما يحتاجه يصله هنا، فيصير اختباره تمريرَ مزدوجات لا تهيئةَ عالم.
 */
export interface AgentContext {
  readonly traceId: string;
  readonly event: EventPayload;
  readonly shortTerm: ShortTermMemory;
  readonly longTerm: LongTermMemory;
  readonly knowledge: KnowledgeSearch;
  readonly model: ModelAdapter;
}

export interface Agent {
  readonly id: string;
  /** الأنواع التي يتولّاها. `registry` يبني منها جدول التوجيه فلا يُكرَّر يدوياً. */
  readonly handles: readonly EventType[];
  /**
   * **لا يرمي أبداً.** العجز يُعبَّر عنه باقتراحٍ ثقته صفر وسببٍ في `missingData`،
   * لا باستثناء. من رمى استثناءً هنا أوقف مسار الحدث كله بدل أن يُخبر عن عجزه.
   */
  handle(context: AgentContext): Promise<AgentProposal>;
}

/** اقتراح فارغ موحَّد: يستعمله كل وكيل حين لا يجد ما يقوله، فلا يختلف شكل العجز. */
export function emptyProposal(agentId: string, reason: string): AgentProposal {
  return {
    agentId,
    classification: null,
    recommendedAction: "",
    confidence: 0,
    requestedToolLevel: "NONE",
    evidence: [],
    missingData: [reason],
  };
}
