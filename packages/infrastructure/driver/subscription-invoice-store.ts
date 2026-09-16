/**
 * الغرض: محوّلُ الفاتورةِ الضريبيّةِ على PostgreSQL — نداءُ دوالِّ `F3-09`
 *   وقراءةُ حمولتِها **بلا حسابٍ ولا افتراضٍ** (`F3-09` · `SD-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-09`.
 * ينتمي إلى: infrastructure/driver
 * يُستخدم من: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ.
 * يحرسُه: tests/integration/subscription-tax-invoice.test.ts ·
 *   scripts/check-tax-invoice-contract.ts
 * الحاكم: docs/adr/0127-simplified-tax-invoice.md
 *
 * ## لِمَ الحمولةُ تُفحَصُ حقلاً حقلاً ولا تُقبَلُ كما جاءَت
 *
 * لأنَّ الفاتورةَ **تُقرَأُ على أنَّها إقرارٌ**: حقلٌ ناقصٌ يصيرُ في السطحِ خانةً
 * فارغةً في وثيقةٍ ضريبيّةٍ، وحقلٌ نصُّه رقمٌ يصيرُ `NaN` في جمعٍ. فغيابُ حقلٍ
 * **عطبُ عقدٍ يُعلَنُ** (`MALFORMED_RESULT` ⇒ `503`) لا خانةٌ تُعرَضُ فارغةً.
 *
 * ## ولِمَ **الجمعُ يُتحقَّقُ** ههنا معَ أنَّ قيداً في المخطَّطِ يفرضُه
 *
 * لأنَّ القيدَ يحرسُ **الكتابةَ** في قاعدتِنا، وهذا المحوّلُ يقرأُ ما وصلَ عبرَ
 * شبكةٍ ومُجمِّعٍ وتحويلِ `jsonb`. والتحقُّقُ ههنا **ليسَ حاسباً ثانياً للضريبةِ**
 * — لا يحسبُ نسبةً ولا يُقرِّبُ — بل يقيسُ تماسكَ ما وصلَ. وحدُّ الفرقِ بينَهما:
 * لو خالفَ الجمعُ **يُرفَضُ ولا يُصلَحُ**.
 *
 * ## وما لا يفعلُه هذا المحوّلُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يحسبُ ضريبةً ولا يبني رمزَ استجابةٍ**: القاعدةُ تفعلُ، والمحوّلُ ينقلُ.
 *   ــ **لا يُعدِّلُ ولا يحذفُ فاتورةً**: لا `update` ولا `delete` ههنا، وزنادٌ
 *      في القاعدةِ يمنعُهما ولو حاولَ محوّلٌ آخرُ.
 *   ــ **لا يُركِّبُ SQL نصّاً**: مُعامَلاتٌ مُمرَّرةٌ.
 *   ــ **لا يُصنِّفُ عطبَ شبكةٍ رفضاً**: استثناءٌ = `STORE_ERROR` = `503`.
 *   ــ **لا يقرأُ ولا يُخزِّنُ بيانةَ بطاقةٍ**: لا حقلَ ألبتّةَ.
 */

import {
  type SubscriptionTaxInvoiceStore,
  TAX_INVOICE_STORE_REJECTIONS,
  type TaxInvoiceIssueOutcome,
  type TaxInvoiceStoreError,
  type TaxInvoiceStoreRejection,
} from "../../application/driver/subscription-invoice-ports.ts";
import type {
  SimplifiedTaxInvoice,
  SubscriptionPaymentStatus,
} from "../../domain/driver/subscription-invoice.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

function failed(reason: "STORE_ERROR" | "MALFORMED_RESULT"): TaxInvoiceStoreError {
  return { reason } as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  return parsed;
}

function readNonNegativeInteger(value: unknown): number | null {
  const parsed = readInteger(value);
  return parsed === null || parsed < 0 ? null : parsed;
}

