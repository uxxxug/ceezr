/**
 * الغرض: شكلُ ردودِ حالِ الدفعةِ والفاتورةِ الضريبيّةِ المبسَّطةِ كما يقرؤها
 *   العميلُ — أنواعٌ لا منطقٌ (البند `F3-09` · `SD-08` · الدفعةُ الثانيةُ).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-09`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/subscription
 * يُستخدم من: `invoice-api.ts` · `invoice-view.ts` · `PaymentInvoicePanel.tsx`
 * يُتوقع أن يستخدمه لاحقاً: المرحلةُ الثانيةُ من الفوترةِ الإلكترونيّةِ (`XML`
 *   وتوقيعٌ وربطٌ بهيئةِ الزكاةِ) — **ولا حقلَ لها ههنا الآنَ**، إذ حقلٌ فارغٌ
 *   يوحي بقدرةٍ لم تُبنَ.
 * يحرسُه: scripts/check-tax-invoice-contract.ts
 * الحاكم: docs/adr/0127-simplified-tax-invoice.md
 *
 * ## لِمَ الحقولُ كلُّها من الجوابِ ولا يُحسَبُ منها شيءٌ ههنا
 *
 * لأنَّ الفاتورةَ **وثيقةٌ صدرَت** لا لوحُ حسابٍ: المبلغُ والضريبةُ ونسبتُها
 * ورقمُ البائعِ **مخزونةٌ في صفِّها** لحظةَ الإصدارِ. فلو حسبَ العميلُ الضريبةَ
 * من المبلغِ لَظهرَ رقمٌ ثانٍ يُخالِفُ ما في القاعدةِ عندَ أوّلِ تغييرٍ في
 * الإعداداتِ — ولوحُ سائقٍ يُخالِفُ وثيقةً ضريبيّةً عطبٌ لا خلافُ تنسيقٍ.
 *
 * ## ولِمَ رمزُ الاستجابةِ **نصٌّ** لا صورةً
 *
 * لأنَّ الذي يجبُ أن يصلَ العميلَ هوَ **الحِمْلُ المُصدَّقُ** كما خزنَتْهُ
 * القاعدةُ؛ ورسمُه صورةً شأنُ سطحٍ يقعُ فوقَ النصِّ. ولو أُرسِلَت صورةٌ لَصارَ
 * في الطريقِ مُرمِّزٌ ثانٍ يُمكِنُ أن يُخالِفَ الأصلَ بلا أن يُقاسَ.
 *
 * ## وما لا يصفُه هذا الملفُّ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا هويّةَ مشترٍ**: الفاتورةُ المبسَّطةُ لا تحملُها، فلا حقلَ لها.
 *   ــ **لا معرِّفَ مزوِّدٍ**: مِفتاحُ تظلُّمٍ في لوحتِه لا حقُّ واجهةٍ (القاعدةُ ٨).
 *   ــ **لا حالةَ اشتراكٍ**: هذا عقدُ دفعةٍ وفاتورةٍ، والاشتراكُ عقدُه لهُ.
 *   ــ **لا رابطَ تحميلٍ لـ`PDF`**: لم يُبنَ مُصدِّرُ ملفٍّ، فلا يُوعَدُ به.
 */

/** نوعُ الوثيقةِ كما يُقرأُ من القاعدةِ — واحدٌ اليومَ، والاتّحادُ يُوسَّعُ حينَ يُبنى. */
export type ApiTaxDocumentType = "SIMPLIFIED_TAX_INVOICE";

/**
 * جسمُ الفاتورةِ — **موضعٌ واحدٌ** في الخادمِ يُشكِّلُه، فثلاثةُ مساراتٍ لا
 * تفترقُ حقولُها، وعقدٌ واحدٌ ههنا يُقابِلُه.
 */
export interface ApiSimplifiedTaxInvoice {
  readonly invoice_number: string;
  readonly document_type: ApiTaxDocumentType;
  readonly issued_at: string;
  readonly transaction_id: string;
  readonly seller_name: string;
  readonly seller_vat_number: string;
  /** نسبةُ الضريبةِ بنقاطِ الأساسِ — ١٥٠٠ تعني ١٥٪. */
  readonly vat_rate_bps: number;
  readonly currency: string;
  readonly total_excl_vat_minor: number;
  readonly vat_amount_minor: number;
  readonly total_incl_vat_minor: number;
  /** الحقولُ الخمسةُ الواجبةُ بترميزِ `TLV` ثمَّ `base64` — سطرٌ واحدٌ بلا فراغٍ. */
  readonly qr_tlv_base64: string;
}

/** حالُ عمليةِ دفعٍ بعينِها — يُقرأُ عندَ الرجوعِ من صفحةِ المزوّدِ. */
export interface ApiDriverPaymentStatusResponse {
  readonly ok: true;
  readonly server_time: string;
  readonly transaction_id: string;
  readonly status: string;
  readonly amount_minor: number;
  readonly currency: string;
  readonly created_at: string;
  readonly updated_at: string | null;
  readonly checkout_url: string | null;
  /** هل صارَ للمعاملةِ صفُّ فاتورةٍ — **رايةٌ تمنعُ نداءَ إصدارٍ لا يلزمُ**. */
  readonly invoice_issued: boolean;
  /**
   * أيصحُّ طلبُ الإصدارِ الآنَ — **من القاعدةِ لا من قياسِ الشاشةِ لِحالٍ**.
   * فلو قاسَت الشاشةُ اسمَ الحالِ لَنسخَت محدِّدَ عملٍ تتخلَّفُ عنه.
   */
  readonly invoice_issuable: boolean;
}

/**
 * جوابُ الإصدارِ. و`already_issued` **ليسَ عطباً**: نداءٌ ثانٍ يُعيدُ الوثيقةَ
 * عينَها بـ`200` ولا يُصدِرُ رقماً ثانياً، والرايةُ تُقالُ للسائقِ صراحةً كي لا
 * يظنَّ أنَّه أصدرَ فاتورتَينِ.
 */
export interface ApiDriverInvoiceIssueResponse {
  readonly ok: true;
  readonly already_issued: boolean;
  readonly invoice: ApiSimplifiedTaxInvoice;
}

/** جوابُ القراءةِ — وغيابُ الفاتورةِ `404` بـ`INVOICE_NOT_ISSUED` لا جسمٌ فارغٌ. */
export interface ApiDriverInvoiceReadResponse {
  readonly ok: true;
  readonly invoice: ApiSimplifiedTaxInvoice;
}
