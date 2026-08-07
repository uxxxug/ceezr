/**
 * الغرض: أسماء أحداث السمعة كما تُكتب في audit_log — مصدر واحد للاسم.
 * الحالة: منفّذ فعلياً — المرحلة 2.5.
 * ينتمي إلى: domain/reputation
 * يُتوقع أن يستخدمه لاحقاً: اختبارات التدقيق، صفحة سجلّ التدقيق في لوحة الإدارة
 * ملاحظات مستقبلية: أي حدث جديد يُسجَّل في القاعدة يُضاف هنا ليبقى الاسمان واحداً.
 */

export const REPUTATION_EVENTS = {
  rideStarted: "order.started",
  rideCompleted: "order.completed",
  ratingSubmitted: "rating.submitted",
  ratingFlagged: "rating.flagged",
} as const;

export type ReputationEventName = (typeof REPUTATION_EVENTS)[keyof typeof REPUTATION_EVENTS];
