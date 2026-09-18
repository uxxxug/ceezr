/**
 * الغرض: معالجُ بلاغِ المفقودِ للسائقِ في صندوقِ الصادرِ (`F12-07`). راكبٌ فقدَ
 *   شيئاً في رحلةٍ منتهيةٍ مُسنَدٍ سائقُها، فأُودِعَ بلاغٌ موجَّهٌ إلى محادثةِ ذلكَ
 *   السائقِ داخلَ معاملةِ فتحِ التذكرةِ. والمعالجُ يقرأُ محادثةَ السائقِ ولغتَهُ
 *   ومرجعَ التذكرةِ من الحمولةِ كما قرأتها القاعدةُ حيّةً لحظةَ الالتقاطِ، ويُرسلُ
 *   النصَّ من القاموسِ بلغةِ السائقِ وبلا لوحةِ أزرارٍ: الفعلُ «فتِّشْ سيّارتَك»
 *   لا ينتظرُ زرّاً.
 * الحالة: منفّذ فعلياً — 2026-09-18، البند `F12-07`.
 * ينتمي إلى: application/dispatch
 * يُستخدم من: apps/workers/src/container.ts (عاملُ صندوقِ الصادرِ)
 * ملاحظات مستقبلية: لا شيءَ — البندُ إيداعُ البلاغِ وحسبُ، ولا سيرَ إرجاعٍ هنا.
 */
import type { DriverId, OrderId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import { ok } from "../../shared/result/index.ts";
import type { NotificationHandler } from "../notification/deliver-notification.ts";
import type { PortFailureError } from "../ports/index.ts";

/**
 * ما يحتاجُه النصُّ ولا شيءَ سواه. والمرجعُ المنطوقُ للتذكرةِ يُخاطَبُ به السائقُ
 * فيردَّ إن وجدَ شيئاً — لا معرّفٌ صمّاءٌ.
 */
export interface LostItemNotice {
  readonly orderId: OrderId;
  readonly driverId: DriverId;
  readonly chatId: string;
  readonly language: string;
  readonly ticketId: string;
  readonly reference: string;
}

export interface LostItemMessenger {
  /** يُخبِرُ السائقَ ببلاغِ مفقودٍ في رحلتِه — بلا أزرارٍ، فلا فعلَ ينتظرُ موافقةً. */
  sendLostItemReport(notice: LostItemNotice): Promise<Result<string | null, PortFailureError>>;
}

/**
 * قراءةُ البلاغِ من الحمولةِ. الرجوعُ بـnull يعني أنَّ الصفَّ لن يُقبلَ أبدًا: سائقٌ
 * لا محادثةَ له لحظةَ الالتقاطِ — حُذِفَ حسابُه أو لم يُوجَد — والإعادةُ في هذا
 * الحالِ تكرارٌ بلا رجاءِ نجاحٍ.
 */
function readNotice(payload: Readonly<Record<string, unknown>>): LostItemNotice | null {
  const orderId = payload.order_id;
  const driverId = payload.driver_id;
  const chatId = payload.chat_id;
  const language = payload.language;
  const ticketId = payload.ticket_id;
  const reference = payload.reference;
  if (typeof orderId !== "string" || orderId === "") return null;
  if (typeof driverId !== "string" || driverId === "") return null;
  if (typeof chatId !== "string" || chatId === "") return null;
  if (typeof ticketId !== "string" || ticketId === "") return null;
  return {
    orderId: orderId as OrderId,
    driverId: driverId as DriverId,
    chatId,
    language: typeof language === "string" && language !== "" ? language : "ar",
    ticketId,
    reference: typeof reference === "string" ? reference : ticketId,
  };
}

export function createLostItemReportHandler(messenger: LostItemMessenger): NotificationHandler {
  return async (delivery) => {
    const notice = readNotice(delivery.payload);
    if (notice === null) return ok({ abandon: true, messageId: null, failure: null });
    const sent = await messenger.sendLostItemReport(notice);
    return ok({
      abandon: false,
      messageId: sent.ok ? sent.value : null,
      failure: sent.ok ? null : sent.error.detail,
    });
  };
}
