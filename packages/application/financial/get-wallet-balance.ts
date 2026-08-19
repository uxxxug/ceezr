/**
 * الغرض: قراءة رصيد محفظة ائتمان الاشتراك من دفتر الحركات القانوني.
 * الحالة: منفّذ فعلياً في 2026-08-13؛ كان الملف هيكلاً (`export {}`) وصدر أمر التفعيل.
 * القرار ومسوّغه: ADR 0016 يقرر أن الرصيد مجموع الدفتر لا عمود قابل للانجراف تحت التزامن.
 */
import type { DriverId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { SubscriptionWalletRpcPort } from "./ports.ts";
export interface GetWalletBalanceInput {
  readonly driverId: DriverId;
}
export interface GetWalletBalanceDeps {
  readonly wallets: SubscriptionWalletRpcPort;
}
export interface GetWalletBalanceOutcome {
  readonly walletId: string;
  readonly currency: string;
  readonly balanceMinor: number;
}
export class GetWalletBalanceError {
  readonly code = "GET_WALLET_BALANCE_FAILURE" as const;
  constructor(readonly detail: string) {}
}
export async function getWalletBalance(
  input: GetWalletBalanceInput,
  deps: GetWalletBalanceDeps,
): Promise<Result<GetWalletBalanceOutcome, GetWalletBalanceError>> {
  const result = await deps.wallets.getBalance(input.driverId);
  if (!result.ok) return err(new GetWalletBalanceError(result.error.detail));
  if (
    !result.value.ok ||
    result.value.walletId === null ||
    result.value.currency === null ||
    result.value.balanceMinor === null
  )
    return err(new GetWalletBalanceError(result.value.error ?? "WALLET_NOT_FOUND"));
  return ok({
    walletId: result.value.walletId,
    currency: result.value.currency,
    balanceMinor: result.value.balanceMinor,
  });
}
