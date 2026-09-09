/**
 * الغرض: محوّلُ مركزِ الإشعاراتِ داخلَ التطبيقِ على دالّتَي القاعدةِ
 *   `get_user_notifications` و`mark_notification_read` (البند `F6-05` / `SS-07`).
 * الحالة: منفّذ فعلياً — 2026-09-09.
 * ينتمي إلى: infrastructure/notification
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ فقط.
 *
 * ## لماذا كلُّ عمليّةٍ استدعاءُ دالّةٍ واحدةٍ لا استعلاماتٍ
 *
 * الموجَزُ وعددُ غيرِ المقروءِ يُقرآنِ في **معاملةٍ واحدةٍ** داخلَ الدالّةِ. ولو
 * قُرِئا باستعلامَينِ من ههنا لأمكنَ أن يُوسَمَ إشعارٌ مقروءاً بينَهما، فيظهرُ
 * «٣ غيرُ مقروءةٍ» فوقَ قائمةٍ كلُّها مقروءةٌ — عطلٌ يُقرأُ خطأَ عرضٍ فيُطارَدُ
 * في الواجهةِ سنةً. والأهمُّ: تحويلُ معرّفِ تيليجرام إلى `users.id` يبقى **داخلَ**
 * الدالّةِ، فلا يستطيعُ هذا المحوّلُ — ولا مَن يعدّلُه — أن يقرأَ صندوقَ غيرِ
 * صاحبِ الجلسةِ أصلاً.
 *
 * ## ولماذا لا يُمرَّرُ نصُّ خطأِ القاعدةِ إلى الأعلى
 *
 * لأنّه يحملُ أسماءَ جداولٍ وقيمَ معاملاتٍ. يُسجَّلُ سببٌ مصنَّفٌ وحدَه.
 */

import {
  type MarkNotificationReadOutcome,
  type UserNotificationCenter,
  type UserNotificationEntry,
  type UserNotificationFailure,
  type UserNotificationFeed,
  type UserNotificationFeedQuery,
  userNotificationFailure,
} from "../../application/notification/user-notification-ports.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

interface RpcRow {
  readonly result: unknown;
}

/**
 * `users.telegram_id` عمودُ `bigint`، ومعرّفُ الجلسةِ نصٌّ. فالنصُّ غيرُ الرقميِّ
 * لا يُرسَلُ إلى القاعدةِ: لا صفَّ يمكنُ أن يطابقَه، وإرسالُه يورِّثُ خطأَ تحويلٍ
 * يُقرأُ عطلَ خادمٍ لا «لا مستقبِلَ».
 */
function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * سببُ القاعدةِ يُترجَمُ إلى سببِ المنفذِ بقائمةٍ مغلقةٍ. وسببٌ مجهولٌ يُقرأُ
 * `READER_ERROR` لا «غيرَ موجودٍ»: تخشينُ المجهولِ إلى «لا شيءَ ههنا» كانَ
 * سيُخفي عطلاً حقيقيّاً في صورةِ صندوقٍ فارغٍ.
 */
function mapDbError(code: unknown): UserNotificationFailure {
  if (code === "USER_NOT_FOUND") return userNotificationFailure("RECIPIENT_NOT_FOUND");
  if (code === "NOTIFICATION_NOT_FOUND") return userNotificationFailure("NOTIFICATION_NOT_FOUND");
  return userNotificationFailure("READER_ERROR");
}

function readEntry(value: unknown): UserNotificationEntry | null {
  const row = asRecord(value);
  if (row === null) return null;
  const id = row.id;
  const kind = row.kind;
  const channel = row.channel;
  const createdAt = row.created_at;
  if (typeof id !== "string" || typeof kind !== "string" || typeof channel !== "string")
    return null;
  if (typeof createdAt !== "string") return null;
  const readAt = row.read_at;
  return {
    id,
    kind,
    channel,
    payload: asRecord(row.payload) ?? {},
    createdAt: new Date(createdAt),
    readAt: typeof readAt === "string" ? new Date(readAt) : null,
  };
}

export function createUserNotificationCenter(sql: Sql): UserNotificationCenter {
  return {
    readFeed: async (
      query: UserNotificationFeedQuery,
    ): Promise<Result<UserNotificationFeed, UserNotificationFailure>> => {
      const telegramId = asTelegramId(query.telegramUserId);
      if (telegramId === null) return err(userNotificationFailure("RECIPIENT_NOT_FOUND"));

      let rows: RpcRow[];
      try {
        rows = await sql.unsafe<RpcRow[]>(
          "select get_user_notifications($1::bigint, $2::integer, $3::timestamptz) as result",
          [telegramId, query.limit ?? null, query.before?.toISOString() ?? null],
        );
      } catch {
        return err(userNotificationFailure("READER_ERROR"));
      }

      const payload = asRecord(rows[0]?.result);
      if (payload === null) return err(userNotificationFailure("READER_ERROR"));
      if (payload.ok !== true) return err(mapDbError(payload.error));

      const rawItems = Array.isArray(payload.items) ? payload.items : [];
      const items: UserNotificationEntry[] = [];
      for (const raw of rawItems) {
        const entry = readEntry(raw);
        // صفٌّ لا يُقرأُ يُعلَنُ عطلاً ولا يُحذَفُ بصمتٍ: إسقاطُه كانَ سيُنتِجُ
        // موجَزاً ناقصاً يبدو صحيحاً، وهوَ أسوأُ من موجَزٍ يُخفِق فيُرى.
        if (entry === null) return err(userNotificationFailure("READER_ERROR"));
        items.push(entry);
      }

      const unread = payload.unread;
      if (typeof unread !== "number" || !Number.isFinite(unread)) {
        return err(userNotificationFailure("READER_ERROR"));
      }

      return ok({ items, unreadCount: unread });
    },

    markRead: async (
      telegramUserId: string,
      notificationId: string,
    ): Promise<Result<MarkNotificationReadOutcome, UserNotificationFailure>> => {
      const telegramId = asTelegramId(telegramUserId);
      if (telegramId === null) return err(userNotificationFailure("RECIPIENT_NOT_FOUND"));

      let rows: RpcRow[];
      try {
        rows = await sql.unsafe<RpcRow[]>(
          "select mark_notification_read($1::bigint, $2::uuid) as result",
          [telegramId, notificationId],
        );
      } catch {
        return err(userNotificationFailure("READER_ERROR"));
      }

      const payload = asRecord(rows[0]?.result);
      if (payload === null) return err(userNotificationFailure("READER_ERROR"));
      if (payload.ok !== true) return err(mapDbError(payload.error));

      const readAt = payload.read_at;
      if (typeof readAt !== "string") return err(userNotificationFailure("READER_ERROR"));

      return ok({
        notificationId,
        readAt: new Date(readAt),
        alreadyRead: payload.already_read === true,
      });
    },
  };
}
