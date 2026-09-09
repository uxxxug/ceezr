/**
 * الغرض: تجميعُ حالاتِ استخدامِ وحدةِ `notification` المُفعَّلةِ.
 * الحالة: مُفعَّلٌ جزئياً — مركزُ الإشعاراتِ `F6-05` / `SS-07` فقط؛ وبقيّةُ
 *   ملفّاتِ الوحدةِ هياكلُ بلا تنفيذٍ إلى أن يصدرَ أمرُ تفعيلٍ صريحٌ لها.
 * ينتمي إلى: application/notification
 * يُتوقع أن يستخدمه لاحقاً: apps/*
 */
export {
  clampNotificationLimit,
  DEFAULT_NOTIFICATION_PAGE_SIZE,
  type GetUserNotificationsDeps,
  type GetUserNotificationsInput,
  getUserNotifications,
  MAX_NOTIFICATION_PAGE_SIZE,
} from "./get-user-notifications.ts";
export {
  type MarkNotificationReadDeps,
  type MarkNotificationReadInput,
  markNotificationRead,
} from "./mark-notification-read.ts";
export {
  type MarkNotificationReadOutcome,
  type UserNotificationCenter,
  type UserNotificationEntry,
  type UserNotificationFailure,
  type UserNotificationFailureReason,
  type UserNotificationFeed,
  type UserNotificationFeedQuery,
  userNotificationFailure,
} from "./user-notification-ports.ts";
