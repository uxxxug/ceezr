/**
 * الغرض: نقطة التصدير العامة لوحدة subscription — اشتراكات السائقين
 * الحالة: منفّذ فعلياً — المرحلة 2.1. تُصدَّر فقط الرموز المنفَّذة، وما بقي هيكلاً لا يُصدَّر.
 * ينتمي إلى: domain/subscription
 * يُتوقع أن يستخدمه لاحقاً: packages/application/subscription/*, packages/infrastructure/subscription/*
 * ملاحظات مستقبلية: value-objects و events و errors ما زالت هياكل، فلا تُعاد تصديرها بعد.
 */

export * from "./entity.ts";
