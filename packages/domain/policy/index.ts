/**
 * الغرض: نقطة التصدير العامة لوحدة policy — سجل platform_settings والتحقّق منه
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: domain/policy
 * يُتوقع أن يستخدمه لاحقاً: packages/application/*, packages/infrastructure/policy/*
 * ملاحظات مستقبلية: سياسات الإلغاء والتسعير الديناميكي تُضاف هنا لاحقاً بلا تعديل السجل.
 */

export * from "./entity.ts";
