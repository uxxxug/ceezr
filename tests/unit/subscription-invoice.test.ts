/**
 * الغرض: اختبارُ طبقةِ تطبيقِ الفاتورةِ الضريبيّةِ (`F3-09` · `SD-08`) — أنَّ
 *   الهويّةَ من الرمزِ الموقَّعِ وحدَه، وأنَّ معرِّفَ المعاملةِ **يُرفَضُ ولا
 *   يُقصَرُ**، وأنَّ كلَّ رفضٍ من المخزنِ يُترجَمُ رمزاً عامّاً واحداً لا يتغيّرُ،
 *   وأنَّ عطبَ المخزنِ **لا يُقرأُ رفضاً مفهوماً**.
 * الحالة: اختبار فعلي — بلا شبكةٍ ولا قاعدةٍ؛ المخزنُ منفذٌ مُصطنَعٌ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test tests/unit` وسلسلةُ `ci`.
 * يُتوقع أن يستخدمه لاحقاً: كلُّ رمزِ رفضٍ يُزادُ — **يُزادُ سطرٌ في جدولِ
 *   الترجمةِ ههنا**، وإلّا سقطَ اختبارُ الشمولِ.
 * يحرسُه: scripts/check-tax-invoice-contract.ts
 * الحاكم: docs/adr/0127-simplified-tax-invoice.md
 *
 * **وحدُّ هذا المِلفِّ مُعلَنٌ (`ح-5`):** لا يُثبِتُ شيئاً عن حسابِ الضريبةِ ولا
 * عن `TLV` — كلُّ ذلكَ في القاعدةِ، ويُقاسُ في
 * `tests/integration/subscription-tax-invoice.test.ts` بمُفكِّكٍ مستقلٍّ.
 */

import { describe, expect, test } from "bun:test";
import {
  issueSubscriptionTaxInvoice,
  parseTransactionId,
  readSubscriptionPaymentStatus,
  readSubscriptionTaxInvoice,
  type SubscriptionInvoiceDeps,
  TAX_INVOICE_PUBLIC_ERROR_CODES,
  type TaxInvoicePublicErrorCode,
} from "../../packages/application/driver/subscription-invoice.ts";
import {
  TAX_INVOICE_STORE_REJECTIONS,
  type TaxInvoiceStoreError,
  type TaxInvoiceStoreRejection,
} from "../../packages/application/driver/subscription-invoice-ports.ts";
import type { SimplifiedTaxInvoice } from "../../packages/domain/driver/subscription-invoice.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const SECRET = "test-only-session-signing-secret-0123456789";
const NOW = new Date("2027-05-04T10:00:00.000Z");
const TELEGRAM_ID = "5550009";
const TXN = "9f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

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

/** ما رآهُ المخزنُ فعلاً — بهِ تُثبَتُ أنَّ الهويّةَ من الرمزِ لا من الطلبِ. */
interface Seen {
  readonly issuedFor: string[];
  readonly readFor: string[];
}

function harness(outcome: { readonly fail?: TaxInvoiceStoreError } = {}) {
  const seen: Seen = { issuedFor: [], readFor: [] };
  const store = {
    issueInvoice: async (input: { telegramUserId: string; transactionId: string }) => {
      seen.issuedFor.push(`${input.telegramUserId}:${input.transactionId}`);
      if (outcome.fail !== undefined) return err(outcome.fail);
      return ok({ invoice: INVOICE, alreadyIssued: false });
    },
    readInvoice: async (input: { telegramUserId: string; transactionId: string }) => {
      seen.readFor.push(`${input.telegramUserId}:${input.transactionId}`);
      if (outcome.fail !== undefined) return err(outcome.fail);
      return ok(INVOICE);
    },
    readPaymentStatus: async (input: { telegramUserId: string; transactionId: string }) => {
      seen.readFor.push(`${input.telegramUserId}:${input.transactionId}`);
      if (outcome.fail !== undefined) return err(outcome.fail);
      return ok({
        serverTime: NOW.toISOString(),
        transactionId: input.transactionId,
        status: "active",
        amountMinor: 25_000,
        currency: "SAR",
        createdAt: "2027-05-04T09:58:00.000Z",
        updatedAt: "2027-05-04T09:59:00.000Z",
        checkoutUrl: null,
        invoiceIssued: true,
        invoiceIssuable: false,
      });
    },
  };
  const deps: SubscriptionInvoiceDeps = {
    sessions: createMiniAppSessionReader(SECRET),
    store,
    now: () => NOW,
  };
  return { deps, seen };
}

