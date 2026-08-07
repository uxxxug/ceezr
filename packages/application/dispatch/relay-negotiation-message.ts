/**
 * الغرض: قناة التمرير بين العميل والسائق صاحب الدور، عبر البوت وبلا كشف أي رقم هاتف
 *   (القسم 3.4، الخطوة 3). الرسالة تُقرأ من طرف وتُكتب للطرف الآخر، ويُحجب منها
 *   ما يشبه رقم هاتف حتى لا يلتفّ الطرفان على الشرط بأيديهما.
 * الحالة: منفّذ فعلياً — المرحلة 2.3.
 * ينتمي إلى: application/dispatch
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/driver، apps/gateway/src/bots/rider
 * ملاحظات مستقبلية: تمرير الصور والمواقع يُضاف بنفس المنفذ بحقل نوع محتوى، لا بمسار موازٍ.
 */

import { redactPhoneNumbers } from "../../domain/dispatch/negotiation.ts";
import type { DriverId, OrderId, RiderId } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import type { NegotiationParties } from "./register-unsubscribed-claim.ts";

export type RelaySide = "driver" | "rider";

/** يجد الدورة التي يكون فيها هذا المستخدم طرفاً نشطاً الآن، إن وُجدت. */
export interface ActiveNegotiationLookup {
  forDriver(driverId: DriverId): Promise<Result<NegotiationParties | null, PortFailureError>>;
  forRider(riderId: RiderId): Promise<Result<NegotiationParties | null, PortFailureError>>;
}

export interface RelaySender {
  /** يعيد false إن تعذّر الوصول للطرف الآخر بلا عطل تقني (حظر البوت مثلاً). */
  relay(
    parties: NegotiationParties,
    from: RelaySide,
    text: string,
  ): Promise<Result<boolean, PortFailureError>>;
}

export interface RelayDependencies {
  readonly lookup: ActiveNegotiationLookup;
  readonly sender: RelaySender;
}

export interface RelayReport {
  readonly relayed: boolean;
  readonly orderId: OrderId | null;
  readonly negotiationId: string | null;
  /** كم مقطعاً يشبه رقم هاتف حُجب — يُستخدم لتنبيه المرسِل، لا لمنع الرسالة. */
  readonly redacted: number;
  /** null إن مُرِّرت؛ وإلا سبب واضح: NO_ACTIVE_NEGOTIATION أو EMPTY_MESSAGE أو UNREACHABLE. */
  readonly reason: string | null;
}

function empty(reason: string): RelayReport {
  return { relayed: false, orderId: null, negotiationId: null, redacted: 0, reason };
}

/**
 * يمرّر رسالة نصّية واحدة. من ليس طرفاً في تفاوض نشط لا تُمرَّر رسالته إطلاقاً —
 * وهذا هو ما يمنع أي سائق آخر في القروب من مخاطبة العميل قبل أن يصله الدور.
 */
export async function relayNegotiationMessage(
  input: {
    readonly from: RelaySide;
    readonly driverId: DriverId | null;
    readonly riderId: RiderId | null;
    readonly text: string;
  },
  deps: RelayDependencies,
): Promise<Result<RelayReport, PortFailureError>> {
  const body = input.text.trim();
  if (body === "") return ok(empty("EMPTY_MESSAGE"));

  const found =
    input.from === "driver"
      ? input.driverId === null
        ? null
        : await deps.lookup.forDriver(input.driverId)
      : input.riderId === null
        ? null
        : await deps.lookup.forRider(input.riderId);

  if (found === null) return ok(empty("NO_ACTIVE_NEGOTIATION"));
  if (!found.ok) return found;
  if (found.value === null) return ok(empty("NO_ACTIVE_NEGOTIATION"));

  const parties = found.value;
  const safe = redactPhoneNumbers(body);

  const sent = await deps.sender.relay(parties, input.from, safe.text);
  if (!sent.ok) return sent;

  return ok({
    relayed: sent.value,
    orderId: parties.orderId,
    negotiationId: parties.negotiationId,
    redacted: safe.redacted,
    reason: sent.value ? null : "UNREACHABLE",
  });
}
