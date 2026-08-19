/**
 * الغرض: إنشاء محفظة ائتمان اشتراك واحدة للسائق.
 * الحالة: منفّذ فعلياً في 2026-08-13؛ كان الملف هيكلاً (`export {}`) وصدر أمر التفعيل.
 * القرار ومسوّغه: العملة تقررها القاعدة من platform_settings والإنشاء RPC ذري ذو قيد واحد لكل سائق، فلا تنشأ محافظ متنافسة أو عملة يختارها العميل.
 */
import type { DriverId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { SubscriptionWalletRpcPort } from "./ports.ts";
export interface CreateWalletInput {
  readonly driverId: DriverId;
}
export interface CreateWalletDeps {
  readonly wallets: SubscriptionWalletRpcPort;
}
export interface CreateWalletOutcome {
  readonly walletId: string;
  readonly currency: string;
  readonly alreadyExists: boolean;
}
export class CreateWalletError {
  readonly code = "CREATE_WALLET_FAILURE" as const;
  constructor(readonly detail: string) {}
}
export async function createWallet(
  input: CreateWalletInput,
  deps: CreateWalletDeps,
): Promise<Result<CreateWalletOutcome, CreateWalletError>> {
  const result = await deps.wallets.createWallet(input.driverId);
  if (!result.ok) return err(new CreateWalletError(result.error.detail));
  if (!result.value.ok || result.value.walletId === null || result.value.currency === null)
    return err(new CreateWalletError(result.value.error ?? "WALLET_NOT_CREATED"));
  return ok({
    walletId: result.value.walletId,
    currency: result.value.currency,
    alreadyExists: result.value.alreadyExists,
  });
}
