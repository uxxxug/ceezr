/**
 * الغرض: `F11-07` (الشقُّ المملوكُ للمستودَعِ) — توقُّفُ مزوّدِ الدفعِ **محقونٌ على
 *   السِلكِ**: خادمُ Tap محليٌّ يُطفَأُ ويُعلِّقُ ويردُّ 5xx وحمولةً فاسدةً، ومعاملةُ
 *   دفعٍ حقيقيّةٌ على PostgreSQL تُدارُ في كلِّ طورٍ. المعاملةُ تبقى `pending`
 *   بلا فسادٍ ماليٍّ، والسائقُ يستعيدُ رابطَ دفعِهِ بعدَ التعافي (`D-38`)،
 *   والمراجعةُ تُسوّي مرّةً واحدةً.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: حماية subscribe-plan وreconcile-pending-payments
 *   ومسار الويبهوك من أيِّ تعديلٍ يُفسِدُ سلوكَ العطلِ.
 * ملاحظات مستقبلية: الخادم محلي ويقلّد API Tap فقط؛ لا اتصال بمزوّدٍ خارجيٍّ.
 *
 * لا mocks هنا: القاعدة حقيقية، والدوالُّ هي دوالُّ الإنتاج، والمزوّدُ خادمُ HTTP
 * فعليٌّ يردُّ ما يردُّهُ Tap. والعطلُ يُحقَنُ على السِلكِ لا في نتيجةٍ مصنوعةٍ.
 *
 * كلُّ طورٍ في تركيبٍ مستقلٍّ (خادمٌ وسائقٌ ومفتاحُ تفرّدٍ) — درسُ `F11-06`: تركيبٌ
 * واحدٌ متتابعٌ يُخفي الطورَ خلفَ حالةٍ سابقةٍ فلا يُقاسُ الطورُ بل ما بقيَ من سابِقِهِ.
 *
 * ونطاقُ المراجعةِ مدينةٌ لا صفٌّ: فالعدُّ المُسنَدُ إلى حَكَمِ «failure-honest»
 * يُحصَرُ في صفوفِ مزوّدِنا (`tap`) المُرشَّحةِ فعلاً، لأنَّ الصفوفَ الأجنبيّةَ
 * من مزوّداتٍ أخرى تُتخطّى عمداً في المراجعةِ ولا تُعَدُّ فشلاً ولا نجاحاً.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { createPaymentWebhookRoutes } from "../../apps/gateway/src/routes/payment-webhook.ts";
import { reconcilePendingPayments } from "../../packages/application/financial/index.ts";
import { subscribePlan } from "../../packages/application/financial/subscribe-plan.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createPaymentRepository,
  createWebhookEventStore,
} from "../../packages/infrastructure/financial/payment-adapters.ts";
import {
  chargeHashString,
  createTapProvider,
} from "../../packages/infrastructure/financial/tap-provider.ts";
import {
  type ChargeOutageFacts,
  type ChargeRecoveryFacts,
  judgeChargeOutage,
  judgeChargeRecovery,
  judgeReconcileOutage,
  judgeSettlement,
  judgeWebhookOutage,
  OUTAGE_MODES,
  type PaymentOutageMode,
  type ReconcileOutageFacts,
  type SettlementFacts,
  type WebhookOutageFacts,
} from "../../scripts/lib/payment-outage.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIf = databaseUrl === undefined ? describe.skip : describe;
let sql: Sql;
let sequence = 0;
const base = 7_800_000_000 + (Date.now() % 200_000_000);

/** مهلةُ الطلبِ عندَ المزوّدِ في الاختبارِ — قصيرةٌ كي لا يُعلِّقِ الطورُ الاختبارَ. */
const TAP_TIMEOUT_MS = 400;
const TAP_MAX_ATTEMPTS = 2;

interface Fixture {
  readonly cityId: string;
  readonly driverId: string;
}

