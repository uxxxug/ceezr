/**
 * الغرض: اختبارُ مساراتِ فاتورةِ الاشتراكِ (`F3-09` · `SD-08`) على خادمِ البوابةِ
 *   الحقيقيِّ نفسِه: رقمُ كلِّ رفضٍ، و`201` للإصدارِ الأوّلِ و`200` لإعادتِه،
 *   و**أنَّ `GET` لا يكتبُ ألبتّةَ**، وأنَّ التعطيلَ يُعلَنُ `503` لا لوحاً فارغاً،
 *   وأنَّ الجوابَ **لا يحملُ معرِّفَ مزوّدٍ ولا بيانةَ بطاقةٍ**.
 * الحالة: اختبار فعلي — Hono يعالجُ الطلبَ في العمليّةِ نفسِها بلا شبكةٍ ولا قاعدةٍ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test tests/unit` وسلسلةُ `ci`.
 * يُتوقع أن يستخدمه لاحقاً: سطحُ الفاتورةِ في التطبيقِ المُصغَّرِ (الدفعةُ الثانيةُ).
 * يحرسُه: scripts/check-tax-invoice-contract.ts
 * الحاكم: docs/adr/0127-simplified-tax-invoice.md
 *
 * **وحدُّ هذا المِلفِّ مُعلَنٌ (`ح-5`):** المخزنُ ههنا **مُصطنَعٌ**، فما يُثبَتُ هوَ
 * الترجمةُ إلى HTTP وحدَها. أنَّ القاعدةَ لا تُصدِرُ رقمَينِ لتوريدٍ واحدٍ، وأنَّ
 * `TLV` صحيحٌ — في `tests/integration/subscription-tax-invoice.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { createServer } from "../../apps/gateway/src/server.ts";
import type {
  SubscriptionTaxInvoiceStore,
  TaxInvoiceStoreError,
} from "../../packages/application/driver/subscription-invoice-ports.ts";
import type { SimplifiedTaxInvoice } from "../../packages/domain/driver/subscription-invoice.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import { createTestRevocationStore } from "../helpers/revocation-store.ts";

const SESSION_SECRET = "test-only-session-signing-secret-0123456789";
const WEBHOOK_SECRET = "test-webhook-secret-value";
const NOW = new Date("2027-05-04T10:00:00.000Z");
const TELEGRAM_ID = "5550009";
const TXN = "9f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const BASE = `/v1/driver/subscription/payments/${TXN}`;

const FULL_ENV: Record<string, string> = {
  SUPABASE_URL: "https://example.supabase.co",
  DATABASE_URL: "postgres://user:pass@localhost:5432/postgres",
  SUPABASE_SERVICE_ROLE_KEY: "x",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "x",
  DRIVER_BOT_TOKEN: "x",
  RIDER_BOT_TOKEN: "x",
  TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
  BOOTSTRAP_ADMIN_TELEGRAM_ID: "900000",
};

const INVOICE: SimplifiedTaxInvoice = {
  invoiceNumber: "INV-00000007",
  documentType: "SIMPLIFIED_TAX_INVOICE",
  issuedAt: "2027-05-04T09:59:00.000Z",
  transactionId: TXN,
  sellerName: "شركةٌ مُختبَرةٌ",
  sellerVatNumber: "300000000000003",
  vatRateBps: 1500,
  currency: "SAR",
  totalExclVatMinor: 21_739,
  vatAmountMinor: 3261,
  totalInclVatMinor: 25_000,
  qrTlvBase64: "AQEB",
};

interface Options {
  readonly mounted?: boolean;
  readonly configured?: boolean;
  readonly fail?: TaxInvoiceStoreError;
  readonly alreadyIssued?: boolean;
}

/** ما نُودِيَ فعلاً — بهِ يُثبَتُ أنَّ `GET` لم يكتبْ. */
interface Seen {
  readonly calls: string[];
}

