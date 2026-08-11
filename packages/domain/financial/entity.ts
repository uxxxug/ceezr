/**
 * الغرض: الكيانات الجذرية لوحدة financial — معاملة الدفع (PaymentTransaction)
 *   ككيان مستقل، وكائن النقود (Money) بوحدات صغرى فقط (لا float نهائياً)،
 *   ومدخل دفتر الأستاذ (LedgerEntry) الذي يُكتب فيه سطر اشتراك السائق وحده الآن.
 * الحالة: منفّذ فعلياً — البند 8 (طبقة الدفع: اشتراك السائق الشهري فقط).
 * ينتمي إلى: domain/financial
 * يُتوقع أن يستخدمه لاحقاً: packages/application/financial/*, packages/infrastructure/financial/*
 * ملاحظات مستقبلية: المحافظ/التسويات/المصاريف هياكل فقط حتى أمر تفعيل صريح.
 *   السطر الوحيد المكتوب فعلياً في dفتر الأستاذ الآن هو دفعة اشتراك السائق.
 */

import type { Brand, DriverId } from "../../shared/kernel/index.ts";

/** معرّف معاملة دفع. */
export type PaymentTransactionId = Brand<string, "PaymentTransactionId">;

/** نوع الدافع/المستفيد — توسّع مستقبليّ، الآن السائق وحده. */
export type PaymentParty = "driver" | "platform";

/** غرض الدفعة. الآن اشتراك السائق وحده مفعّل. */
export type PaymentPurpose = "driver_subscription";

/**
 * حالات معاملة الدفع. تتبع دورة حياة الاشتراك تحديداً كما طلب البند 8.2:
 * PENDING → ACTIVE (نجاح) أو FAILED/CANCELED/EXPIRED.
 */
export type PaymentTransactionStatus =
  | "active"
  | "pending"
  | "past_due"
  | "failed"
  | "canceled"
  | "expired";

/**
 * النقود بوحدات صغرى (minor units) فقط — هللات لا ريالات.
 * ممنوع float نهائياً في أي عمود أو حساب: الفقدان التراكميّ في الجمع والقسمة
 * يجعل الموازنة مستحيلاً. كل القيم أعداد صحيحة من الوحدات الصغرى.
 */
export interface Money {
  /** المبلغ بوحدات صغرى (هلّة). عدد صحيح موجب. */
  readonly amount: number;
  /** رمز العملة ISO (SAR، إلخ). يُقرأ من platform_settings لا يُكتب هنا. */
  readonly currency: string;
}

/** يبني نقوداً بعد التحقّق أنها وحدات صغرى صحيحة موجبة. */
export function money(amount: number, currency: string): Money {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`المبلغ يجب أن يكون وحدات صغرى صحيحة موجبة، لا ${amount}`);
  }
  if (currency.length !== 3) {
    throw new Error(`العملة رمز ISO ثلاثيّ، لا "${currency}"`);
  }
  return { amount, currency: currency.toUpperCase() };
}

/**
 * معاملة دفع مستقلّة — ليست مرتبطة بطلب ولا رحلة (البند 8.5: ممنوع ربطها بالطلبات).
 * السطر الوحيد المكتوب فيها فعلياً: اشتراك السائق الشهري.
 */
export interface PaymentTransaction {
  readonly id: PaymentTransactionId;
  /** من يدفع — الآن السائق وحده. */
  readonly payerId: DriverId;
  /** من يستلم — المنصّة. */
  readonly payeeId: PaymentParty;
  readonly purpose: PaymentPurpose;
  readonly amount: Money;
  /** اسم مزوّد الدفع (interface فقط، لا مزوّد فعلي مدمج). */
  readonly provider: string;
  /** معرّف العملية عند المزوّد — يُملأ عند نجاح الدفع. */
  readonly providerTransactionId: string | null;
  readonly status: PaymentTransactionStatus;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** مدخل دفتر الأستاذ — سطر واحد لكل حركة مالية. الآن اشتراك السائق وحده. */
export type LedgerEntryType =
  | "debit"
  | "credit"
  | "fee"
  | "commission"
  | "refund"
  | "payout"
  | "settlement";

export interface LedgerEntry {
  readonly id: string;
  readonly transactionId: PaymentTransactionId;
  readonly driverId: DriverId;
  readonly type: LedgerEntryType;
  readonly amount: Money;
  readonly createdAt: Date;
}

/** هل المعاملة في حالة تسمح بإكمال الاشتراك؟ */
export function isPaymentSuccessful(status: PaymentTransactionStatus): boolean {
  return status === "active";
}

/** هل المعاملة لا تزال قابلة للحسم (لم تُغلق نهائياً)؟ */
export function isPaymentOpen(status: PaymentTransactionStatus): boolean {
  return status === "pending" || status === "past_due";
}
