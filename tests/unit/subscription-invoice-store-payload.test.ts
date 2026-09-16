/**
 * الغرض: قياسُ **قراءةِ حمولةِ حالِ الدفعةِ** في محوّلِ الفاتورةِ الضريبيّةِ —
 *   وأخصُّها رايةُ `invoice_issuable`: تُنقَلُ كما جاءَت، وغيابُها عطبُ عقدٍ
 *   مُعلَنٌ لا «لا» صامتةٌ (`F3-09` · `SD-08` · الدفعةُ الثانيةُ).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-09`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test tests/unit`
 * يُتوقع أن يستخدمه لاحقاً: كلُّ رايةٍ تُضافُ إلى جوابِ الحالِ — تُقاسُ ههنا.
 * يحرسُه: scripts/check-tax-invoice-contract.ts
 * الحاكم: docs/adr/0127-simplified-tax-invoice.md
 *
 * ## لِمَ يُقاسُ هذا بلا قاعدةٍ معَ أنَّ التكاملَ يقيسُ الدالّةَ
 *
 * لأنَّ المقيسَ ههنا **حكمُ القارئِ لا حكمُ المحرّكِ**: ماذا يفعلُ المحوّلُ إذا
 * وصلَه جوابٌ من قاعدةٍ **لم تُطبَّق عليها الهجرةُ الثانيةُ** — وهذه حالٌ لا
 * يُمكِنُ زرعُها في وظيفةِ التكاملِ لأنَّ هجراتَها كلَّها مطبَّقةٌ. وهيَ **أخطرُ
 * حالٍ عمليّةٍ**: نشرُ شيفرةٍ قبلَ هجرةٍ.
 *
 * ## وما لا تفعلُه هذه القياساتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تُنادي قاعدةً**: `sql` مزدوجٌ يُرجِعُ ما نزرعُه؛ حكمُ المحرّكِ في
 *      `tests/integration/subscription-tax-invoice.test.ts` وحدَه.
 *   ــ **لا تقيسُ حالاتَ HTTP**: خريطةُ الحالاتِ تُقاسُ في اختبارِ المسلكِ.
 */

import { describe, expect, test } from "bun:test";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import { PostgresSubscriptionTaxInvoiceStore } from "../../packages/infrastructure/driver/subscription-invoice-store.ts";

const TELEGRAM_ID = "987654321";
const TRANSACTION_ID = "11111111-1111-4111-8111-111111111111";

/** حمولةُ حالٍ صالحةٌ كما تبنيها الدالّةُ بعدَ الهجرةِ الثانيةِ. */
function payload(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    server_time: "2026-09-16T09:00:00.000Z",
    transaction_id: TRANSACTION_ID,
    status: "active",
    amount_minor: 10_000,
    currency: "SAR",
    created_at: "2026-09-16T08:00:00.000Z",
    updated_at: null,
    checkout_url: null,
    invoice_issued: false,
    invoice_issuable: true,
    ...patch,
  };
}

/** مزدوجُ `sql`: قالبٌ موسومٌ يُرجِعُ صفّاً واحداً بما زُرِعَ. */
function storeReturning(result: unknown): PostgresSubscriptionTaxInvoiceStore {
  const sql = (() => Promise.resolve([{ result }])) as unknown as Sql;
  return new PostgresSubscriptionTaxInvoiceStore(sql);
}

/** مزدوجٌ يرفعُ — ليُقاسَ تصنيفُ عطبِ الشبكةِ. */
function storeThrowing(): PostgresSubscriptionTaxInvoiceStore {
  const sql = (() => Promise.reject(new Error("ECONNRESET"))) as unknown as Sql;
  return new PostgresSubscriptionTaxInvoiceStore(sql);
}

async function readStatus(
  store: PostgresSubscriptionTaxInvoiceStore,
): Promise<ReturnType<PostgresSubscriptionTaxInvoiceStore["readPaymentStatus"]>> {
  return store.readPaymentStatus({ telegramUserId: TELEGRAM_ID, transactionId: TRANSACTION_ID });
}

