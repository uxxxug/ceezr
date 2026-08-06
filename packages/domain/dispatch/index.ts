/**
 * الغرض: نقطة التصدير العامة لوحدة dispatch — محرك المطابقة والتوزيع
 * الحالة: منفّذ فعلياً — المرحلة 2.1. تُصدَّر فقط الرموز المنفَّذة، وما بقي هيكلاً لا يُصدَّر.
 * ينتمي إلى: domain/dispatch
 * يُتوقع أن يستخدمه لاحقاً: packages/application/dispatch/*, packages/infrastructure/dispatch/*
 * ملاحظات مستقبلية: value-objects و events و errors ما زالت هياكل، فلا تُعاد تصديرها بعد.
 */

export * from "./entity.ts";
