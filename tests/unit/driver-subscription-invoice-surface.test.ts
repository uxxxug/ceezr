/**
 * الغرض: قياسُ سطحِ الفاتورةِ في التطبيقِ المُصغَّرِ — نموذجُ العرضِ ومفاتيحُ
 *   النصوصِ ورايةُ الإمكانِ (البند `F3-09` · `SD-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-09`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test tests/unit`
 * يُتوقع أن يستخدمه لاحقاً: لوحُ فاتورةِ عمولةٍ إن بُنيَ — يقيسُ الرايةَ عينَها.
 * يحرسُه: scripts/check-tax-invoice-contract.ts
 * الحاكم: docs/adr/0127-simplified-tax-invoice.md
 *
 * ## ما الذي يُقاسُ ههنا وما الذي يحرسُه حاجزٌ بدَلاً من قياسٍ
 *
 * العطبُ الذي وقعَ فعلاً كانَ **شرطَ ظهورِ زرِّ الإصدارِ**: كُتِبَ أوّلاً
 * `status === "paid"` وهوَ حالٌ لا وجودَ له في قيدِ الجدولِ، فكانَ الزرُّ لا
 * يظهرُ أبداً. والبوّابةُ الآنَ حقلٌ واحدٌ (`canIssueInvoice`) يُقاسُ ههنا نقلُه
 * حرفاً عن رايةِ القاعدةِ، **ومنعُ عودةِ الشرطِ المنسوخِ حاجزٌ ساكنٌ** (القاعدةُ ٩
 * في `scripts/check-tax-invoice-contract.ts`) لا قياسُ رسمٍ — وحاجزٌ ساكنٌ يُنفَذُ
 * على كلِّ سطرٍ يُكتَبُ لاحقاً، والرسمُ يُقاسُ في الحالِ الذي يُبذَرُ وحدَه.
 *
 * ## وما لا تفعلُه هذه القياساتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تُرسِمُ اللوحَ ولا تنقُرُ زرّاً**: في هذا المستودعِ نسختانِ من `react`
 *      (`19.2.6` في الجذرِ و`19.2.8` في التطبيقِ المُصغَّرِ)، ورسمٌ يخلطُ بينَهما
 *      **يسقطُ بعطبِ مُوزِّعٍ لا بعطبِ سطحٍ** — فقياسٌ كهذا يقيسُ التبعيّاتِ لا
 *      الشاشةَ. وتوحيدُ النسختَينِ وبناءُ مِرسَمٍ عملٌ **لم يُنفَّذ** ولا يُدَّعى.
 *   ــ **لا تُنادي شبكةً**: كلُّ نداءٍ محقونٌ.
 *   ــ **لا تقيسُ صحّةَ `TLV`**: مُفكِّكٌ مستقلٌّ يقيسُها في `tests/integration`.
 *   ــ **لا تُصرِّحُ بأنَّ اللوحَ قِيسَ على تلغرامَ**: وِعاءٌ حقيقيٌّ لم يُقَس ههنا.
 */

import { describe, expect, test } from "bun:test";
import type {
  ApiDriverInvoiceIssueResponse,
  ApiDriverPaymentStatusResponse,
  ApiSimplifiedTaxInvoice,
} from "../../apps/miniapp/src/surfaces/driver/subscription/invoice-contract.ts";
import {
  invoiceErrorKey,
  isRetryableInvoiceError,
  isStatusRecheckError,
  toInvoiceIssue,
  toPaymentStatus,
  toTaxInvoice,
  vatRatePercentText,
} from "../../apps/miniapp/src/surfaces/driver/subscription/invoice-view.ts";

const INVOICE: ApiSimplifiedTaxInvoice = {
  invoice_number: "INV-00000007",
  document_type: "SIMPLIFIED_TAX_INVOICE",
  issued_at: "2026-09-16T09:00:00.000Z",
  transaction_id: "11111111-1111-4111-8111-111111111111",
  seller_name: "شركةُ عزر",
  seller_vat_number: "300000000000003",
  vat_rate_bps: 1500,
  currency: "SAR",
  total_excl_vat_minor: 8696,
  vat_amount_minor: 1304,
  total_incl_vat_minor: 10000,
  qr_tlv_base64:
    "AQnYtNix2YPYqdmPAg8zMDAwMDAwMDAwMDAwMDMDFDIwMjYtMDktMTZUMDk6MDA6MDBaBAUxMDAuMAUEMTMuMA==",
};

function status(
  patch: Partial<ApiDriverPaymentStatusResponse> = {},
): ApiDriverPaymentStatusResponse {
  return {
    ok: true,
    server_time: "2026-09-16T09:00:00.000Z",
    transaction_id: INVOICE.transaction_id,
    status: "active",
    amount_minor: 10000,
    currency: "SAR",
    created_at: "2026-09-16T08:00:00.000Z",
    updated_at: null,
    checkout_url: null,
    invoice_issued: false,
    invoice_issuable: true,
    ...patch,
  };
}

