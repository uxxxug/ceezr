/**
 * الغرض: رسائلُ تذكرةِ الدعم ([B] · R15) — `GET/POST /v1/support/tickets/:id/messages`
 *   (`apps/gateway/src/routes/support-tickets.ts` · DEC-43) — ونموذجُ عرضٍ نقيّ.
 * الحالة: منفّذ فعلياً — UI-3 / PR 5 (ADR 0238).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/settings
 *
 * ## حدُّ العقدِ كما هوَ (لا محادثةَ حيّةٌ مُختلَقة)
 *
 *   ــ `sender_type` في العقدِ `rider` | `driver` فقط: **لا ردَّ موظّفٍ في المحادثة**. ردُّ الفريقِ يصلُ
 *      حالةَ التذكرةِ وقرارَها (`resolution`) كما كانَ — فالشاشةُ تقولُ ذلك، ولا تَعِدُ بمحادثةٍ ثنائيّة.
 *   ــ لا تحديثَ حيٌّ ولا استطلاع: القراءةُ عندَ الفتحِ وبعدَ كلِّ إرسالٍ، و«تحديث» بزرٍّ صريح.
 *   ــ إغلاقُ التذكرةِ حكمُ الخادم (`TICKET_CLOSED`) — لا يُستنتَجُ من الحالةِ في الواجهة.
 */

import { apiFetch } from "../../../api/client.ts";

export const TICKET_MESSAGE_MAX = 2000;

export interface ApiTicketMessage {
  readonly id: string;
  readonly sender_type: string;
  readonly message: string;
  readonly created_at: string;
}

export interface TicketMessagesResponse {
  readonly ok: true;
  readonly messages: readonly ApiTicketMessage[];
}

export interface TicketThreadApi {
  readonly read: (ticketId: string) => Promise<TicketMessagesResponse>;
  readonly send: (
    ticketId: string,
    message: string,
  ) => Promise<{ readonly ok: true; readonly status: "added"; readonly message_id: string }>;
}

export const ticketThreadApi: TicketThreadApi = {
  read: (ticketId) =>
    apiFetch<TicketMessagesResponse>(
      `/v1/support/tickets/${encodeURIComponent(ticketId)}/messages`,
    ),
  send: (ticketId, message) =>
    apiFetch(`/v1/support/tickets/${encodeURIComponent(ticketId)}/messages`, {
      method: "POST",
      body: { message },
    }),
};

/** مرسلٌ يعرفُه العقد ⇒ مفتاحُه؛ والمجهولُ يُقالُ «غيرُ معروف» ولا يُنسَبُ إلى الراكب. */
export function senderKey(senderType: string): string {
  if (senderType === "rider") return "rider.support.thread.sender.rider";
  if (senderType === "driver") return "rider.support.thread.sender.driver";
  return "rider.support.thread.sender.unknown";
}

export function canSendMessage(message: string, busy: boolean): boolean {
  return !busy && message.trim().length > 0 && message.length <= TICKET_MESSAGE_MAX;
}

export function threadErrorKey(code: string): string {
  switch (code) {
    case "TICKET_CLOSED":
      return "rider.support.thread.error.closed";
    case "TICKET_NOT_FOUND":
      return "rider.support.thread.error.notFound";
    case "MESSAGE_EMPTY":
      return "rider.support.thread.error.empty";
    case "MESSAGE_TOO_LONG":
      return "rider.support.thread.error.tooLong";
    default:
      return "rider.support.thread.error.generic";
  }
}

/** لحظةُ الرسالةِ كما جاءَت (ISO) بصيغةٍ مقروءةٍ في منطقةِ الجهاز — والتالفةُ تُقالُ خامّاً لا تُخفى. */
export function messageTime(iso: string, locale: string, timeZone: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(ms));
  } catch {
    return iso;
  }
}