function harness(options: Options = {}) {
  const seen: Seen = { calls: [] };
  const store: SubscriptionTaxInvoiceStore = {
    issueInvoice: async () => {
      seen.calls.push("issue");
      if (options.fail !== undefined) return err(options.fail);
      return ok({ invoice: INVOICE, alreadyIssued: options.alreadyIssued === true });
    },
    readInvoice: async () => {
      seen.calls.push("readInvoice");
      if (options.fail !== undefined) return err(options.fail);
      return ok(INVOICE);
    },
    readPaymentStatus: async () => {
      seen.calls.push("readStatus");
      if (options.fail !== undefined) return err(options.fail);
      return ok({
        serverTime: NOW.toISOString(),
        transactionId: TXN,
        status: "active",
        amountMinor: 25_000,
        currency: "SAR",
        createdAt: "2027-05-04T09:58:00.000Z",
        updatedAt: "2027-05-04T09:59:00.000Z",
        checkoutUrl: "https://checkout.example.com/s/abc",
        invoiceIssued: true,
        invoiceIssuable: false,
      });
    },
  };

  const driverSubscriptionInvoice =
    options.mounted === false
      ? undefined
      : {
          ...(options.configured === false
            ? {}
            : {
                invoices: {
                  sessions: createMiniAppSessionReader(SESSION_SECRET),
                  revocation: createTestRevocationStore(),
                  store,
                  now: () => NOW,
                },
              }),
          log: () => {},
        };

  const app = createServer({
    health: { now: () => NOW, startedAt: NOW, env: FULL_ENV },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    ...(driverSubscriptionInvoice === undefined ? {} : { driverSubscriptionInvoice }),
  });
  return { app, seen };
}

function tokenFor(telegramUserId = TELEGRAM_ID): string {
  const issued = createMiniAppSessionIssuer({ secret: SESSION_SECRET }).issue(
    { telegramUserId, bot: "driver", authDateSeconds: Math.floor(NOW.getTime() / 1000) },
    NOW.getTime(),
  );
  if (!issued.ok) throw new Error("إصدارُ رمزٍ فاشلٌ");
  return issued.value.accessToken;
}

async function call(
  h: ReturnType<typeof harness>,
  path: string,
  options: { method?: "GET" | "POST"; authorization?: string | null } = {},
): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  const authorization =
    options.authorization === undefined ? `Bearer ${tokenFor()}` : options.authorization;
  const response = await h.app.fetch(
    new Request(`http://localhost${path}`, {
      method: options.method ?? "GET",
      headers: authorization === null ? {} : { authorization },
    }),
  );
  const text = await response.text();
  return { status: response.status, json: JSON.parse(text) as Record<string, unknown>, text };
}

describe("تركيبٌ غائبٌ — يُعلَنُ ولا يُخفى", () => {
  test("بلا تركيبٍ: المسارُ غيرُ موجودٍ (404 من الخادمِ لا من العقدِ)", async () => {
    const h = harness({ mounted: false });
    const response = await h.app.fetch(new Request(`http://localhost${BASE}`));
    expect(response.status).toBe(404);
  });

  test.each([
    ["حالُ الدفعةِ", BASE, "GET"],
    ["قراءةُ الفاتورةِ", `${BASE}/invoice`, "GET"],
    ["إصدارُ الفاتورةِ", `${BASE}/invoice`, "POST"],
  ] as const)("بلا قاعدةٍ (%s): 503 برمزِ تعطيلٍ لا جوابٌ فارغٌ", async (_name, path, method) => {
    const h = harness({ configured: false });
    const response = await call(h, path, { method });
    expect(response.status).toBe(503);
    expect(response.json.error).toBe("INVOICE_STORE_NOT_AVAILABLE");
    expect(h.seen.calls).toEqual([]);
  });
});

