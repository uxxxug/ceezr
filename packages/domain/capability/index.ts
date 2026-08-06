/**
 * الغرض: نقطة التصدير العامة لوحدة capability — نوع الخدمة التي يقدّمها السائق
 * الحالة: منفّذ فعلياً — المرحلة 2.1. تُصدَّر فقط الرموز المنفَّذة، وما بقي هيكلاً لا يُصدَّر.
 * ينتمي إلى: domain/capability
 * يُتوقع أن يستخدمه لاحقاً: packages/application/capability/*, packages/infrastructure/capability/*
 * ملاحظات مستقبلية: value-objects و events و errors ما زالت هياكل، فلا تُعاد تصديرها بعد.
 */

export * from "./entity.ts";
