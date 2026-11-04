/**
 * الغرض: معالجُ إخطارِ السائقِ بالتدخّلِ الإداريِّ (`WR-42`) في صندوقِ الصادرِ
 *   الموحَّدِ. الإلغاءُ الكائنُ يقولُ «ألغى العميلُ»، وهذا في التدخّلِ كذبٌ
 *   صريحٌ؛ فالنوعُ الجديدُ يُخبِرُ السائقَ بيدِ مَن قُطِعَت رحلتُه أو أُنهِيَت،
 *   وبالسببِ الذي كتبَهُ المشرفُ، وبلا لوحةِ أزرارٍ: القرارُ اتُّخِذَ ولا فعلَ بقيَ
 *   له، والدعمُ هو جهةُ السؤالِ.
 * الحالة: منفّذ فعلياً — 2026-11-04 (`WR-42`).
 * ينتمي إلى: application/dispatch
 * يُستخدم من: apps/workers/src/container.ts (عاملُ صندوقِ الصادرِ)
 * ملاحظات مستقبلية: لا شيءَ — أصنافُ تدخّلٍ جديدةٌ تُضافُ في القاعدةِ والقاموسِ
 *   لا هنا: هذا المعالجُ يقرأُ `action` ولا يعرفُ شكلَها.
 */
import type { DriverId, OrderId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import { ok } from "../../shared/result/index.ts";
import type { NotificationHandler } from "../notification/deliver-notification.ts";
import type { PortFailureError } from "../ports/index.ts";

/** ما يحتاجُهُ النصُّ ولا شيءَ سواه. */
export interface AdminInterventionNotice {
  readonly orderId: OrderId;
  readonly driverId: DriverId;
  readonly chatId: string;
  readonly language: string;
  readonly action: "cancel" | "complete";
  readonly reason: string | null;
  readonly wasStatus: string | null;
}

export interface AdminInterventionMessenger {
  /** يُخبِرُ السائقَ بتدخّلٍ إداريٍّ في رحلتِهِ — بلا أزرارٍ، فلا فعلَ بقيَ له. */
  sendAdminIntervention(
    notice: AdminInterventionNotice,
  ): Promise<Result<string | null, PortFailureError>>;
}

/**
 * قراءةُ الإخطارِ من الحمولةِ. الرجوعُ بـnull يعني أنّ الصفَّ لن يُقبلَ أبدًا:
 * سائقٌ لا محادثةَ له لحظةَ الالتقاطِ، والإعادةُ في هذا الحالِ تكرارٌ بلا
 * رجاءِ نجاحٍ.
 */
function readNotice(payload: Readonly<Record<string, unknown>>): AdminInterventionNotice | null {
  const orderId = payload.order_id;
  const driverId = payload.driver_id;
  const chatId = payload.chat_id;
  const language = payload.language;
  const action = payload.action;
  if (typeof orderId !== "string" || orderId === "") return null;
  if (typeof driverId !== "string" || driverId === "") return null;
  if (typeof chatId !== "string" || chatId === "") return null;
  if (action !== "cancel" && action !== "complete") return null;
  return {
    orderId: orderId as OrderId,
    driverId: driverId as DriverId,
    chatId,
    language: typeof language === "string" && language !== "" ? language : "ar",
    action,
    reason: typeof payload.reason === "string" && payload.reason !== "" ? payload.reason : null,
    wasStatus:
      typeof payload.was_status === "string" && payload.was_status !== ""
        ? payload.was_status
        : null,
  };
}

export function createAdminInterventionHandler(
  messenger: AdminInterventionMessenger,
): NotificationHandler {
  return async (delivery) => {
    const notice = readNotice(delivery.payload);
    if (notice === null) return ok({ abandon: true, messageId: null, failure: null });
    const sent = await messenger.sendAdminIntervention(notice);
    return ok({
      abandon: false,
      messageId: sent.ok ? sent.value : null,
      failure: sent.ok ? null : sent.error.detail,
    });
  };
}
