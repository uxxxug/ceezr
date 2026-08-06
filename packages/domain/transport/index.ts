/**
 * الغرض: نقطة التصدير العامة لوحدة transport — رحلات المشاوير وآلة حالات الطلب
 * الحالة: منفّذ فعلياً — المرحلة 2.1. تُصدَّر فقط الرموز المنفَّذة، وما بقي هيكلاً لا يُصدَّر.
 * ينتمي إلى: domain/transport
 * يُتوقع أن يستخدمه لاحقاً: packages/application/transport/*, packages/infrastructure/transport/*
 * ملاحظات مستقبلية: value-objects و events و errors ما زالت هياكل، فلا تُعاد تصديرها بعد.
 */

export * from "./entity.ts";
