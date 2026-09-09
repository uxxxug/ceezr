/**
 * الغرض: منافذُ مركزِ الإشعاراتِ داخلَ التطبيقِ — قراءةُ الموجَزِ ووسمُ مقروءٍ
 *   (البند `F6-05` / `SS-07`). عقدٌ وحدَه: لا SQL ولا HTTP ههنا.
 * الحالة: منفّذ فعلياً — 2026-09-09.
 * ينتمي إلى: application/notification
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway` عبرَ حقنِ التبعياتِ، ومحوّلُ
 *   `packages/infrastructure/notification/user-notification-center.ts`.
 *
 * ## لماذا يأخذُ المنفذُ `telegramUserId` لا `userId`
 *
 * لأنَّ تحويلَ معرّفِ تيليجرام إلى `users.id` **قرارُ تفويضٍ على مستوى الكائنِ**،
 * ومكانُه داخلَ دالّةِ القاعدةِ في معاملةٍ واحدةٍ مع القراءةِ. ولو مرَّرَ التطبيقُ
 * `userId` لصارَ **العميلُ قادراً على اختيارِ صاحبِ الصندوقِ** إن أخفقَ فحصٌ واحدٌ
 * في الطريقِ — وهوَ فحصٌ يسهلُ نسيانُه في مسارٍ جديدٍ. فبقاءُ التحويلِ في القاعدةِ
 * يجعلَ «لا يقرأُ أحدٌ صندوقَ غيرِه» **خاصّيّةَ مخطَّطٍ لا انتباهَ مُراجعٍ**.
 */

import type { Result } from "../../shared/result/index.ts";

/** مدخلُ موجَزِ الإشعاراتِ: هويّةٌ مُصادَقةٌ + ترقيمٌ بالمؤشِّرِ لا بالإزاحة. */
export interface UserNotificationFeedQuery {
  readonly telegramUserId: string;
  readonly limit?: number;
  /** يُعادُ ما هوَ **أقدمُ** من هذا الوقتِ — مؤشِّرٌ مستقرٌّ أمامَ الإدراجِ المتوازي. */
  readonly before?: Date;
}

export interface UserNotificationEntry {
  readonly id: string;
  readonly kind: string;
  readonly channel: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  readonly readAt: Date | null;
}

export interface UserNotificationFeed {
  readonly items: readonly UserNotificationEntry[];
  readonly unreadCount: number;
}

/**
 * أسبابُ الإخفاقِ. `RECIPIENT_NOT_FOUND` منفصلٌ عن `READER_ERROR` لأنَّ الأوّلَ
 * حالةُ حسابٍ غيرِ مسجَّلٍ (تُقرأُ موجَزاً فارغاً في المسارِ) والثاني عطلٌ يُسجَّل.
 */
export type UserNotificationFailureReason =
  | "READER_ERROR"
  | "RECIPIENT_NOT_FOUND"
  | "NOTIFICATION_NOT_FOUND";

export interface UserNotificationFailure {
  readonly code: "USER_NOTIFICATION_FAILED";
  readonly reason: UserNotificationFailureReason;
}

export function userNotificationFailure(
  reason: UserNotificationFailureReason,
): UserNotificationFailure {
  return { code: "USER_NOTIFICATION_FAILED", reason };
}

/** نتيجةُ الوسمِ: `alreadyRead` تُفرِّقُ الوسمَ الأوّلَ عن تكرارِه بلا إخفاق. */
export interface MarkNotificationReadOutcome {
  readonly notificationId: string;
  readonly readAt: Date;
  readonly alreadyRead: boolean;
}

/**
 * منفذُ مركزِ الإشعاراتِ. الدالّتانِ **ذرّيّتانِ في القاعدةِ**: القراءةُ تُعيدُ
 * الصفحةَ وعددَ غيرِ المقروءِ في استدعاءٍ واحدٍ، فلا تُقرأُ حالتانِ متخالفتانِ
 * يظهرُ بينَهما «٣ غيرُ مقروءةٍ» فوقَ قائمةٍ كلُّها مقروءةٌ.
 */
export interface UserNotificationCenter {
  readFeed(
    query: UserNotificationFeedQuery,
  ): Promise<Result<UserNotificationFeed, UserNotificationFailure>>;

  markRead(
    telegramUserId: string,
    notificationId: string,
  ): Promise<Result<MarkNotificationReadOutcome, UserNotificationFailure>>;
}
