/**
 * الغرض: إصدار فاتورة اشتراك من الدفعة والخطة الفعليتين.
 * الحالة: منفّذ فعلياً في 2026-08-13؛ كان الملف هيكلاً (`export {}`) وصدر أمر التفعيل.
 * القرار ومسوّغه: الـRPC يقفل الدفعة ويخصص رقماً فريداً حسب المدينة والسنة، فلا قيمة خطة أو رقم فاتورة مرمزة في التطبيق.
 */
import type { PaymentTransactionId } from "../../domain/financial/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { SubscriptionWalletRpcPort } from "./ports.ts";
export interface IssueInvoiceInput {
  readonly paymentId: PaymentTransactionId;
}
export interface IssueInvoiceDeps {
  readonly wallets: SubscriptionWalletRpcPort;
}
export interface IssueInvoiceOutcome {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly alreadyIssued: boolean;
}
export class IssueInvoiceError {
  readonly code = "ISSUE_INVOICE_FAILURE" as const;
  constructor(readonly detail: string) {}
}
export async function issueInvoice(
  input: IssueInvoiceInput,
  deps: IssueInvoiceDeps,
): Promise<Result<IssueInvoiceOutcome, IssueInvoiceError>> {
  const result = await deps.wallets.issueInvoice(input.paymentId);
  if (!result.ok) return err(new IssueInvoiceError(result.error.detail));
  if (!result.value.ok || result.value.invoiceId === null || result.value.invoiceNumber === null)
    return err(new IssueInvoiceError(result.value.error ?? "INVOICE_REJECTED"));
  return ok({
    invoiceId: result.value.invoiceId,
    invoiceNumber: result.value.invoiceNumber,
    alreadyIssued: result.value.alreadyIssued,
  });
}
