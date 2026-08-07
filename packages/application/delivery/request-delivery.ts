/**
 * الغرض: حالة الاستخدام الجوهرية لوحدة التوصيل: من طلب عميلٍ نصفِ مُدخَل إلى طلب حقيقي في
 *   orders بخدمة delivery، ثم بثّ العرض على سائقي التوصيل وحدهم عبر نفس مسار الإرسال.
 *   لا تكرار لمنطق المطابقة هنا: التمييز بين النقل والتوصيل يقع في domain/dispatch
 *   بحُكم driver_capabilities.service وخطة الاشتراك، ونحن نمرّر نوع الخدمة فقط.
 * الحالة: منفّذ فعلياً — المرحلة 2.2.
 * ينتمي إلى: application/delivery
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway (بوت العميل)، apps/workers، apps/admin-dashboard
 * ملاحظات مستقبلية: تسعير التوصيل يُضاف بـestimate-delivery-fare بقراءة platform_settings لا هنا.
 */

import {
  type DeliveryRequestError,
  type DeliveryRequestInput,
  makeDeliveryRequest,
} from "../../domain/delivery/index.ts";
import type { DriverId, OrderId } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { OrderWriter } from "../bots/types.ts";
import { type BroadcastDependencies, broadcastOffers } from "../dispatch/broadcast-offers.ts";
import type { MatchOrderError } from "../dispatch/match-order.ts";
import type { PortFailureError } from "../ports/index.ts";

export interface RequestDeliveryDependencies {
  readonly orders: OrderWriter;
  readonly matching: BroadcastDependencies;
}

export interface RequestDeliveryResult {
  readonly orderId: OrderId;
  /** السائقون الذين أُخطروا فعلاً. فارغة = الطلب قائم بلا سائق، ولا يُدَّعى غير ذلك. */
  readonly notified: readonly DriverId[];
  /**
   * سبب عدم فتح دورة بثّ، إن لم تُفتح. ليس فشلاً للطلب:
   * الطلب مكتوب ويبقى في searching لتتولّاه دورات العامل التالية.
   */
  readonly broadcastFailure: MatchOrderError | null;
}

export type RequestDeliveryError = DeliveryRequestError | PortFailureError;

/**
 * ينشئ طلب التوصيل ثم يحاول بثّه فوراً.
 * فشل البثّ لا يُلغي الطلب المكتوب: نعيد معرّفه وسبب عدم البثّ صراحةً بدل ابتلاع الخبر.
 */
export async function requestDelivery(
  input: DeliveryRequestInput,
  deps: RequestDeliveryDependencies,
): Promise<Result<RequestDeliveryResult, RequestDeliveryError>> {
  const request = makeDeliveryRequest(input);
  if (!request.ok) return request;

  const created = await deps.orders.create({
    cityId: request.value.cityId,
    riderId: request.value.riderId,
    service: request.value.service,
    pickup: request.value.pickup,
    dropoff: request.value.dropoff,
    // وصف الطرد يُحفظ مع الطلب: السائق ولوحة الإدارة يقرآنه من مصدر واحد
    notes: request.value.parcelDescription,
  });
  if (!created.ok) return created;

  const broadcast = await broadcastOffers({ orderId: created.value }, deps.matching);
  if (!broadcast.ok) {
    return ok({ orderId: created.value, notified: [], broadcastFailure: broadcast.error });
  }

  return ok({
    orderId: created.value,
    notified: broadcast.value.notified,
    broadcastFailure: null,
  });
}
