/**
 * الغرض: منافذ (Ports) وحدة الدفع — العقود التي تُخاطب بها طبقة التطبيق مزوّدَي
 *   الدفع والقاعدةَ. لا تنفيذ هنا: التنفيذ في packages/infrastructure/financial،
 *   والمزدوجات في tests/support.
 * الحالة: منفّذ فعلياً — البند 8.2 (Provider Abstraction) و8.3 (Subscription Flow).
 * ينتمي إلى: application/financial
 * ملاحظات مستقبلية: لا مزوّد فعلي مدمج الآن — الاختيار معلَّق في تعليق الكود حتى
 *   يحدده المالك. البنية وحدها قائمة، واشتراك السائق حالة الاستخدام الوحيدة المفعّلة.
 */

import type {
  Money,
  PaymentPurpose,
  PaymentTransaction,
  PaymentTransactionId,
  PaymentTransactionStatus,
} from "../../domain/financial/index.ts";
import type { DriverId } from "../../shared/kernel/index.ts";
import { PortFailureError } from "../ports/index.ts";
import type { Result } from "../../shared/result/index.ts";

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

/**
 * منفذ مزوّد الدفع — تجريد صرف بلا أي منطق خاص بمزوّد بعينه.
 * **لا تُدمج Adyen أو Tap أو أي مزوّد فعلي الآن** — الاختيار معلَّق حتى يحدده المالك.
 * المنفذ وحده يُحقن، فإضافة مزوّد لاحقاً لا تُغيّر أي حالة استخدام.
 */
export interface PaymentProvider {
  /** اسم المزوّد للسجلّ والمعرفة. */
  readonly name: string;

  /**
   * يبدأ عملية دفع لاشتراك السائق. لا يخزّن بيانات بطاقة ولا CVV (البند 8.9).
   * يعيد حالة المعاملة ورابط الدفع إن كان المزوّد يتطلّبه.
   */
  chargeSubscription(input: {
    readonly driverId: DriverId;
    readonly amount: Money;
    readonly purpose: PaymentPurpose;
    readonly idempotencyKey: string;
  }): Promise<Result<ChargeInitiation, PortFailureError>>;
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
   * يؤكّد معاملة ذرّياً: يحدّث الحالة ومعرّف المزوّد، ويُفعّل الاشتراك، ويكتب
   * دفتر الأستاذ — كلّها في معاملة واحدة لا تُكسر. يعيد المعاملة المحدّثة.
   */
  confirmPayment(input: {
    readonly transactionId: PaymentTransactionId;
    readonly providerTransactionId: string;
    readonly newStatus: PaymentTransactionStatus;
  }): Promise<Result<PaymentTransaction, PortFailureError>>;
}

/** منفذ تخزين أحداث الويبهوك — لمنع معالجة الحدث مرّتين (Idempotency). */
export interface WebhookEventStore {
  /**
   * يحاول تسجيل حدث ويبهوك. يعيد `true` إن كان جديداً (ويُعالَج)،
   * و`false` إن كان مكرَّراً (ويُهمل).
   */
  record(eventId: string, provider: string, payload: string): Promise<Result<boolean, PortFailureError>>;
}
