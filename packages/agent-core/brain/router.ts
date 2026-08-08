/**
 * الغرض: اختيار الوكيل الذي يتولّى الحدث. دور العقل هنا **التوجيه لا التنفيذ**.
 * الحالة: منفّذ فعلياً بقواعد صريحة — القسم 3، البند ب.2.
 * ينتمي إلى: packages/agent-core/brain
 * يُتوقع أن يستخدمه لاحقاً: core.ts
 * ملاحظات مستقبلية: عند مليار مستخدم يصير هذا موزّعاً: طابور لكل مستوى أولوية،
 *   وتوجيه إلى خدمة الوكيل عبر الشبكة، وضغط عكسي (backpressure) حين يمتلئ.
 *   **العقد `RoutingDecision` هو نفسه** — يتغيّر كيف يصل الحدث للوكيل لا من يقرّر.
 *
 * ═══ لماذا `switch` صريح لا جدولٌ مجرَّد ═══
 *
 * لأن الحالة الحقيقية اليوم: **نوع واحد له وكيل، وثلاثة محجوزة بلا وكيل.** جدولُ
 * توجيهٍ ديناميكي فوق هذا الواقع يُخفي بساطته خلف تجريدٍ لا يخدم شيئاً، ويجعل
 * قارئ الملف يظنّ أن هناك توجيهاً معقّداً يجري بينما لا يجري شيء. الـ`switch`
 * أدناه يقول الحقيقة كاملةً في عشرة أسطر: من له وكيل ومن لا.
 *
 * ملاحظة: `registry.forEventType` كافيةٌ تقنياً لهذا كلّه — والـ`switch` مكتوبٌ
 * فوقها **عمداً** لأنه المكان الذي يُقرأ فيه قرار «هذا النوع محجوز ولا يُوجَّه»
 * صراحةً، بدل أن يكون غياباً صامتاً في مصفوفة.
 */

import { SUPPORT_TICKET_AGENT_ID } from "../agents/ids.ts";
import type { AgentRegistry } from "../agents/registry.ts";
import type { EventPayload, RoutingDecision } from "../schemas.ts";
import { assessPriority } from "./priority.ts";

export function route(event: EventPayload, registry: AgentRegistry): RoutingDecision {
  const priority = assessPriority(event);

  switch (event.eventType) {
    case "support_ticket_opened": {
      const agent = registry.byId(SUPPORT_TICKET_AGENT_ID);
      if (agent === undefined) {
        // لا يقع اليوم — لكن سجلٌّ مُمرَّر في اختبار قد يكون فارغاً، وانهيار
        // التوجيه على سجلٍّ فارغ يُخفي عيب الاختبار خلف استثناء غامض.
        return {
          agentId: null,
          priority,
          rationale: "وكيل تذاكر الدعم غير مسجَّل في هذا السجلّ",
        };
      }
      return {
        agentId: agent.id,
        priority,
        rationale: `تذكرة دعم → ${agent.id} (أولوية ${priority.level})`,
      };
    }

    // ── الأنواع المحجوزة: معرَّفة في العقد، بلا وكيل، ولا تُوجَّه ─────────────
    case "operational_anomaly_detected":
    case "fraud_signal_raised":
    case "growth_opportunity_spotted":
      return {
        agentId: null,
        priority,
        rationale: `النوع ${event.eventType} محجوز — لا وكيل منفَّذ له في هذه المرحلة`,
      };

    default: {
      // `never` يجعل إضافة نوع حدث جديد في `schemas.ts` **خطأ ترجمة هنا**، فلا
      // يُضاف نوع ويُنسى توجيهه فيسقط صامتاً في حالة افتراضية.
      const exhaustive: never = event.eventType;
      return {
        agentId: null,
        priority,
        rationale: `نوع غير معروف للتوجيه: ${String(exhaustive)}`,
      };
    }
  }
}
