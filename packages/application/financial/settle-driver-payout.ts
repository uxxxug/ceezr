/**
 * الغرض: تصحيح إداري موثق لرصيد ائتمان الاشتراك عند خطأ نظام فقط.
 * الحالة: منفّذ فعلياً في 2026-08-13؛ كان الملف هيكلاً (`export {}`) وصدر أمر التفعيل.
 * القرار ومسوّغه: الاسم التاريخي لا يعني مستحقات رحلة؛ العملية لا تقبل إلا مديراً وسبباً ومرجعاً ومفتاح إيدمبوتنسي وتكتب audit_log داخل الـRPC.
 */
import type { DriverId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { SubscriptionWalletRpcPort } from "./ports.ts";
export interface SettleDriverPayoutInput {
  readonly driverId: DriverId;
  readonly adjustmentMinor: number;
  readonly actorUserId: string;
  readonly reason: string;
  readonly reference: string;
  readonly idempotencyKey: string;
}
export interface SettleDriverPayoutDeps {
  readonly wallets: SubscriptionWalletRpcPort;
}
export interface SettleDriverPayoutOutcome {
  readonly walletId: string;
  readonly entryId: string;
  readonly alreadyExists: boolean;
}
export class SettleDriverPayoutError {
  readonly code = "SETTLE_DRIVER_PAYOUT_FAILURE" as const;
  constructor(readonly detail: string) {}
}
export async function settleDriverPayout(
  input: SettleDriverPayoutInput,
  deps: SettleDriverPayoutDeps,
): Promise<Result<SettleDriverPayoutOutcome, SettleDriverPayoutError>> {
  const result = await deps.wallets.settleSystemError(input);
  if (!result.ok) return err(new SettleDriverPayoutError(result.error.detail));
  if (!result.value.ok || result.value.walletId === null || result.value.entryId === null)
    return err(
      new SettleDriverPayoutError(result.value.error ?? "SYSTEM_ERROR_SETTLEMENT_REJECTED"),
    );
  return ok({
    walletId: result.value.walletId,
    entryId: result.value.entryId,
    alreadyExists: result.value.alreadyExists,
  });
}
