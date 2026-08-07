/**
 * الغرض: تجميع حالات استخدام وحدة dispute — المنفَّذ منها فقط.
 * الحالة: منفّذ فعلياً — المرحلة 2.4.
 * ينتمي إلى: application/dispute
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway، apps/admin-dashboard
 * ملاحظات مستقبلية: add-dispute-note ما زال هيكلاً بسبب موثَّق داخله، فلا يُصدَّر.
 */

export * from "./claim-dispute.ts";
export * from "./close-dispute.ts";
export * from "./open-dispute.ts";
export * from "./post-dispute-card.ts";
export * from "./resolve-dispute.ts";
