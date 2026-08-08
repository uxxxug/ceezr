/**
 * الغرض: القائمة الوحيدة للوكلاء الفاعلين. من ليس فيها لا يُستدعى.
 * الحالة: منفّذ فعلياً — **وكيل واحد.** القسم 3، البند ب.3.
 * ينتمي إلى: packages/agent-core/agents
 * يُتوقع أن يستخدمه لاحقاً: brain/router.ts، core.ts
 * ملاحظات مستقبلية: تُضاف الوكلاء المحجوزون هنا **حين يُنفَّذون بأمر صريح** لكلٍّ
 *   على حدة، لا دفعةً واحدة. راجع `docs/adr/0012-isolated-agent-core-layer.md`.
 *
 * ⚠️ `anomalyAgent` و`fraudAgent` و`growthAgent` **غير مستوردة هنا عمداً**:
 * استيرادها — ولو للنوع فقط — يُغري بإضافتها للمصفوفة، وأول من يضيفها يجد وكيلاً
 * بلا تنفيذ فيُغريه أن «يُكمله». الغياب هنا هو الحاجز.
 */

import { createSupportTicketAgent } from "./supportTicketAgent.ts";
import type { Agent } from "./types.ts";

export interface AgentRegistry {
  byId(agentId: string): Agent | undefined;
  /** الوكيل الذي يتولّى هذا النوع. `undefined` = لا وكيل، وهي حالة متوقَّعة. */
  forEventType(eventType: string): Agent | undefined;
  list(): readonly Agent[];
}

/**
 * **مصفوفة بوكيل واحد.** قائمة صريحة لا اكتشافاً تلقائياً لملفات المجلّد: الاكتشاف
 * التلقائي كان سيُدخل الوكلاء المحجوزين لحظة كتابة سطر تنفيذ فيهم، بلا مراجعة
 * ولا قرار. التسجيل هنا فعلٌ مقصود يُرى في الفرق (diff).
 */
export function createAgentRegistry(agents?: readonly Agent[]): AgentRegistry {
  const list = agents ?? [createSupportTicketAgent()];
  const byType = new Map<string, Agent>();

  for (const agent of list) {
    for (const eventType of agent.handles) {
      // أوّل مسجَّل يفوز: تسجيل وكيلين لنوع واحد خطأ إعداد، والتغلّب الصامت عليه
      // يجعل ترتيب الملفات هو من يقرّر أيّ وكيل يعمل.
      if (!byType.has(eventType)) byType.set(eventType, agent);
    }
  }

  return {
    byId: (agentId) => list.find((agent) => agent.id === agentId),
    forEventType: (eventType) => byType.get(eventType),
    list: () => list,
  };
}
