/**
 * الغرض: كتابة قرارات طبقة الذكاء الاصطناعي وأحكام البشر عليها في القاعدة، وقراءة
 *   القرار المرتبط بتذكرة. لا منطق أسبقية هنا — كلّه في `record_agent_outcome`.
 * الحالة: منفّذ فعلياً — أمر قياس جدوى الاقتراحات.
 * ينتمي إلى: infrastructure/dispute
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts، scripts/agent-core-report.ts
 * ملاحظات مستقبلية: حين يُقاس وكيل ثانٍ لا يتغيّر هذا الملف — الجدول لا يعرف الوكلاء.
 *
 * ⚠️ **لا يستورد من `packages/agent-core` ولا يعرف بوجودها.** ما يصله بنيةٌ من
 * طبقة التطبيق فقط، وهو ما يُبقي اتجاه الاعتماد الواحد سليماً — ويفحصه CI.
 */

import type {
  AgentDecisionRecord,
  AgentDecisionSnapshot,
  AgentMeasurementPort,
  AgentOutcomeInput,
  AgentOutcomeReport,
} from "../../application/dispute/index.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

export function createAgentMeasurementPort(sql: Sql): AgentMeasurementPort {
  return {
    saveDecision: (record: AgentDecisionRecord) =>
      guard("db.save_agent_decision", async (): Promise<void> => {
        // المدينة تُقرأ من التذكرة لا تُمرَّر: مصدرٌ واحد لها يمنع قراراً يُنسب لمدينة
        // غير مدينة تذكرته. والإدراج مشروطٌ بوجود التذكرة، فلا صفّ يتيم.
        await sql`
          insert into agent_decisions
            (city_id, trace_id, ticket_id, agent_id, classification,
             recommended_action, confidence, allowed_tool_level, published)
          select t.city_id,
                 ${record.traceId}::text,
                 t.id,
                 ${record.agentId}::text,
                 ${record.classification}::text,
                 ${record.recommendedAction}::text,
                 ${record.confidence}::numeric,
                 ${record.allowedToolLevel}::text,
                 ${record.published}::boolean
            from support_tickets t
           where t.id = ${record.ticketId}::uuid
          on conflict (trace_id) do nothing
        `;
      }),

    recordOutcome: (input: AgentOutcomeInput) =>
      guard("rpc.record_agent_outcome", async (): Promise<AgentOutcomeReport> => {
        const rows = await sql<{ result: unknown }[]>`
          select record_agent_outcome(
            ${input.traceId}::text,
            ${input.verdict}::text,
            ${input.source}::text,
            ${input.humanAction}::text,
            ${input.actorTelegramId}::bigint
          ) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) throw new Error("ردّ record_agent_outcome غير مفهوم");
        if (!envelope.ok) {
          return { recorded: false, reason: String(envelope.error ?? "UNKNOWN") };
        }
        const reason = envelope.reason;
        return {
          recorded: envelope.recorded === true,
          reason: reason === undefined || reason === null ? null : String(reason),
        };
      }),

    decisionForTicket: (ticketId: string) =>
      guard("db.agent_decision_for_ticket", async (): Promise<AgentDecisionSnapshot | null> => {
        const rows = await sql<{ trace_id: string; classification: string | null }[]>`
          select trace_id, classification
            from agent_decisions
           where ticket_id = ${ticketId}::uuid
           -- تذكرةٌ لها أكثر من قرار لا تحدث اليوم، والأحدث هو الذي عُرض على الفريق.
           order by created_at desc
           limit 1
        `;
        const row = rows[0];
        if (row === undefined) return null;
        return { traceId: row.trace_id, classification: row.classification };
      }),
  };
}