async function fixture(): Promise<Fixture> {
  sequence += 1;
  const city = (await sql<{ id: string }[]>`select id from cities order by code limit 1`)[0];
  if (city === undefined) throw new Error("CITY_NOT_FOUND");
  const user = (
    await sql<{ id: string }[]>`
    insert into users(city_id,telegram_id,full_name,phone,role)
    values(${city.id},${base + sequence},${`عطل دفع ${sequence}`},${`+9665${String(base + sequence).slice(-8)}`},'driver')
    returning id
  `
  )[0];
  if (user === undefined) throw new Error("USER_NOT_FOUND");
  const driver = (
    await sql<{ id: string }[]>`
    insert into drivers(city_id,user_id,vehicle_type,plate_number)
    values(${city.id},${user.id},'sedan',${`F1107-${base + sequence}`}) returning id
  `
  )[0];
  if (driver === undefined) throw new Error("DRIVER_NOT_FOUND");
  return { cityId: city.id, driverId: driver.id };
}

/** حالةُ الدفعةِ عندَ الخادمِ المحليِّ — تُقلَبُ لاختبارِ التعافي. */
type ChargeState = "INITIATED" | "CAPTURED";

/**
 * خادمُ Tap محليٌّ بأطوارِ عطلٍ محقونةٍ على السِلكِ. الطورُ `stopped` يُطبَّقُ بإطفاءِ
 * الخادمِ من خارجٍ (`server.stop(true)`) لا بعلمٍ داخليٍّ — رفضُ الاتصالِ لا يبلغُ
 * المعالِجَ أصلاً.
 */
function tapOutageServer() {
  let mode: PaymentOutageMode | "healthy" = "healthy";
  let chargeState: ChargeState = "INITIATED";
  const chargeRequests: unknown[] = [];
  const readRequests: string[] = [];
  const charges = new Map<string, Record<string, string>>();
  const server = Bun.serve({
    port: 0,
    idleTimeout: 255,
    async fetch(request) {
      const url = new URL(request.url);
      // العدُّ قبلَ سلوكِ الطورِ: طلباتُ الشحنةِ التي بلغَت السِلكَ تُحصى ولو ردَّ
      // الطورُ خطأً أو علَّقَ — فالعطلُ المحقونُ يُقاسُ بوصولِهِ لا بجوابِهِ.
      const isChargePost = url.pathname === "/v2/charges" && request.method === "POST";
      if (isChargePost) chargeRequests.push(null);
      const isChargeRead = /^\/v2\/charges\/[^/]+$/.test(url.pathname) && request.method === "GET";
      if (isChargeRead) readRequests.push(url.pathname.split("/").pop() ?? "");
      if (mode === "hanging") {
        await new Promise(() => {});
        return new Response("unreachable", { status: 500 });
      }
      if (mode === "server_error") return new Response("upstream down", { status: 500 });
      if (mode === "malformed") return new Response("<not-json>", { status: 200 });
      if (isChargePost) {
        const body = (await request.json()) as { metadata: Record<string, string> };
        const id = `chg_${base}_${sequence}_${charges.size + 1}`;
        charges.set(id, body.metadata);
        chargeRequests.push(body);
        return Response.json({
          id,
          status: chargeState,
          amount: 250,
          currency: "SAR",
          metadata: body.metadata,
          reference: { transaction: body.metadata.waslah_transaction_id },
          transaction: { url: `https://tap.local/pay/${id}` },
        });
      }
      const read = /^\/v2\/charges\/(?<id>[^/]+)$/.exec(url.pathname);
      if (read?.groups !== undefined && request.method === "GET") {
        const id = read.groups.id ?? "";
        const metadata = charges.get(id);
        if (metadata === undefined) return new Response("not found", { status: 404 });
        return Response.json({ id, metadata, status: chargeState, amount: 250, currency: "SAR" });
      }
      return new Response("not found", { status: 404 });
    },
  });
  const provider = createTapProvider({
    secretKey: "sk_test_not_a_real_secret",
    redirectUrl: "https://example.invalid/paid",
    baseUrl: `http://127.0.0.1:${server.port}/v2`,
    timeoutMs: TAP_TIMEOUT_MS,
    maxAttempts: TAP_MAX_ATTEMPTS,
  });
  return {
    server,
    provider,
    set mode(value: PaymentOutageMode | "healthy") {
      mode = value;
    },
    set state(value: ChargeState) {
      chargeState = value;
    },
    get chargeCount() {
      return chargeRequests.length;
    },
    get readCount() {
      return readRequests.length;
    },
  };
}

