/**
 * الغرض: المحوِّل الرفيع الوحيد بين المشروع الأساسي وطبقة الذكاء الاصطناعي المعزولة.
 *   يترجم طلب المستشار إلى `EventPayload`، ويترجم `DecisionResult` إلى `TicketAdvice`.
 * الحالة: منفّذ فعلياً — القسم ج من أمر طبقة الذكاء الاصطناعي المعزولة.
 * ينتمي إلى: apps/gateway
 * يُتوقع أن يستخدمه لاحقاً: container.ts وحده
 * ملاحظات مستقبلية: حين تصير الطبقة خدمةً مستقلّة يتغيّر سطر `createAgentCore`
 *   إلى عميل HTTP، ولا يتغيّر شيء آخر في هذا الملف ولا خارجه.
 *
 * ═══ لماذا هذا الملف هنا لا في infrastructure ═══
 *
 * لأنه **مكان التركيب** لا مكان التنفيذ: هو الوحيد الذي يعرف الطرفين معاً. وضعُه
 * في `infrastructure` كان سيجعل تلك الطبقة تستورد `agent-core`، فينكسر اتجاه
 * الاعتماد الواحد المنصوص عليه في القسم صفر. `apps/gateway` هو الرأس الذي يجمع
 * كل شيء أصلاً، فاجتماعهما فيه لا يضيف التصاقاً جديداً.
 *
 * ⚠️ الاستيراد من `agent-core` هنا هو من `gateway.ts` وحده — يفرضه سكربت
 * `scripts/check-agent-core-isolation.ts` في CI.
 */

import type { AgentCoreGateway } from "../../../packages/agent-core/gateway.ts";
import { createAgentCore } from "../../../packages/agent-core/gateway.ts";
import type {
  SupportAdviceCard,
  SupportAdvicePublisher,
  TicketAdvice,
  TicketAdviceRequest,
  TicketAdvisor,
} from "../../../packages/application/dispute/index.ts";
import type { SupportSender } from "../../../packages/infrastructure/notification/telegram-support-notifier.ts";
import { DEFAULT_LANGUAGE, t } from "../../../packages/shared/i18n/index.ts";

/** نوع التذكرة في الدومين ↔ نوع الحدث في الطبقة. الترجمة هنا وحدها. */
const EVENT_TYPE = "support_ticket_opened";

export function createTicketAdvisor(core: AgentCoreGateway): TicketAdvisor {
  return {
    advise: async (request: TicketAdviceRequest): Promise<TicketAdvice | null> => {
      // الطبقة معطَّلة: لا استدعاء أصلاً. فحصٌ زائد عن فحص البوّابة عمداً — الحدّ
      // الذي يُفحص من الطرفين هو الذي يصمد حين يُعدَّل أحدهما.
      if (!core.enabled) return null;

      const decision = await core.process({
        eventId: request.ticketId,
        eventType: EVENT_TYPE,
        occurredAt: request.openedAt,
        source: "support_tickets",
        text: request.message,
        // **حقول بدائية فقط.** لا كائن تذكرة، ولا كيان دومين، ولا اتصال قاعدة.
        // هذا هو كل ما تعرفه الطبقة عن مشروعنا — وهو المقصود بـ«EventPayload وحده».
        attributes: {
          ticket_type: request.type,
          city_id: request.cityId,
        },
      });

      if (decision.status !== "suggested" || decision.recommendedAction === null) return null;

      return {
        traceId: decision.traceId,
        classification: decision.classification,
        suggestion: decision.recommendedAction,
        confidence: decision.confidence,
      };
    },
  };
}

/**
 * ناشر الاقتراح. **رسالة منفصلة بلا أزرار قرار** — أزرار البطاقة وحدها هي التي
 * تُغيّر حالة، وإلحاق زرٍّ باقتراحٍ آليّ كان سيجعل النقر عليه فعلاً لا مراجعة.
 */
export function createSupportAdvicePublisher(sender: SupportSender): SupportAdvicePublisher {
  return {
    publish: async (card: SupportAdviceCard): Promise<boolean> => {
      try {
        const tr = t(DEFAULT_LANGUAGE);
        const text = tr("support.advice_card", {
          ticket_short: card.ticketId.slice(0, 8),
          classification: card.classification ?? tr("support.advice_unclassified"),
          confidence: Math.round(card.confidence * 100),
          suggestion: card.suggestion,
        });
        const messageId = await sender.sendReturningId(card.groupId, text, undefined);
        return messageId !== null;
      } catch {
        return false;
      }
    },
  };
}

export { createAgentCore };
