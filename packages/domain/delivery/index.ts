/**
 * الغرض: نقطة التصدير العامة لوحدة delivery — توصيل الطرود
 * الحالة: منفّذ فعلياً — المرحلة 2.2.
 * ينتمي إلى: domain/delivery
 * يُتوقع أن يستخدمه لاحقاً: packages/application/delivery/*, packages/infrastructure/delivery/*
 * ملاحظات مستقبلية: أي تصدير جديد يمرّ من هنا لا من مسار الملف مباشرة.
 */

export {
  DELIVERY_SERVICE,
  type DeliveryRequest,
  type DeliveryRequestInput,
  makeDeliveryRequest,
} from "./entity.ts";
export {
  DeliveryDropoffRequiredError,
  type DeliveryRequestError,
  InvalidParcelDescriptionError,
} from "./errors.ts";
export type { DeliveryEvent, DeliveryRequestedEvent } from "./events.ts";
export { type ParcelDescription, parseParcelDescription } from "./value-objects.ts";
