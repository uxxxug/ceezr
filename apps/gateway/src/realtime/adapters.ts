/**
 * الغرض: محوّلاتُ منافذِ قناةِ الرحلةِ الآنيةِ — تُحقِّقُ الجلسةَ وتحلُّ الرحلةَ النشطة.
 * الحالة: منفّذ فعلياً — المرحلة F4-04.
 * ينتمي إلى: apps/gateway/src/realtime
 *
 * ## ما يفعلُه هذا الملفُّ وحدَه
 *
 * يحوِّلُ بين منافذِ `ride-channel.ts` (النقيّة: لا قاعدةَ ولا شبكة) والبنية
 * التحتية القائمة (قراءةُ جلسةِ Mini App، استعلامُ `orders`). وهو يُنشأُ ويُحقَنُ
 * من `index.ts` لا من `container.ts` لأنَّ دورةَ حياةِ Socket.IO تتبعُ البوابة
 * لا الحاوية.
 */

import type { WatchedTripStatus } from "../../../../packages/domain/tracking/visibility.ts";
import type { Sql } from "../../../../packages/infrastructure/db/client.ts";
import { readMiniAppSession } from "../../../../packages/infrastructure/identity/miniapp-session.ts";
import type { ActiveRideResolver, RideChannelSessionVerifier } from "./ride-channel.ts";

interface ActiveRideRow {
  readonly id: string;
  readonly assigned_driver_id: string | null;
  readonly status: string;
}

/**
 * يُحقِّقُ رمزَ جلسةِ Mini App ويُرجِعُ معرّفَ الراكبِ الداخليَّ (UUID في `users`).
 *
 * خطوتان: (١) التحقُّقُ التشفيريُّ من الرمز؛ (٢) حلُّ `rider_id` من `telegram_id`.
 * والخطوةُ الثانيةُ لا تُوثَّقُ برمزٍ من العميلِ: هو معرّفٌ داخليٌّ يُشتَقُّ من القاعدة.
 */
export function createSessionVerifier(
  sql: Sql,
  sessionSecret: string,
  nowMs: () => number,
): RideChannelSessionVerifier {
  return {
    verify: async (sessionToken: string) => {
      const result = readMiniAppSession(sessionToken, sessionSecret, nowMs());
      if (!result.ok) return null;

      const telegramId = result.value.telegramUserId;
      if (!/^[0-9]{1,19}$/.test(telegramId)) return null;

      const rows = await sql<{ rider_id: string }[]>`
        select r.id as rider_id
          from riders r
          join users u on u.id = r.user_id
         where u.telegram_id = ${telegramId}
         limit 1
      `;
      const row = rows[0];
      if (row === undefined) return null;

      return { riderId: row.rider_id };
    },
  };
}

/**
 * يحلُّ الرحلةَ النشطةَ للراكبِ من القاعدة — لا يثقُ بـ`tripId` من العميلِ إلا تلميحاً.
 *
 * إن وُجدَ `hintTripId` يُتحقَّقُ من ملكيّتِه وحالتِه؛ وإن لم يُوجدْ يُبحَثُ عن
 * أحدثِ رحلةٍ نشطةٍ للراكب.
 */
export function createActiveRideResolver(sql: Sql): ActiveRideResolver {
  return {
    resolve: async (riderId: string, hintTripId?: string) => {
      if (hintTripId !== undefined) {
        const rows = await sql<ActiveRideRow[]>`
          select id, assigned_driver_id, status::text as status
            from orders
           where id = ${hintTripId}::uuid
             and rider_id = ${riderId}::uuid
           limit 1
        `;
        const row = rows[0];
        if (row === undefined) return null;
        return {
          tripId: row.id,
          driverId: row.assigned_driver_id ?? "",
          status: row.status as WatchedTripStatus,
        };
      }

      // لا تلميحَ: ابحث عن أحدثِ رحلةٍ نشطة
      const rows = await sql<ActiveRideRow[]>`
        select id, assigned_driver_id, status::text as status
          from orders
         where rider_id = ${riderId}::uuid
           and status in ('matched', 'in_progress')
         order by created_at desc
         limit 1
      `;
      const row = rows[0];
      if (row === undefined) return null;
      return {
        tripId: row.id,
        driverId: row.assigned_driver_id ?? "",
        status: row.status as WatchedTripStatus,
      };
    },
  };
}
