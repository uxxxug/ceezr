/**
 * الغرض: منفذُ Mini App لإشعاراتِ أطوارِ رحلةِ الراكبِ — ADR 0287 (التكليفُ
 *   السابعُ لـ LOAD-01). مرآةُ `offer-board-delivery.ts` للسائقِ: إيصالٌ منَ
 *   العميلِ بعدَ تطبيقِ الحدثِ، وإشارةٌ لغرفةِ الراكبِ في القناةِ الآنيةِ.
 * الحالة: منفَّذٌ فعليّاً.
 * ينتمي إلى: infrastructure/notification
 * يُستخدم من: `apps/workers/src/container.ts` (حقنُ `app` في معالجِ إشعارِ الراكبِ).
 *
 * ## قراراتٌ معلنةٌ
 *
 *   ــ **الإيصالُ = إقرارُ العميلِ**: `findReceipt` يقرأُ `rider_trip_event_receipts`
 *      الذي لا يكتبُه إلا نداءُ الإقرارِ (`POST /v1/rides/:id/trip-events/ack`)
 *      بعدَ أن يطبّقَ العميلُ الحدثَ. لا البثُّ ولا قراءةُ القائمةِ.
 *   ــ **فشلُ القراءةِ أو الإشارةِ ليسَ تسليمًا ولا فشلَ صفٍّ**: يُعادُ `null`/`false`
 *      فيذهبُ الحدثُ إلى تيليجرامَ احتياطًا — لا يُدّعى وصولٌ لم يُقَس.
 *   ــ **السرُّ لا يُسجَّلُ**: ما يُسجَّلُ المآلُ والحالةُ لا الترويسةُ.
 */

import type { RiderTripAppDelivery } from "../../application/dispatch/deliver-rider-trip-notice.ts";
import { createGuardedFetch } from "../../shared/wasla/egress-gate.ts";
import type { Sql } from "../db/client.ts";
import { fanoutSignal, signalTargets } from "./internal-signal-fanout.ts";

/** مهلةُ نداءِ الإشارةِ: قصيرةٌ كي لا يُعلَّقَ الشوطُ على بوابةٍ بطيئةٍ. */
const SIGNAL_TIMEOUT_MS = 2_000;

export interface RiderTripAppDeliveryDeps {
  readonly sql: Sql;
  /** غيابُه أو غيابُ السرِّ = الإشارةُ معطَّلةٌ (تيليجرامُ كما كانَ). */
  readonly gatewayInternalUrl: string | readonly string[] | null;
  readonly secret: string | null;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export function createRiderTripAppDelivery(deps: RiderTripAppDeliveryDeps): RiderTripAppDelivery {
  const guardedFetch = createGuardedFetch("gateway-internal-rider-trip-signal");
  const targets = signalTargets(deps.gatewayInternalUrl);
  const signalEnabled = targets.length > 0 && deps.secret !== null && deps.secret.length >= 16;

  return {
    findReceipt: async (deliveryId) => {
      try {
        const rows = await deps.sql<{ acked_at: Date }[]>`
          select acked_at from rider_trip_event_receipts
          where delivery_id = ${deliveryId}::uuid`;
        const at = rows[0]?.acked_at;
        return at instanceof Date ? at : null;
      } catch {
        return null;
      }
    },
    signalRider: async (telegramUserId, orderId) => {
      if (!signalEnabled) return false;
      return fanoutSignal({
        fetch: guardedFetch,
        targets,
        path: "/internal/realtime/rider-trip-signal",
        secret: deps.secret as string,
        body: { telegram_user_id: telegramUserId, order_id: orderId },
        timeoutMs: SIGNAL_TIMEOUT_MS,
        onRejected: (status) => deps.log?.("rider_trip_signal.rejected", { status }),
      });
    },
  };
}