function token(telegramUserId = TELEGRAM_ID): string {
  const issued = createMiniAppSessionIssuer({ secret: SECRET }).issue(
    { telegramUserId, bot: "driver", authDateSeconds: Math.floor(NOW.getTime() / 1000) },
    NOW.getTime(),
  );
  if (!issued.ok) throw new Error("إصدارُ رمزٍ فاشلٌ");
  return issued.value.accessToken;
}

describe("معرِّفُ المعاملةِ — يُرفَضُ ولا يُقصَرُ", () => {
  test("معرِّفٌ صحيحٌ يُقبَلُ ويُوحَّدُ حرفُه صغيراً", () => {
    expect(parseTransactionId(TXN.toUpperCase())).toBe(TXN);
  });

  test("معرِّفٌ بفراغٍ حولَه يُقبَلُ بعدَ قصِّ الفراغِ وحدَه", () => {
    expect(parseTransactionId(`  ${TXN}  `)).toBe(TXN);
  });

  test.each([
    ["فراغٌ", ""],
    ["رقمٌ", "12345"],
    ["ناقصُ مقطعٍ", "9f1c2d3e-4a5b-4c6d-8e9f"],
    ["زائدٌ", `${TXN}0`],
    ["حرفٌ خارجَ الستَّ عشريِّ", "9f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5g"],
    ["حقنُ فاصلةٍ", `${TXN}' or '1'='1`],
  ])("مُشوَّهٌ (%s) يُرفَضُ بلا افتراضٍ", (_name, value) => {
    expect(parseTransactionId(value)).toBeNull();
  });

  test.each([
    ["لا نصَّ", 12_345],
    ["مصفوفةٌ", [TXN]],
    ["كائنٌ", { toString: () => TXN }],
    ["غيابٌ", undefined],
    ["فراغٌ صريحٌ", null],
  ])("نوعٌ غيرُ نصٍّ (%s) يُرفَضُ", (_name, value) => {
    expect(parseTransactionId(value)).toBeNull();
  });
});

