/**
 * الغرض: مراجعة الدفعات المعلّقة على قاعدة PostgreSQL حقيقية وخادم Tap محلي —
 *   إثبات أنّ دفعةً ضاع ويبهوكها تُحسم بالسؤال، مرّةً واحدة لا أكثر.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: حماية record_payment_provider_reference و
 *   list_stale_pending_payments وحالة reconcilePendingPayments من أي تعديل.
 * ملاحظات مستقبلية: الخادم محلي ويقلّد API Tap فقط؛ لا اتصال بمزوّد خارجي.
 *
 * لا mocks هنا: القاعدة حقيقية، والدوالّ هي دوالّ الإنتاج، والمزوّد خادم HTTP
 * فعليّ يردّ ما يردّه Tap. وما يُختبر هو التوصيل نفسه — وهو بعينه ما لا يثبته
 * اختبار وحدة بمزدوجات.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { reconcilePendingPayments } from "../../packages/application/financial/index.ts";
import { subscribePlan } from "../../packages/application/financial/subscribe-plan.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createPaymentRepository } from "../../packages/infrastructure/financial/payment-adapters.ts";
import { createTapProvider } from "../../packages/infrastructure/financial/tap-provider.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIf = databaseUrl === undefined ? describe.skip : describe;
let sql: Sql;
let sequence = 0;
const base = 7_300_000_000 + (Date.now() % 200_000_000);

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
    values(${city.id},${base + sequence},${`مراجعة ${sequence}`},${`+9665${String(base + sequence).slice(-8)}`},'driver')
    returning id
  `
  )[0];
  if (user === undefined) throw new Error("USER_NOT_FOUND");
  const driver = (
    await sql<{ id: string }[]>`
    insert into drivers(city_id,user_id,vehicle_type,plate_number)
    values(${city.id},${user.id},'sedan',${`REC-${base + sequence}`}) returning id
  `
  )[0];
  if (driver === undefined) throw new Error("DRIVER_NOT_FOUND");
  return { cityId: city.id, driverId: driver.id };
}

/** خادم Tap محلي: ينشئ دفعة معلّقة، ثم يردّ عليها بما يُطلب منه عند إعادة القراءة. */
function tapServer(settled: () => Record<string, unknown>) {
  const charges = new Map<string, Record<string, string>>();
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/v2/charges" && request.method === "POST") {
        const body = (await request.json()) as { metadata: Record<string, string> };
        const id = `chg_${base}_${charges.size + 1}`;
        charges.set(id, body.metadata);
        return Response.json({
          id,
          status: "INITIATED",
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
        return Response.json({ id, metadata, ...settled() });
      }
      return new Response("not found", { status: 404 });
    },
  });
  const provider = createTapProvider({
    secretKey: "sk_test_not_a_real_secret",
    redirectUrl: "https://example.invalid/paid",
    baseUrl: `http://127.0.0.1:${server.port}/v2`,
  });
  return { server, provider };
}

/** يُنشئ دفعةً معلّقة عبر مسار الإنتاج نفسه، ويعيد معرّفها ومعرّف Tap المحفوظ. */
async function pendingPayment(
  f: Fixture,
  provider: ReturnType<typeof createTapProvider>,
): Promise<{ transactionId: string; providerTransactionId: string }> {
  const payments = createPaymentRepository(sql, async () => f.cityId);
  const initiated = await subscribePlan(
    {
      driverId: f.driverId as never,
      cityId: f.cityId as never,
      plan: "transport",
      idempotencyKey: `reconcile-${base}-${sequence}`,
    },
    {
      payments,
      provider,
      priceReader: async () => ({ ok: true, value: { amount: 25_000, currency: "SAR" } }),
    } as never,
  );
  if (!initiated.ok) throw new Error(`SUBSCRIBE_FAILED: ${initiated.error.detail}`);
  const row = (
    await sql<{ provider_transaction_id: string | null }[]>`
      select provider_transaction_id from payment_transactions
       where id = ${initiated.value.transactionId}::uuid
    `
  )[0];
  // هذا هو التوكيد الأهم في الملف: بلا مرجعٍ محفوظ لحظة الشحن لا مراجعة أصلاً.
  if (row?.provider_transaction_id == null) throw new Error("PROVIDER_REFERENCE_NOT_PERSISTED");
  return {
    transactionId: initiated.value.transactionId,
    providerTransactionId: row.provider_transaction_id,
  };
}

