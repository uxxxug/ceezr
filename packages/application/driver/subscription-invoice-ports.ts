/**
 * الغرض: منفذُ الفاتورةِ الضريبيّةِ — **إصدارٌ واحدٌ يكتبُ، وقراءتانِ لا تكتبانِ**
 *   (`F3-09` · `SD-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-09`.
 * ينتمي إلى: packages/application/driver
 * يُستخدم من: `packages/application/driver/subscription-invoice.ts` ·
 *   `packages/infrastructure/driver/subscription-invoice-store.ts`
 * يحرسُه: scripts/check-tax-invoice-contract.ts
 * الحاكم: docs/adr/0127-simplified-tax-invoice.md
 *
 * ## لِمَ عقدٌ جديدٌ لا توسيعٌ لـ`DriverSubscriptionStore`
 *
 * لأنَّ ذاكَ العقدَ **قراءةٌ محضةٌ** أُعلِنَ ذلكَ في رأسِه ويُقاسُ في حاجزِه، وفيه
 * إصدارٌ يكتبُ صفّاً. وتوسيعُه يُعطي سلطةَ كتابةٍ لكلِّ مُستعمِلٍ لِلوحٍ أو
 * لتاريخٍ — و**أوسعُ سلطةٍ في عقدٍ تُقرأُ سلطةَ كلِّ مُستعمِلِه**. فعقدٌ بجانبِه.
 *
 * ## ولِمَ الإصدارُ في المنفذِ لا في حالةِ الاستخدامِ
 *
 * لأنَّ الترقيمَ المتتابعَ والتماثلَ (فاتورةٌ واحدةٌ للمعاملةِ) **مُنفَذانِ في
 * القاعدةِ** بمُتوالٍ وقيدِ تفرُّدٍ. فالمنفذُ ينقلُ أمرَ إصدارٍ، ولا يُقرِّرُ رقماً
 * ولا يفحصُ سابقةً — ولو فحصَ لَكانَ بينَ فحصِه وكتابتِه سباقٌ.
 *
 * ## وما لا يقولُه هذا العقدُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقولُ تعديلاً ولا حذفاً**: الوثيقةُ غيرُ قابلةٍ للتعديلِ بزنادٍ في
 *      القاعدةِ، فلا طريقةَ ههنا تُوهِمُ بأنَّهما ممكنانِ.
 *   ــ **لا يقولُ سرداً**: لا «فواتيري كلُّها» — سطحٌ لم يُبنَ، ولا منفذَ لما لا
 *      مُستدعيَ له.
 *   ــ **لا يقولُ سائقاً آخرَ**: المِلكيّةُ مُنفَذةٌ في القاعدةِ، والهويّةُ من
 *      الرمزِ الموقَّعِ وحدَه.
 *   ــ **لا يقولُ بيانةَ بطاقةٍ**: لا حقلَ — ويحرسُه حاجزٌ ساكنٌ.
 *
 * ## زيادةٌ بعدَ حلِّ تعارضٍ — (`ح-8`)
 *
 * سجلُّ الفواتيرِ ليسَ جديداً بل `subscription_invoices` القائمُ منذُ
 * `20260813010000`، وكاتبُه `issue_subscription_invoice` قائمٌ له مَنفذٌ آخرُ
 * (`packages/infrastructure/financial/subscription-wallet-adapters.ts`). ومن ثَمَّ
 * دخلَ رفضانِ كانا مستوريَنِ في ذاكَ الكاتبِ إلى هذا المجالِ:
 *   ــ `PAYMENT_PLAN_MISSING`: خطّةُ الاشتراكِ غائبةٌ من بياناتِ المعاملةِ —
 *      **عطبُ بياناتٍ لا خطأُ سائقٍ**، ولا يفعلُ السائقُ به شيئاً.
 *   ــ `INVOICE_WITHOUT_TAX_FIELDS`: صفٌّ صدرَ قبلَ هذه الهجرةِ فلا حقولَ
 *      ضريبيّةَ فيه — **ولا يُلفَّقُ له وعاءٌ ولا نسبةٌ**.
 */

