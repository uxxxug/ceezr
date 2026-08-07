/**
 * الغرض: أسباب فشل عمليات السمعة كما تعود من القاعدة حرفياً.
 * الحالة: منفّذ فعلياً — المرحلة 2.5.
 * ينتمي إلى: domain/reputation
 * يُتوقع أن يستخدمه لاحقاً: application/reputation، حوارات البوتين
 * ملاحظات مستقبلية: أي سبب جديد يُضاف في دالّة القاعدة يُضاف هنا في الوقت نفسه.
 */

/** أسباب رفض تسجيل تقييم — القيم مطابقة لما تعيده submit_rating. */
export type SubmitRatingReason =
  | "STARS_OUT_OF_RANGE"
  | "RATER_NOT_FOUND"
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_COMPLETED"
  | "RATER_NOT_PARTY_TO_ORDER"
  | "RATING_WINDOW_CLOSED"
  | "ALREADY_RATED";

/** أسباب رفض بدء الرحلة أو إنهائها. */
export type RideLifecycleReason =
  | "DRIVER_NOT_FOUND"
  | "ORDER_NOT_STARTABLE"
  | "ORDER_NOT_COMPLETABLE";

/** أسباب رفض تعليم تقييم بإساءة. */
export type FlagRatingReason = "ACTOR_NOT_FOUND" | "ACTOR_NOT_AUTHORIZED" | "RATING_NOT_FLAGGABLE";

export type ReputationFailureReason =
  | SubmitRatingReason
  | RideLifecycleReason
  | FlagRatingReason
  | "UNKNOWN";
