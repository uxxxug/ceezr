/**
 * الغرض: أحداث الدومين التي تصدرها وحدة dispute — أسماؤها هي نفسها أسماء أفعال audit_log.
 * الحالة: منفّذ فعلياً — المرحلة 2.4.
 * ينتمي إلى: domain/dispute
 * يُتوقع أن يستخدمه لاحقاً: application/dispute، apps/admin-dashboard (سجلّ التدقيق)
 * ملاحظات مستقبلية: لا ناقل أحداث بعد؛ هذه أسماء موحَّدة لا نظام نشر واشتراك.
 */

/**
 * توحيد الأسماء مقصود: ما يُكتب في audit_log هو ما تقرأه لوحة الإدارة، فأي اختلاف
 * بين الاسمين يعني صفحة تدقيق تعرض أفعالاً لا يفهمها أحد.
 */
export const DISPUTE_EVENTS = {
  ticketOpened: "support.ticket_opened",
  ticketClaimed: "support.ticket_claimed",
  ticketActivated: "support.ticket_activate",
  ticketTerminated: "support.ticket_terminate",
  ticketRejected: "support.ticket_reject",
} as const;

export type DisputeEventName = (typeof DISPUTE_EVENTS)[keyof typeof DISPUTE_EVENTS];
