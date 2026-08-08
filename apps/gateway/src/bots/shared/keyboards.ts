/**
 * الغرض: إعادة تصدير محوّل الأزرار بعد نقله إلى infrastructure/notification، حفاظاً على
 *   مسار الاستيراد الذي تعرفه البوتات والاختبارات القائمة.
 * الحالة: منفّذ فعلياً — واجهة إعادة تصدير فقط، لا منطق.
 * ينتمي إلى: apps/gateway/src/bots/shared
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/{driver,rider}/index.ts
 * ملاحظات مستقبلية: عند تحديث كل مواضع الاستيراد يُحذف هذا الملف.
 */

export type {
  InlineMarkup,
  RemoveMarkup,
  ReplyMarkup,
  TelegramMarkup,
} from "../../../../../packages/infrastructure/notification/telegram-markup.ts";
export {
  isCallbackDataValid,
  MAX_CALLBACK_DATA_BYTES,
  toTelegramMarkup,
} from "../../../../../packages/infrastructure/notification/telegram-markup.ts";
