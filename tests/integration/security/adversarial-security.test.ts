/**
 * الغرض: اختبارات انحدار هجومية على قاعدة PostgreSQL والحدود HTTP الفعلية:
 *   نزاهة ويبهوك الدفع، CSRF للخروج، وعزل سطح anon ودوال security definer.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration/security
 * يُتوقع أن يستخدمه لاحقاً: CI وأي مراجعة أمنية دورية.
 * ملاحظات مستقبلية: اختبارات ملكية الرحلة وعزل المدينة الكاملة تبقى في
 *   full-ride وmutual-ratings؛ هذا الملف يثبت الإصلاحات التي اكتشفها الفحص.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
  createAdminAuthPort,
  csrfTokenFor,
  sha256Hex,
} from "../../../apps/gateway/src/admin/auth.ts";
import { createAdminUiRoutes } from "../../../apps/gateway/src/routes/admin-ui.ts";
import { createPaymentWebhookRoutes } from "../../../apps/gateway/src/routes/payment-webhook.ts";
import type {
  PaymentProvider,
  ProviderTransactionSnapshot,
} from "../../../packages/application/financial/ports.ts";
import { PortFailureError } from "../../../packages/application/ports/index.ts";
import { createSql, type Sql } from "../../../packages/infrastructure/db/client.ts";
import {
  createPaymentRepository,
  createWebhookEventStore,
} from "../../../packages/infrastructure/financial/payment-adapters.ts";
import { err, ok } from "../../../packages/shared/result/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_TOKEN = "security-test-provider-token";
const PROVIDER = "security-provider";
const OTHER_PROVIDER = "other-provider";
const TELEGRAM_ID = 989001234;
const ADMIN_TELEGRAM_ID = 989001235;
const IDEMPOTENCY_KEY = `security-webhook-integrity-${Date.now()}`;

let sql: Sql;
let cityId: string;
let transactionId: string;
let adminUserId: string;
let adminToken: string;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

function verifiedRequest(body: string): Request {
  return new Request("http://localhost/webhook/payment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

interface WebhookFixture {
  readonly providerName?: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly localTransactionId?: string;
}

function webhookApp(fixture: WebhookFixture = {}): Hono {
  const provider: PaymentProvider = {
    name: fixture.providerName ?? PROVIDER,
    chargeSubscription: async () =>
      err(new PortFailureError("security-fixture", "لا يستعمل الاختبار بدء الدفع")),
    verifyWebhook: async (raw) => {
      let event: { eventId?: unknown; providerTransactionId?: unknown; token?: unknown };
      try {
        event = JSON.parse(raw) as typeof event;
      } catch {
        return err(new PortFailureError("security-fixture", "جسم غير صالح"));
      }
      if (
        event.token !== WEBHOOK_TOKEN ||
        typeof event.eventId !== "string" ||
        typeof event.providerTransactionId !== "string"
      ) {
        return err(new PortFailureError("security-fixture", "حدث غير موثّق"));
      }
      return ok({
        id: event.eventId,
        type: "payment.updated",
        providerTransactionId: event.providerTransactionId,
      });
    },
    fetchTransaction: async (providerTransactionId) =>
      ok({
        id: providerTransactionId,
        status: "failed",
        amount: fixture.amount ?? 1200,
        currency: fixture.currency ?? "SAR",
        metadata: {
          waslah_transaction_id: fixture.localTransactionId ?? transactionId,
        },
        invoiceId: null,
      } satisfies ProviderTransactionSnapshot),
  };
  return createPaymentWebhookRoutes({
    provider,
    confirmDeps: {
      payments: createPaymentRepository(sql, async (driverId) => {
        const rows = await sql<{ city_id: string }[]>`
          select city_id from drivers where id = ${driverId}::uuid
        `;
        return rows[0]?.city_id ?? null;
      }),
      events: createWebhookEventStore(sql),
    },
  });
}

function logoutApp() {
  const app = new Hono();
  app.route(
    "/admin",
    createAdminUiRoutes({
      sql,
      auth: createAdminAuthPort(sql),
      codeSender: { send: async () => true },
    }),
  );
  return app;
}

async function cleanupFixture(): Promise<void> {
  await sql`
    delete from webhook_events
     where transaction_id in (
       select p.id
         from payment_transactions p
         join drivers d on d.id = p.payer_driver_id
         join users u on u.id = d.user_id
        where u.telegram_id = ${TELEGRAM_ID}
     )
  `;
  await sql`
    delete from payment_transactions
     where payer_driver_id in (
       select d.id from drivers d join users u on u.id = d.user_id
        where u.telegram_id = ${TELEGRAM_ID}
     )
  `;
  await sql`
    delete from audit_log
     where actor_user_id in (
       select id from users where telegram_id in (${TELEGRAM_ID}, ${ADMIN_TELEGRAM_ID})
     )
  `;
  await sql`
    delete from admin_sessions
     where user_id in (
       select id from users where telegram_id in (${TELEGRAM_ID}, ${ADMIN_TELEGRAM_ID})
     )
  `;
  await sql`
    delete from drivers
     where user_id in (
       select id from users where telegram_id = ${TELEGRAM_ID}
     )
  `;
  await sql`delete from users where telegram_id in (${TELEGRAM_ID}, ${ADMIN_TELEGRAM_ID})`;
}

async function paymentStatus(): Promise<string | null> {
  const rows = await sql<{ status: string }[]>`
    select status from payment_transactions where id = ${transactionId}::uuid
  `;
  return rows[0]?.status ?? null;
}

describeIf("الفحص الهجومي الفعلي: ويبهوك ودخول وقاعدة", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    await cleanupFixture();
    const cities = await sql<{ id: string }[]>`select id from cities order by code limit 1`;
    cityId = cities[0]?.id ?? "";
    if (cityId === "") throw new Error("لا توجد مدينة لاختبار الأمن");

    const user = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, role)
      values (${cityId}::uuid, ${TELEGRAM_ID}, 'سائق أمن الدفع', '+966598900123', 'driver')
      returning id
    `;
    const driverUserId = user[0]?.id;
    if (driverUserId === undefined) throw new Error("تعذر زرع سائق الأمن");

    const driver = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status)
      values (${cityId}::uuid, ${driverUserId}::uuid, 'verified')
      returning id
    `;
    const driverId = driver[0]?.id;
    if (driverId === undefined) throw new Error("تعذر زرع ملف السائق");

    const payment = await sql<{ id: string }[]>`
      insert into payment_transactions
        (city_id, payer_driver_id, amount_minor, currency, provider, provider_transaction_id,
         status, idempotency_key, metadata)
      values (${cityId}::uuid, ${driverId}::uuid, 1200, 'SAR', ${PROVIDER},
              'provider-secure-transaction', 'pending', ${IDEMPOTENCY_KEY},
              ${sql.json({ plan: "transport" })})
      returning id
    `;
    transactionId = payment[0]?.id ?? "";
    if (transactionId === "") throw new Error("تعذر زرع معاملة الدفع");

    const admin = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, role)
      values (${cityId}::uuid, ${ADMIN_TELEGRAM_ID}, 'مسؤول أمن', '+966598900124', 'admin')
      returning id
    `;
    adminUserId = admin[0]?.id ?? "";
    if (adminUserId === "") throw new Error("تعذر زرع مسؤول الأمن");
    adminToken = "security-admin-session-token";
    const opened = await createAdminAuthPort(sql).openSession(
      adminUserId,
      sha256Hex(adminToken),
      "security-test",
    );
    if (!opened.ok || !opened.value.ok) throw new Error("تعذر فتح جلسة مسؤول الأمن");
  });

  afterAll(async () => {
    if (DATABASE_URL === undefined) return;
    try {
      await cleanupFixture();
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("حمولة مزوّرة لا تفرض مبلغها: لقطة المزوّد المخالفة لا تغيّر معاملة حقيقية", async () => {
    const body = JSON.stringify({
      token: WEBHOOK_TOKEN,
      eventId: "security-tampered-amount",
      providerTransactionId: "provider-secure-transaction",
      amount: 1,
    });
    const altered = await webhookApp({ amount: 1 }).fetch(verifiedRequest(body));
    expect(altered.status).toBe(422);
    expect(await paymentStatus()).toBe("pending");
  });

  it("ويبهوك من مزود آخر لا يستطيع تأكيد معاملة مزودنا ولا يحرق حدثاً قابلاً للإعادة", async () => {
    const body = JSON.stringify({
      token: WEBHOOK_TOKEN,
      eventId: "security-wrong-provider",
      providerTransactionId: "provider-secure-transaction",
    });
    const rejected = await webhookApp({ providerName: OTHER_PROVIDER }).fetch(
      verifiedRequest(body),
    );
    expect(rejected.status).toBe(422);
    expect(await paymentStatus()).toBe("pending");

    const events = await sql<{ n: number }[]>`
      select count(*)::int as n from webhook_events where event_id = 'security-wrong-provider'
    `;
    expect(events[0]?.n).toBe(0);
  });

  it("إعادة نفس حدث الدفع لا تنشئ حدثاً أو تحولاً ثانياً", async () => {
    const body = JSON.stringify({
      token: WEBHOOK_TOKEN,
      eventId: "security-replay",
      providerTransactionId: "provider-secure-transaction",
    });
    const app = webhookApp();
    const first = await app.fetch(verifiedRequest(body));
    const second = await app.fetch(verifiedRequest(body));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(((await first.json()) as { duplicate: boolean }).duplicate).toBe(false);
    expect(((await second.json()) as { duplicate: boolean }).duplicate).toBe(true);

    const events = await sql<{ n: number }[]>`
      select count(*)::int as n from webhook_events where event_id = 'security-replay'
    `;
    expect(events[0]?.n).toBe(1);
    expect(await paymentStatus()).toBe("failed");
  });

  it("حدث مزوّر بلا إثبات ربط بمعاملة محلية لا يُسجّل ولا يغيّر أي صف", async () => {
    const body = JSON.stringify({
      token: WEBHOOK_TOKEN,
      eventId: "security-unowned-transaction",
      providerTransactionId: "provider-unowned-transaction",
    });
    const rejected = await webhookApp({
      localTransactionId: "00000000-0000-4000-8000-000000000001",
    }).fetch(verifiedRequest(body));
    expect(rejected.status).toBe(422);

    const events = await sql<{ n: number }[]>`
      select count(*)::int as n from webhook_events where event_id = 'security-unowned-transaction'
    `;
    expect(events[0]?.n).toBe(0);
  });

  it("POST خروج بلا CSRF لا يبطل جلسة مسؤول حقيقية", async () => {
    const app = logoutApp();
    const cookie = `waslah_admin=${adminToken}`;
    const missing = await app.fetch(
      new Request("http://localhost/admin/logout", { method: "POST", headers: { cookie } }),
    );
    expect(missing.status).toBe(403);

    const stillOpen = await sql<{ revoked_at: Date | null }[]>`
      select revoked_at from admin_sessions where user_id = ${adminUserId}::uuid
    `;
    expect(stillOpen[0]?.revoked_at).toBeNull();

    const tokenHash = sha256Hex(adminToken);
    const valid = await app.fetch(
      new Request("http://localhost/admin/logout", {
        method: "POST",
        headers: { cookie },
        body: new URLSearchParams({ csrf: csrfTokenFor(tokenHash) }),
      }),
    );
    expect(valid.status).toBe(303);
    const revoked = await sql<{ revoked_at: Date | null }[]>`
      select revoked_at from admin_sessions where user_id = ${adminUserId}::uuid
    `;
    expect(revoked[0]?.revoked_at).not.toBeNull();
  });

  it("دور anon لا يقرأ أي جدول من جداول التطبيق ولا ينفذ أية دالة مملوكة", async () => {
    const tables = await sql<{ relname: string; readable: boolean }[]>`
      select c.relname, has_table_privilege('anon', c.oid, 'select') as readable
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'spatial_ref_sys'
    `;
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.every((table) => !table.readable)).toBe(true);

    await sql.begin(async (tx) => {
      await tx`set local role anon`;
      const identity = await tx<{ role: string }[]>`select current_user as role`;
      expect(identity[0]?.role).toBe("anon");
      const functions = await tx<{ executable: boolean }[]>`
        select has_function_privilege(current_user, p.oid, 'execute') as executable
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and not exists (
             select 1 from pg_depend d
              where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
           )
      `;
      expect(functions.every((fn) => !fn.executable)).toBe(true);
    });

    const unsafeDefiners = await sql<{ sig: string }[]>`
      select p.oid::regprocedure::text as sig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         and not coalesce(p.proconfig, array[]::text[]) @> array['search_path=public']::text[]
    `;
    expect(unsafeDefiners.length).toBe(0);
  });
});
