/**
 * الغرض: حالةُ الاستخدامِ «سِمْ إشعاري مقروءاً» (البند `F6-05` / `SS-07`).
 * الحالة: منفّذ فعلياً — 2026-09-09.
 * ينتمي إلى: application/notification
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/routes/notifications.ts`.
 *
 * ## لماذا «غيرُ موجودٍ» و«ليسَ لك» جوابٌ واحدٌ
 *
 * لو فرَّقَ المسارُ بينَهما لصارَ **مِرقاباً**: حاملُ جلسةٍ صالحةٍ يجرِّبُ معرّفاتٍ
 * فيعرفُ أيُّها إشعارٌ قائمٌ لغيرِه. والمعرّفُ `uuid` فلا يُحصى بالقوّةِ الغاشمةِ،
 * لكنَّ التسريبَ لا يحتاجُ إحصاءً: يكفي معرّفٌ مُلتقَطٌ من سجلٍّ أو من مشاركةِ
 * شاشةٍ ليصيرَ تأكيداً بأنَّ صاحبَه تلقّى إشعاراً من نوعٍ ما. فالسببُ واحدٌ
 * `NOTIFICATION_NOT_FOUND` في الطرفَينِ، وتمييزُهما — إن لزمَ — في سجلِّ الخادمِ.
 *
 * ## ولماذا التكرارُ لا يُخفِق
 *
 * الوسمُ **مُتَمَاثِلٌ**: `coalesce(read_at, now())` في القاعدةِ يُبقي أوّلَ وقتٍ.
 * فإعادةُ الطلبِ بعدَ انقطاعِ شبكةٍ لا تُنتِجُ خطأً يراهُ المستخدمُ ولا تُزيحُ
 * الوقتَ المُسجَّلَ إلى الأمام — والإزاحةُ كانت ستُفسِدُ أيَّ قياسٍ لزمنِ التفاعل.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import type {
  MarkNotificationReadOutcome,
  UserNotificationCenter,
  UserNotificationFailure,
} from "./user-notification-ports.ts";
import { userNotificationFailure } from "./user-notification-ports.ts";

export interface MarkNotificationReadInput {
  readonly telegramUserId: string;
  readonly notificationId: string;
}

export interface MarkNotificationReadDeps {
  readonly center: UserNotificationCenter;
  readonly log?: (message: string, context: Record<string, unknown>) => void;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * معرّفٌ غيرُ صالحِ الشكلِ **لا يُرسَلُ إلى القاعدةِ**: لا صفَّ يمكنُ أن يطابقَه،
 * وإرسالُه يورِّثُ خطأَ تحويلٍ يُقرأُ عطلَ خادمٍ (٥٠٠) لا «غيرَ موجودٍ» (٤٠٤) —
 * فيصيرُ خطأُ العميلِ إنذاراً كاذباً في مراقبةِ الخادم.
 */
export async function markNotificationRead(
  input: MarkNotificationReadInput,
  deps: MarkNotificationReadDeps,
): Promise<Result<MarkNotificationReadOutcome, UserNotificationFailure>> {
  if (!UUID_PATTERN.test(input.notificationId)) {
    return err(userNotificationFailure("NOTIFICATION_NOT_FOUND"));
  }

  const outcome = await deps.center.markRead(input.telegramUserId, input.notificationId);
  if (!outcome.ok) {
    deps.log?.("notifications.mark_read_failed", { reason: outcome.error.reason });
    return err(outcome.error);
  }

  return ok(outcome.value);
}
