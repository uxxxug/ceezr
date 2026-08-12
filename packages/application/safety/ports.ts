/** منافذ safety: الدوال الذرية هي مصدر الحقيقة؛ لا قرار أو قفل في التطبيق. */
import type { Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

export type SafetyRole = "rider" | "driver";
export type SafetyDecision = "close" | "block_reporter";

export interface TriggerSosPort {
  trigger(input: {
    orderId: string;
    actorTelegramId: string;
    reporterRole: SafetyRole;
  }): Promise<
    Result<
      { incidentId: string; created: boolean } | { incidentId: null; error: string },
      PortFailureError
    >
  >;
}
export interface SafetyResolutionPort {
  claim(
    incidentId: string,
    actorTelegramId: string,
  ): Promise<
    Result<{ claimed: boolean; error: string | null; claimedBy: string | null }, PortFailureError>
  >;
  resolve(input: {
    incidentId: string;
    actorTelegramId: string;
    decision: SafetyDecision;
  }): Promise<Result<{ resolved: boolean; error: string | null }, PortFailureError>>;
}
export interface SafetyDelivery {
  readonly deliveryId: string;
  readonly incidentId: string;
  readonly claimToken: string;
  readonly groupId: string;
  readonly orderId: string;
  readonly service: string;
  readonly reporterRole: SafetyRole;
  readonly status: string;
  readonly locationWkt: string | null;
  readonly maxAttempts: number;
}
export interface SafetyDeliveryPort {
  claim(): Promise<Result<SafetyDelivery | null, PortFailureError>>;
  finish(input: {
    deliveryId: string;
    claimToken: string;
    messageId: string | null;
  }): Promise<Result<boolean, PortFailureError>>;
}
export interface SafetyCardPublisher {
  publish(card: SafetyDelivery): Promise<Result<string, PortFailureError>>;
}