async function counts(transactionId: string, driverId: string) {
  const [subscriptions, ledger, events] = await Promise.all([
    sql<{ count: number }[]>`
      select count(*)::int as count from subscriptions
       where driver_id=${driverId}::uuid and status='active'`,
    sql<{ count: number }[]>`
      select count(*)::int as count from ledger_entries
       where transaction_id=${transactionId}::uuid`,
    sql<{ event_id: string }[]>`
      select event_id from webhook_events where transaction_id=${transactionId}::uuid`,
  ]);
  return {
    subscriptions: subscriptions[0]?.count ?? 0,
    ledger: ledger[0]?.count ?? 0,
    events: events.map((row) => row.event_id),
  };
}

beforeAll(() => {
  if (databaseUrl !== undefined) sql = createSql({ connectionString: databaseUrl });
});
afterAll(async () => {
  if (databaseUrl !== undefined) await sql.end();
});

describeIf("مراجعة الدفعات المعلّقة على القاعدة الحقيقية", () => {
  /**
   * السيناريو الذي جاءت المراجعة له: السائق دفع، والويبهوك لم يصل قطّ. لا شيء في
   * النظام كان يلاحظ هذا الصفّ، ولا سبيل كان إلى سؤال المزوّد عنه.
   */
  it("تحسم دفعةً ضاع ويبهوكها وتُفعّل الاشتراك مرّةً واحدة", async () => {
    const f = await fixture();
    const { server, provider } = tapServer(() => ({
      status: "CAPTURED",
      amount: 250,
      currency: "SAR",
    }));
    try {
      const created = await pendingPayment(f, provider);
      const payments = createPaymentRepository(sql, async () => f.cityId);

      // قبل الحسم: لا اشتراك ولا قيد ولا حدث. الويبهوك لم يصل.
      const before = await counts(created.transactionId, f.driverId);
      expect(before.subscriptions).toBe(0);
      expect(before.ledger).toBe(0);
      expect(before.events).toHaveLength(0);

      // الحدّ الأدنى للعمر حقيقيّ لا مُعطَّل: ننتظره بدل أن نُلغيه.
      await Bun.sleep(1_100);
      const first = await reconcilePendingPayments(
        { cityId: f.cityId, olderThanSeconds: 1, maxAgeSeconds: 3_600, limit: 50 },
        { payments, provider },
      );
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      // المدينة مشتركة بين تجهيزات الملف، فالعدّادات الكلّية لا تُقيَّد بالتساوي:
      // الدقّة المطلوبة هي حالة صفّنا نفسه، وهي ما يُؤكَّد بعدها صفّاً صفّاً.
      expect(first.value.examined).toBeGreaterThanOrEqual(1);
      expect(first.value.settled).toBeGreaterThanOrEqual(1);

      const after = await counts(created.transactionId, f.driverId);
      expect(after.subscriptions).toBe(1);
      expect(after.ledger).toBe(1);
      expect(after.events).toEqual([`reconcile:tap:${created.providerTransactionId}:active`]);

      // الحالة صارت نهائية والمرجع مكتوباً، فالدورة الثانية لا ترى شيئاً.
      const second = await reconcilePendingPayments(
        { cityId: f.cityId, olderThanSeconds: 1, maxAgeSeconds: 3_600, limit: 50 },
        { payments, provider },
      );
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      // صفّنا لم يعد مرشّحاً: حالته نهائية ومرجعه مكتوب.
      const stillListed = await sql<{ id: string }[]>`
        select id from payment_transactions
         where id=${created.transactionId}::uuid and status in ('pending','past_due')`;
      expect(stillListed).toHaveLength(0);
      expect(second.value.settled).toBe(0);

      const settled = await counts(created.transactionId, f.driverId);
      expect(settled.subscriptions).toBe(1);
      expect(settled.ledger).toBe(1);
      expect(settled.events).toHaveLength(1);
    } finally {
      server.stop(true);
    }
  });

  /**
   * لقطةٌ لا تطابق الصفّ لا تُحسم. هذا ليس عطلاً عابراً يُعاد المحاولة عليه بل
   * تناقضٌ يحتاج بشراً، فيُعدّ فشلاً صريحاً لا «ما زالت معلّقة».
   */
  it("ترفض حسم دفعةٍ لا يطابق مبلغُها عند المزوّد مبلغَ الصفّ", async () => {
    const f = await fixture();
    const { server, provider } = tapServer(() => ({
      status: "CAPTURED",
      amount: 900,
      currency: "SAR",
    }));
    try {
      const created = await pendingPayment(f, provider);
      const payments = createPaymentRepository(sql, async () => f.cityId);
      await Bun.sleep(1_100);
      const report = await reconcilePendingPayments(
        { cityId: f.cityId, olderThanSeconds: 1, maxAgeSeconds: 3_600, limit: 50 },
        { payments, provider },
      );
      expect(report.ok).toBe(true);
      if (!report.ok) return;
      expect(report.value.failed).toBeGreaterThanOrEqual(1);
      expect(report.value.settled).toBe(0);
      const status = await sql<{ status: string }[]>`
        select status from payment_transactions where id=${created.transactionId}::uuid`;
      expect(status[0]?.status).toBe("pending");

      const after = await counts(created.transactionId, f.driverId);
      expect(after.subscriptions).toBe(0);
      expect(after.ledger).toBe(0);
      expect(after.events).toHaveLength(0);
    } finally {
      server.stop(true);
    }
  });

  it("تترك الدفعة معلّقة ما دام المزوّد يقول إنّها لم تُحسم", async () => {
    const f = await fixture();
    const { server, provider } = tapServer(() => ({
      status: "INITIATED",
      amount: 250,
      currency: "SAR",
    }));
    try {
      const created = await pendingPayment(f, provider);
      const payments = createPaymentRepository(sql, async () => f.cityId);
      await Bun.sleep(1_100);
      const report = await reconcilePendingPayments(
        { cityId: f.cityId, olderThanSeconds: 1, maxAgeSeconds: 3_600, limit: 50 },
        { payments, provider },
      );
      expect(report.ok).toBe(true);
      if (!report.ok) return;
      expect(report.value.stillPending).toBeGreaterThanOrEqual(1);
      expect(report.value.settled).toBe(0);
      const after = await counts(created.transactionId, f.driverId);
      expect(after.subscriptions).toBe(0);
      expect(after.ledger).toBe(0);
      expect(after.events).toHaveLength(0);
      const status = await sql<{ status: string }[]>`
        select status from payment_transactions where id=${created.transactionId}::uuid`;
      expect(status[0]?.status).toBe("pending");
    } finally {
      server.stop(true);
    }
  });

  it("عقد record_payment_provider_reference: ملكيّة ومرجعٌ واحد لا يُستبدل", async () => {
    const f = await fixture();
    const { server, provider } = tapServer(() => ({
      status: "INITIATED",
      amount: 250,
      currency: "SAR",
    }));
    try {
      const created = await pendingPayment(f, provider);
      const call = async (txId: string, providerName: string, ref: string) =>
        (
          await sql<{ result: { ok: boolean; error?: string; stored?: boolean } }[]>`
            select record_payment_provider_reference(${txId}::uuid,${providerName},${ref}) as result
          `
        )[0]?.result;

      // نفس المرجع مرّةً ثانية: مسار إعادة المحاولة الطبيعي، لا خطأ ولا استبدال.
      const again = await call(created.transactionId, "tap", created.providerTransactionId);
      expect(again?.ok).toBe(true);
      expect(again?.stored).toBe(false);

      // مرجعٌ ثانٍ مختلف يعني عمليتين عند المزوّد لمعاملةٍ واحدة.
      const other = await call(created.transactionId, "tap", "chg_SOMETHING_ELSE");
      expect(other?.ok).toBe(false);
      expect(other?.error).toBe("PROVIDER_TRANSACTION_MISMATCH");

      // مزوّدٌ لا يملك الصفّ لا يكتب فيه.
      const foreign = await call(created.transactionId, "moyasar", created.providerTransactionId);
      expect(foreign?.ok).toBe(false);
      expect(foreign?.error).toBe("PROVIDER_MISMATCH");

      const empty = await call(created.transactionId, "tap", "   ");
      expect(empty?.ok).toBe(false);
      expect(empty?.error).toBe("PROVIDER_TRANSACTION_ID_REQUIRED");

      const missing = (
        await sql<{ result: { ok: boolean; error?: string } }[]>`
          select record_payment_provider_reference(gen_random_uuid(),'tap','chg_x') as result
        `
      )[0]?.result;
      expect(missing?.ok).toBe(false);
      expect(missing?.error).toBe("TRANSACTION_NOT_FOUND");

      // صفٌّ نهائيّ بمرجعٍ محفوظ: نفس المرجع يبقى ردّاً صادقاً بلا كتابة —
      // `stored: false` يقول الحقيقة، ورفضُه كان سيجعل إعادة المحاولة خطأً.
      await sql`update payment_transactions set status='canceled' where id=${created.transactionId}::uuid`;
      const terminalSameRef = await call(
        created.transactionId,
        "tap",
        created.providerTransactionId,
      );
      expect(terminalSameRef?.ok).toBe(true);
      expect(terminalSameRef?.stored).toBe(false);

      // وصفٌّ نهائيّ بلا مرجع لا يُكتب فيه مرجعٌ أبداً: كتابته تجعل صفّاً محسوماً
      // مرشّحاً للمراجعة من جديد، فيُسأل المزوّد عن دفعةٍ انتهى أمرها.
      const terminalNoRef = (
        await sql<{ id: string }[]>`
          insert into payment_transactions
            (city_id,payer_driver_id,payee_id,purpose,amount_minor,currency,provider,status,idempotency_key,metadata)
          values (${f.cityId}::uuid,${f.driverId}::uuid,'platform','driver_subscription',
                  25000,'SAR','tap','canceled',${`terminal-no-ref-${base}-${sequence}`},'{}'::jsonb)
          returning id`
      )[0];
      if (terminalNoRef === undefined) throw new Error("INSERT_FAILED");
      const terminal = await call(terminalNoRef.id, "tap", "chg_after_the_fact");
      expect(terminal?.ok).toBe(false);
      expect(terminal?.error).toBe("TRANSACTION_NOT_PENDING");
    } finally {
      server.stop(true);
    }
  });

  it("عقد list_stale_pending_payments: حدّان زمنيان ونطاق مدينة", async () => {
    const f = await fixture();
    const { server, provider } = tapServer(() => ({
      status: "INITIATED",
      amount: 250,
      currency: "SAR",
    }));
    try {
      const created = await pendingPayment(f, provider);
      const list = async (cityId: string, older: number, maxAge: number, limit: number) =>
        (
          await sql<{ result: { ok: boolean; error?: string; transactions?: { id: string }[] } }[]>`
            select list_stale_pending_payments(
              ${cityId}::uuid,${older}::integer,${maxAge}::integer,${limit}::integer
            ) as result
          `
        )[0]?.result;

      // العمر الحقيقي للصفّ هنا ~2.2 ثانية، وعليه تُحسب الحدود: سقفُ عمرٍ أقصر
      // من عمر الصفّ هو ما يُخرجه، لا سقفٌ أطول منه.
      await Bun.sleep(2_200);
      const included = await list(f.cityId, 1, 3_600, 50);
      expect(included?.ok).toBe(true);
      expect(included?.transactions?.some((row) => row.id === created.transactionId)).toBe(true);

      // لم يمضِ ما يكفي: السائق قد يكون في صفحة الدفع الآن.
      const tooFresh = await list(f.cityId, 3_600, 7_200, 50);
      expect(tooFresh?.transactions?.some((row) => row.id === created.transactionId)).toBe(false);

      // تجاوزت السقف: فاتورةٌ انتهت عند المزوّد ولن تتغيّر، فلا تُسأل إلى الأبد.
      const tooOld = await list(f.cityId, 1, 2, 50);
      expect(tooOld?.transactions?.some((row) => row.id === created.transactionId)).toBe(false);

      // مدينةٌ أخرى لا ترى صفوف غيرها.
      const otherCity = await list("00000000-0000-4000-8000-000000000000", 1, 3_600, 50);
      expect(otherCity?.ok).toBe(true);
      expect(otherCity?.transactions).toHaveLength(0);

      expect((await list(f.cityId, 0, 3_600, 50))?.error).toBe("OLDER_THAN_SECONDS_REQUIRED");
      expect((await list(f.cityId, 3_600, 3_600, 50))?.error).toBe(
        "MAX_AGE_MUST_EXCEED_OLDER_THAN",
      );
      expect((await list(f.cityId, 1, 3_600, 0))?.error).toBe("LIMIT_REQUIRED");

      const noCity = (
        await sql<{ result: { ok: boolean; error?: string } }[]>`
          select list_stale_pending_payments(null,1,3600,50) as result
        `
      )[0]?.result;
      expect(noCity?.error).toBe("CITY_ID_REQUIRED");
    } finally {
      server.stop(true);
    }
  });
});
