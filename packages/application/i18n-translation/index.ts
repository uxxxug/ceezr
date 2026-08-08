/**
 * الغرض: واجهة حالات استخدام اللغة والترجمة.
 * الحالة: منفّذ فعلياً — المرحلة 2.6.
 * ينتمي إلى: application/i18n-translation
 * يُتوقع أن يستخدمه لاحقاً: apps/*
 * ملاحظات مستقبلية: يبقى تصديراً صرفاً بلا منطق.
 */

export * from "./detect-language.ts";
export * from "./get-supported-languages.ts";
export * from "./render-localized-template.ts";
export * from "./select-language.ts";
export * from "./translate-message.ts";
