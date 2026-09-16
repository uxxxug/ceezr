/**
 * الغرض: مساراتُ فاتورةِ اشتراكِ السائقِ وحالِ عمليتِه —
 *   `POST /v1/driver/subscription/payments/:transactionId/invoice` و
 *   `GET  /v1/driver/subscription/payments/:transactionId/invoice` و
 *   `GET  /v1/driver/subscription/payments/:transactionId` (`F3-09` · `SD-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-09`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ.
 * يُتوقع أن يستخدمه لاحقاً: سطحُ الفاتورةِ في التطبيقِ المُصغَّرِ (الدفعةُ الثانيةُ).
 * يحرسُه: scripts/check-tax-invoice-contract.ts ·
 *   tests/unit/driver-subscription-invoice-routes.test.ts
 * الحاكم: docs/adr/0127-simplified-tax-invoice.md
 *
 * ## لِمَ الفاتورةُ مَورِدٌ تحتَ المعاملةِ لا مساراً مستقلاً برقمِ فاتورةٍ
 *
 * لأنَّ ما يملكُه السائقُ هوَ **دفعتُه**، ورقمُ الفاتورةِ لا يعرفُه قبلَ الإصدارِ.
 * ومسارٌ بـ`/invoices/:invoiceNumber` يجعلُ الترقيمَ المتتابعَ **سطحاً قابلاً
 * للتعدادِ**: من رأى رقمَه رأى مدى إصدارِنا وجرَّبَ ما قبلَه وما بعدَه. والمِلكيّةُ
 * تحميه، لكنَّ إخفاءَ المدى أحسنُ من الاعتمادِ على حاجزٍ وحدَه.
 *
 * ## ولِمَ `TRANSACTION_NOT_PAID` تُجابُ `409` لا `422`
 *
 * لأنَّ الطلبَ **صحيحُ الشكلِ ومفهومٌ**، والمانعُ حالُ المَورِدِ الآنَ: دفعةٌ لم
 * تُؤكَّد بعدُ. و`422` يقولُ «طلبُكَ خاطئٌ» فيدفعُ السطحَ إلى تصحيحِ ما لا خطأَ
 * فيه، و`409` يقولُ «ليسَ الآنَ» — وذاكَ ما يُريدُ السطحُ أن يُقيسَ عليه إعادةً.
 *
 * ## وما لا تفعلُه هذه المساراتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تكتبُ في `GET` ألبتّةَ**: الإصدارُ `POST` وحدَه.
 *   ــ **لا تقرأُ معرِّفَ سائقٍ من طلبٍ**: من الرمزِ الموقَّعِ وحدَه.
 *   ــ **لا تُعيدُ صورةَ رمزٍ**: نصُّ الترميزِ وحدَه، والرسمُ في السطحِ.
 *   ــ **لا تُعيدُ بيانةَ بطاقةٍ ولا معرِّفَ مزوّدٍ**: لا حقلَ ههنا.
 */

import { type Context, Hono } from "hono";
import {
  issueSubscriptionTaxInvoice,
  readSubscriptionPaymentStatus,
  readSubscriptionTaxInvoice,
  type SubscriptionInvoiceDeps,
  type TaxInvoicePublicErrorCode,
  type TaxInvoiceRejection,
} from "../../../../packages/application/driver/subscription-invoice.ts";
import type { SimplifiedTaxInvoice } from "../../../../packages/domain/driver/subscription-invoice.ts";

