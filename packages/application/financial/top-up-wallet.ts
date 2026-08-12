/**
 * الغرض: إضافة ائتمان اشتراك من دفعة مؤكدة أو قرار إداري موثق.
 * الحالة: منفّذ فعلياً في 2026-08-13؛ كان الملف هيكلاً (`export {}`) وصدر أمر التفعيل.
 * القرار ومسوّغه: المفتاح الإيدمبوتنسي يُمرر للـRPC الذري؛ دفعة الويبهوك الواحدة لا تضاف مرتين مهما أعيد إرسالها.
 */

import type { PaymentTransactionId } from "../../domain/financial/index.ts";
import type { DriverId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { SubscriptionWalletRpcPort } from "./ports.ts";
export interface TopUpWalletInput {
  readonly driverId: DriverId;
  readonly paymentId: PaymentTransactionId | null;
  readonly amountMinor: number | null;
  readonly actorUserId: string | null;
  readonly reason: string | null;
  readonly reference: string | null;
  readonly idempotencyKey: string;
}
export interface TopUpWalletDeps {
  readonly wallets: SubscriptionWalletRpcPort;
}
export interface TopUpWalletOutcome {
  readonly walletId: string;
  readonly entryId: string;
  readonly alreadyExists: boolean;
  readonly balanceMinor: number | null;
}
export class TopUpWalletError {
  readonly code = "TOP_UP_WALLET_FAILURE" as const;
  constructor(readonly detail: string) {}
}
export async function topUpWallet(
  input: TopUpWalletInput,
  deps: TopUpWalletDeps,
): Promise<Result<TopUpWalletOutcome, TopUpWalletError>> {
  const result = await deps.wallets.topUp(input);
  if (!result.ok) return err(new TopUpWalletError(result.error.detail));
  if (!result.value.ok || result.value.walletId === null || result.value.entryId === null)
    return err(new TopUpWalletError(result.value.error ?? "WALLET_TOP_UP_REJECTED"));
  return ok({
    walletId: result.value.walletId,
    entryId: result.value.entryId,
    alreadyExists: result.value.alreadyExists,
    balanceMinor: result.value.balanceMinor,
  });
}
