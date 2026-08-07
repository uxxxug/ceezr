/**
 * الغرض: نقطة التصدير العامة لحالات استخدام dispatch — المنفَّذ منها فقط.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: application/dispatch
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway، apps/workers
 * ملاحظات مستقبلية: باقي حالات الاستخدام (broadcast-offer، claim-order، expire-offer) ما زالت هياكل
 *   لأنها تحتاج مفاتيح Supabase و Redis وتلغرام، فلا تُصدَّر بعد.
 */

export * from "./escalate-unmatched-order.ts";
export * from "./match-order.ts";
export * from "./publish-to-unsubscribed-group.ts";
export * from "./register-unsubscribed-claim.ts";
export * from "./relay-negotiation-message.ts";
export * from "./republish-order-card.ts";
export * from "./rotate-negotiation-turn.ts";