export interface DriverSubscriptionInvoiceRouteDependencies {
  /** غيابُها **يُعطّلُ المساراتِ بـ503** ولا يجعلها تُجيبُ بلا قاعدةٍ. */
  readonly invoices?: SubscriptionInvoiceDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/** خريطةُ الحالاتِ — **شاملةٌ حرفاً** لاتّحادِ رموزِ الطبقةِ. */
const STATUS_BY_ERROR: Readonly<
  Record<TaxInvoicePublicErrorCode, 401 | 403 | 404 | 409 | 422 | 503>
> = {
  SESSION_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  SESSION_INVALID: 401,
  SESSION_NOT_AVAILABLE: 503,
  INVOICE_STORE_NOT_AVAILABLE: 503,
  NOT_A_DRIVER: 403,
  TRANSACTION_ID_INVALID: 422,
  TRANSACTION_NOT_FOUND: 404,
  TRANSACTION_NOT_PAID: 409,
  // نقصُ هويّةِ البائعِ **عطبُ تهيئةٍ عندَنا لا خطأُ طالبٍ**: `503` يقولُ
  // «جرِّبْ لاحقاً»، ولا يُتَّهَمُ السائقُ بطلبٍ خاطئٍ في نقصٍ نحنُ سببُه.
  TAX_IDENTITY_NOT_CONFIGURED: 503,
  // فاتورةٌ قديمةٌ بلا حقولٍ ضريبيّةٍ **حالُ موردٍ لا غيابٌ ولا عطبٌ**: ٤٠٩
  // لأنَّ الموردَ موجودٌ ولكنَّ حالَه لا يسمحُ بما طُلِبَ، وإعادةُ المحاولةِ لا
  // تُغيِّرُ شيئاً — فلا ٥٠٣ تدعو إلى محاولةٍ أبديّةٍ.
  INVOICE_WITHOUT_TAX_FIELDS: 409,
  INVOICE_NOT_ISSUED: 404,
};

function rejected(c: Context, rejection: TaxInvoiceRejection) {
  return c.json({ ok: false, error: rejection.code }, STATUS_BY_ERROR[rejection.code]);
}

function bearerTokenFrom(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const trimmed = header.trim();
  if (trimmed.length === 0) return undefined;
  const prefix = "Bearer ";
  if (trimmed.length < prefix.length) return undefined;
  if (trimmed.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) return undefined;
  const token = trimmed.slice(prefix.length).trim();
  return token.length > 0 ? token : undefined;
}

/** **موضعٌ واحدٌ** يُشكِّلُ الفاتورةَ في الجوابِ — ثلاثةُ مساراتٍ لا تفترقُ حقولُها. */
function invoiceBody(invoice: SimplifiedTaxInvoice): Record<string, unknown> {
  return {
    invoice_number: invoice.invoiceNumber,
    document_type: invoice.documentType,
    issued_at: invoice.issuedAt,
    transaction_id: invoice.transactionId,
    seller_name: invoice.sellerName,
    seller_vat_number: invoice.sellerVatNumber,
    vat_rate_bps: invoice.vatRateBps,
    currency: invoice.currency,
    total_excl_vat_minor: invoice.totalExclVatMinor,
    vat_amount_minor: invoice.vatAmountMinor,
    total_incl_vat_minor: invoice.totalInclVatMinor,
    qr_tlv_base64: invoice.qrTlvBase64,
  };
}

export function createDriverSubscriptionInvoiceRoutes(
  deps: DriverSubscriptionInvoiceRouteDependencies,
): Hono {
  const app = new Hono();
  const base = "/v1/driver/subscription/payments/:transactionId";

  /** «حالُ دفعتي» — يُقرأُ عندَ الرجوعِ من صفحةِ المزوّدِ، ولا يكتبُ شيئاً. */
  app.get(base, async (c) => {
    if (deps.invoices === undefined) {
      deps.log?.("driver_subscription_invoice.status_disabled", {});
      return rejected(c, { code: "INVOICE_STORE_NOT_AVAILABLE" });
    }

    const result = await readSubscriptionPaymentStatus(deps.invoices, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      transactionId: c.req.param("transactionId"),
    });
    if (!result.ok) return rejected(c, result.error);

    const s = result.value;
    return c.json({
      ok: true,
      server_time: s.serverTime,
      transaction_id: s.transactionId,
      status: s.status,
      amount_minor: s.amountMinor,
      currency: s.currency,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
      checkout_url: s.checkoutUrl,
      invoice_issued: s.invoiceIssued,
      invoice_issuable: s.invoiceIssuable,
    });
  });

  /**
   * «أصدِرْ فاتورتي» — `POST` لأنَّه يكتبُ. ونداءٌ ثانٍ لا يُصدِرُ رقماً ثانياً:
   * يُعيدُ ما صدرَ بـ`200` ورايةٍ، ويُجيبُ `201` في الإصدارِ الأوّلِ وحدَه.
   */
  app.post(`${base}/invoice`, async (c) => {
    if (deps.invoices === undefined) {
      deps.log?.("driver_subscription_invoice.issue_disabled", {});
      return rejected(c, { code: "INVOICE_STORE_NOT_AVAILABLE" });
    }

    const result = await issueSubscriptionTaxInvoice(deps.invoices, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      transactionId: c.req.param("transactionId"),
    });
    if (!result.ok) return rejected(c, result.error);

    const outcome = result.value;
    return c.json(
      {
        ok: true,
        already_issued: outcome.alreadyIssued,
        invoice: invoiceBody(outcome.invoice),
      },
      outcome.alreadyIssued ? 200 : 201,
    );
  });

  /** «فاتورتي» — قراءةٌ محضةٌ، وغيابُها `404` لا إصدارٌ ضمنيٌّ. */
  app.get(`${base}/invoice`, async (c) => {
    if (deps.invoices === undefined) {
      deps.log?.("driver_subscription_invoice.read_disabled", {});
      return rejected(c, { code: "INVOICE_STORE_NOT_AVAILABLE" });
    }

    const result = await readSubscriptionTaxInvoice(deps.invoices, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      transactionId: c.req.param("transactionId"),
    });
    if (!result.ok) return rejected(c, result.error);

    return c.json({ ok: true, invoice: invoiceBody(result.value) });
  });

  return app;
}
