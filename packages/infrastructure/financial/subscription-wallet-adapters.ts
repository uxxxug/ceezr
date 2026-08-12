/**
 * الغرض: محول قاعدة البيانات لمحفظة ائتمان الاشتراك والاسترداد والفاتورة وتصحيح الخطأ الإداري.
 * الحالة: منفّذ فعلياً في 2026-08-13؛ يستدعي RPCs ذرية ولا يكتب أرصدة أو دفعات بتحديثات خام.
 * ينتمي إلى: infrastructure/financial
 * القرار: هذا المسار إداري/ويبهوك فقط، فلا وصلة بوت للسائق تسمح له بإصدار استرداد أو تسوية مالية بنفسه.
 */
import type {
  SubscriptionInvoiceOutcome,
  SubscriptionRefundOutcome,
  SubscriptionWalletRpcPort,
  SystemErrorSettlementRequest,
  WalletBalance,
  WalletCreation,
  WalletMutation,
  WalletTopUpRequest,
} from "../../application/financial/ports.ts";
import type { PaymentTransactionId } from "../../domain/financial/index.ts";
import type { DriverId } from "../../shared/kernel/index.ts";
import { guard, type RpcEnvelope, readEnvelope, type Sql } from "../db/client.ts";

function envelope(value: unknown, operation: string): RpcEnvelope {
  const parsed = readEnvelope(value);
  if (parsed === null) throw new Error(`ردّ ${operation} غير مفهوم`);
  return parsed;
}
function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function number(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
function bool(value: unknown): boolean {
  return value === true;
}

export function createSubscriptionWalletRpc(sql: Sql): SubscriptionWalletRpcPort {
  return {
    createWallet: (driverId: DriverId) =>
      guard("rpc.create_subscription_wallet", async () => {
        const rows = await sql`select create_subscription_wallet(${driverId}::uuid) as result`;
        const v = envelope(
          (rows[0] as { result?: unknown } | undefined)?.result,
          "create_subscription_wallet",
        );
        return {
          ok: v.ok,
          error: text(v.error),
          walletId: text(v.wallet_id),
          currency: text(v.currency),
          alreadyExists: bool(v.already_exists),
        } satisfies WalletCreation;
      }),
    getBalance: (driverId: DriverId) =>
      guard("rpc.subscription_wallet_balance", async () => {
        const rows = await sql`select subscription_wallet_balance(${driverId}::uuid) as result`;
        const v = envelope(
          (rows[0] as { result?: unknown } | undefined)?.result,
          "subscription_wallet_balance",
        );
        return {
          ok: v.ok,
          error: text(v.error),
          walletId: text(v.wallet_id),
          currency: text(v.currency),
          balanceMinor: number(v.balance_minor),
        } satisfies WalletBalance;
      }),
    topUp: (input: WalletTopUpRequest) =>
      guard("rpc.top_up_subscription_wallet", async () => {
        const rows =
          await sql`select top_up_subscription_wallet(${input.driverId}::uuid, ${input.paymentId}::uuid, ${input.amountMinor}, ${input.actorUserId}::uuid, ${input.reason}, ${input.reference}, ${input.idempotencyKey}) as result`;
        const v = envelope(
          (rows[0] as { result?: unknown } | undefined)?.result,
          "top_up_subscription_wallet",
        );
        return {
          ok: v.ok,
          error: text(v.error),
          walletId: text(v.wallet_id),
          entryId: text(v.entry_id),
          alreadyExists: bool(v.already_exists),
          balanceMinor: number(v.balance_minor),
        } satisfies WalletMutation;
      }),
    refund: (input) =>
      guard("rpc.refund_subscription_payment", async () => {
        const rows =
          await sql`select refund_subscription_payment(${input.paymentId}::uuid, ${input.amountMinor}, ${input.destination}, ${input.actorUserId}::uuid, ${input.reason}, ${input.reference}) as result`;
        const v = envelope(
          (rows[0] as { result?: unknown } | undefined)?.result,
          "refund_subscription_payment",
        );
        return {
          ok: v.ok,
          error: text(v.error),
          refundId: text(v.refund_id),
          walletId: text(v.wallet_id),
          alreadyRefunded: bool(v.already_refunded),
          destination: text(v.destination),
        } satisfies SubscriptionRefundOutcome;
      }),
    issueInvoice: (paymentId: PaymentTransactionId) =>
      guard("rpc.issue_subscription_invoice", async () => {
        const rows = await sql`select issue_subscription_invoice(${paymentId}::uuid) as result`;
        const v = envelope(
          (rows[0] as { result?: unknown } | undefined)?.result,
          "issue_subscription_invoice",
        );
        return {
          ok: v.ok,
          error: text(v.error),
          invoiceId: text(v.invoice_id),
          invoiceNumber: text(v.invoice_number),
          alreadyIssued: bool(v.already_issued),
        } satisfies SubscriptionInvoiceOutcome;
      }),
    settleSystemError: (input: SystemErrorSettlementRequest) =>
      guard("rpc.settle_subscription_wallet_system_error", async () => {
        const rows =
          await sql`select settle_subscription_wallet_system_error(${input.driverId}::uuid, ${input.adjustmentMinor}, ${input.actorUserId}::uuid, ${input.reason}, ${input.reference}, ${input.idempotencyKey}) as result`;
        const v = envelope(
          (rows[0] as { result?: unknown } | undefined)?.result,
          "settle_subscription_wallet_system_error",
        );
        return {
          ok: v.ok,
          error: text(v.error),
          walletId: text(v.wallet_id),
          entryId: text(v.entry_id),
          alreadyExists: bool(v.already_exists),
          balanceMinor: null,
        } satisfies WalletMutation;
      }),
  };
}