describe("الجلسةُ — بلا رمزٍ لا وثيقةَ", () => {
  test.each([
    ["حالُ الدفعةِ", BASE, "GET"],
    ["قراءةُ الفاتورةِ", `${BASE}/invoice`, "GET"],
    ["إصدارُ الفاتورةِ", `${BASE}/invoice`, "POST"],
  ] as const)("بلا ترويسةٍ (%s): 401 ولا نداءَ مخزنٍ", async (_name, path, method) => {
    const h = harness();
    const response = await call(h, path, { method, authorization: null });
    expect(response.status).toBe(401);
    expect(response.json.error).toBe("SESSION_REQUIRED");
    expect(h.seen.calls).toEqual([]);
  });

  test("ترويسةٌ بلا `Bearer`: 401", async () => {
    const h = harness();
    const response = await call(h, BASE, { authorization: tokenFor() });
    expect(response.status).toBe(401);
    expect(response.json.error).toBe("SESSION_REQUIRED");
  });

  // والرمزُ ههنا **لاتينيٌ عن قصدٍ**: ترويسةُ `HTTP` لا تقبلُ حرفاً فوقَ
  // `latin1`، فنصٌ عربيٌّ يُسقِطُ بناءَ الطلبِ قبلَ أن يبلُغَ الخادمَ — فيُقاسُ
  // منعُ الوِعاءِ لا حكمُ الخادمِ.
  test.each([
    ["ثلاثةُ مقاطعَ مُلفَّقةٌ", "Bearer not.a.token"],
    ["مقطعٌ واحدٌ", "Bearer abcdef"],
    ["توقيعٌ مُبدَّلٌ", `Bearer ${tokenFor().slice(0, -4)}AAAA`],
  ] as const)("رمزٌ مُشوَّهٌ (%s): 401 برمزِ بطلانٍ", async (_name, authorization) => {
    const h = harness();
    const response = await call(h, BASE, { authorization });
    expect(response.status).toBe(401);
    expect(response.json.error).toBe("SESSION_INVALID");
    expect(h.seen.calls).toEqual([]);
  });
});

describe("رقمُ كلِّ رفضٍ — خريطةٌ شاملةٌ لا افتراضَ 500 فيها", () => {
  test.each([
    ["NOT_A_DRIVER", 403, "NOT_A_DRIVER"],
    ["USER_NOT_FOUND", 403, "NOT_A_DRIVER"],
    ["TRANSACTION_NOT_FOUND", 404, "TRANSACTION_NOT_FOUND"],
    ["TRANSACTION_NOT_PAID", 409, "TRANSACTION_NOT_PAID"],
    ["TAX_IDENTITY_NOT_CONFIGURED", 503, "TAX_IDENTITY_NOT_CONFIGURED"],
    ["VAT_RATE_NOT_CONFIGURED", 503, "TAX_IDENTITY_NOT_CONFIGURED"],
    ["INVOICE_NOT_ISSUED", 404, "INVOICE_NOT_ISSUED"],
  ] as const)("«%s» ⇒ %i", async (rejection, status, code) => {
    const h = harness({ fail: { rejection } });
    const response = await call(h, `${BASE}/invoice`, { method: "POST" });
    expect(response.status).toBe(status);
    expect(response.json.error).toBe(code);
  });

  test("معرِّفٌ مُشوَّهٌ في المسارِ ⇒ 422 لا 404", async () => {
    const h = harness();
    const response = await call(h, "/v1/driver/subscription/payments/ليسَ-معرِّفاً/invoice", {
      method: "POST",
    });
    expect(response.status).toBe(422);
    expect(response.json.error).toBe("TRANSACTION_ID_INVALID");
    expect(h.seen.calls).toEqual([]);
  });

  test("عطبُ مخزنٍ ⇒ 503 لا 500 صامتٌ", async () => {
    const h = harness({ fail: { reason: "STORE_ERROR" } });
    const response = await call(h, BASE);
    expect(response.status).toBe(503);
    expect(response.json.error).toBe("INVOICE_STORE_NOT_AVAILABLE");
  });
});

