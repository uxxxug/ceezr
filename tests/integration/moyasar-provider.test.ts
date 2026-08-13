/**
 * الغرض: اختبار محوّل Moyasar عبر خادم HTTP محلي فعلي لا عبر mock لـfetch.
 * الحالة: منفّذ فعلياً؛ يغطي النجاح، 4xx، 5xx مع إعادة المحاولة، المهلة، والرد المشوّه.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: صيانة عقد Moyasar عند ترقية المحوّل.
 * ملاحظات مستقبلية: مفاتيح الاختبار هنا نصوص وهمية صراحةً ولا تصلح عند Moyasar.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { createMoyasarProvider } from "../../packages/infrastructure/financial/moyasar-provider.ts";
import { createPaymentProvider } from "../../packages/infrastructure/financial/payment-provider-factory.ts";

const localSecret = "not-a-real-secret";
const transactionId = "11111111-1111-4111-8111-111111111111" as never;
const driverId = "22222222-2222-4222-8222-222222222222" as never;
const authorization = `Basic ${Buffer.from(`${localSecret}:`, "utf8").toString("base64")}`;

interface RunningServer {
  readonly server: ReturnType<typeof Bun.serve>;
  readonly provider: ReturnType<typeof createMoyasarProvider>;
}
const running: RunningServer[] = [];

function start(handler: (request: Request) => Response | Promise<Response>): RunningServer {
  const server = Bun.serve({ port: 0, fetch: handler });
  const provider = createMoyasarProvider({
    secretKey: localSecret,
    webhookSecret: "local-webhook-token",
    callbackUrl: "https://example.invalid/payment-webhook",
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    timeoutMs: 25,
    maxAttempts: 3,
  });
  const item = { server, provider };
  running.push(item);
  return item;
}

afterEach(() => {
  while (running.length > 0) running.pop()?.server.stop(true);
});

function charge(provider: ReturnType<typeof createMoyasarProvider>) {
  return provider.chargeSubscription({
    transactionId,
    driverId,
    amount: { amount: 25000, currency: "SAR" },
    purpose: "driver_subscription",
    idempotencyKey: "fixture-key",
  });
}

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-1",
    status: "paid",
    amount: 25000,
    currency: "SAR",
    metadata: { waslah_transaction_id: transactionId, idempotency_key: "fixture-key" },
    invoice_id: "invoice-1",
    ...overrides,
  };
}

describe("Moyasar provider over a real local HTTP server", () => {
  it("يختار moyasar وmanual صراحة ويرفض الاسم أو الأسرار غير الصالحة", () => {
    const manual = createPaymentProvider("manual", {});
    expect(manual.ok).toBe(true);
    const unknown = createPaymentProvider("unknown", {});
    expect(unknown.ok).toBe(false);
    const incomplete = createPaymentProvider("moyasar", {
      moyasar: { secretKey: "", webhookSecret: "", callbackUrl: "" },
    });
    expect(incomplete.ok).toBe(false);
  });

  it("ينشئ فاتورة برابط checkout حقيقي ويتحقق من Basic auth ويقرأ الدفعة", async () => {
    let invoiceBody: unknown = null;
    const { provider } = start(async (request) => {
      expect(request.headers.get("authorization")).toBe(authorization);
      if (request.method === "POST" && new URL(request.url).pathname === "/v1/invoices") {
        invoiceBody = await request.json();
        return Response.json(
          { id: "invoice-1", status: "initiated", url: "https://pay.example/invoice-1" },
          { status: 201 },
        );
      }
      if (request.method === "GET" && new URL(request.url).pathname === "/v1/payments/payment-1") {
        return Response.json(payment());
      }
      return new Response("missing", { status: 404 });
    });
    const initiated = await charge(provider);
    expect(initiated.ok).toBe(true);
    if (!initiated.ok) return;
    expect(initiated.value.checkoutUrl).toBe("https://pay.example/invoice-1");
    expect(invoiceBody).not.toBeNull();
    expect(
      (invoiceBody as { metadata: Record<string, string> }).metadata.waslah_transaction_id,
    ).toBe(transactionId);
    const fetched = await provider.fetchTransaction("payment-1");
    expect(fetched.ok).toBe(true);
    if (fetched.ok) expect(fetched.value.status).toBe("active");
  });

  it("لا يعيد محاولة 401 أو 400", async () => {
    for (const status of [401, 400]) {
      let calls = 0;
      const { provider } = start(() => {
        calls += 1;
        return new Response("رفض", { status });
      });
      const result = await charge(provider);
      expect(result.ok).toBe(false);
      expect(calls).toBe(1);
    }
  });

  it("يعيد محاولة 5xx فقط ثم ينجح", async () => {
    let calls = 0;
    const { provider } = start(() => {
      calls += 1;
      if (calls < 3) return new Response("temporary", { status: 503 });
      return Response.json(
        { id: "invoice-1", status: "initiated", url: "https://pay.example/invoice-1" },
        { status: 201 },
      );
    });
    const result = await charge(provider);
    expect(result.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it("ينهي الطلب البطيء بنتيجة خطأ ولا يعلّق", async () => {
    const { provider } = start(async () => {
      await Bun.sleep(100);
      return Response.json(payment());
    });
    const result = await provider.fetchTransaction("payment-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.detail).toBe("MOYASAR_NETWORK_OR_TIMEOUT");
  });

  it("يرفض الردود المشوهة من الفاتورة أو الدفعة", async () => {
    const malformedInvoice = start(() =>
      Response.json({ id: "invoice-1", status: "initiated" }, { status: 201 }),
    );
    const invoice = await charge(malformedInvoice.provider);
    expect(invoice.ok).toBe(false);

    const malformedPayment = start(() => Response.json(payment({ amount: "25000" })));
    const fetched = await malformedPayment.provider.fetchTransaction("payment-1");
    expect(fetched.ok).toBe(false);
  });

  it("يتحقق من secret_token بزمن ثابت قبل استخراج الدفعة", async () => {
    const { provider } = start(() => new Response("unused"));
    const accepted = await provider.verifyWebhook(
      JSON.stringify({
        id: "event-1",
        type: "payment_paid",
        secret_token: "local-webhook-token",
        data: { id: "payment-1" },
      }),
      new Headers(),
    );
    expect(accepted.ok).toBe(true);
    const rejected = await provider.verifyWebhook(
      JSON.stringify({
        id: "event-2",
        type: "payment_paid",
        secret_token: "wrong",
        data: { id: "payment-1" },
      }),
      new Headers(),
    );
    expect(rejected.ok).toBe(false);
  });
});
