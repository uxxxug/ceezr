/** منافذ safety: الدوال الذرية هي مصدر الحقيقة؛ لا قرار أو قفل في التطبيق. */

import type { SafetyIncidentReason } from "../../domain/safety/value-objects.ts";
import type { Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

export type SafetyRole = "rider" | "driver";
export type SafetyDecision = "close" | "block_reporter";
/**
 * رمزُ السببِ الداخليِّ لقرارِ الإغلاقِ (`PD-021`). مجموعةٌ مغلقةٌ قابلةٌ
 * للتوسعةِ بقرارٍ. لا يُنشَرُ للمُبلِّغِ — رسالةُ الحالةِ العامّةُ تُشتَقُّ من
 * القرارِ لا من السببِ.
 */
export type SafetyDecisionReason =
  | "resolved"
  | "false_report"
  | "duplicate"
  | "escalated"
  | "safety_risk"
  | "policy_violation";
export const SAFETY_DECISION_REASONS: readonly SafetyDecisionReason[] = [
  "resolved",
  "false_report",
  "duplicate",
  "escalated",
  "safety_risk",
  "policy_violation",
];
export const isSafetyDecisionReason = (value: unknown): value is SafetyDecisionReason =>
  typeof value === "string" && SAFETY_DECISION_REASONS.some((r) => r === value);

export interface TriggerSosPort {
  trigger(input: {
    /** `null` = تَحُلُّ الدالّةُ الطلبَ القائمَ للمُبلِّغِ بنفسِها (`F8-05` · `ADR-0077`). */
    orderId: string | null;
    actorTelegramId: string;
    reporterRole: SafetyRole;
    /**
     * جنسُ البلاغِ (`PD-020` · `ADR 0159`): `sos` للنداءِ العامّ، و
     * `driver_cannot_complete` لفعلِ «تعذّرَ الإكمالُ» من سطحِ مهمّةِ السائقِ.
     */
    reason: SafetyIncidentReason;
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
    /** رمزُ السببِ الداخليِّ الإلزاميُّ (`PD-021`). */
    decisionReason: SafetyDecisionReason;
  }): Promise<Result<{ resolved: boolean; error: string | null }, PortFailureError>>;
}
export interface SafetyDelivery {
  readonly deliveryId: string;
  readonly incidentId: string;
  readonly claimToken: string;
  readonly groupId: string;
  /**
   * `null` = بلاغٌ **بلا رحلةٍ** (`F12-03`). ولا يُقرأُ فراغاً ولا يُستبدَلُ بنصٍّ
   * مثلِ «غيرُ متاحٍ» ههنا: بطاقةُ الفريقِ تُصاغُ نصّاً مختلفاً لا حقلاً فارغاً،
   * ورقمُ رحلةٍ مُلفَّقٌ يُرسِلُ فريقَ سلامةٍ يبحثُ عن رحلةٍ لا وجودَ لها.
   */
  readonly orderId: string | null;
  /** `null` معَ `orderId: null` — لا خدمةَ بلا رحلةٍ. */
  readonly service: string | null;
  readonly reporterRole: SafetyRole;
  readonly status: string;
  /** جنسُ البلاغِ — تُختارُ بهِ بطاقةُ الفريقِ (`PD-020` · `ADR 0159`). */
  readonly incidentReason: SafetyIncidentReason;
  readonly locationWkt: string | null;
  readonly maxAttempts: number;
}
/**
 * صفٌّ تُخطّي لأنّ إعداد مدينته ناقص. يُعاد صريحاً لا يُهمَل: تخطٍّ صامتٌ لنداء
 * استغاثة أسوأ من العطل الذي حلّ محلّه.
 */
export interface SafetyDeferral {
  readonly deliveryId: string;
  readonly cityId: string;
  readonly reason: string;
}
export interface SafetyClaim {
  readonly delivery: SafetyDelivery | null;
  readonly deferred: readonly SafetyDeferral[];
}
export interface SafetyDeliveryPort {
  claim(): Promise<Result<SafetyClaim, PortFailureError>>;
  finish(input: {
    deliveryId: string;
    claimToken: string;
    messageId: string | null;
  }): Promise<Result<boolean, PortFailureError>>;
}
export interface SafetyCardPublisher {
  publish(card: SafetyDelivery): Promise<Result<string, PortFailureError>>;
}
