/**
 * الغرض: بناء بطاقة التذكرة ونشرها في قروب الدعم، ثم حفظ معرّف رسالتها.
 *   البطاقة تُبنى من سياق يُقرأ الآن: حالة الاشتراك في البطاقة هي حالته لحظة الإرسال.
 * الحالة: منفّذ فعلياً — المرحلة 2.4.
 * ينتمي إلى: application/dispute
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway (بعد فتح التذكرة)، أي مسار إعادة نشر لاحق
 * ملاحظات مستقبلية: عند إضافة لوحة الإدارة تُعاد استخدام نفس القارئ لعرض التذكرة.
 */

import type { SupportResolution } from "../../domain/dispute/index.ts";
import { availableActions, type SupportTicket } from "../../domain/dispute/index.ts";
import type { Result } from "../../shared/result/index.ts";
import { ok } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

/** يقابل get_support_ticket_context: كل ما تعرضه البطاقة، مقروءاً في هذه اللحظة. */
export interface SupportTicketContextReader {
  read(ticketId: string): Promise<Result<SupportTicketContext | null, PortFailureError>>;
}

export interface SupportTicketContext {
  readonly ticket: SupportTicket;
  readonly groupId: string | null;
}

export interface SupportCard {
  readonly groupId: string;
  readonly ticket: SupportTicket;
  readonly actions: readonly (SupportResolution | "claim")[];
}

/**
 * النَّاشر يُعيد معرّف الرسالة لأن البطاقة تُحدَّث لاحقاً عند الاستلام والحلّ
 * بدل تكديس رسائل جديدة في القروب على كل خطوة.
 */
export interface SupportCardPublisher {
  publish(card: SupportCard): Promise<Result<string | null, PortFailureError>>;
}

export interface SupportCardRecorder {
  attach(ticketId: string, messageId: string): Promise<Result<void, PortFailureError>>;
}

export interface PostDisputeCardDependencies {
  readonly context: SupportTicketContextReader;
  readonly publisher: SupportCardPublisher;
  readonly recorder: SupportCardRecorder;
}

export type PostCardReason = "TICKET_NOT_FOUND" | "CITY_GROUP_MISSING" | "PUBLISH_FAILED";

export interface PostCardReport {
  readonly posted: boolean;
  readonly messageId: string | null;
  readonly reason: PostCardReason | null;
}

export async function postDisputeCard(
  input: { readonly ticketId: string },
  deps: PostDisputeCardDependencies,
): Promise<Result<PostCardReport, PortFailureError>> {
  const context = await deps.context.read(input.ticketId);
  if (!context.ok) return context;
  if (context.value === null) {
    return ok({ posted: false, messageId: null, reason: "TICKET_NOT_FOUND" });
  }

  const { ticket, groupId } = context.value;
  if (groupId === null) {
    return ok({ posted: false, messageId: null, reason: "CITY_GROUP_MISSING" });
  }

  const published = await deps.publisher.publish({
    groupId,
    ticket,
    actions: availableActions(ticket),
  });
  if (!published.ok) return published;
  if (published.value === null) {
    // البطاقة لم تُنشر: لا نحفظ معرّفاً وهمياً ولا نُعلن نجاحاً
    return ok({ posted: false, messageId: null, reason: "PUBLISH_FAILED" });
  }

  // فشل الحفظ لا يُبطل النشر: البطاقة أمام الفريق فعلاً، وغياب المعرّف يعني
  // أن التحديث اللاحق سيُرسِل رسالة جديدة بدل التعديل — وهذا تدهور مقبول لا فقدان حالة.
  const attached = await deps.recorder.attach(input.ticketId, published.value);
  if (!attached.ok) return attached;

  return ok({ posted: true, messageId: published.value, reason: null });
}
