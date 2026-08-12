/**
 * الغرض: اختبارات مسار ويبهوك الدفع HTTP — البند 8.
 *   تثبت: التوقيع الصحيح يُقبل، الخاطئ يُرفض، الحدث المكرر يُهمل بأمان.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import {
  createPaymentWebhookRoutes,
  type PaymentWebhookDependencies,
} from "../../apps/gateway/src/routes/payment-webhook.ts";
import type {
  PaymentRepository,
  WebhookEventStore,
} from "../../packages/application/financial/ports.ts";
import type {
  PaymentTransaction,
  PaymentTransactionId,
} from "../../packages/domain/financial/entity.ts";
import type { DriverId } from "../../packages/shared/kernel/index.ts";
import { ok } from "../../packages/shared/result/index.ts";

const SECRET = "test-webhook-secret";
const PROVIDER = "test-provider";
const txId = "tx-wh-1" as PaymentTransactionId;

function fakeRepo(
  initial?: PaymentTransaction,
): PaymentRepository & { txns: PaymentTransaction[] } {
  const txns: PaymentTransaction[] = initial ? [initial] : [];
  return {
    txns,
    create: async (input) => {
      const tx: PaymentTransaction = {
        id: input.idempotencyKey as PaymentTransactionId,
        payerId: input.driverId as DriverId,
        payeeId: "platform",
        purpose: input.purpose,
        amount: input.amount,
        provider: input.provider,
        providerTransactionId: input.providerTransactionId,
        status: input.status,
        metadata: input.metadata ?? {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      txns.push(tx);
      return ok({ transaction: tx, alreadyExists: false });
    },
    findById: async () => ok(txns[0] ?? null),
    findByIdempotencyKey: async () => ok(txns[0] ?? null),
    confirmPayment: async (input) => {
      const first = txns[0];
      if (first === undefined) return ok({} as PaymentTransaction);
      const updated: PaymentTransaction = {
        ...first,
        status: input.newStatus,
        providerTransactionId: input.providerTransactionId,
      };
      txns[0] = updated;
      return ok(updated);
    },
  };
}

function fakeEventStore(): WebhookEventStore & { seen: Set<string> } {
  const seen = new Set<string>();
  return {
    seen,
    record: async (eventId) => {
      if (seen.has(eventId)) return ok(false);
      seen.add(eventId);
      return ok(true);
    },
  };
}

function makeDeps(repo: PaymentRepository, events: WebhookEventStore): PaymentWebhookDependencies {
  return {
    webhookSecret: SECRET,
    providerName: PROVIDER,
    confirmDeps: { payments: repo, events },
    log: () => {},
  };
}

function webhookBody(eventId: string, status = "active", providerTxId = "prov-1"): string {
  return JSON.stringify({
    eventId,
    transactionId: txId,
    providerTransactionId: providerTxId,
    status,
  });
}

describe("payment-webhook: HTTP route", () => {
  it("التوقيع الصحيح يقبل الحدث ويؤكّد الدفع", async () => {
    const repo = fakeRepo();
    const events = fakeEventStore();
    const app = createPaymentWebhookRoutes(makeDeps(repo, events));

    const res = await app.fetch(
      new Request("http://localhost/webhook/payment", {
        method: "POST",
        headers: { "x-payment-signature": SECRET, "content-type": "application/json" },
        body: webhookBody("wh-http-1"),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; duplicate?: boolean };
    expect(body.ok).toBe(true);
    expect(body.duplicate).toBe(false);
  });

  it("التوقيع الخاطئ يُرفض بـ 401", async () => {
    const repo = fakeRepo();
    const events = fakeEventStore();
    const app = createPaymentWebhookRoutes(makeDeps(repo, events));

    const res = await app.fetch(
      new Request("http://localhost/webhook/payment", {
        method: "POST",
        headers: { "x-payment-signature": "wrong-secret", "content-type": "application/json" },
        body: webhookBody("wh-http-2"),
      }),
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_SIGNATURE");
  });

  it("الحدث المكرر يُهمل بأمان (200 + duplicate=true)", async () => {
    const repo = fakeRepo();
    const events = fakeEventStore();
    const app = createPaymentWebhookRoutes(makeDeps(repo, events));

    // أول إرسال
    const res1 = await app.fetch(
      new Request("http://localhost/webhook/payment", {
        method: "POST",
        headers: { "x-payment-signature": SECRET, "content-type": "application/json" },
        body: webhookBody("wh-dup"),
      }),
    );
    expect(res1.status).toBe(200);

    // إعادة إرسال نفس الحدث
    const res2 = await app.fetch(
      new Request("http://localhost/webhook/payment", {
        method: "POST",
        headers: { "x-payment-signature": SECRET, "content-type": "application/json" },
        body: webhookBody("wh-dup"),
      }),
    );
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { ok: boolean; duplicate: boolean };
    expect(body2.ok).toBe(true);
    expect(body2.duplicate).toBe(true);
  });

  it("JSON غير صالح يُرفض بـ 400", async () => {
    const repo = fakeRepo();
    const events = fakeEventStore();
    const app = createPaymentWebhookRoutes(makeDeps(repo, events));

    const res = await app.fetch(
      new Request("http://localhost/webhook/payment", {
        method: "POST",
        headers: { "x-payment-signature": SECRET, "content-type": "application/json" },
        body: "not-json",
      }),
    );

    expect(res.status).toBe(400);
  });
});
