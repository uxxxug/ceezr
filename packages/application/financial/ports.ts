/**
 * الغرض: منافذ (Ports) وحدة الدفع — العقود التي تُخاطب بها طبقة التطبيق مزوّدَي
 *   الدفع والقاعدةَ. لا تنفيذ هنا: التنفيذ في packages/infrastructure/financial،
 *   والمزدوجات في tests/support.
 * الحالة: منفّذ فعلياً — البند 8.2 (Provider Abstraction) و8.3 (Subscription Flow).
 * ينتمي إلى: application/financial
 * ملاحظات مستقبلية: Moyasar ومنفذ الدعم اليدوي مدمجان؛ لا تُضاف بوابة أخرى إلا
 *   بعد توثيق آلية تحققها وإعادة القراءة من خادمها.
 */

import type {
  Money,
  PaymentPurpose,
  PaymentTransaction,
  PaymentTransactionId,
  PaymentTransactionStatus,
} from "../../domain/financial/index.ts";
import type { DriverId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import { PortFailureError } from "../ports/index.ts";

/** خطأ منفذ دفع: PortFailureError القائم — ليتوافق مع guard<T>. */
export type PaymentPortError = PortFailureError;
export { PortFailureError };

/** نتيجة بدء عملية دفع عند المزوّد. */
export interface ChargeInitiation {
  /** معرّف العملية عند المزوّد (إن بدأها فوراً) أو null إن لم تُبدأ بعد. */
  readonly providerTransactionId: string | null;
  /** رابط دفع للعميل إن كان المزوّد يتطلّب توجيهاً (Checkout URL). null إن اكتمل فوراً. */
  readonly checkoutUrl: string | null;
  readonly status: PaymentTransactionStatus;
}

/** حدث موثّق أصله من مزوّد الدفع، بلا مبلغ أو حالة موثوقين من الحمولة. */
export interface ProviderEvent {
  readonly id: string;
  readonly type: string;
  /** معرّف الدفعة عند المزوّد؛ يُعاد جلبها من خادمه قبل أي أثر مالي. */
  readonly providerTransactionId: string;
}

/**
 * اللقطة الوحيدة التي يحق لمسار الويبهوك أن يعتمد منها الحالة والمبلغ والعملة.
 * metadata نصية لأن Moyasar يقبل النصوص فقط، ومنها يثبت ربط الدفعة بمعاملتنا.
 */
export interface ProviderTransactionSnapshot {
  readonly id: string;
  readonly status: PaymentTransactionStatus;
  readonly amount: number;
  readonly currency: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly invoiceId: string | null;
}

/**
 * صفٌّ معلّق مرشّح للمراجعة من خادم المزوّد. يحمل ما تحتاجه المراجعة للمقارنة
 * قبل التأكيد — فالمراجعة تقارن لقطة المزوّد بالصفّ ولا تكتفي بما يرويه المزوّد.
 */
export interface StalePendingPayment {
  readonly id: PaymentTransactionId;
  readonly cityId: string;
  readonly payerDriverId: string;
  readonly provider: string;
  readonly providerTransactionId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly status: PaymentTransactionStatus;
  readonly updatedAt: Date;
}

/**
 * منفذ مزوّد الدفع — تجريد صرف بلا أي منطق خاص بمزوّد بعينه.
 * لا تُعتمد حمولة الويبهوك كمصدر مالي؛ verifyWebhook يثبت المصدر فقط و
 * fetchTransaction يقرأ الحقيقة من API المزوّد.
 */
export interface PaymentProvider {
  /** اسم المزوّد للسجلّ والمعرفة. */
  readonly name: string;

  /**
   * يبدأ عملية دفع لاشتراك السائق. لا يخزّن بيانات بطاقة ولا CVV (البند 8.9).
   * يعيد حالة المعاملة ورابط الدفع إن كان المزوّد يتطلّبه.
   */
  chargeSubscription(input: {
    /** معرّف معاملتنا الذي يُرسل في metadata ليثبت ملكية الدفعة لاحقاً. */
    readonly transactionId: PaymentTransactionId;
    readonly driverId: DriverId;
    readonly amount: Money;
    readonly purpose: PaymentPurpose;
    readonly idempotencyKey: string;
  }): Promise<Result<ChargeInitiation, PortFailureError>>;

  /** يثبت أصالة الجسم الخام ويستخرج معرف الحدث والدفعة فقط. */
  verifyWebhook(
    rawBody: string,
    headers: Headers,
  ): Promise<Result<ProviderEvent, PortFailureError>>;

  /** إعادة القراءة الإلزامية من خادم المزوّد قبل تغيير أي حالة محلية. */
  fetchTransaction(
    providerTransactionId: string,
  ): Promise<Result<ProviderTransactionSnapshot, PortFailureError>>;
}

/**
 * قدرة مستقلة لا يعلنها PaymentProvider الأساسي عمداً: Moyasar في نطاق هذه
 * المواصفة لا يوفّر endpoint استرداد موثقاً نبني عليه. لا تُضف refund شكلية.
 */
export interface RefundCapablePaymentProvider extends PaymentProvider {
  refund(input: {
    readonly providerTransactionId: string;
    readonly amount: Money;
    readonly idempotencyKey: string;
  }): Promise<Result<ProviderTransactionSnapshot, PortFailureError>>;
}

/** مدخل لإنشاء معاملة دفع في القاعدة. */
export interface CreatePaymentInput {
  readonly driverId: DriverId;
  readonly amount: Money;
  readonly purpose: PaymentPurpose;
  readonly provider: string;
  readonly providerTransactionId: string | null;
  readonly status: PaymentTransactionStatus;
  readonly idempotencyKey: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * نتيجة إنشاء معاملة دفع — تحمل المعاملة وعلم «كانت موجودة سلفاً».
 * alreadyExists=true يعني أنّ المعاملة رُفض إنشاؤها ثانيةً وأُعيدت القائمة.
 * هذا العلم حاسم لمنع استدعاء المزوّد مرّتين عند السباق (race condition).
 */
export interface CreatePaymentResult {
  readonly transaction: PaymentTransaction;
  readonly alreadyExists: boolean;
}

/**
 * منفذ مستودع معاملات الدفع — الكتابة والقراءة على القاعدة عبر RPC ذرّي.
 * Idempotency على مفتاح `idempotencyKey`: إنشاءٌ بنفس المفتاح مرّتين يُعيد
 * المعاملة الموجودة لا يُنشئ ثانية، ويُعيّن alreadyExists=true.
 */
export interface PaymentRepository {
  /** ينشئ معاملة ذرّياً مع حماية التكرار على مفتاح الإيدمبوتنسي. */
  create(input: CreatePaymentInput): Promise<Result<CreatePaymentResult, PortFailureError>>;

  /** يقرأ معاملة بمعرّفها. */
  findById(id: PaymentTransactionId): Promise<Result<PaymentTransaction | null, PortFailureError>>;

  /** يجد معاملة بمفتاح الإيدمبوتنسي (لمنع التكرار في الويبهوك). */
  findByIdempotencyKey(key: string): Promise<Result<PaymentTransaction | null, PortFailureError>>;

  /**
   * يحفظ رابط الدفع المستضاف داخل المعاملة مرّةً واحدة، ويعيد الرابط النافذ.
   *
   * بلا هذا كان الرابط يعيش في ردّ المزوّد لحظةً ثمّ يُفقد، فالضغطة الثانية على
   * زرّ الاشتراك تعيد معاملةً معلّقة بلا سبيلٍ إلى دفعها. وإنشاءُ فاتورةٍ ثانية
   * بدلاً من ذلك خطرٌ ماليّ: `activate_subscription` يستبدل المدّة ولا يجمعها،
   * فمن دفع فاتورتين خسر شهراً من قيمة ما دفع.
   */
  recordCheckoutUrl(input: {
    readonly transactionId: PaymentTransactionId;
    readonly checkoutUrl: string;
  }): Promise<Result<{ readonly checkoutUrl: string }, PortFailureError>>;

  /**
   * يحفظ معرّف عملية المزوّد لحظةَ بدئها لا لحظةَ تأكيدها — مرّةً واحدة، بلا
   * تغيير حالةٍ ولا تفعيل اشتراك.
   *
   * ولماذا لا يُترك للويبهوك؟ لأنّ المعرفة كانت في اتجاهٍ واحد: المزوّد يعرف
   * معاملتنا من `metadata`، ونحن لا نعرف عمليته. فإن ضاع الويبهوك بقي الصفّ
   * معلّقاً إلى الأبد ولا سبيل إلى سؤال المزوّد «ما مصير هذه الدفعة؟» — فيدفع
   * السائق ولا يُفعَّل اشتراكه بلا أن يظهر ذلك في أيّ مقياس.
   */
  recordProviderReference(input: {
    readonly transactionId: PaymentTransactionId;
    readonly provider: string;
    readonly providerTransactionId: string;
  }): Promise<
    Result<{ readonly providerTransactionId: string; readonly stored: boolean }, PortFailureError>
  >;

  /**
   * يسرد المعاملات المعلّقة القابلة للمراجعة من خادم المزوّد: مرّ عليها ما يكفي
   * ولم تتجاوز سقف العمر، ولها مرجعٌ عند المزوّد يُسأل به.
   */
  findStalePending(input: {
    readonly cityId: string;
    readonly olderThanSeconds: number;
    readonly maxAgeSeconds: number;
    readonly limit: number;
  }): Promise<Result<readonly StalePendingPayment[], PortFailureError>>;

  /**
   * يؤكّد معاملة ذرّياً: يحدّث الحالة ومعرّف المزوّد، ويُفعّل الاشتراك، ويكتب
   * دفتر الأستاذ — كلّها في معاملة واحدة لا تُكسر. يعيد المعاملة المحدّثة.
   */
  confirmPayment(input: {
    readonly transactionId: PaymentTransactionId;
    readonly providerTransactionId: string;
    readonly newStatus: PaymentTransactionStatus;
    /**
     * يمرّره الويبهوك فقط: يربط تأكيد المزوّد بالمعاملة التي أُنشئت له في
     * القاعدة، فلا يستطيع مزوّد/مرسل آخر تأكيد معاملة ليست له.
     */
    readonly provider?: string;
  }): Promise<Result<PaymentTransaction, PortFailureError>>;

  /**
   * حسم ويبهوك في RPC واحد: يمنع الانتقالات غير الصالحة، ويسجل eventId، ويكتب
   * دفتر الأستاذ ويُفعّل الاشتراك في المعاملة نفسها.
   */
  confirmWebhookPayment?(input: {
    readonly transactionId: PaymentTransactionId;
    readonly providerTransactionId: string;
    readonly newStatus: PaymentTransactionStatus;
    /** مبلغ وعملة لقطة خادم المزوّد، يعيد الـRPC مطابقتهما مع الصف المقفل. */
    readonly providerAmount: number;
    readonly providerCurrency: string;
    readonly provider: string;
    readonly webhookEventId: string;
    readonly rawPayload: string;
  }): Promise<
    Result<
      { readonly transaction: PaymentTransaction; readonly duplicate: boolean },
      PortFailureError
    >
  >;
}

/** منفذ تخزين أحداث الويبهوك — لمنع معالجة الحدث مرّتين (Idempotency). */
export interface WebhookEventStore {
  /**
   * يحاول تسجيل حدث ويبهوك. يعيد `true` إن كان جديداً (ويُعالَج)،
   * و`false` إن كان مكرَّراً (ويُهمل).
   *
   * `transactionId` ليس زينة: منه تُقرأ مدينة الصفّ (city_id) داخل القاعدة،
   * فحدثٌ لمعاملةٍ مجهولة يُردّ بفشلٍ صريح لا يُسجَّل بمدينةٍ مفترضة.
   */
  record(
    eventId: string,
    provider: string,
    payload: string,
    transactionId: PaymentTransactionId,
  ): Promise<Result<boolean, PortFailureError>>;
}

/** منافذ محفظة ائتمان الاشتراك. كل كتابة تقابل RPC ذرّياً في القاعدة. */
export interface SubscriptionWalletRpcPort {
  createWallet(driverId: DriverId): Promise<Result<WalletCreation, PortFailureError>>;
  getBalance(driverId: DriverId): Promise<Result<WalletBalance, PortFailureError>>;
  topUp(input: WalletTopUpRequest): Promise<Result<WalletMutation, PortFailureError>>;
  refund(
    input: SubscriptionRefundRequest,
  ): Promise<Result<SubscriptionRefundOutcome, PortFailureError>>;
  issueInvoice(
    paymentId: PaymentTransactionId,
  ): Promise<Result<SubscriptionInvoiceOutcome, PortFailureError>>;
  settleSystemError(
    input: SystemErrorSettlementRequest,
  ): Promise<Result<WalletMutation, PortFailureError>>;
}

export interface WalletCreation {
  readonly ok: boolean;
  readonly error: string | null;
  readonly walletId: string | null;
  readonly currency: string | null;
  readonly alreadyExists: boolean;
}
export interface WalletBalance {
  readonly ok: boolean;
  readonly error: string | null;
  readonly walletId: string | null;
  readonly currency: string | null;
  readonly balanceMinor: number | null;
}
export interface WalletMutation {
  readonly ok: boolean;
  readonly error: string | null;
  readonly walletId: string | null;
  readonly entryId: string | null;
  readonly alreadyExists: boolean;
  readonly balanceMinor: number | null;
}
export interface WalletTopUpRequest {
  readonly driverId: DriverId;
  readonly paymentId: PaymentTransactionId | null;
  readonly amountMinor: number | null;
  readonly actorUserId: string | null;
  readonly reason: string | null;
  readonly reference: string | null;
  readonly idempotencyKey: string;
}
export interface SubscriptionRefundRequest {
  readonly paymentId: PaymentTransactionId;
  readonly amountMinor: number;
  readonly destination: "wallet_credit" | "provider_refund";
  readonly actorUserId: string | null;
  readonly reason: string;
  readonly reference: string;
}
export interface SubscriptionRefundOutcome {
  readonly ok: boolean;
  readonly error: string | null;
  readonly refundId: string | null;
  readonly walletId: string | null;
  readonly alreadyRefunded: boolean;
  readonly destination: string | null;
}
export interface SubscriptionInvoiceOutcome {
  readonly ok: boolean;
  readonly error: string | null;
  readonly invoiceId: string | null;
  readonly invoiceNumber: string | null;
  readonly alreadyIssued: boolean;
}
export interface SystemErrorSettlementRequest {
  readonly driverId: DriverId;
  readonly adjustmentMinor: number;
  readonly actorUserId: string;
  readonly reason: string;
  readonly reference: string;
  readonly idempotencyKey: string;
}
