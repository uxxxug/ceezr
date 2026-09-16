/**
 * الغرض: أنواعُ **الفاتورةِ الضريبيّةِ المبسَّطةِ** وحالِ عمليةِ دفعٍ بعينِها،
 *   كما تُصدِرُهما القاعدةُ (`F3-09` · `SD-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-09`.
 * ينتمي إلى: packages/domain/driver
 * يُستخدم من: `packages/application/driver/subscription-invoice-ports.ts` ·
 *   `packages/infrastructure/driver/subscription-invoice-store.ts`
 * يُتوقع أن يستخدمه لاحقاً: سطحُ الفاتورةِ في التطبيقِ المُصغَّرِ (الدفعةُ
 *   الثانيةُ من `F3-09`) — يقرأُ هذا الشكلَ ولا يُعيدُ حسابَ حقلٍ منه.
 * يحرسُه: scripts/check-tax-invoice-contract.ts
 * الحاكم: docs/adr/0127-simplified-tax-invoice.md
 *
 * ## لِمَ لا حسابَ ضريبةٍ ههنا
 *
 * المجالُ ههنا **يصفُ وثيقةً صدرَت**، ولا يحسبُ ما فيها. والحسابُ في القاعدةِ
 * لحظةَ الإصدارِ (كاتبٌ واحدٌ · القاعدة ٠.٦)، ولو أُعيدَ ههنا لَصارَ للضريبةِ
 * حاسبانِ — وحاسبانِ لرقمٍ ضريبيٍّ ليسَ تكراراً في الشِّفرةِ بل **خطرَ إقرارٍ
 * مختلفٍ عن الوثيقةِ**. فالطبقاتُ فوقَ القاعدةِ **تنقلُ ولا تحسبُ**.
 *
 * ## ولِمَ الوحداتُ الصغرى أعداداً صحيحةً
 *
 * لأنَّ الوثيقةَ تُطابَقُ بالجمعِ: وعاءٌ زائدَ ضريبةٍ يساوي إجمالياً — وقيدٌ في
 * المخطَّطِ يفرضُه. وكسرٌ عشريٌّ عائمٌ يجعلُ المطابقةَ تُخفِقُ بهلّةٍ لا يراها أحدٌ.
 *
 * ## وما لا يقولُه هذا الملفُّ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقولُ امتثالاً للمرحلةِ الثانيةِ**: لا `UUID` مُختَمٌ ولا تجزئةٌ
 *      متسلسلةٌ (`PIH`) ولا ختمٌ تشفيريٌّ — والحقولُ ههنا حقولُ الطورِ الأوّلِ.
 *   ــ **لا يقولُ صورةً**: `qrTlvBase64` **نصُّ ترميزٍ** لا صورةَ رمزٍ؛ ورسمُ
 *      الرمزِ شأنُ سطحٍ.
 *   ــ **لا يقولُ مشترياً**: الفاتورةُ المبسَّطةُ لا تحملُ هويّةَ المشتري.
 *   ــ **لا يقولُ ضريبةً على معاملةٍ لم تنجحْ**: `pending` ليسَ توريداً.
 */

/** نوعُ الوثيقةِ — **حقلٌ من القاعدةِ** لا نصٌّ تختارُه شاشةٌ. */
export type TaxDocumentType = "SIMPLIFIED_TAX_INVOICE";

/**
 * فاتورةٌ ضريبيّةٌ مبسَّطةٌ صدرَت فعلاً. **كلُّ حقلٍ ههنا مخزونٌ لا محسوبٌ**:
 * لقطةُ هويّةِ البائعِ ونسبةِ الضريبةِ وقتَ الإصدارِ، فتغييرُ إعدادٍ لاحقاً لا
 * يُعيدُ كتابةَ وثيقةٍ.
 */
export interface SimplifiedTaxInvoice {
  /** رقمٌ متتابعٌ فريدٌ — `INV-00000001`. */
  readonly invoiceNumber: string;
  readonly documentType: TaxDocumentType;
  readonly issuedAt: string;
  readonly transactionId: string;
  readonly sellerName: string;
  /** خمسةَ عشرَ رقماً — يُفرَضُ شكلُه في القاعدةِ لا ههنا. */
  readonly sellerVatNumber: string;
  /** نسبةُ الضريبةِ بنقاطِ الأساسِ — ١٥٠٠ تعني ١٥٪. */
  readonly vatRateBps: number;
  readonly currency: string;
  readonly totalExclVatMinor: number;
  readonly vatAmountMinor: number;
  readonly totalInclVatMinor: number;
  /** الحقولُ الخمسةُ الواجبةُ بترميزِ `TLV` ثمَّ `base64` — نصٌّ لا صورةٌ. */
  readonly qrTlvBase64: string;
}

/** حالُ عمليةِ دفعٍ بعينِها كما تُقرأُ عندَ الرجوعِ من صفحةِ المزوّدِ. */
export interface SubscriptionPaymentStatus {
  readonly serverTime: string;
  readonly transactionId: string;
  readonly status: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly createdAt: string;
  readonly updatedAt: string | null;
  readonly checkoutUrl: string | null;
  /** هل صارَ للمعاملةِ صفُّ فاتورةٍ — **رايةٌ تمنعُ سؤالاً ثانياً**. */
  readonly invoiceIssued: boolean;
}