describe("الجلسةُ — الهويّةُ من الرمزِ الموقَّعِ وحدَه", () => {
  test("بلا رمزٍ: `SESSION_REQUIRED` ولا يُنادى المخزنُ ألبتّةَ", async () => {
    const { deps, seen } = harness();
    const result = await issueSubscriptionTaxInvoice(deps, {
      accessToken: undefined,
      transactionId: TXN,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SESSION_REQUIRED");
    expect(seen.issuedFor).toEqual([]);
  });

  test("رمزٌ مُشوَّهٌ: `SESSION_INVALID` ولا كتابةَ", async () => {
    const { deps, seen } = harness();
    const result = await issueSubscriptionTaxInvoice(deps, {
      accessToken: "ليسَ.رمزاً.موقَّعاً",
      transactionId: TXN,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SESSION_INVALID");
    expect(seen.issuedFor).toEqual([]);
  });

  test("المعرِّفُ الممرَّرُ للمخزنِ هوَ الذي في الرمزِ لا الذي في الطلبِ", async () => {
    const { deps, seen } = harness();
    const result = await issueSubscriptionTaxInvoice(deps, {
      accessToken: token("7770001"),
      transactionId: TXN,
    });
    expect(result.ok).toBe(true);
    expect(seen.issuedFor).toEqual([`7770001:${TXN}`]);
  });

  test("معرِّفٌ مُشوَّهٌ يُرفَضُ **قبلَ** نداءِ المخزنِ", async () => {
    const { deps, seen } = harness();
    const result = await issueSubscriptionTaxInvoice(deps, {
      accessToken: token(),
      transactionId: "لا-معرِّف",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TRANSACTION_ID_INVALID");
    expect(seen.issuedFor).toEqual([]);
  });
});

/**
 * جدولُ الترجمةِ — **مصدرُ الحقيقةِ للشمولِ**. كلُّ رمزٍ في
 * `TAX_INVOICE_STORE_REJECTIONS` له سطرٌ، والاختبارُ التالي يُثبِتُ أنَّه لا
 * ينقصُ سطرٌ إن زادَ رمزٌ.
 */
const TRANSLATION: readonly (readonly [TaxInvoiceStoreRejection, TaxInvoicePublicErrorCode])[] = [
  ["USER_NOT_FOUND", "NOT_A_DRIVER"],
  ["NOT_A_DRIVER", "NOT_A_DRIVER"],
  ["TRANSACTION_NOT_FOUND", "TRANSACTION_NOT_FOUND"],
  ["TRANSACTION_NOT_PAID", "TRANSACTION_NOT_PAID"],
  ["TAX_IDENTITY_NOT_CONFIGURED", "TAX_IDENTITY_NOT_CONFIGURED"],
  ["VAT_RATE_NOT_CONFIGURED", "TAX_IDENTITY_NOT_CONFIGURED"],
  // رفضانِ دخلا معَ توحيدِ سجلِّ الفواتيرِ (`ح-8`): أوّلُهما **حالُ موردٍ**
  // يُقالُ للسائقِ برمزِه، والثاني **عطبُ بياناتٍ داخليٌّ** لا يُفصَحُ عنه.
  ["INVOICE_WITHOUT_TAX_FIELDS", "INVOICE_WITHOUT_TAX_FIELDS"],
  ["PAYMENT_PLAN_MISSING", "INVOICE_STORE_NOT_AVAILABLE"],
  ["INVOICE_NOT_ISSUED", "INVOICE_NOT_ISSUED"],
];

describe("ترجمةُ الرفضِ — رمزٌ عامٌّ واحدٌ لا يتغيّرُ", () => {
  test("الجدولُ يُغطّي اتّحادَ المخزنِ كلَّه — بلا نقصٍ ولا زيادةٍ", () => {
    expect(TRANSLATION.map(([rejection]) => rejection).sort()).toEqual(
      [...TAX_INVOICE_STORE_REJECTIONS].sort(),
    );
  });

  test("كلُّ رمزٍ مُترجَمٍ من الرموزِ العامّةِ المُعلَنةِ", () => {
    for (const [, code] of TRANSLATION) {
      expect(TAX_INVOICE_PUBLIC_ERROR_CODES as readonly string[]).toContain(code);
    }
  });

  test.each(TRANSLATION)("«%s» يُترجَمُ «%s» في الإصدارِ", async (rejection, expected) => {
    const { deps } = harness({ fail: { rejection } });
    const result = await issueSubscriptionTaxInvoice(deps, {
      accessToken: token(),
      transactionId: TXN,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(expected);
  });

  test.each(TRANSLATION)("«%s» يُترجَمُ «%s» في القراءةِ كذلك", async (rejection, expected) => {
    const { deps } = harness({ fail: { rejection } });
    const result = await readSubscriptionTaxInvoice(deps, {
      accessToken: token(),
      transactionId: TXN,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(expected);
  });

  test.each([["STORE_ERROR"], ["MALFORMED_RESULT"]] as const)(
    "عطبُ مخزنٍ (%s) **لا يُقرأُ رفضاً مفهوماً** بل تعطيلَ مخزنٍ",
    async (reason) => {
      const { deps } = harness({ fail: { reason } });
      const result = await readSubscriptionPaymentStatus(deps, {
        accessToken: token(),
        transactionId: TXN,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVOICE_STORE_NOT_AVAILABLE");
    },
  );
});

describe("المسارُ السعيدُ — يُمرَّرُ كما هوَ بلا إعادةِ حسابٍ", () => {
  test("الفاتورةُ تُعادُ حرفاً — ولا تُحسَبُ ضريبةٌ في هذه الطبقةِ", async () => {
    const { deps } = harness();
    const result = await readSubscriptionTaxInvoice(deps, {
      accessToken: token(),
      transactionId: TXN,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(INVOICE);
  });

  test("حالُ الدفعةِ يُعادُ ورايةُ الفاتورةِ معَه", async () => {
    const { deps } = harness();
    const result = await readSubscriptionPaymentStatus(deps, {
      accessToken: token(),
      transactionId: TXN,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("active");
      expect(result.value.invoiceIssued).toBe(true);
    }
  });
});
