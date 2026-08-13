/**
 * الغرض: اختبارات ويبهوك الدفع العدائية: لا تثق بالحمولة بل بلقطة خادم المزوّد.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: حماية أي تعديل في payment-webhook.ts.
 * ملاحظات مستقبلية: اختبار HTTP الحقيقي لمحوّل Moyasar موجود منفصلاً في integration.
 */

import { describe, expect, it } from "bun:test";
import {
  createPaymentWebhookRoutes,
  type PaymentWebhookDependencies,
} from "../../apps/gateway/src/routes/payment-webhook.ts";
import type {
  PaymentProvider,
  PaymentRepository,
  ProviderTransactionSnapshot,
  WebhookEventStore,
} from "../../packages/application/financial/ports.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type {
  PaymentTransaction,
  PaymentTransactionId,
} from "../../packages/domain/financial/entity.ts";
import type { DriverId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const txId = "11111111-1111-4111-8111-111111111111" as PaymentTransactionId;
const amount = 25000;

function transaction(status: PaymentTransaction["status"] = "pending"): PaymentTransaction {
  return {
    id: txId,
    payerId: "driver" as DriverId,
    payeeId: "platform",
    purpose: "driver_subscription",
    amount: { amount, currency: "SAR" },
    provider: "moyasar",
    providerTransactionId: null,
    status,
    metadata: { plan: "transport" },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function repo(): PaymentRepository & { readonly activations: () => number } {
  let current = transaction();
  const seen = new Set<string>();
  let activations = 0;
  return {
    create: async () => ok({ transaction: current, alreadyExists: false }),
    findById: async (id) => ok(id === txId ? current : null),
    findByIdempotencyKey: async () => ok(null),
    recordCheckoutUrl: async (input) => ok({ checkoutUrl: input.checkoutUrl }),
    confirmPayment: async () => ok(current),
    confirmWebhookPayment: async (input) => {
      if (seen.has(input.webhookEventId)) return ok({ transaction: current, duplicate: true });
      if (current.status !== "pending" && current.status !== "past_due") {
        return err(new PortFailureError("payments", "INVALID_STATUS_TRANSITION"));
      }
      seen.add(input.webhookEventId);
      current = {
        ...current,
        status: input.newStatus,
        providerTransactionId: input.providerTransactionId,
      };
      if (input.newStatus === "active") activations += 1;
      return ok({ transaction: current, duplicate: false });
    },
    activations: () => activations,
  };
}

function events(): WebhookEventStore {
  return { record: async () => ok(true) };
}

function snapshot(
  overrides: Partial<ProviderTransactionSnapshot> = {},
): ProviderTransactionSnapshot {
  return {
    id: "payment-1",
    status: "active",
    amount,
    currency: "SAR",
    metadata: { waslah_transaction_id: txId },
    invoiceId: "invoice-1",
    ...overrides,
  };
}

function provider(server: ProviderTransactionSnapshot): PaymentProvider {
  return {
    name: "moyasar",
    chargeSubscription: async () =>
      ok({ providerTransactionId: null, checkoutUrl: "https://checkout", status: "pending" }),
    verifyWebhook: async (raw) => {
      const body = JSON.parse(raw) as {
        secret_token?: string;
        id?: string;
        data?: { id?: string };
      };
      if (body.secret_token !== "unit-secret")
        return err(new PortFailureError("moyasar", "SECRET_MISMATCH"));
      if (typeof body.id !== "string" || typeof body.data?.id !== "string")
        return err(new PortFailureError("moyasar", "MALFORMED"));
      return ok({ id: body.id, type: "payment_paid", providerTransactionId: body.data.id });
    },
    fetchTransaction: async (id) =>
      id === server.id ? ok(server) : err(new PortFailureError("moyasar", "NOT_FOUND")),
  };
}

function body(eventId: string, changes: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: eventId,
    secret_token: "unit-secret",
    data: { id: "payment-1", amount: 1, ...changes },
  });
}

function app(local: PaymentRepository, remote = snapshot()) {
  const deps: PaymentWebhookDependencies = {
    provider: provider(remote),
    confirmDeps: { payments: local, events: events() },
    log: () => {},
  };
  return createPaymentWebhookRoutes(deps);
}

function request(raw: string): Request {
  return new Request("http://localhost/webhook/payment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw,
  });
}

describe("payment webhook verified flow", () => {
  it("يرفض السر الخاطئ قبل أي قراءة أو تفعيل", async () => {
    const local = repo();
    const response = await app(local).fetch(
      request(
        JSON.stringify({
          id: "event-secret",
          secret_token: "bad",
          data: { id: "payment-1" },
        }),
      ),
    );
    expect(response.status).toBe(401);
    expect(local.activations()).toBe(0);
  });

  it("يعتمد مبلغ الخادم ويرفض عدم تطابقه مع المعاملة المحلية", async () => {
    const local = repo();
    const response = await app(local, snapshot({ amount: amount + 1 })).fetch(
      request(body("event-amount", { amount: amount })),
    );
    expect(response.status).toBe(422);
    expect(local.activations()).toBe(0);
  });

  it("يرفض الحدث الذي لا يثبت ملكية معاملة محلية", async () => {
    const local = repo();
    const response = await app(
      local,
      snapshot({ metadata: { waslah_transaction_id: "22222222-2222-4222-8222-222222222222" } }),
    ).fetch(request(body("event-unknown")));
    expect(response.status).toBe(422);
    expect(local.activations()).toBe(0);
  });

  it("يسجل فشل الدفعة ولا يفعّل اشتراكاً", async () => {
    const local = repo();
    const response = await app(local, snapshot({ status: "failed" })).fetch(
      request(body("event-failed")),
    );
    expect(response.status).toBe(200);
    expect(local.activations()).toBe(0);
  });

  it("يعيد 2xx للحدث المكرر ولا يفعّل مرتين", async () => {
    const local = repo();
    const route = app(local);
    const raw = body("event-repeat");
    const [first, second] = await Promise.all([
      route.fetch(request(raw)),
      route.fetch(request(raw)),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(local.activations()).toBe(1);
    const results = [await first.json(), await second.json()] as { duplicate: boolean }[];
    expect(results.some((value) => value.duplicate)).toBe(true);
  });
});