function readInstant(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const text = readText(value);
  if (text === null) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

function rejectionFrom(payload: Record<string, unknown>): TaxInvoiceStoreError {
  const code = readText(payload.error);
  if (code === null || !(TAX_INVOICE_STORE_REJECTIONS as readonly string[]).includes(code)) {
    return failed("MALFORMED_RESULT");
  }
  return { rejection: code as TaxInvoiceStoreRejection };
}

/** **لا حقلَ يُفترَضُ**: غيابُ واحدٍ يُبطِلُ الحمولةَ كلَّها. */
function readInvoicePayload(value: unknown): SimplifiedTaxInvoice | null {
  if (!isRecord(value)) return null;

  const invoiceNumber = readText(value.invoice_number);
  const issuedAt = readInstant(value.issued_at);
  const transactionId = readText(value.transaction_id);
  const sellerName = readText(value.seller_name);
  const sellerVatNumber = readText(value.seller_vat_number);
  const vatRateBps = readNonNegativeInteger(value.vat_rate_bps);
  const currency = readText(value.currency);
  const totalExclVatMinor = readNonNegativeInteger(value.total_excl_vat_minor);
  const vatAmountMinor = readNonNegativeInteger(value.vat_amount_minor);
  const totalInclVatMinor = readNonNegativeInteger(value.total_incl_vat_minor);
  const qrTlvBase64 = readText(value.qr_tlv_base64);

  if (
    invoiceNumber === null ||
    issuedAt === null ||
    transactionId === null ||
    sellerName === null ||
    sellerVatNumber === null ||
    vatRateBps === null ||
    currency === null ||
    totalExclVatMinor === null ||
    vatAmountMinor === null ||
    totalInclVatMinor === null ||
    qrTlvBase64 === null
  ) {
    return null;
  }

  // نوعُ الوثيقةِ **يُقرأُ ولا يُفترَضُ**: وثيقةٌ من نوعٍ آخرَ تُعرَضُ بعنوانِ
  // فاتورةٍ مبسَّطةٍ هيَ ادّعاءٌ خاطئٌ لا حقلٌ ناقصٌ.
  if (value.document_type !== "SIMPLIFIED_TAX_INVOICE") return null;

  // تماسكُ ما وصلَ لا حسابُ ضريبةٍ: لو خالفَ الجمعُ **يُرفَضُ ولا يُصلَحُ**.
  if (totalExclVatMinor + vatAmountMinor !== totalInclVatMinor) return null;
  if (totalInclVatMinor <= 0) return null;

  return {
    invoiceNumber,
    documentType: "SIMPLIFIED_TAX_INVOICE",
    issuedAt,
    transactionId,
    sellerName,
    sellerVatNumber,
    vatRateBps,
    currency,
    totalExclVatMinor,
    vatAmountMinor,
    totalInclVatMinor,
    qrTlvBase64,
  };
}

function readStatusPayload(payload: Record<string, unknown>): SubscriptionPaymentStatus | null {
  const serverTime = readInstant(payload.server_time);
  const transactionId = readText(payload.transaction_id);
  const status = readText(payload.status);
  const amountMinor = readNonNegativeInteger(payload.amount_minor);
  const currency = readText(payload.currency);
  const createdAt = readInstant(payload.created_at);

  if (
    serverTime === null ||
    transactionId === null ||
    status === null ||
    amountMinor === null ||
    currency === null ||
    createdAt === null
  ) {
    return null;
  }
  if (typeof payload.invoice_issued !== "boolean") return null;

  return {
    serverTime,
    transactionId,
    status,
    amountMinor,
    currency,
    createdAt,
    updatedAt: readInstant(payload.updated_at),
    checkoutUrl: readText(payload.checkout_url),
    invoiceIssued: payload.invoice_issued,
  };
}

interface ResultRow {
  readonly result: unknown;
}

export class PostgresSubscriptionTaxInvoiceStore implements SubscriptionTaxInvoiceStore {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async issueInvoice(input: {
    readonly telegramUserId: string;
    readonly transactionId: string;
  }): Promise<Result<TaxInvoiceIssueOutcome, TaxInvoiceStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    let rows: ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`
        select issue_subscription_tax_invoice(
          ${telegramId}::bigint, ${input.transactionId}::uuid
        ) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    const payload = rows[0]?.result;
    if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
    if (payload.ok !== true) return err(rejectionFrom(payload));

    const invoice = readInvoicePayload(payload.invoice);
    if (invoice === null) return err(failed("MALFORMED_RESULT"));
    if (typeof payload.already_issued !== "boolean") return err(failed("MALFORMED_RESULT"));

    return ok({ invoice, alreadyIssued: payload.already_issued });
  }

  async readInvoice(input: {
    readonly telegramUserId: string;
    readonly transactionId: string;
  }): Promise<Result<SimplifiedTaxInvoice, TaxInvoiceStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    let rows: ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`
        select driver_subscription_tax_invoice(
          ${telegramId}::bigint, ${input.transactionId}::uuid
        ) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    const payload = rows[0]?.result;
    if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
    if (payload.ok !== true) return err(rejectionFrom(payload));

    const invoice = readInvoicePayload(payload.invoice);
    if (invoice === null) return err(failed("MALFORMED_RESULT"));
    return ok(invoice);
  }

  async readPaymentStatus(input: {
    readonly telegramUserId: string;
    readonly transactionId: string;
  }): Promise<Result<SubscriptionPaymentStatus, TaxInvoiceStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    let rows: ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`
        select driver_subscription_payment_status(
          ${telegramId}::bigint, ${input.transactionId}::uuid
        ) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    const payload = rows[0]?.result;
    if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
    if (payload.ok !== true) return err(rejectionFrom(payload));

    const status = readStatusPayload(payload);
    if (status === null) return err(failed("MALFORMED_RESULT"));
    return ok(status);
  }
}
