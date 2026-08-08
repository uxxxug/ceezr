/**
 * الغرض: واجهة محوّلات اللغة والترجمة.
 * الحالة: منفّذ فعلياً — المرحلة 2.6.
 * ينتمي إلى: infrastructure/i18n-translation
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway، apps/workers عبر حقن التبعيات فقط
 * ملاحظات مستقبلية: يبقى تصديراً صرفاً بلا منطق.
 */

export * from "./language-adapters.ts";
export * from "./translation-cache.ts";
export * from "./translation-providers.ts";
