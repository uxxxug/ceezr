/**
 * الغرض: محوّلات مقاييس لمنافذ التوزيع الفعلية: فتح العروض وقبولها وانتهاؤها وغياب
 *   سائق؛ تُحقن عند تركيب الحاوية ولا تنقل أي سياسة توزيع إلى طبقة المراقبة.
 * الحالة: منفّذ فعلياً — يحتاج تركيبه في container.ts من الوكيل الرئيسي.
 * ينتمي إلى: apps/gateway/src/observability
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts وapps/workers/src/container.ts.
 * ملاحظات مستقبلية: نتيجة RPC هي مصدر العدّ، لا رسالة Telegram التي قد تفشل بعد الكتابة.
 */

import type { OfferWriter } from "../../../../packages/application/dispatch/broadcast-offers.ts";
import type { ExpireOffersRpcPort } from "../../../../packages/application/dispatch/expire-offers-ports.ts";
import type { DispatchRpcPort } from "../../../../packages/application/ports/index.ts";
import type { OperationalMetrics } from "../../../../packages/infrastructure/observability/index.ts";

export function instrumentOfferWriter(
  writer: OfferWriter,
  metrics: OperationalMetrics,
): OfferWriter {
  return {
    openRound: async (input) => {
      metrics.recordDispatchRequest();
      const result = await writer.openRound(input);
      if (result.ok) metrics.recordDispatchOffersSent(input.entries.length);
      return result;
    },
  };
}

export function instrumentDispatchRpc(
  dispatch: DispatchRpcPort,
  metrics: OperationalMetrics,
): DispatchRpcPort {
  return {
    claimRide: async (orderId, driverId) => {
      const result = await dispatch.claimRide(orderId, driverId);
      if (result.ok && result.value.claimed) metrics.recordDispatchOfferAccepted();
      return result;
    },
  };
}

export function instrumentExpireOffersRpc(
  rpc: ExpireOffersRpcPort,
  metrics: OperationalMetrics,
): ExpireOffersRpcPort {
  return {
    expireStaleOffers: async (cityId, offerIds) => {
      const result = await rpc.expireStaleOffers(cityId, offerIds);
      if (result.ok) metrics.recordDispatchOfferTimedOut(result.value);
      return result;
    },
  };
}

/** يُستدعى عند موضع قرار المطابقة الذي يثبت أنه لا يوجد سائق مؤهل. */
export function recordNoEligibleDriver(metrics: OperationalMetrics): void {
  metrics.recordDispatchNoDriver();
}