describe("الإصدارُ — 201 مرّةً و200 لما صدرَ", () => {
  test("أوّلُ إصدارٍ: 201 وراية `already_issued` كاذبةٌ", async () => {
    const h = harness();
    const response = await call(h, `${BASE}/invoice`, { method: "POST" });
    expect(response.status).toBe(201);
    expect(response.json.ok).toBe(true);
    expect(response.json.already_issued).toBe(false);
    expect(h.seen.calls).toEqual(["issue"]);
  });

  test("إعادةُ النداءِ: 200 وراية صادقةٌ — **لا رقمَ ثانياً**", async () => {
    const h = harness({ alreadyIssued: true });
    const response = await call(h, `${BASE}/invoice`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(response.json.already_issued).toBe(true);
  });

  test("حقولُ الفاتورةِ كاملةٌ بأسماءٍ ثابتةٍ", async () => {
    const h = harness();
    const response = await call(h, `${BASE}/invoice`, { method: "POST" });
    expect(response.json.invoice).toEqual({
      invoice_number: "INV-00000007",
      document_type: "SIMPLIFIED_TAX_INVOICE",
      issued_at: "2027-05-04T09:59:00.000Z",
      transaction_id: TXN,
      seller_name: "شركةٌ مُختبَرةٌ",
      seller_vat_number: "300000000000003",
      vat_rate_bps: 1500,
      currency: "SAR",
      total_excl_vat_minor: 21_739,
      vat_amount_minor: 3261,
      total_incl_vat_minor: 25_000,
      qr_tlv_base64: "AQEB",
    });
  });

  test("المساراتُ الثلاثةُ **لا تفترقُ حقولُها** — شاكِلٌ واحدٌ", async () => {
    const issued = await call(harness(), `${BASE}/invoice`, { method: "POST" });
    const read = await call(harness(), `${BASE}/invoice`);
    expect(read.json.invoice).toEqual(issued.json.invoice);
  });
});

describe("`GET` لا يكتبُ ألبتّةَ — القاعدةُ الثالثةُ مقيسةً بأثرٍ", () => {
  test("قراءةُ الحالِ تُنادي القراءةَ وحدَها", async () => {
    const h = harness();
    await call(h, BASE);
    expect(h.seen.calls).toEqual(["readStatus"]);
    expect(h.seen.calls).not.toContain("issue");
  });

  test("قراءةُ الفاتورةِ تُنادي القراءةَ وحدَها", async () => {
    const h = harness();
    await call(h, `${BASE}/invoice`);
    expect(h.seen.calls).toEqual(["readInvoice"]);
    expect(h.seen.calls).not.toContain("issue");
  });

  test("عشرُ قراءاتٍ متتاليةٍ لا تُصدِرُ شيئاً", async () => {
    const h = harness();
    for (let attempt = 0; attempt < 10; attempt += 1) await call(h, `${BASE}/invoice`);
    expect(h.seen.calls.filter((entry) => entry === "issue")).toEqual([]);
  });
});

describe("ما لا يُكشَفُ في الجوابِ — كتمانٌ مقيسٌ لا موعودٌ", () => {
  test("حالُ الدفعةِ يحملُ الحقولَ المُعلَنةَ وحدَها", async () => {
    const h = harness();
    const response = await call(h, BASE);
    expect(Object.keys(response.json).sort()).toEqual([
      "amount_minor",
      "checkout_url",
      "created_at",
      "currency",
      "invoice_issuable",
      "invoice_issued",
      "ok",
      "server_time",
      "status",
      "transaction_id",
      "updated_at",
    ]);
  });

  test.each([
    ["معرِّفُ المزوّدِ", "provider_transaction_id"],
    ["اسمُ المزوّدِ الخامُ", "provider_status"],
    ["رقمُ بطاقةٍ", "card_number"],
    ["رمزُ تحقُّقٍ", "cvv"],
    ["معرِّفُ تيليجرام", TELEGRAM_ID],
  ] as const)("لا أثرَ لـ%s في نصِّ الجوابِ", async (_name, needle) => {
    const status = await call(harness(), BASE);
    const invoice = await call(harness(), `${BASE}/invoice`);
    expect(status.text).not.toContain(needle);
    expect(invoice.text).not.toContain(needle);
  });
});
