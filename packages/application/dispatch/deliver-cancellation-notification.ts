/**
 * الغرض: معالجُ إخطارِ إلغاءِ الطلبِ للسائقينِ في صندوقِ الصادرِ الموحَّدِ (BUG-004).
 *   لكلِّ سائقٍ يعنيه الأمرُ صفٌّ خاصٌّ به، فمَن وصلَه الإخطارُ لا يصلُه ثانيةً حينَ
 *   يُعادُ إخطارُ غيرِه. ومعرّفُ المحادثةِ واللغةُ يأتيانِ في الحمولةِ كما قرأتهما
 *   القاعدةُ حيَّينِ لحظةَ الالتقاطِ، أمّا `was_assigned` فهو وصفُ حالِ السائقِ حينَ
 *   أُلغيَ الطلبُ فيُحفَظُ في الحمولةِ: الطلبُ صار `cancelled` فلا يُستخرَجُ منه بعدَها
 *   مَن كان مُسنَدًا، والفرقُ بين النصَّينِ فرقُ صدقٍ لا تجميلٌ.
 * الحالة: منفّذ فعلياً — 2026-09-06.
 * ينتمي إلى: application/dispatch
 * يُستخدم من: apps/workers/src/jobs/deliver-notifications.ts
 * ملاحظات مستقبلية: نصُّ الرسالةِ في طبقةِ البنيةِ بلغةِ السائقِ وبلا لوحةِ أزرارٍ.
 */
import type { DriverId, OrderId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import { ok } from "../../shared/result/index.ts";
import type { NotificationHandler } from "../notification/deliver-notification.ts";
import type { PortFailureError } from "../ports/index.ts";

/**
 * ما يحتاجُه النصُّ ولا شيءَ سواه. والمُسنَدُ يُخاطَبُ بغيرِ ما يُخاطَبُ به صاحبُ عرضٍ
 * معلَّقٍ: أحدُهما كان في طريقِه فعلًا، والآخرُ لم يقبلْ بعد.
 */
export interface CancellationNotice {
  readonly orderId: OrderId;
  readonly driverId: DriverId;
  readonly chatId: string;
  readonly language: string;
  readonly wasAssigned: boolean;
}

export interface CancellationMessenger {
  /** يُخبِرُ السائقَ أنَّ الطلبَ أُلغي — بلا أزرارٍ، فلا فعلَ بقيَ له. */
  sendOrderCancelled(notice: CancellationNotice): Promise<Result<string | null, PortFailureError>>;
}

/**
 * قراءةُ الإخطارِ من الحمولةِ. الرجوعُ بـnull يعني أنّ الصفَّ لن يُقبلَ أبدًا: سائقٌ
 * لا محادثةَ له لحظةَ الالتقاطِ — حُذِفَ حسابُه أو لم يُوجَد — والإعادةُ في هذا الحالِ
 * تكرارٌ بلا رجاءِ نجاحٍ.
 */
function readNotice(payload: Readonly<Record<string, unknown>>): CancellationNotice | null {
  const orderId = payload.order_id;
  const driverId = payload.driver_id;
  const chatId = payload.chat_id;
  const language = payload.language;
  if (typeof orderId !== "string" || orderId === "") return null;
  if (typeof driverId !== "string" || driverId === "") return null;
  if (typeof chatId !== "string" || chatId === "") return null;
  return {
    orderId: orderId as OrderId,
    driverId: driverId as DriverId,
    chatId,
    language: typeof language === "string" && language !== "" ? language : "ar",
    wasAssigned: payload.was_assigned === true,
  };
}

export function createOrderCancelledHandler(messenger: CancellationMessenger): NotificationHandler {
  return async (delivery) => {
    const notice = readNotice(delivery.payload);
    if (notice === null) return ok({ abandon: true, messageId: null, failure: null });
    const sent = await messenger.sendOrderCancelled(notice);
    return ok({
      abandon: false,
      messageId: sent.ok ? sent.value : null,
      failure: sent.ok ? null : sent.error.detail,
    });
  };
}