describe("رايةُ «أيمكنُ الإصدارُ» — تُنقَلُ ولا تُشتَقُّ", () => {
  test("الرايةُ الصادقةُ تُنقَلُ صادقةً، والكاذبةُ كاذبةً", async () => {
    const yes = await readStatus(storeReturning(payload({ invoice_issuable: true })));
    expect(yes.ok).toBe(true);
    if (yes.ok) expect(yes.value.invoiceIssuable).toBe(true);

    const no = await readStatus(storeReturning(payload({ invoice_issuable: false })));
    expect(no.ok).toBe(true);
    if (no.ok) expect(no.value.invoiceIssuable).toBe(false);
  });

  test("**اسمُ الحالِ لا يُشتَقُّ منه شيءٌ**: حالٌ لا يعرفُه القارئُ لا يُغيِّرُ الرايةَ", async () => {
    const result = await readStatus(
      storeReturning(payload({ status: "a_status_added_next_year", invoice_issuable: true })),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.invoiceIssuable).toBe(true);
      expect(result.value.status).toBe("a_status_added_next_year");
    }
  });
});

describe("غيابُ الرايةِ عطبُ عقدٍ مُعلَنٌ لا «لا» صامتةٌ", () => {
  test("جوابُ قاعدةٍ **قبلَ الهجرةِ الثانيةِ** يُرَدُّ `MALFORMED_RESULT`", async () => {
    // هذه هيَ حالُ «نُشِرَت الشيفرةُ قبلَ الهجرةِ»: بلا هذا الحكمِ يقرأُ
    // السائقُ لوحاً بلا زرٍّ ويظنُّ فاتورتَه ممنوعةً، والعطبُ في النشرِ.
    const before = payload();
    delete before.invoice_issuable;
    const result = await readStatus(storeReturning(before));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ reason: "MALFORMED_RESULT" });
  });

  test.each([
    ["نصٌّ", "true"],
    ["رقمٌ", 1],
    ["فراغٌ", null],
  ] as const)("رايةٌ من نوعٍ آخرَ (%s) تُرَدُّ ولا تُخشَّنُ إلى منطقٍ", async (_name, value) => {
    const result = await readStatus(storeReturning(payload({ invoice_issuable: value })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ reason: "MALFORMED_RESULT" });
  });

  test("وغيابُ `invoice_issued` كذلكَ — الرايتانِ سواءٌ في الصرامةِ", async () => {
    const missing = payload();
    delete missing.invoice_issued;
    const result = await readStatus(storeReturning(missing));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ reason: "MALFORMED_RESULT" });
  });
});

describe("تصنيفُ ما ليسَ حمولةً", () => {
  test("رفضٌ مُسمّىً من الدالّةِ يُنقَلُ **رفضاً** لا عطبَ عقدٍ", async () => {
    const result = await readStatus(storeReturning({ ok: false, error: "TRANSACTION_NOT_FOUND" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ rejection: "TRANSACTION_NOT_FOUND" });
  });

  test("رمزُ رفضٍ لا يعرفُه الاتّحادُ يُقرأُ عطبَ عقدٍ — ولا يُمرَّرُ إلى السطحِ", async () => {
    const result = await readStatus(storeReturning({ ok: false, error: "SOMETHING_NEW" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ reason: "MALFORMED_RESULT" });
  });

  test("عطبُ شبكةٍ يُصنَّفُ `STORE_ERROR` — ولا يُقرأُ رفضاً في الحكمِ", async () => {
    const result = await readStatus(storeThrowing());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ reason: "STORE_ERROR" });
  });

  test("معرِّفُ تيليجرام غيرُ رقميٍّ يُرَدُّ قبلَ أيِّ نداءٍ", async () => {
    let called = false;
    const sql = (() => {
      called = true;
      return Promise.resolve([{ result: payload() }]);
    }) as unknown as Sql;
    const store = new PostgresSubscriptionTaxInvoiceStore(sql);
    const result = await store.readPaymentStatus({
      telegramUserId: "not-a-number",
      transactionId: TRANSACTION_ID,
    });
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});
