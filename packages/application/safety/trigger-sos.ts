/**
 * الغرض: تسجيل SOS من الراكب أو السائق قبل أي اتصال خارجي.
 * الحالة: منفّذ فعلياً في 2026-08-13؛ كان هيكلاً. القرار: RPC واحد يثبت ملكية
 * الطلب، يقفل نافذة المنع، وينشئ incident+outbox في معاملة واحدة، لأن تيليجرام
 * قد يفشل ولا يجوز أن يصبح فشله فقداناً لنداء الطوارئ.
 * ينتمي إلى: application/safety
 * يستخدمه: حوارا الراكب والسائق في apps/gateway.
 * ملاحظات مستقبلية: لا تضف اتصالات تيليجرام هنا؛ outbox العامل هو حدّ الموثوقية.
 */
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import type { SafetyRole, TriggerSosPort } from "./ports.ts";

export class TriggerSosError {
  readonly code = "TRIGGER_SOS_REJECTED" as const;
  constructor(readonly detail: string) {}
}
export interface TriggerSosInput {
  readonly orderId: string;
  readonly actorTelegramId: string;
  readonly reporterRole: SafetyRole;
}
export interface TriggerSosDeps {
  readonly incidents: TriggerSosPort;
}
export interface TriggerSosReport {
  readonly incidentId: string;
  readonly created: boolean;
}

export async function triggerSos(
  input: TriggerSosInput,
  deps: TriggerSosDeps,
): Promise<Result<TriggerSosReport, TriggerSosError | PortFailureError>> {
  const triggered = await deps.incidents.trigger(input);
  if (!triggered.ok) return triggered;
  if (triggered.value.incidentId === null) return err(new TriggerSosError(triggered.value.error));
  return ok({ incidentId: triggered.value.incidentId, created: triggered.value.created });
}
