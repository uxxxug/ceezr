/** منافذ safety: الدوال الذرية هي مصدر الحقيقة؛ لا قرار أو قفل في التطبيق. */
import type { Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

export type SafetyRole = "rider" | "driver";
export type SafetyDecision = "close" | "block_reporter";

export interface TriggerSosPort {
  trigger(input: {
    /** `null` = تَحُلُّ الدالّةُ الطلبَ القائمَ للمُبلِّغِ بنفسِها (`F8-05` · `ADR-0077`). */
    orderId: string | null;
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
