/**
 * الغرض: نموذجُ عرضِ حالِ الدفعةِ والفاتورةِ — دالّاتٌ نقيّةٌ تُحوِّلُ الردَّ إلى
 *   نصوصٍ معروضةٍ ومفاتيحِ ترجمةٍ، **بلا JSX وبلا شبكةٍ وبلا ساعةٍ** (`F3-09`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-09`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/subscription
 * يُستخدم من: `PaymentInvoicePanel.tsx`، ويُقاسُ مباشرةً في `tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: مُصدِّرُ ملفٍّ (`PDF`) إن بُنيَ — يقرأُ النموذجَ عينَه
 *   فلا يُنشئُ صياغةً ثانيةً للمبالغِ.
 * يحرسُه: scripts/check-tax-invoice-contract.ts
 * الحاكم: docs/adr/0127-simplified-tax-invoice.md
 *
 * ## لِمَ الضريبةُ **تُنقَلُ ولا تُحسَبُ** ههنا
 *
 * لأنَّ الضريبةَ في هذه الوثيقةِ **مُستخرَجةٌ من مبلغٍ قُبِضَ شاملاً** بنسبةٍ
 * مخزونةٍ في صفِّها لحظةَ الإصدارِ. فلو حسبَها العميلُ لَاحتاجَ نسبةً — ولو أخذَها
 * من إعدادٍ اليومَ لَخالَفَ وثيقةً صدرَت أمسَ بنسبةٍ أخرى. والوحيدُ المسموحُ ههنا
 * **تحويلُ وحدةٍ**: نقاطُ الأساسِ إلى نسبةٍ مئويّةٍ (قسمةٌ على مئةٍ)، وفلوسٌ إلى
 * ريالاتٍ بدالّةِ المجالِ الواحدةِ — وكلاهُما صياغةُ رقمٍ وصلَ لا اشتقاقُ رقمٍ جديدٍ.
 *
 * ## ولِمَ يُعرَضُ رقمُ البائعِ الضريبيُّ ولا يُتحقَّقُ من شكلِه ههنا
 *
 * لأنَّ شكلَه (خمسةَ عشرَ رقماً) **مفروضٌ في القاعدةِ بقيدٍ**، فلا يبلغُ العميلَ
 * إلّا صحيحاً. وفحصٌ ثانٍ في الشاشةِ يُنشئُ حاكمَينِ لقاعدةٍ واحدةٍ، وإن اختلفا
 * أخفى الأضعفُ عطبَ الأقوى.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقرأُ ساعةً**: لا `Date.now()` — وتاريخُ الإصدارِ من الوثيقةِ.
 *   ــ **لا يُرمِّزُ ولا يُفكِّكُ `TLV`**: الحِمْلُ نصٌّ يُنقَلُ كما خزنَتْهُ القاعدةُ.
 *   ــ **لا يُخترِعُ نسبةً**: لا ثابتَ ضريبةٍ في هذا الملفِّ ولا في الشاشةِ.
 *   ــ **لا يُخفي حقلاً غابَ**: عطبٌ لا نصَّ له يُقالُ «عطبٌ غيرُ معروفٍ» صراحةً.
 *   ــ **لا يقولُ «مدفوعةٌ» من عندِه**: حالُ المعاملةِ نصُّها من الخادمِ.
 */

import { minorUnitsToMajorText } from "../../../../../../packages/domain/financial/minor-units.ts";
import type {
  ApiDriverInvoiceIssueResponse,
  ApiDriverInvoiceReadResponse,
  ApiDriverPaymentStatusResponse,
  ApiSimplifiedTaxInvoice,
} from "./invoice-contract.ts";

/**
 * رموزُ العطبِ التي لهذه الشاشةِ نصٌّ لها — **مُقابِلةٌ حرفاً** لـ
 * `TAX_INVOICE_PUBLIC_ERROR_CODES` في طبقةِ التطبيقِ، والتقابلُ **مقيسٌ** في
 * `scripts/check-tax-invoice-contract.ts` (القاعدةُ ١١) لا متروكٌ لِيَقظةِ قارئٍ.
 */
const KNOWN_INVOICE_ERRORS: ReadonlySet<string> = new Set([
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "INVOICE_STORE_NOT_AVAILABLE",
  "NOT_A_DRIVER",
  "TRANSACTION_ID_INVALID",
  "TRANSACTION_NOT_FOUND",
  "TRANSACTION_NOT_PAID",
  "TAX_IDENTITY_NOT_CONFIGURED",
  "INVOICE_WITHOUT_TAX_FIELDS",
  "INVOICE_NOT_ISSUED",
]);

export function invoiceErrorKey(code: string): string {
  return KNOWN_INVOICE_ERRORS.has(code)
    ? `driver.subscription.invoice.error.${code}`
    : "driver.subscription.invoice.error.UNKNOWN";
}

/**
 * أيُّ الأعطابِ **تُعادُ المحاولةُ فيه بزرٍّ**. و`TAX_IDENTITY_NOT_CONFIGURED`
 * منها: نقصُ تهيئةٍ عندَنا يُسَدُّ في دقائقَ فتَصدُرُ الفاتورةُ — فزرُّ إعادةٍ
 * أصدقُ من شاشةٍ ميّتةٍ. أمّا «المعاملةُ غيرُ مدفوعةٍ» فلا: إعادةُ النداءِ تردُّ
 * الحكمَ عينَه، والصوابُ زرٌّ يُعيدُ قراءةَ **الحالِ** لا الإصدارَ.
 */
