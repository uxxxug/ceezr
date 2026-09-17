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

import { ActiveDeliveryExistsError } from "../../domain/delivery/errors.ts";
import {
  type DeliveryRequestError,
  type DeliveryRequestInput,
  makeDeliveryRequest,
} from "../../domain/delivery/index.ts";
import type { DriverId, OrderId } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import { type BroadcastDependencies, broadcastOffers } from "../dispatch/broadcast-offers.ts";
import type { MatchOrderError } from "../dispatch/match-order.ts";
import { PortFailureError } from "../ports/index.ts";
import type { RideRequestCommand } from "../transport/ride-request-ports.ts";

export interface RequestDeliveryDependencies {
  /** D-01: الإنشاءُ عبر `RideRequestCommand` الذرّيِّ الآمنِ لا الكتابةَ المباشرة. */
  readonly rides: RideRequestCommand;
  readonly matching: BroadcastDependencies;
}

export interface RequestDeliveryResult {
  readonly orderId: OrderId;
  /**
   * السائقون الذين فُتحَت لهم عروضٌ فعلاً — وكلُّ عرضٍ صُحِبَ بصفِّ إشعارٍ ذرّيٍّ في
   * معاملةِ open_offer_round نفسِها. «المعروضُ عليه» لا يعني «المُخبَر» بعد: الإرسالُ
   * غيرُ متزامنٍ يتولّاه عاملُ التسليم. فارغة = الطلب قائم بلا سائق، ولا يُدَّعى غير ذلك (BUG-004).
   */
  readonly offered: readonly DriverId[];
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
  /** مفتاحُ التكرارِ — حتميٌّ من `update_id` لا عشوائيٌّ (D-01). */
  idempotencyKey: string,
  telegramUserId: string,
): Promise<Result<RequestDeliveryResult, RequestDeliveryError>> {
  const request = makeDeliveryRequest(input);
  if (!request.ok) return request;

  const created = await deps.rides.create({
    telegramUserId,
    idempotencyKey,
    service: request.value.service,
    origin: { lat: request.value.pickup.latitude, lng: request.value.pickup.longitude },
    destination: { lat: request.value.dropoff.latitude, lng: request.value.dropoff.longitude },
    notes: request.value.parcelDescription,
  });
  if (!created.ok) {
    return { ok: false, error: new PortFailureError("rides", created.error.reason) };
  }

  if (!created.value.accepted) {
    // `ACTIVE_RIDE_EXISTS` رفضٌ مقيسٌ لا عطبٌ — نُعادُهُ صراحةً ليُعالِجَهُ المُستدعي.
    if (created.value.refusal === "ACTIVE_RIDE_EXISTS" && created.value.activeRide !== null) {
      return { ok: false, error: new ActiveDeliveryExistsError(created.value.activeRide.orderId) };
    }
    return { ok: false, error: new PortFailureError("rides", created.value.refusal) };
  }

  // `reused: true` = الأمرُ سُبِقَ — لا بثَّ ثانٍ.
  const orderId = created.value.ride.orderId as OrderId;
  if (created.value.ride.reused) {
    return ok({ orderId, offered: [], broadcastFailure: null });
  }

  const broadcast = await broadcastOffers({ orderId }, deps.matching);
  if (!broadcast.ok) {
    return ok({ orderId, offered: [], broadcastFailure: broadcast.error });
  }

  return ok({
    orderId,
    offered: broadcast.value.offered,
    broadcastFailure: null,
  });
}
