/**
 * الغرض: معالجاتُ أنواعِ دورةِ غيرِ المشتركينِ في صندوقِ الصادرِ الموحَّدِ (BUG-004):
 *   فتحُ الدورِ، وإغلاقُه، والاتفاقُ. الصفُّ لمُستلِمٍ واحدٍ لا لحادثةٍ: إخطارُ الدورِ
 *   يخصُّ طرفَينِ، ولكلِّ طرفٍ رسالتُه ومعرّفُها ومحاولاتُها. ولو جُمِعَ الطرفانِ في
 *   صفٍّ واحدٍ لكانَ فشلُ إحدى الرسالتَينِ يُعيدُ إرسالَ الأخرى — أثرٌ مكرَّرٌ على
 *   مُستلِمٍ وصلَه أصلاً، وهو ما يمنعُه العقدُ المنشورُ لا يُتساهَلُ فيه.
 *   ومعرّفُ المحادثةِ واللغةُ وثوانيَ المهلةِ تأتي في الحمولةِ كما قرأتها القاعدةُ
 *   حيّةً لحظةَ الالتقاطِ لا كما كانت لحظةَ الإيداعِ.
 * الحالة: منفّذ فعلياً — 2026-09-06.
 * ينتمي إلى: application/dispatch
 * يُستخدم من: apps/workers/src/jobs/deliver-notifications.ts
 * ملاحظات مستقبلية: نصُّ كلِّ رسالةٍ وأزرارُها في طبقةِ البنيةِ بلغةِ صاحبِها.
 */
import type { Result } from "../../shared/result/index.ts";
import { ok } from "../../shared/result/index.ts";
import type { NotificationHandler } from "../notification/deliver-notification.ts";
import type { PortFailureError } from "../ports/index.ts";

/** جهةُ الرسالةِ: طرفٌ واحدٌ بمحادثتِه ولغتِه هو، لا بلغةِ الطرفِ الآخر. */
export interface NegotiationSideNotice {
  readonly side: "driver" | "rider";
  readonly chatId: string;
  readonly language: string;
  readonly negotiationId: string;
  readonly position: number;
  readonly deadlineSeconds: number;
}

/** إغلاقُ الدورِ سببانِ لا ثالثَ لهما، ونصُّ الرسالةِ يختلفُ بهما. */
export type TurnClosedReason = "declined" | "expired";

export interface NegotiationMessenger {
  /** يفتحُ الدورَ لطرفٍ، ويعطي العميلَ زرّي «تم الاتفاق» و«غير مناسب». */
  sendTurnOpened(notice: NegotiationSideNotice): Promise<Result<string | null, PortFailureError>>;
  sendTurnClosed(
    notice: NegotiationSideNotice,
    reason: TurnClosedReason,
  ): Promise<Result<string | null, PortFailureError>>;
  sendAgreed(notice: NegotiationSideNotice): Promise<Result<string | null, PortFailureError>>;
}

function readNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * قراءةُ الجهةِ من الحمولةِ. الرجوعُ بـnull يعني أنّ الأثرَ لن يُقبلَ أبدًا: لا
 * محادثةَ للمُستلِمِ، أو المطالبةُ التي أُودِعَ لها الصفُّ لم تُوجَد لحظةَ الالتقاطِ
 * فلا مصدرَ للإغناءِ. الإعادةُ في هذه الحالِ تكرارٌ بلا رجاءِ نجاحٍ.
 */
function readNotice(payload: Readonly<Record<string, unknown>>): NegotiationSideNotice | null {
  const side = payload.side;
  const chatId = payload.chat_id;
  const language = payload.language;
  const negotiationId = payload.negotiation_id;
  const position = readNumber(payload.position);
  const deadlineSeconds = readNumber(payload.deadline_seconds);
  if (side !== "driver" && side !== "rider") return null;
  if (typeof chatId !== "string" || chatId === "") return null;
  if (typeof negotiationId !== "string" || negotiationId === "") return null;
  if (position === null || deadlineSeconds === null) return null;
  return {
    side,
    chatId,
    language: typeof language === "string" && language !== "" ? language : "ar",
    negotiationId,
    position,
    deadlineSeconds,
  };
}

/** نتيجةُ النشرِ إلى حكمٍ على الصفِّ: معرّفٌ حقيقيٌّ أو سببُ فشلٍ مُعلَنٌ. */
function outcomeOf(sent: Result<string | null, PortFailureError>) {
  return ok({
    abandon: false,
    messageId: sent.ok ? sent.value : null,
    failure: sent.ok ? null : sent.error.detail,
  });
}

export function createTurnOpenedHandler(messenger: NegotiationMessenger): NotificationHandler {
  return async (delivery) => {
    const notice = readNotice(delivery.payload);
    if (notice === null) return ok({ abandon: true, messageId: null, failure: null });
    return outcomeOf(await messenger.sendTurnOpened(notice));
  };
}

export function createTurnClosedHandler(messenger: NegotiationMessenger): NotificationHandler {
  return async (delivery) => {
    const notice = readNotice(delivery.payload);
    const reason = delivery.payload.reason;
    if (notice === null || (reason !== "declined" && reason !== "expired")) {
      return ok({ abandon: true, messageId: null, failure: null });
    }
    return outcomeOf(await messenger.sendTurnClosed(notice, reason));
  };
}

export function createAgreedHandler(messenger: NegotiationMessenger): NotificationHandler {
  return async (delivery) => {
    const notice = readNotice(delivery.payload);
    if (notice === null) return ok({ abandon: true, messageId: null, failure: null });
    return outcomeOf(await messenger.sendAgreed(notice));
  };
}
