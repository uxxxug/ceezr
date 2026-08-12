/**
 * الغرض: نقطة التصدير العامة لوحدة safety — زر الطوارئ والسلامة
 * الحالة: منفّذ فعلياً في 2026-08-13؛ كان هيكلاً.
 * ينتمي إلى: domain/safety
 * يُتوقع أن يستخدمه لاحقاً: packages/application/safety/*, packages/infrastructure/safety/*
 * ملاحظات مستقبلية: أنواع safety تبقى صغيرة لأن مصدر الحقيقة هو السجل الذري.
 */
export * from "./entity.ts";
export * from "./errors.ts";
export * from "./events.ts";
export * from "./value-objects.ts";
