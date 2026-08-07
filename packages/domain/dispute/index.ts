/**
 * الغرض: نقطة التصدير العامة لوحدة dispute.
 * الحالة: منفّذ فعلياً — المرحلة 2.4.
 * ينتمي إلى: domain/dispute
 * يُتوقع أن يستخدمه لاحقاً: application/dispute، apps/*
 * ملاحظات مستقبلية: لا تُصدَّر إلا الملفات المنفَّذة فعلاً.
 */

export * from "./entity.ts";
export * from "./errors.ts";
export * from "./events.ts";
export * from "./value-objects.ts";