describe("نسبةُ الضريبةِ — تحويلُ وحدةٍ لا اشتقاقُ رقمٍ", () => {
  test("نقاطُ الأساسِ تُقرأُ نسبةً، والكسرُ يُعرَضُ ولا يُقرَّبُ", () => {
    expect(vatRatePercentText(1500)).toBe("15");
    expect(vatRatePercentText(750)).toBe("7.5");
    expect(vatRatePercentText(505)).toBe("5.05");
    expect(vatRatePercentText(0)).toBe("0");
  });

  test("النسبةُ من الوثيقةِ لا من ثابتٍ — وثيقةٌ بنسبةٍ أخرى تُعرَضُ بنسبتِها", () => {
    // **وثيقةٌ صدرَت أمسَ بنسبةٍ أخرى** تُعرَضُ كما صدرَت لا كما هوَ الإعدادُ اليومَ.
    expect(toTaxInvoice({ ...INVOICE, vat_rate_bps: 500 }).vatRatePercentText).toBe("5");
  });
});

describe("رايةُ «أيمكنُ الإصدارُ» — من القاعدةِ لا من قياسِ حالٍ", () => {
  test("الرايةُ تُنقَلُ كما وصلَت", () => {
    expect(toPaymentStatus(status({ invoice_issuable: true })).canIssueInvoice).toBe(true);
    expect(toPaymentStatus(status({ invoice_issuable: false })).canIssueInvoice).toBe(false);
  });

  test("**اسمُ الحالِ لا يُغيِّرُ الرايةَ**: حالٌ لم يكن في حسابِ السطحِ لا يُعطِّلُ الزرَّ", () => {
    // هذا القياسُ بعينِه هوَ الذي يمنعُ عودةَ العطبِ: كانَ السطحُ يشترطُ
    // `status === "paid"` — فحالُ القاعدةِ الحقيقيُّ («active» و«refunded») كانَ
    // يُخفي الزرَّ دائماً. والآنَ الحالُ نصٌّ يُعرَضُ، والرايةُ هيَ التي تحكمُ.
    for (const name of ["active", "refunded", "settled_by_a_future_name"]) {
      expect(
        toPaymentStatus(status({ status: name, invoice_issuable: true })).canIssueInvoice,
      ).toBe(true);
    }
  });

  test("مفتاحُ نصِّ الحالِ مبنيٌّ من الحالِ الواصلِ — ولا نصَّ مُخترَعٌ", () => {
    expect(toPaymentStatus(status({ status: "pending" })).statusLabelKey).toBe(
      "driver.subscription.payment.status.pending",
    );
  });
});

describe("نصوصُ الأعطابِ وإعادةُ المحاولةِ", () => {
  test("رمزٌ معروفٌ لهُ مفتاحُه، ورمزٌ غريبٌ يُقرأُ «غيرَ معروفٍ» ولا يُعرَضُ خاماً", () => {
    expect(invoiceErrorKey("TRANSACTION_NOT_PAID")).toBe(
      "driver.subscription.invoice.error.TRANSACTION_NOT_PAID",
    );
    expect(invoiceErrorKey("SOMETHING_WE_NEVER_DECLARED")).toBe(
      "driver.subscription.invoice.error.UNKNOWN",
    );
  });

  test("«هويّةٌ غيرُ مُهيَّأةٍ» يُعادُ فيها، و«ليسَ سائقاً» لا يُعادُ", () => {
    expect(isRetryableInvoiceError("TAX_IDENTITY_NOT_CONFIGURED")).toBe(true);
    expect(isRetryableInvoiceError("NOT_A_DRIVER")).toBe(false);
  });

  test("«غيرُ مدفوعةٍ» و«لم تُصدَرْ» يُعادُ فيهما **بقراءةِ حالٍ** لا بإصدارٍ", () => {
    expect(isStatusRecheckError("TRANSACTION_NOT_PAID")).toBe(true);
    expect(isStatusRecheckError("INVOICE_NOT_ISSUED")).toBe(true);
    expect(isRetryableInvoiceError("TRANSACTION_NOT_PAID")).toBe(false);
  });
});

describe("الوثيقةُ تُنقَلُ ولا تُحسَبُ", () => {
  test("المبالغُ الثلاثةُ من حقولِها، والحِمْلُ نصٌّ كما وصلَ", () => {
    const model = toTaxInvoice(INVOICE);
    expect(model.totalExclVatText).toBe("86.96");
    expect(model.vatAmountText).toBe("13.04");
    expect(model.totalInclVatText).toBe("100.00");
    expect(model.qrTlvBase64).toBe(INVOICE.qr_tlv_base64);
  });

  test("**وثيقةٌ لا يجمعُ حسابُها تُعرَضُ كما هيَ** — السطحُ لا يُصلِحُ وثيقةً صدرَت", () => {
    // الجمعُ مفروضٌ بقيدٍ في القاعدةِ؛ ولو وصلَ خلافُه فالصوابُ عرضُه لِيُرى
    // لا تصحيحُه صامتاً في العميلِ فيُخفى عطبُ قاعدةٍ.
    const model = toTaxInvoice({ ...INVOICE, vat_amount_minor: 1 });
    expect(model.vatAmountText).toBe("0.01");
    expect(model.totalInclVatText).toBe("100.00");
  });

  test("«صدرَت من قبلُ» تُنقَلُ رايةً لا تُخترَعُ", () => {
    const issued: ApiDriverInvoiceIssueResponse = {
      ok: true,
      already_issued: true,
      invoice: INVOICE,
    };
    expect(toInvoiceIssue(issued).alreadyIssued).toBe(true);
  });
});
