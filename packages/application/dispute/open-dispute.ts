/**
 * الغرض: فتح تذكرة دعم أو نزاع من رسالة مستخدم، وإعادة معرّفها ومكان نشرها.
 *   لا يُنشر شيء هنا: النشر خطوة مستقلّة (post-dispute-card) لأنها تحتاج قراءة سياق حيّ.
 * الحالة: منفّذ فعلياً — المرحلة 2.4.
 * ينتمي إلى: application/dispute
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway (حواري السائق والعميل)، apps/admin-dashboard
 * ملاحظات مستقبلية: عند إضافة أنواع مرفقات أخرى (مستند، تسجيل صوتي) يتوسّع المرفق هنا وحده.
 */

import type { OpenTicketReason } from "../../domain/dispute/index.ts";
import {
  parseAttachmentId,
  parseSupportMessage,
  type SupportTicketType,
} from "../../domain/dispute/index.ts";
import type { CityId } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

export interface OpenTicketInput {
  /** معرّف تلغرام لصاحب الشكوى — البوت لا يعرف معرّفاتنا الداخلية. */
  readonly telegramUserId: string;
  readonly type: SupportTicketType;
  readonly message: string;
  readonly attachmentFileId?: string | null;
  readonly orderId?: string | null;
}

export interface OpenedTicket {
  readonly ticketId: string;
  readonly cityId: CityId;
  readonly groupId: string;
  readonly type: SupportTicketType;
}

export interface OpenTicketOutcome {
  readonly opened: OpenedTicket | null;
  readonly reason: OpenTicketReason | null;
  /** ثوانٍ حتى يُسمح بتذكرة أخرى — تُملأ مع COOLDOWN_ACTIVE وحدها. */
  readonly retryAfterSeconds: number | null;
}

/** المنفذ يقابل الدالة الذرّية open_support_ticket حرفاً بحرف. */
export interface SupportTicketPort {
  open(input: {
    readonly telegramUserId: string;
    readonly type: SupportTicketType;
    readonly message: string;
    readonly attachmentFileId: string | null;
    readonly orderId: string | null;
  }): Promise<Result<OpenTicketOutcome, PortFailureError>>;
}

export interface OpenDisputeDependencies {
  readonly tickets: SupportTicketPort;
}

export type MessageRejection = "too_short" | "too_long" | "is_command";

export interface OpenTicketReport {
  readonly opened: OpenedTicket | null;
  /** سبب من القاعدة (حدّ التكرار، مدينة بلا قروب…). */
  readonly reason: OpenTicketReason | null;
  /** سبب من الدومين: النصّ نفسه غير مقبول، فلم نصل للقاعدة أصلاً. */
  readonly rejection: MessageRejection | null;
  readonly retryAfterSeconds: number | null;
}

/**
 * التحقّق من النصّ قبل ملامسة القاعدة مقصود: تذكرة بنصّ «مشكلة» تُهدر دورة دعم كاملة،
 * ورفضها فوراً برسالة واضحة أرخص من فتحها ثم إغلاقها بسؤال.
 */
export async function openSupportTicket(
  input: OpenTicketInput,
  deps: OpenDisputeDependencies,
): Promise<Result<OpenTicketReport, PortFailureError>> {
  const parsed = parseSupportMessage(input.message);
  if (!parsed.ok) {
    return ok({
      opened: null,
      reason: null,
      rejection: parsed.error.reason,
      retryAfterSeconds: null,
    });
  }

  const opened = await deps.tickets.open({
    telegramUserId: input.telegramUserId,
    type: input.type,
    message: parsed.value,
    attachmentFileId: parseAttachmentId(input.attachmentFileId),
    orderId: input.orderId ?? null,
  });
  if (!opened.ok) return opened;

  return ok({
    opened: opened.value.opened,
    reason: opened.value.reason,
    rejection: null,
    retryAfterSeconds: opened.value.retryAfterSeconds,
  });
}
