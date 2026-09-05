/**
 * محوّلاتُ تسليمِ إشعارِ العرضِ إلى RPCs الذرّيّة. كلُّ تغيّرِ حالةٍ يبقى في PostgreSQL:
 * claim بـFOR UPDATE SKIP LOCKED + claim_token، وfinish بالرمزِ لا بالصفّ، وabandon
 * بالرمزِ كذلك. مرآةٌ لـcreateSafetyDeliveryPort في البنية، تزيدُ عليها abandon.
 * (BUG-004.)
 */
import type { OfferDelivery, OfferDeliveryPort } from "../../application/dispatch/deliver-offer-notification.ts";
import type { CityId, DriverId, OfferId, OrderId } from "../../shared/kernel/index.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

function envelope(value: unknown, name: string): Record<string, unknown> {
  const result = readEnvelope(value);
  if (result === null) throw new Error(`ردّ ${name} غير مفهوم`);
  return result;
}

export function createOfferDeliveryPort(sql: Sql): OfferDeliveryPort {
  return {
    claim: () =>
      guard("rpc.claim_notification_delivery", async () => {
        const rows = await sql<{ result: unknown }[]>`select claim_notification_delivery() result`;
        const row = envelope(rows[0]?.result, "claim_notification_delivery");
        if (row.ok !== true) throw new Error(String(row.error ?? "UNKNOWN"));
        const delivery = row.delivery as Record<string, unknown> | null;
        if (delivery == null) return { delivery: null };
        return {
          delivery: {
            deliveryId: String(delivery.delivery_id),
            offerId: String(delivery.offer_id) as OfferId,
            orderId: String(delivery.order_id) as OrderId,
            driverId: String(delivery.driver_id) as DriverId,
            cityId: String(delivery.city_id) as CityId,
            claimToken: String(delivery.claim_token),
            attempts: Number(delivery.attempts),
            maxAttempts: Number(delivery.max_attempts),
            distanceKm: String(delivery.distance_km),
            expiresAt: String(delivery.expires_at),
            offerStatus: String(delivery.offer_status),
          } satisfies OfferDelivery,
        };
      }),
    finish: (input) =>
      guard("rpc.finish_notification_delivery", async () => {
        const rows = await sql<{ result: unknown }[]>`select finish_notification_delivery(${input.deliveryId}::uuid, ${input.claimToken}::uuid, ${input.messageId}::text, ${input.messageId !== null}) result`;
        const row = envelope(rows[0]?.result, "finish_notification_delivery");
        return row.ok === true;
      }),
    abandon: (input) =>
      guard("rpc.abandon_notification_delivery", async () => {
        const rows = await sql<{ result: unknown }[]>`select abandon_notification_delivery(${input.deliveryId}::uuid, ${input.claimToken}::uuid) result`;
        const row = envelope(rows[0]?.result, "abandon_notification_delivery");
        return row.ok === true;
      }),
  };
}