export function isRetryableInvoiceError(code: string): boolean {
  return (
    code === "INVOICE_STORE_NOT_AVAILABLE" ||
    code === "SESSION_NOT_AVAILABLE" ||
    code === "TAX_IDENTITY_NOT_CONFIGURED" ||
    code === "UNKNOWN"
  );
}

/**
 * أهوَ عطبٌ يُصلِحُه **إعادةُ قراءةِ الحالِ** لا إعادةُ الإصدارِ. و«غيرُ مدفوعةٍ»
 * منه: قد يكونُ الويبهوكُ وصلَ بعدَ نداءِنا.
 */
export function isStatusRecheckError(code: string): boolean {
  return code === "TRANSACTION_NOT_PAID" || code === "INVOICE_NOT_ISSUED";
}

export interface PaymentStatusModel {
  readonly serverTime: string;
  readonly transactionId: string;
  readonly status: string;
  /** مفتاحُ نصِّ الحالِ — **مفاتيحُ `F3-06` عينُها** فلا نصَّانِ لحالٍ واحدٍ. */
  readonly statusLabelKey: string;
  readonly amountText: string;
  readonly currency: string;
  readonly createdAt: string;
  readonly updatedAt: string | null;
  readonly checkoutUrl: string | null;
  readonly invoiceIssued: boolean;
  /** أيمكنُ طلبُ الإصدارِ الآنَ — **رايةٌ وصلَت من القاعدةِ** لا قياسٌ ههنا. */
  readonly canIssueInvoice: boolean;
}

export function toPaymentStatus(response: ApiDriverPaymentStatusResponse): PaymentStatusModel {
  return {
    serverTime: response.server_time,
    transactionId: response.transaction_id,
    status: response.status,
    statusLabelKey: `driver.subscription.payment.status.${response.status}`,
    amountText: minorUnitsToMajorText(response.amount_minor),
    currency: response.currency,
    createdAt: response.created_at,
    updatedAt: response.updated_at,
    checkoutUrl: response.checkout_url,
    invoiceIssued: response.invoice_issued,
    canIssueInvoice: response.invoice_issuable,
  };
}

/**
 * تحويلُ نقاطِ الأساسِ إلى نسبةٍ مئويّةٍ معروضةٍ. **قسمةٌ على مئةٍ تحويلُ وحدةٍ**
 * لا اشتقاقُ رقمٍ: ١٥٠٠ نقطةَ أساسٍ هيَ ١٥٪ بتعريفِ الوحدةِ نفسِها. والكسرُ
 * يُعرَضُ إن كانَ (٧٥٠ ⇒ «7.5») ولا يُقرَّبُ، إذ تقريبُ نسبةٍ ضريبيّةٍ في وثيقةٍ
 * تحريفٌ لِرقمٍ رسميٍّ.
 */
export function vatRatePercentText(vatRateBps: number): string {
  const hundredths = 100;
  const whole = Math.trunc(vatRateBps / hundredths);
  const fraction = Math.abs(vatRateBps % hundredths);
  if (fraction === 0) return String(whole);
  const padded = fraction < 10 ? `0${String(fraction)}` : String(fraction);
  return `${String(whole)}.${padded.replace(/0$/, "")}`;
}

export interface TaxInvoiceModel {
  readonly invoiceNumber: string;
  readonly documentTypeLabelKey: string;
  readonly issuedAt: string;
  readonly transactionId: string;
  readonly sellerName: string;
  readonly sellerVatNumber: string;
  readonly vatRatePercentText: string;
  readonly currency: string;
  readonly totalExclVatText: string;
  readonly vatAmountText: string;
  readonly totalInclVatText: string;
  /** حِمْلُ رمزِ الاستجابةِ — **نصٌّ يُنقَلُ كما وصلَ** ولا يُعادُ ترميزُه. */
  readonly qrTlvBase64: string;
}

export function toTaxInvoice(invoice: ApiSimplifiedTaxInvoice): TaxInvoiceModel {
  return {
    invoiceNumber: invoice.invoice_number,
    documentTypeLabelKey: `driver.subscription.invoice.document_type.${invoice.document_type}`,
    issuedAt: invoice.issued_at,
    transactionId: invoice.transaction_id,
    sellerName: invoice.seller_name,
    sellerVatNumber: invoice.seller_vat_number,
    vatRatePercentText: vatRatePercentText(invoice.vat_rate_bps),
    currency: invoice.currency,
    totalExclVatText: minorUnitsToMajorText(invoice.total_excl_vat_minor),
    vatAmountText: minorUnitsToMajorText(invoice.vat_amount_minor),
    totalInclVatText: minorUnitsToMajorText(invoice.total_incl_vat_minor),
    qrTlvBase64: invoice.qr_tlv_base64,
  };
}

export interface InvoiceIssueModel {
  /** **يُقالُ صراحةً**: نداءٌ ثانٍ أعادَ وثيقةً صدرَت ولم يُصدِرْ رقماً ثانياً. */
  readonly alreadyIssued: boolean;
  readonly invoice: TaxInvoiceModel;
}

export function toInvoiceIssue(response: ApiDriverInvoiceIssueResponse): InvoiceIssueModel {
  return { alreadyIssued: response.already_issued, invoice: toTaxInvoice(response.invoice) };
}

export function toInvoiceRead(response: ApiDriverInvoiceReadResponse): TaxInvoiceModel {
  return toTaxInvoice(response.invoice);
}
