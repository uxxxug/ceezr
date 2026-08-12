/**
 * الغرض: نشر حالات الإسناد والطوارئ في قروب الإسناد لكل مدينة
 * الحالة: منفّذ فعلياً:
 *   النشر: packages/infrastructure/notification/telegram-negotiation-notifier.ts
 *           (createEscalationGroupPublisher)
 *   حالة الاستخدام: packages/application/dispatch/escalate-unmatched-order.ts
 *   المشغّل: apps/workers/src/jobs/rotate-unsubscribed-negotiation.ts
 *   SOS: packages/application/safety/trigger-sos.ts ثم outbox العامل
 *        apps/workers/src/jobs/deliver-safety-incidents.ts؛ أزرار الاستلام/الإغلاق
 *        يعالجها حوار بوت السائق لأن القروب موصول به.
 * ينتمي إلى: apps/gateway/groups
 * ملاحظات مستقبلية: بطاقات SOS تعود إلى نفس بوت السائق الذي نشرها، لذلك لا تمر
 * عبر معالج بوت العميل.
 */
export {};
