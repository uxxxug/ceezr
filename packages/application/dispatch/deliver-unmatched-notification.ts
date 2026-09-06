/**
 * الغرض: معالجا إخطارَي صاحبِ الطلبِ العالقِ في صندوقِ الصادرِ الموحَّدِ (BUG-004):
 *   «الانتقالُ إلى دائرةٍ أوسعَ» و«لا سائقَ». المُستلِمُ واحدٌ — صاحبُ الطلبِ — فصفٌّ
 *   واحدٌ لكلِّ خبرٍ، ومفتاحُ منعِ التكرارِ بالطلبِ نفسِه: خبرُ الدائرةِ الأوسعِ يقعُ
 *   مرّةً واحدةً عندَ الدورةِ الأولى، وخبرُ «لا سائقَ» عندَ أوّلِ تسليمٍ لبطاقةِ
 *   الإسنادِ لا في كلِّ شوطٍ. ومعرّفُ المحادثةِ واللغةُ ونوعُ الخدمةِ تأتي في الحمولةِ
 *   كما قرأتها القاعدةُ حيّةً لحظةَ الالتقاطِ لا كما كانت لحظةَ الإيداعِ.
 * الحالة: منفّذ فعلياً — 2026-09-06.
 * ينتمي إلى: application/dispatch
 * يُستخدم من: apps/workers/src/jobs/deliver-notifications.ts
 * ملاحظات مستقبلية: نصُّ كلِّ رسالةٍ وزرُّ الإلغاءِ في طبقةِ البنيةِ بلغةِ صاحبِها.
 */
import type { OrderId, ServiceType } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import { ok } from "../../shared/result/index.ts";
import type { NotificationHandler } from "../notification/deliver-notification.ts";
import type { PortFailureError } from "../ports/index.ts";

/**
 * ما يحتاجُه النصُّ ولا شيءَ سواه. نوعُ الخدمةِ حاضرٌ لأنَّ نصَّ «لا سائقَ» في
 * التوصيلِ غيرُ نصِّه في النقلِ، ولو غابَ لقيلَ لصاحبِ طردٍ «لم نجد سائقاً لرحلتِك».
 */
export interface UnmatchedRiderNotice {
  readonly orderId: OrderId;
  readonly chatId: string;
  readonly language: string;
  readonly service: ServiceType;
}

export interface UnmatchedRiderMessenger {
  /** يُخبِرُ صاحبَ الطلبِ أنَّ طلبَه عُرِضَ على دائرةٍ أوسعَ، وأنَّ الإلغاءَ بزرٍّ. */
  sendWiderCircleOpened(
    notice: UnmatchedRiderNotice,
  ): Promise<Result<string | null, PortFailureError>>;
  sendNoDriverFound(notice: UnmatchedRiderNotice): Promise<Result<string | null, PortFailureError>>;
}

/**
 * قراءةُ الخبرِ من الحمولةِ. الرجوعُ بـnull يعني أنّ الصفَّ لن يُقبلَ أبدًا: لا
 * محادثةَ لصاحبِ الطلبِ، أو الطلبُ لم يُوجَد لحظةَ الالتقاطِ فلا مصدرَ للإغناءِ.
 * الإعادةُ في هذه الحالِ تكرارٌ بلا رجاءِ نجاحٍ.
 */
function readNotice(payload: Readonly<Record<string, unknown>>): UnmatchedRiderNotice | null {
  const orderId = payload.order_id;
  const chatId = payload.chat_id;
  const language = payload.language;
  const service = payload.service;
  if (typeof orderId !== "string" || orderId === "") return null;
  if (typeof chatId !== "string" || chatId === "") return null;
  if (service !== "transport" && service !== "delivery") return null;
  return {
    orderId: orderId as OrderId,
    chatId,
    language: typeof language === "string" && language !== "" ? language : "ar",
    service,
  };
}

/** نتيجةُ الإرسالِ إلى حكمٍ على الصفِّ: معرّفٌ حقيقيٌّ أو سببُ فشلٍ مُعلَنٌ. */
function outcomeOf(sent: Result<string | null, PortFailureError>) {
  return ok({
    abandon: false,
    messageId: sent.ok ? sent.value : null,
    failure: sent.ok ? null : sent.error.detail,
  });
}

export function createWiderCircleOpenedHandler(
  messenger: UnmatchedRiderMessenger,
): NotificationHandler {
  return async (delivery) => {
    const notice = readNotice(delivery.payload);
    if (notice === null) return ok({ abandon: true, messageId: null, failure: null });
    return outcomeOf(await messenger.sendWiderCircleOpened(notice));
  };
}

export function createNoDriverFoundHandler(
  messenger: UnmatchedRiderMessenger,
): NotificationHandler {
  return async (delivery) => {
    const notice = readNotice(delivery.payload);
    if (notice === null) return ok({ abandon: true, messageId: null, failure: null });
    return outcomeOf(await messenger.sendNoDriverFound(notice));
  };
}
