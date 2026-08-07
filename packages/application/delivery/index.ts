/**
 * الغرض: تجميع حالات استخدام وحدة delivery
 * الحالة: منفّذ جزئياً — المرحلة 2.2 فعّلت request-delivery؛ وبقية الملفات هياكل معلنة.
 * ينتمي إلى: application/delivery
 * يُتوقع أن يستخدمه لاحقاً: apps/*
 * ملاحظات مستقبلية: pickup-parcel و deliver-parcel و estimate-delivery-fare تُفعَّل
 *   عند تفعيل انتقالات الرحلة (بدء/إنهاء) بدوال RPC ذرّية، لا بتحديث مباشر.
 */

export {
  type RequestDeliveryDependencies,
  type RequestDeliveryError,
  type RequestDeliveryResult,
  requestDelivery,
} from "./request-delivery.ts";
