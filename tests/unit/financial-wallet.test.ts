/** اختبارات وحدة لمسارات محفظة الاشتراك: نجاح الغلاف ورفض النطاق من RPC. */
import { describe, expect, it } from "bun:test";
import { createWallet } from "../../packages/application/financial/create-wallet.ts";
import { getWalletBalance } from "../../packages/application/financial/get-wallet-balance.ts";
import { issueInvoice } from "../../packages/application/financial/issue-invoice.ts";
import type { SubscriptionWalletRpcPort } from "../../packages/application/financial/ports.ts";
import { refundPayment } from "../../packages/application/financial/refund-payment.ts";
import { settleDriverPayout } from "../../packages/application/financial/settle-driver-payout.ts";
import { topUpWallet } from "../../packages/application/financial/top-up-wallet.ts";
import { ok } from "../../packages/shared/result/index.ts";

const driver = "00000000-0000-0000-0000-000000000001" as never;
const payment = "00000000-0000-0000-0000-000000000002" as never;
const port: SubscriptionWalletRpcPort = {
  createWallet: async () =>
    ok({ ok: true, error: null, walletId: "w", currency: "SAR", alreadyExists: false }),
  getBalance: async () =>
    ok({ ok: true, error: null, walletId: "w", currency: "SAR", balanceMinor: 90 }),
  topUp: async () =>
    ok({
      ok: true,
      error: null,
      walletId: "w",
      entryId: "e",
      alreadyExists: false,
      balanceMinor: 90,
    }),
  refund: async () =>
    ok({
      ok: true,
      error: null,
      refundId: "r",
      walletId: "w",
      alreadyRefunded: false,
      destination: "wallet_credit",
    }),
  issueInvoice: async () =>
    ok({
      ok: true,
      error: null,
      invoiceId: "i",
      invoiceNumber: "JED-2026-000001",
      alreadyIssued: false,
    }),
  settleSystemError: async () =>
    ok({
      ok: true,
      error: null,
      walletId: "w",
      entryId: "s",
      alreadyExists: false,
      balanceMinor: null,
    }),
};
describe("financial wallet use-cases", () => {
  it("يعيد نتائج العمليات الست من منفذها الذري", async () => {
    expect((await createWallet({ driverId: driver }, { wallets: port })).ok).toBe(true);
    expect((await getWalletBalance({ driverId: driver }, { wallets: port })).ok).toBe(true);
    expect(
      (
        await topUpWallet(
          {
            driverId: driver,
            paymentId: payment,
            amountMinor: 90,
            actorUserId: null,
            reason: null,
            reference: null,
            idempotencyKey: "k",
          },
          { wallets: port },
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await refundPayment(
          {
            paymentId: payment,
            amountMinor: 90,
            destination: "wallet_credit",
            actorUserId: null,
            reason: "r",
            reference: "ref",
          },
          { wallets: port },
        )
      ).ok,
    ).toBe(true);
    expect((await issueInvoice({ paymentId: payment }, { wallets: port })).ok).toBe(true);
    expect(
      (
        await settleDriverPayout(
          {
            driverId: driver,
            adjustmentMinor: 1,
            actorUserId: "a",
            reason: "bug",
            reference: "INC",
            idempotencyKey: "s",
          },
          { wallets: port },
        )
      ).ok,
    ).toBe(true);
  });
  it("لا يحول رفض RPC إلى نجاح كاذب", async () => {
    const rejected: SubscriptionWalletRpcPort = {
      ...port,
      getBalance: async () =>
        ok({
          ok: false,
          error: "WALLET_NOT_FOUND",
          walletId: null,
          currency: null,
          balanceMinor: null,
        }),
    };
    const result = await getWalletBalance({ driverId: driver }, { wallets: rejected });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.detail).toBe("WALLET_NOT_FOUND");
  });
});
