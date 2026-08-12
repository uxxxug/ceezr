/** محوّلات safety الفعلية إلى RPCs؛ كل تغير حالة يبقى في PostgreSQL الذرية. */
import type {
  SafetyDeliveryPort,
  SafetyResolutionPort,
  TriggerSosPort,
} from "../../application/safety/ports.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

function envelope(value: unknown, name: string): Record<string, unknown> {
  const result = readEnvelope(value);
  if (result === null) throw new Error(`ردّ ${name} غير مفهوم`);
  return result;
}
export function createTriggerSosPort(sql: Sql): TriggerSosPort {
  return {
    trigger: (input) =>
      guard("rpc.trigger_sos", async () => {
        const rows = await sql<
          { result: unknown }[]
        >`select trigger_sos(${input.orderId}::uuid, ${input.actorTelegramId}::bigint, ${input.reporterRole}::text) result`;
        const row = envelope(rows[0]?.result, "trigger_sos");
        return row.ok === true
          ? { incidentId: String(row.incident_id), created: row.created === true }
          : { incidentId: null, error: String(row.error ?? "UNKNOWN") };
      }),
  };
}
export function createSafetyResolutionPort(sql: Sql): SafetyResolutionPort {
  return {
    claim: (incidentId, actorTelegramId) =>
      guard("rpc.claim_safety_incident", async () => {
        const rows = await sql<
          { result: unknown }[]
        >`select claim_safety_incident(${incidentId}::uuid, ${actorTelegramId}::bigint) result`;
        const row = envelope(rows[0]?.result, "claim_safety_incident");
        return {
          claimed: row.ok === true,
          error: row.ok === true ? null : String(row.error ?? "UNKNOWN"),
          claimedBy: row.claimed_by == null ? null : String(row.claimed_by),
        };
      }),
    resolve: (input) =>
      guard("rpc.resolve_safety_incident", async () => {
        const rows = await sql<
          { result: unknown }[]
        >`select resolve_safety_incident(${input.incidentId}::uuid, ${input.actorTelegramId}::bigint, ${input.decision}::text) result`;
        const row = envelope(rows[0]?.result, "resolve_safety_incident");
        return {
          resolved: row.ok === true,
          error: row.ok === true ? null : String(row.error ?? "UNKNOWN"),
        };
      }),
  };
}
export function createSafetyDeliveryPort(sql: Sql): SafetyDeliveryPort {
  return {
    claim: () =>
      guard("rpc.claim_safety_incident_delivery", async () => {
        const rows = await sql<
          { result: unknown }[]
        >`select claim_safety_incident_delivery() result`;
        const row = envelope(rows[0]?.result, "claim_safety_incident_delivery");
        if (row.ok !== true) throw new Error(String(row.error ?? "UNKNOWN"));
        const delivery = row.delivery as Record<string, unknown> | null;
        if (delivery === null) return null;
        return {
          deliveryId: String(delivery.delivery_id),
          incidentId: String(delivery.incident_id),
          claimToken: String(delivery.claim_token),
          groupId: String(delivery.group_id),
          orderId: String(delivery.order_id),
          service: String(delivery.service),
          reporterRole: String(delivery.reporter_role) as "rider" | "driver",
          status: String(delivery.status),
          locationWkt: delivery.location_wkt == null ? null : String(delivery.location_wkt),
          maxAttempts: Number(delivery.max_attempts),
        };
      }),
    finish: (input) =>
      guard("rpc.finish_safety_incident_delivery", async () => {
        const rows = await sql<
          { result: unknown }[]
        >`select finish_safety_incident_delivery(${input.deliveryId}::uuid, ${input.claimToken}::uuid, ${input.messageId}::text::bigint, ${input.messageId !== null}) result`;
        const row = envelope(rows[0]?.result, "finish_safety_incident_delivery");
        return row.ok === true;
      }),
  };
}
