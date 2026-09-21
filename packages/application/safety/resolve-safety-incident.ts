/**
 * الغرض: تسجيل قرار بشري اتُّخذ في قروب الإسناد.
 * الحالة: منفّذ فعلياً في 2026-08-13؛ كان هيكلاً. لا يوجد تصنيف أو قرار آلي:
 * القاعدة تقفل الحادث وتتحقق من الاستلام قبل الإغلاق، وقرار الحظر فقط يستدعي
 * مسار admin_set_user_blocked الإداري القائم داخل المعاملة.
 * ينتمي إلى: application/safety
 * يستخدمه: أزرار قروب الإسناد في حوار بوت السائق.
 * ملاحظات مستقبلية: أي قرار جديد يجب إضافته إلى انتقالات RPC ولا يستنتج من محتوى البلاغ.
 */
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import type { SafetyDecision, SafetyDecisionReason, SafetyResolutionPort } from "./ports.ts";

export class ResolveSafetyIncidentError {
  readonly code = "RESOLVE_SAFETY_INCIDENT_REJECTED" as const;
  constructor(readonly detail: string) {}
}
export interface ResolveSafetyIncidentInput {
  readonly incidentId: string;
  readonly actorTelegramId: string;
  readonly action: "claim" | SafetyDecision;
  /** رمزُ السببِ الداخليِّ الإلزاميُّ (`PD-021`). `null` عندَ `claim`. */
  readonly decisionReason: SafetyDecisionReason | null;
}
export interface ResolveSafetyIncidentDeps {
  readonly incidents: SafetyResolutionPort;
}
export interface ResolveSafetyIncidentReport {
  readonly changed: boolean;
  readonly action: "claim" | SafetyDecision;
}

export async function resolveSafetyIncident(
  input: ResolveSafetyIncidentInput,
  deps: ResolveSafetyIncidentDeps,
): Promise<Result<ResolveSafetyIncidentReport, ResolveSafetyIncidentError | PortFailureError>> {
  if (input.action === "claim") {
    const claimed = await deps.incidents.claim(input.incidentId, input.actorTelegramId);
    if (!claimed.ok) return claimed;
    if (!claimed.value.claimed)
      return err(new ResolveSafetyIncidentError(claimed.value.error ?? "UNKNOWN"));
    return ok({ changed: true, action: "claim" });
  }
  const resolved = await deps.incidents.resolve({
    incidentId: input.incidentId,
    actorTelegramId: input.actorTelegramId,
    decision: input.action,
    decisionReason: input.decisionReason ?? "resolved",
  });
  if (!resolved.ok) return resolved;
  if (!resolved.value.resolved)
    return err(new ResolveSafetyIncidentError(resolved.value.error ?? "UNKNOWN"));
  return ok({ changed: true, action: input.action });
}
