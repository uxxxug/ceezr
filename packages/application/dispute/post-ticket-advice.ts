/**
 * الغرض: طلب اقتراح من المستشار بعد نشر بطاقة التذكرة، ونشره **رسالةً منفصلة**
 *   في قروب الدعم. اقتراحٌ يُقرأ، لا فعلٌ يُنفَّذ.
 * الحالة: منفّذ فعلياً — القسم ج من أمر طبقة الذكاء الاصطناعي المعزولة.
 * ينتمي إلى: application/dispute
 * يُتوقع أن يستخدمه لاحقاً: bots/support-dialog، لوحة الإدارة
 * ملاحظات مستقبلية: يُضاف زرّان («مفيد» / «غير مفيد») تحت الاقتراح ليصير تسجيل
 *   النتيجة نقرةً بدل استنتاج. `traceId` مُمرَّر منذ الآن لهذا الغرض تحديداً.
 *
 * ═══ لماذا رسالة منفصلة لا سطر داخل البطاقة ═══
 *
 * لأن البطاقة هي **الوقائع**: هوية صاحبها، واشتراكه، ونصّه، وأزرار القرار. أمّا
 * الاقتراح فـ**ظنّ آلة**. دمجهما في رسالة واحدة يجعل الظنّ يبدو بوزن الواقعة أمام
 * موظّفٍ يقرأ مستعجلاً — وهذا أخطر ما في عرض اقتراحٍ آلي على بشر.
 *
 * ولأنّه منفصل: حذفه لا يمسّ البطاقة، وتعطيل الطبقة يعني ببساطة أن الرسالة الثانية
 * لا تُرسَل — وتبقى الأولى كما كانت حرفاً بحرف.
 *
 * ⚠️ **لا يُفشل شيئاً.** كل مسارات هذه الدالّة تعود بتقرير، ولا واحد منها يُرجِع
 * خطأً يوقف نداءه. فتحُ التذكرة ونشرُ بطاقتها تمّا قبل أن تُستدعى.
 */

import type { SupportTicketType } from "../../domain/dispute/index.ts";
import type { SupportTicketContextReader } from "./post-dispute-card.ts";
import type { TicketAdvisor } from "./ticket-advisor.ts";

/**
 * ما يُنشَر. **بنيةٌ لا نصّ** — التنسيق شأن infrastructure كما في `SupportCard`،
 * وهو ما يمنع نصّ العرض من التسرّب إلى طبقة التطبيق.
 */
export interface SupportAdviceCard {
  readonly groupId: string;
  readonly ticketId: string;
  readonly traceId: string;
  readonly classification: string | null;
  readonly suggestion: string;
  readonly confidence: number;
}

export interface SupportAdvicePublisher {
  /** لا يرمي: يُعيد `false` عند أي تعذّر. */
  publish(card: SupportAdviceCard): Promise<boolean>;
}

export interface PostTicketAdviceDependencies {
  readonly context: SupportTicketContextReader;
  readonly advisor: TicketAdvisor;
  readonly publisher: SupportAdvicePublisher;
}

export type AdviceSkipReason =
  | "TICKET_NOT_FOUND"
  | "CITY_GROUP_MISSING"
  | "NO_SUGGESTION"
  | "PUBLISH_FAILED"
  | "CONTEXT_UNAVAILABLE";

export interface PostAdviceReport {
  readonly posted: boolean;
  readonly traceId: string | null;
  readonly reason: AdviceSkipReason | null;
}

function skip(reason: AdviceSkipReason, traceId: string | null = null): PostAdviceReport {
  return { posted: false, traceId, reason };
}

export async function postTicketAdvice(
  input: { readonly ticketId: string; readonly type: SupportTicketType },
  deps: PostTicketAdviceDependencies,
): Promise<PostAdviceReport> {
  const context = await deps.context.read(input.ticketId);
  // خطأ القاعدة هنا ليس خطأ المسار: البطاقة نُشرت، والاقتراح كماليّ.
  if (!context.ok) return skip("CONTEXT_UNAVAILABLE");
  if (context.value === null) return skip("TICKET_NOT_FOUND");

  const { ticket, groupId } = context.value;
  if (groupId === null) return skip("CITY_GROUP_MISSING");

  const advice = await deps.advisor.advise({
    ticketId: input.ticketId,
    type: input.type,
    message: ticket.message,
    cityId: null,
    openedAt: new Date().toISOString(),
  });
  if (advice === null || advice.suggestion === null) return skip("NO_SUGGESTION");

  const published = await deps.publisher.publish({
    groupId,
    ticketId: input.ticketId,
    traceId: advice.traceId,
    classification: advice.classification,
    suggestion: advice.suggestion,
    confidence: advice.confidence,
  });

  return published
    ? { posted: true, traceId: advice.traceId, reason: null }
    : skip("PUBLISH_FAILED", advice.traceId);
}
