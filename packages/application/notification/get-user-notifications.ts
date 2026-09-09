/**
 * الغرض: حالةُ الاستخدامِ «اقرأْ موجَزَ إشعاراتي» — مركزُ الإشعاراتِ داخلَ
 *   التطبيقِ (البند `F6-05` / `SS-07`).
 * الحالة: منفّذ فعلياً — 2026-09-09.
 * ينتمي إلى: application/notification
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/routes/notifications.ts`.
 *
 * ## لماذا الحدُّ يُقصَرُ ههنا وفي القاعدةِ معاً
 *
 * القاعدةُ تحصرُ الحدَّ في `[1, 50]`، وهذا الملفُّ يفعلُ الشيءَ نفسَه. والتكرارُ
 * مقصودٌ: القصرُ في القاعدةِ يحمي **كلَّ** مستدعٍ حتّى المستقبليَّ، والقصرُ ههنا
 * يجعلُ الحدَّ المُطبَّقَ **مقروءاً في نفسِ الطبقةِ التي يُختبَرُ فيها** بلا قاعدةٍ
 * حاضرةٍ. ولو تُرِكَ للقاعدةِ وحدَها لكانَ سلوكُ «طلبتُ ١٠٠٠ فأُعطيتُ ٥٠» غيرَ
 * مُختبَرٍ إلّا في اختبارِ تكاملٍ واحدٍ — وهوَ أوّلُ ما يُتخطّى عندَ غيابِ قاعدةٍ.
 *
 * ## ما لا تفعلُه هذه الحالةُ عن قصدٍ
 *
 * **لا تكتبُ شيئاً.** القراءةُ لا تَسِمُ مقروءاً، لأنَّ «فُتِحَ الموجَزُ» ليسَ
 * «قُرِئَ الإشعارُ»: الوسمُ التلقائيُّ بالفتحِ يُفقِدُ المستخدمَ إشعاراً حرجاً
 * مرَّ أمامَ عينِه ولم يقرأْه، بلا أثرٍ يُرجَعُ إليه (ADR 0035 §2 أيضاً: لا حالةَ
 * أعمالٍ من التطبيقِ المصغَّرِ بلا نيّةٍ صريحة).
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import type {
  UserNotificationCenter,
  UserNotificationFailure,
  UserNotificationFeed,
} from "./user-notification-ports.ts";

/** الحدُّ الافتراضيُّ والأقصى — قيمتانِ تشغيليّتانِ لا قيمتا أعمالٍ. */
export const DEFAULT_NOTIFICATION_PAGE_SIZE = 20;
export const MAX_NOTIFICATION_PAGE_SIZE = 50;

export interface GetUserNotificationsInput {
  readonly telegramUserId: string;
  readonly limit?: number;
  readonly before?: Date;
}

export interface GetUserNotificationsDeps {
  readonly center: UserNotificationCenter;
  readonly log?: (message: string, context: Record<string, unknown>) => void;
}

/**
 * حدٌّ غيرُ صحيحٍ أو غيرُ منطقيٍّ **لا يُخفِقُ الطلبَ**: يُقصَرُ. لأنَّ الفشلَ ههنا
 * يحجبُ صندوقاً كاملاً عن مستخدمٍ بسببِ معاملٍ في مسارٍ — والحجبُ عقوبةٌ أثقلُ
 * من التصحيحِ، وهذا معاملُ عرضٍ لا معاملُ أعمال.
 */
export function clampNotificationLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_NOTIFICATION_PAGE_SIZE;
  const floored = Math.floor(limit);
  if (floored < 1) return 1;
  if (floored > MAX_NOTIFICATION_PAGE_SIZE) return MAX_NOTIFICATION_PAGE_SIZE;
  return floored;
}

export async function getUserNotifications(
  input: GetUserNotificationsInput,
  deps: GetUserNotificationsDeps,
): Promise<Result<UserNotificationFeed, UserNotificationFailure>> {
  const feed = await deps.center.readFeed({
    telegramUserId: input.telegramUserId,
    limit: clampNotificationLimit(input.limit),
    ...(input.before === undefined ? {} : { before: input.before }),
  });

  if (!feed.ok) {
    // السجلُّ يحمل السببَ المصنَّفَ ولا يحمل معرّفَ تيليجرام ولا حِمْلَ إشعارٍ.
    deps.log?.("تعذّرت قراءةُ موجَزِ الإشعارات", { reason: feed.error.reason });
    return err(feed.error);
  }

  return ok(feed.value);
}
