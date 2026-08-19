/**
 * الغرض: مسار دفع اشتراك فعلي: قاعدة PostgreSQL + Moyasar محلي + ويبهوك + دفتر الأستاذ.
 * الحالة: منفّذ فعلياً؛ يثبت أن السباق على حدث واحد لا يفعّل أو يسجل مرتين.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: حماية التوصيل بين provider والـRPC ومسار HTTP.
 * ملاحظات مستقبلية: الخادم محلي ويقلد API فقط؛ لا يوجد اتصال بمزوّد خارجي في الاختبار.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createPaymentWebhookRoutes } from "../../apps/gateway/src/routes/payment-webhook.ts";
import { subscribePlan } from "../../packages/application/financial/subscribe-plan.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createMoyasarProvider } from "../../packages/infrastructure/financial/moyasar-provider.ts";
import {
  createPaymentRepository,
  createWebhookEventStore,
} from "../../packages/infrastructure/financial/payment-adapters.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIf = databaseUrl === undefined ? describe.skip : describe;
let sql: Sql;
let sequence = 0;
const base = 7_600_000_000 + (Date.now() % 300_000_000);

async function fixture() {
  sequence += 1;
  const city = (await sql<{ id: string }[]>`select id from cities order by code limit 1`)[0];
  if (city === undefined) throw new Error("CITY_NOT_FOUND");
  const user = (
    await sql<{ id: string }[]>`
    insert into users(city_id,telegram_id,full_name,phone,role)
    values(${city.id},${base + sequence},${`دفع حقيقي ${sequence}`},${`+9665${String(base + sequence).slice(-8)}`},'driver')
    returning id
  `
  )[0];
  if (user === undefined) throw new Error("USER_NOT_FOUND");
  const driver = (
    await sql<{ id: string }[]>`
    insert into drivers(city_id,user_id,vehicle_type,plate_number)
    values(${city.id},${user.id},'sedan',${`PAY-${base + sequence}`}) returning id
  `
  )[0];
  if (driver === undefined) throw new Error("DRIVER_NOT_FOUND");
  return { cityId: city.id, driverId: driver.id };
}

beforeAll(() => {
  if (databaseUrl !== undefined) sql = createSql({ connectionString: databaseUrl });
});
afterAll(async () => {
  if (databaseUrl !== undefined) await sql.end();
});

describeIf("real subscription payment path", () => {
  it("ينشئ checkout ثم يعيد قراءة الدفعة ويُفعّل الاشتراك ودفتره مرة واحدة تحت السباق", async () => {
    const f = await fixture();
    let sentMetadata: Record<string, string> | null = null;
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/v1/invoices" && request.method === "POST") {
          const input = (await request.json()) as { metadata: Record<string, string> };
          sentMetadata = input.metadata;
          return Response.json(
            { id: "invoice-real", status: "initiated", url: "https://checkout.local/invoice-real" },
            { status: 201 },
          );
        }
        if (path === "/v1/payments/payment-real" && request.method === "GET") {
          return Response.json({
            id: "payment-real",
            status: "paid",
            amount: 25000,
            currency: "SAR",
            metadata: sentMetadata,
            invoice_id: "invoice-real",
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    try {
      const provider = createMoyasarProvider({
        secretKey: "not-a-real-secret",
        webhookSecret: "webhook-fixture-token",
        callbackUrl: "https://example.invalid/webhook/payment",
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
      });
      const payments = createPaymentRepository(sql, async () => f.cityId);
      const initiated = await subscribePlan(
        {
          driverId: f.driverId as never,
          cityId: f.cityId as never,
          plan: "transport",
          idempotencyKey: `real-payment-${base}-${sequence}`,
        },
        {
          payments,
          provider,
          priceReader: async () => ({ ok: true, value: { amount: 25000, currency: "SAR" } }),
        },
      );
      expect(initiated.ok).toBe(true);
      if (!initiated.ok) return;
      expect(initiated.value.checkoutUrl).toBe("https://checkout.local/invoice-real");

      const route = createPaymentWebhookRoutes({
        provider,
        confirmDeps: { payments, events: createWebhookEventStore(sql) },
        log: () => {},
      });
      const event = JSON.stringify({
        id: `event-real-${base}-${sequence}`,
        type: "payment_paid",
        secret_token: "webhook-fixture-token",
        data: { id: "payment-real", amount: 1, status: "failed" },
      });
      const request = () =>
        new Request("http://localhost/webhook/payment", { method: "POST", body: event });
      const [first, second] = await Promise.all([route.fetch(request()), route.fetch(request())]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const subscriptions = await sql<{ count: number }[]>`
        select count(*)::int as count from subscriptions where driver_id=${f.driverId}::uuid and status='active'
      `;
      const ledger = await sql<{ count: number }[]>`
        select count(*)::int as count from ledger_entries where transaction_id=${initiated.value.transactionId}::uuid
      `;
      const events = await sql<{ count: number }[]>`
        select count(*)::int as count from webhook_events where transaction_id=${initiated.value.transactionId}::uuid
      `;
      expect(subscriptions[0]?.count).toBe(1);
      expect(ledger[0]?.count).toBe(1);
      expect(events[0]?.count).toBe(1);
    } finally {
      server.stop(true);
    }
  });
  /**
   * الانحدار: `activate_subscription` يستبدل المدّة ولا يجمعها، وMoyasar تُنشئ
   * فاتورةً جديدة في كلّ نداء وتُعيد `payment id` مختلفاً عن `invoice id`. فمعاملةٌ
   * واحدة بفاتورتين تعني إمّا دفعتين لشهرٍ واحد أو تفعيلين متعارضين. لذلك يُحفظ
   * الرابط مرّةً واحدة في القاعدة، ويُعاد المحفوظ لا رابطٌ جديد.
   */
  it("النداء الثاني بنفس مفتاح التفرّد يعيد الرابط المحفوظ بلا فاتورة ثانية", async () => {
    const f = await fixture();
    let invoices = 0;
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/v1/invoices" && request.method === "POST") {
          await request.json();
          invoices += 1;
          return Response.json(
            {
              id: `invoice-${invoices}`,
              status: "initiated",
              url: `https://checkout.local/invoice-${invoices}`,
            },
            { status: 201 },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    try {
      const provider = createMoyasarProvider({
        secretKey: "not-a-real-secret",
        webhookSecret: "webhook-fixture-token",
        callbackUrl: "https://example.invalid/webhook/payment",
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
      });
      const payments = createPaymentRepository(sql, async () => f.cityId);
      const deps = {
        payments,
        provider,
        priceReader: async () => ({ ok: true as const, value: { amount: 25000, currency: "SAR" } }),
      };
      const input = {
        driverId: f.driverId as never,
        cityId: f.cityId as never,
        plan: "transport" as const,
        idempotencyKey: `stored-url-${base}-${sequence}`,
      };
      const first = await subscribePlan(input, deps as never);
      const second = await subscribePlan(input, deps as never);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!(first.ok && second.ok)) return;
      expect(invoices).toBe(1);
      expect(first.value.checkoutUrl).toBe("https://checkout.local/invoice-1");
      expect(second.value.checkoutUrl).toBe(first.value.checkoutUrl);
      expect(second.value.transactionId).toBe(first.value.transactionId);

      // الحفظ مرّةٌ واحدة: نداءٌ مباشر برابطٍ آخر يُرفض حفظه ويُعيد المحفوظ.
      const again = await sql<{ result: { stored: boolean; checkout_url: string } }[]>`
        select record_payment_checkout(${first.value.transactionId}::uuid,'https://evil.local/x') as result
      `;
      expect(again[0]?.result.stored).toBe(false);
      expect(again[0]?.result.checkout_url).toBe("https://checkout.local/invoice-1");

      // رابطٌ فارغ مرفوض بردٍّ صريح لا باستثناءٍ يُبتلع، ولا يمسّ المحفوظ.
      const empty = await sql<{ result: { ok: boolean; error: string } }[]>`
        select record_payment_checkout(${first.value.transactionId}::uuid,'   ') as result
      `;
      expect(empty[0]?.result.ok).toBe(false);
      expect(empty[0]?.result.error).toBe("CHECKOUT_URL_REQUIRED");
      const kept = await sql<{ url: string }[]>`
        select metadata #>> '{checkout_url}' as url
          from payment_transactions where id=${first.value.transactionId}::uuid
      `;
      expect(kept[0]?.url).toBe("https://checkout.local/invoice-1");
    } finally {
      server.stop(true);
    }
  });
});