interface PaymentRowState {
  readonly status: string;
  readonly providerTransactionId: string | null;
}

async function transactionIdForKey(key: string): Promise<string> {
  const row = (
    await sql<{ id: string }[]>`
      select id from payment_transactions where idempotency_key = ${key}
    `
  )[0];
  if (row === undefined) throw new Error("PAYMENT_NOT_FOUND");
  return row.id;
}

async function paymentRow(transactionId: string): Promise<PaymentRowState> {
  const row = (
    await sql<PaymentRowState[]>`
      select status, provider_transaction_id as "providerTransactionId"
        from payment_transactions where id = ${transactionId}::uuid
    `
  )[0];
  if (row === undefined) throw new Error("PAYMENT_ROW_NOT_FOUND");
  return row;
}

async function ledgerCount(transactionId: string): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    select count(*)::int as count from ledger_entries where transaction_id = ${transactionId}::uuid
  `;
  return rows[0]?.count ?? 0;
}

async function activeSubscriptionCount(driverId: string): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    select count(*)::int as count from subscriptions where driver_id = ${driverId}::uuid and status = 'active'
  `;
  return rows[0]?.count ?? 0;
}

async function webhookEventCount(transactionId: string): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    select count(*)::int as count from webhook_events where transaction_id = ${transactionId}::uuid
  `;
  return rows[0]?.count ?? 0;
}

/** الصفوفُ المُرشَّحةُ للمراجعةِ لمزوّدِنا وحدَه — نطاقُ العدِّ الصادقِ للحَكَمِ. */
async function staleTapRowCount(cityId: string): Promise<number> {
  const rows = await sql<{ transactions: unknown }[]>`
    select list_stale_pending_payments(${cityId}::uuid, 1, 86400, 200) as transactions
  `;
  const envelope = rows[0]?.transactions;
  const list = Array.isArray(envelope)
    ? (envelope as { provider: string }[])
    : (((envelope as { transactions?: unknown })?.transactions as
        | { provider: string }[]
        | undefined) ?? []);
  return list.filter((row) => row.provider === "tap").length;
}

/**
 * يزيلُ صفوفَ معاملاتِ هذا السائق (وما يتفرّعُ عنها) كي لا تسرُبَ بينَ الأطوارِ.
 * أحداثُ الويبهوكِ تُحذَفُ أوّلاً: قيدُها الخارجيُّ بلا `on delete cascade`.
 */
async function cleanupPayments(driverId: string): Promise<void> {
  await sql`delete from webhook_events where transaction_id in (
    select id from payment_transactions where payer_driver_id = ${driverId}::uuid
  )`;
  await sql`delete from payment_transactions where payer_driver_id = ${driverId}::uuid`;
}

/** يوقّعُ جسمَ ويبهوكِ Tap كما يوقّعُهُ هو — بالمفتاحِ السرّيِّ نفسِهِ. */
function tapWebhookRequest(
  chargeId: string,
  metadata: Record<string, string>,
  created: string,
): Request {
  const body = JSON.stringify({
    id: chargeId,
    status: "CAPTURED",
    amount: 250,
    currency: "SAR",
    metadata,
    transaction: { created },
    reference: { gateway: "gw-1", payment: "pm-1" },
  });
  const hash = createHmac("sha256", "sk_test_not_a_real_secret")
    .update(
      chargeHashString({
        id: chargeId,
        amount: "250.00",
        currency: "SAR",
        gatewayReference: "gw-1",
        paymentReference: "pm-1",
        status: "CAPTURED",
        created,
      }),
    )
    .digest("hex");
  return new Request("http://localhost/webhook/payment", {
    method: "POST",
    body,
    headers: { hashstring: hash, "content-type": "application/json" },
  });
}

beforeAll(() => {
  if (databaseUrl !== undefined) sql = createSql({ connectionString: databaseUrl });
});
afterAll(async () => {
  if (databaseUrl !== undefined) await sql.end();
});

describeIf("F11-07 — توقُّفُ مزوّدِ الدفعِ محقوناً على السِلكِ", () => {
  for (const mode of OUTAGE_MODES) {
    it(`بدءُ الشحنةِ في طورِ «${mode}» يفشلُ بصدقٍ ولا يُفسِدُ شيئاً، والتعافي يعيدُ للسائقِ رابطَهُ`, async () => {
      const f = await fixture();
      const harness = tapOutageServer();
      const payments = createPaymentRepository(sql, async () => f.cityId);
      const deps = {
        payments,
        provider: harness.provider,
        priceReader: async () => ({
          ok: true as const,
          value: { amount: 25_000, currency: "SAR" },
        }),
      } as never;
      const input = {
        driverId: f.driverId as never,
        cityId: f.cityId as never,
        plan: "transport" as const,
        idempotencyKey: `f11-07-charge-${mode}-${base}-${sequence}`,
      };
      try {
        harness.mode = mode;
        if (mode === "stopped") harness.server.stop(true);

        // (١) المحاولةُ الأولى أثناءَ العطلِ: خطأٌ صادقٌ لا نجاحٌ كاذبٌ.
        const first = await subscribePlan(input, deps);
        expect(first.ok).toBe(false);
        const transactionId = await transactionIdForKey(input.idempotencyKey);
        const outageFacts: ChargeOutageFacts = {
          mode,
          rejected: !first.ok,
          rowStatus: (await paymentRow(transactionId)).status,
          providerReference: (await paymentRow(transactionId)).providerTransactionId,
          ledgerEntries: await ledgerCount(transactionId),
          subscriptionActive: (await activeSubscriptionCount(f.driverId)) > 0,
          wireCalls: harness.chargeCount,
        };
        expect(judgeChargeOutage(outageFacts)).toEqual([]);

        // (٢) إعادةُ المحاولةِ والمعطَّلُ ما زالَ معطِّلاً: خطأٌ صادقٌ ثانٍ —
        // لا نجاحَ برابطٍ `null` (انحدارُ `D-38`).
        const retry = await subscribePlan(input, deps);
        expect(retry.ok).toBe(false);
        expect(
          judgeChargeOutage({
            ...outageFacts,
            rowStatus: (await paymentRow(transactionId)).status,
            wireCalls: harness.chargeCount,
          }),
        ).toEqual([]);

        // (٣) التعافي: المحاولةُ الثالثةُ تُبدأُ الشحنةَ على الصفِّ نفسِهِ وترجِعُ
        // رابطَ دفعٍ حقيقيّاً — جوهرُ «recoverable». وتركيبُ التعافي خادمٌ جديدٌ
        // سليمٌ (خادمُ طورِ «stopped» مطفأٌ لا يُبعَثُ، وبقيتُهُ تصلحُ بالعلمِ وحده).
        const healed = tapOutageServer();
        try {
          const healedDeps = {
            payments,
            provider: healed.provider,
            priceReader: async () => ({
              ok: true as const,
              value: { amount: 25_000, currency: "SAR" },
            }),
          } as never;
          const recovered = await subscribePlan(input, healedDeps);
          expect(recovered.ok).toBe(true);
          if (!recovered.ok) return;
          const row3 = await paymentRow(recovered.value.transactionId);
          const rowsForKey =
            (
              await sql<{ count: number }[]>`
              select count(*)::int as count from payment_transactions
               where idempotency_key = ${input.idempotencyKey}
            `
            )[0]?.count ?? 0;
          const recoveryFacts: ChargeRecoveryFacts = {
            checkoutUrl: recovered.value.checkoutUrl,
            secondChargeStarted: healed.chargeCount > 0,
            rowsForKey,
            rowStatus: row3.status,
            providerReference: row3.providerTransactionId,
            ledgerEntries: await ledgerCount(recovered.value.transactionId),
            subscriptionActive: (await activeSubscriptionCount(f.driverId)) > 0,
          };
          expect(judgeChargeRecovery(recoveryFacts)).toEqual([]);
          expect(recovered.value.checkoutUrl).toContain("https://tap.local/pay/");
        } finally {
          healed.server.stop(true);
        }
      } finally {
        harness.server.stop(true);
        await cleanupPayments(f.driverId);
      }
    });
  }

  it("المراجعةُ أثناءَ العطلِ تُعلنُ فشلَها وتُبقي الصفَّ المعلَّقَ بمرجعِهِ معلَّقاً", async () => {
    const f = await fixture();
    const harness = tapOutageServer();
    const payments = createPaymentRepository(sql, async () => f.cityId);
    const deps = {
      payments,
      provider: harness.provider,
      priceReader: async () => ({ ok: true as const, value: { amount: 25_000, currency: "SAR" } }),
    } as never;
    const input = {
      driverId: f.driverId as never,
      cityId: f.cityId as never,
      plan: "transport" as const,
      idempotencyKey: `f11-07-reconcile-${base}-${sequence}`,
    };
    try {
      // شحنةٌ سليمةٌ أوّلاً: صفٌّ معلَّقٌ بمرجعِ مزوّدٍ (السائقُ في صفحةِ الدفعِ).
      const initiated = await subscribePlan(input, deps);
      expect(initiated.ok).toBe(true);
      if (!initiated.ok) return;
      const transactionId = initiated.value.transactionId;
      expect((await paymentRow(transactionId)).providerTransactionId).not.toBeNull();

      // أقدمُ من حدِّ «لا تُراجَع دفعةٌ لم يمضِ عليها هذا القدرُ».
      await new Promise((resolve) => setTimeout(resolve, 1_200));

      harness.mode = "server_error";
      const tapScopedExamined = await staleTapRowCount(f.cityId);
      const duringOutage = await reconcilePendingPayments(
        { cityId: f.cityId, olderThanSeconds: 1, maxAgeSeconds: 86_400, limit: 200 },
        { payments, provider: harness.provider },
      );
      expect(duringOutage.ok).toBe(true);
      if (!duringOutage.ok) return;
      expect(duringOutage.value.settled).toBe(0);

      const reconcileFacts: ReconcileOutageFacts = {
        mode: "server_error",
        examined: tapScopedExamined,
        failed: duringOutage.value.failed,
        settled: duringOutage.value.settled,
        rowStatus: (await paymentRow(transactionId)).status,
        ledgerEntries: await ledgerCount(transactionId),
        subscriptionActive: (await activeSubscriptionCount(f.driverId)) > 0,
        wireCalls: harness.readCount,
      };
      // صفوفُنا المُرشَّحةُ فشلَ سؤالُها كلُّها: مزوّدُنا هوَ الوحيدُ الحيَّ في
      // هذه الخطوةِ، والصفوفُ الأجنبيّةُ من مزوّدِنا مردُّها 404 = فشلٌ معلَنٌ.
      expect(reconcileFacts.examined).toBeGreaterThan(0);
      expect(judgeReconcileOutage(reconcileFacts)).toEqual([]);
    } finally {
      harness.server.stop(true);
      await cleanupPayments(f.driverId);
    }
  });

  it("التعافي يُسوّي الدفعةَ المعلَّقةَ مرّةً واحدةً: قيدٌ واحدٌ واشتراكٌ واحدٌ", async () => {
    const f = await fixture();
    const harness = tapOutageServer();
    const payments = createPaymentRepository(sql, async () => f.cityId);
    const deps = {
      payments,
      provider: harness.provider,
      priceReader: async () => ({ ok: true as const, value: { amount: 25_000, currency: "SAR" } }),
    } as never;
    const input = {
      driverId: f.driverId as never,
      cityId: f.cityId as never,
      plan: "transport" as const,
      idempotencyKey: `f11-07-settle-${base}-${sequence}`,
    };
    try {
      const initiated = await subscribePlan(input, deps);
      expect(initiated.ok).toBe(true);
      if (!initiated.ok) return;
      const transactionId = initiated.value.transactionId;

      await new Promise((resolve) => setTimeout(resolve, 1_200));

      // السائقُ دفعَ (عندَ المزوّدِ) والويبهوكُ ضاعَ: المراجعةُ هيَ المسارُ الثانيَّ.
      harness.state = "CAPTURED";
      const firstRound = await reconcilePendingPayments(
        { cityId: f.cityId, olderThanSeconds: 1, maxAgeSeconds: 86_400, limit: 200 },
        { payments, provider: harness.provider },
      );
      expect(firstRound.ok).toBe(true);
      if (!firstRound.ok) return;
      expect(firstRound.value.settled).toBeGreaterThanOrEqual(1);

      // الجولةُ الثانيةُ: لا شيءَ يُحسَمُ ولا أثرٌ يتكرَّرُ.
      const secondRound = await reconcilePendingPayments(
        { cityId: f.cityId, olderThanSeconds: 1, maxAgeSeconds: 86_400, limit: 200 },
        { payments, provider: harness.provider },
      );
      expect(secondRound.ok).toBe(true);
      if (!secondRound.ok) return;
      expect(secondRound.value.settled).toBe(0);

      const rowAfter = await paymentRow(transactionId);
      const settlementFacts: SettlementFacts = {
        rowSettledFirstRound: rowAfter.status === "active" ? 1 : 0,
        secondRoundSettled: secondRound.value.settled,
        rowStillStaleAfterSettlement:
          rowAfter.status === "pending" || rowAfter.status === "past_due",
        rowStatus: rowAfter.status,
        ledgerEntries: await ledgerCount(transactionId),
        subscriptionActiveCount: await activeSubscriptionCount(f.driverId),
      };
      expect(judgeSettlement(settlementFacts)).toEqual([]);
      expect(settlementFacts.ledgerEntries).toBe(1);
      expect(settlementFacts.subscriptionActiveCount).toBe(1);
    } finally {
      harness.server.stop(true);
      await cleanupPayments(f.driverId);
    }
  });

  it("الويبهوكُ أثناءَ العطلِ يُردُّ 503 صادقاً ولا يكتبُ حدثاً ولا قيداً", async () => {
    const f = await fixture();
    const harness = tapOutageServer();
    const payments = createPaymentRepository(sql, async () => f.cityId);
    const deps = {
      payments,
      provider: harness.provider,
      priceReader: async () => ({ ok: true as const, value: { amount: 25_000, currency: "SAR" } }),
    } as never;
    const input = {
      driverId: f.driverId as never,
      cityId: f.cityId as never,
      plan: "transport" as const,
      idempotencyKey: `f11-07-webhook-${base}-${sequence}`,
    };
    try {
      const initiated = await subscribePlan(input, deps);
      expect(initiated.ok).toBe(true);
      if (!initiated.ok) return;
      const transactionId = initiated.value.transactionId;
      const providerReference = (await paymentRow(transactionId)).providerTransactionId;
      expect(providerReference).not.toBeNull();

      const route = createPaymentWebhookRoutes({
        provider: harness.provider,
        confirmDeps: { payments, events: createWebhookEventStore(sql) },
        log: () => {},
      });

      harness.mode = "malformed";
      const response = await route.fetch(
        tapWebhookRequest(
          providerReference ?? "chg_unknown",
          {
            waslah_transaction_id: transactionId,
          },
          "1760000000000",
        ),
      );

      const webhookFacts: WebhookOutageFacts = {
        mode: "malformed",
        httpStatus: response.status,
        rowStatus: (await paymentRow(transactionId)).status,
        ledgerEntries: await ledgerCount(transactionId),
        subscriptionActive: (await activeSubscriptionCount(f.driverId)) > 0,
        webhookEventsStored: await webhookEventCount(transactionId),
      };
      expect(judgeWebhookOutage(webhookFacts)).toEqual([]);
      expect(response.status).toBe(503);
    } finally {
      harness.server.stop(true);
      await cleanupPayments(f.driverId);
    }
  });
});
