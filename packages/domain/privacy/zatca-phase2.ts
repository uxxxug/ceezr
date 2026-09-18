/**
 * الغرض: نطاقُ امتثال ZATCA المرحلة الثانية — UUID، تجزئة، PIH، ICV، UBL 2.1
 *   (F12-12).
 * الحالة: منفَّذٌ — البندُ F12-12.
 * ينتمي إلى: packages/domain/privacy
 * الحاكم: ADR 0127 (الفاتورةُ وثيقةٌ تُصدَرُ مرّةً) · ADR 0039 (لا مساسَ بالأجرة)
 * المصادر: ZATCA E-Invoicing Implementation Resolution · ZATCA Detailed Technical Guidelines
 */

/** بذرةُ PIH المعتمدةُ من ZATCA لأولِ فاتورةٍ */
export const ZATCA_PIH_SEED =
  "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==";

/** نوعُ الفاتورةِ المبسَّطةِ في ZATCA */
export const ZATCA_SIMPLIFIED_INVOICE_TYPE = "0200000";

/** ProfileID للفواتيرِ المبسَّطةِ (reporting لا clearance) */
export const ZATCA_REPORTING_PROFILE = "reporting:1.0";

/** حالةُ الإبلاغِ لفاتورةٍ */
export type ReportingStatus = "PENDING" | "REPORTED" | "REJECTED";

/** عناصرُ المرحلةِ الثانيةِ في الفاتورةِ */
export interface Phase2InvoiceElements {
  invoiceUuid: string;
  invoiceHash: string;
  previousInvoiceHash: string;
  invoiceCounter: number;
  ublXml: string;
  reportingStatus: ReportingStatus;
}

/** حمولةُ فاتورةٍ كاملة (المرحلتان 1+2) */
export interface FullInvoicePayload {
  invoiceNumber: string;
  documentType: string;
  issuedAt: string;
  transactionId: string;
  sellerName: string;
  sellerVatNumber: string;
  vatRateBps: number;
  currency: string;
  totalExclVatMinor: number;
  vatAmountMinor: number;
  totalInclVatMinor: number;
  qrTlvBase64: string;
  invoiceUuid: string | null;
  invoiceHash: string | null;
  previousInvoiceHash: string | null;
  invoiceCounter: number | null;
  ublXml: string | null;
  reportingStatus: ReportingStatus | null;
  reportedAt: string | null;
}
