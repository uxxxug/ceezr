/**
 * الغرض: أخطاء العمل المتوقّعة لوحدة dispute، تُعاد عبر Result بلا throw.
 * الحالة: منفّذ فعلياً — المرحلة 2.4.
 * ينتمي إلى: domain/dispute
 * يُتوقع أن يستخدمه لاحقاً: application/dispute
 * ملاحظات مستقبلية: كل رمز هنا يقابل رمزاً تعيده دوال RPC نصّاً — أي إضافة هناك تُضاف هنا.
 */

/**
 * أسباب فشل فتح تذكرة. الأسماء مطابقة حرفياً لما تعيده open_support_ticket
 * حتى لا تحتاج طبقة التطبيق إلى جدول ترجمة ثانٍ يسهل أن يتخلّف عن القاعدة.
 */
export type OpenTicketReason =
  | "MESSAGE_EMPTY"
  | "USER_NOT_FOUND"
  | "USER_BLOCKED"
  | "NOT_REGISTERED"
  | "NOT_A_DRIVER"
  | "CITY_GROUP_MISSING"
  | "COOLDOWN_ACTIVE"
  | "ORDER_NOT_YOURS";

export type ClaimTicketReason =
  | "ACTOR_NOT_FOUND"
  | "ACTOR_BLOCKED"
  | "ACTOR_NOT_AUTHORIZED"
  | "TICKET_NOT_FOUND"
  | "TICKET_ALREADY_CLAIMED"
  | "TICKET_ALREADY_SETTLED";

export type ResolveTicketReason =
  | "ACTOR_NOT_FOUND"
  | "ACTOR_BLOCKED"
  | "ACTOR_NOT_AUTHORIZED"
  | "TICKET_NOT_FOUND"
  | "TICKET_ALREADY_SETTLED"
  | "TICKET_HAS_NO_DRIVER"
  | "UNKNOWN_ACTION"
  | "ACTIVATION_DAYS_MISSING"
  | "ANSWER_NOTE_REQUIRED"
  | "DRIVER_NOT_FOUND";

/** كل رموز الفشل التي قد تُعاد من مسار الدعم، لتوحيد جدول الترجمة في البوت. */
export type SupportFailureReason = OpenTicketReason | ClaimTicketReason | ResolveTicketReason;