import type {
  SimplifiedTaxInvoice,
  SubscriptionPaymentStatus,
} from "../../domain/driver/subscription-invoice.ts";
import type { Result } from "../../shared/result/index.ts";

/**
 * رفضٌ مُصنَّفٌ من القاعدةِ — **مجالٌ مغلقٌ يقابلُ رموزَ الدوالِّ حرفاً**. وزيادةُ
 * رمزٍ في هجرةٍ بلا زيادتِه ههنا تُقرأُ `MALFORMED_RESULT` لا تُمرَّرُ صامتةً.
 */
export type TaxInvoiceStoreRejection =
  | "USER_NOT_FOUND"
  | "NOT_A_DRIVER"
  | "TRANSACTION_NOT_FOUND"
  | "TRANSACTION_NOT_PAID"
  | "TAX_IDENTITY_NOT_CONFIGURED"
  | "VAT_RATE_NOT_CONFIGURED"
  | "PAYMENT_PLAN_MISSING"
  | "INVOICE_WITHOUT_TAX_FIELDS"
  | "INVOICE_NOT_ISSUED";

export const TAX_INVOICE_STORE_REJECTIONS: readonly TaxInvoiceStoreRejection[] = [
  "USER_NOT_FOUND",
  "NOT_A_DRIVER",
  "TRANSACTION_NOT_FOUND",
  "TRANSACTION_NOT_PAID",
  "TAX_IDENTITY_NOT_CONFIGURED",
  "VAT_RATE_NOT_CONFIGURED",
  "PAYMENT_PLAN_MISSING",
  "INVOICE_WITHOUT_TAX_FIELDS",
  "INVOICE_NOT_ISSUED",
];

export interface TaxInvoiceStoreFailure {
  readonly reason: "STORE_ERROR" | "MALFORMED_RESULT";
}

export interface TaxInvoiceRejectionDetail {
  readonly rejection: TaxInvoiceStoreRejection;
}

export type TaxInvoiceStoreError = TaxInvoiceStoreFailure | TaxInvoiceRejectionDetail;

export function isTaxInvoiceRejection(
  error: TaxInvoiceStoreError,
): error is TaxInvoiceRejectionDetail {
  return "rejection" in error;
}

/** نتيجةُ إصدارٍ — والرايةُ تقولُ: أصدرتُ الآن أم أعدتُ ما صدرَ. */
export interface TaxInvoiceIssueOutcome {
  readonly invoice: SimplifiedTaxInvoice;
  readonly alreadyIssued: boolean;
}

export interface SubscriptionTaxInvoiceStore {
  /**
   * **يكتبُ مرّةً**: يُصدِرُ فاتورةَ معاملةٍ ناجحةٍ، ونداءٌ ثانٍ يُعيدُ ما صدرَ
   * برايةِ `alreadyIssued` — لا رقماً ثانياً لتوريدٍ واحدٍ.
   */
  issueInvoice(input: {
    readonly telegramUserId: string;
    readonly transactionId: string;
  }): Promise<Result<TaxInvoiceIssueOutcome, TaxInvoiceStoreError>>;

  /** **يقرأُ ولا يكتبُ**: فاتورةٌ صدرَت، وغيابُها `INVOICE_NOT_ISSUED`. */
  readInvoice(input: {
    readonly telegramUserId: string;
    readonly transactionId: string;
  }): Promise<Result<SimplifiedTaxInvoice, TaxInvoiceStoreError>>;

  /** **يقرأُ ولا يكتبُ**: حالُ معاملةٍ بعينِها ورايةُ صدورِ فاتورتِها. */
  readPaymentStatus(input: {
    readonly telegramUserId: string;
    readonly transactionId: string;
  }): Promise<Result<SubscriptionPaymentStatus, TaxInvoiceStoreError>>;
}
