/**
 * الغرض: أخطاء العمل المتوقعة لوحدة delivery تُعاد عبر نمط Result بلا throw — توصيل الطرود
 * الحالة: منفّذ فعلياً — المرحلة 2.2.
 * ينتمي إلى: domain/delivery
 * يُتوقع أن يستخدمه لاحقاً: packages/application/delivery/*, packages/infrastructure/delivery/*
 * ملاحظات مستقبلية: عند إضافة أوزان/أحجام للطرد تُضاف أخطاؤها هنا لا في طبقة التطبيق.
 */

/** وصف الطرد غير مقبول: فارغ، أو أقصر/أطول من المدى المعقول، أو أمر بوت لا وصفاً. */
export class InvalidParcelDescriptionError {
  readonly code = "INVALID_PARCEL_DESCRIPTION" as const;
  constructor(readonly reason: "empty" | "too_short" | "too_long" | "looks_like_command") {}
}

/**
 * وجهة التوصيل ركن لا خيار: الطرد يُسلَّم إلى مكان محدَّد.
 * هذا هو الفرق الجوهري عن النقل حيث يجوز للعميل أن يوضّح وجهته للسائق شفهياً.
 */
export class DeliveryDropoffRequiredError {
  readonly code = "DELIVERY_DROPOFF_REQUIRED" as const;
}

/**
 * رفضُ التوصيلِ لوجودِ طلبِ توصيلٍ نشطٍ — رفضٌ مقيسٌ لا عطبٌ تقنيٌ.
 * D-01: البوتُ ينشئُ عبرَ `RideRequestCommand` الذرّيِّ، والرفضُ يُعاد صراحةً لا يُبتلَع.
 */
export class ActiveDeliveryExistsError {
  readonly code = "ACTIVE_DELIVERY_EXISTS" as const;
  constructor(readonly orderId: string) {}
}

export type DeliveryRequestError =
  | InvalidParcelDescriptionError
  | DeliveryDropoffRequiredError
  | ActiveDeliveryExistsError;
