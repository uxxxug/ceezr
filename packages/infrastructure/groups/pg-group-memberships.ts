/**
 * الغرض: تنفيذُ PostgreSQL لمنافذِ بوّابةِ قروبِ غيرِ المشتركينَ (`PD-001`):
 *   عزوُ القروبِ إلى مدينتِهِ من عمودِ `cities.telegram_unsubscribed_drivers_group_id`
 *   (المصدرِ الوحيدِ)، وكتابةُ قراراتِ العضويّةِ في `group_memberships`.
 * الحالة: منفَّذ فعلياً — البند `PD-001` (خارطةُ دَينِ المنتَج) · `ADR 0157`.
 * ينتمي إلى: infrastructure/groups
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts (توصيلُ `groupJoinGate`).
 * ملاحظات مستقبلية: جردُ الأعضاءِ الحيِّ (`chat_member`) ومغادرةُ الأعضاءِ ليست
 *   ههنا — الجدولُ سجلُّ قراراتِ البوّابةِ لا مرآةً لتلغرامَ.
 *
 * ## لماذا `driver_id` مفتاحَ العضويّةِ لا `telegram_user_id`
 *
 * كلُّ صفٍّ في الجدولِ سائقٌ معروفٌ (`driver_id` منسوبٌ إلى `drivers`) — فمن ليسَ
 * لهُ صفٌّ هناكَ لا صفَّ لهُ ههنا (محاولاتُ غيرِ المسجَّلينَ في السجلِّ المهيكلِ
 * حصراً). وبذا يبقى الجدولُ خالياً من معرِّفِ تلغرامَ المُعرَّى الذي لا يملكُهُ
 * أحدٌ فيُصيرُ بلا نسبةٍ عندَ طلبِ الحذفِ — وهوَ عينُ ما يحرسُهُ سجلُّ المحوِ
 * (`TABLE_ERASURE`) وقاعدُهُ «جدولٌ فيهِ بيانةٌ شخصيّةٌ وجبَ أن يُعرَفَ أيُّ صفٍّ
 * لمن».
 */

import type {
  GroupMembershipDecision,
  GroupMembershipStore,
  UnsubscribedGroupCityDirectory,
  UnsubscribedGroupRef,
} from "../../application/groups/group-join-gate.ts";
import type { CityId } from "../../shared/kernel/index.ts";
import { guard, type Sql } from "../db/client.ts";

interface CityRow {
  readonly id: string;
  readonly telegram_unsubscribed_drivers_group_id: string | null;
}

/**
 * العزوُ من عمودِ المدنِ نفسِهِ — لا من رابطٍ عامٍّ ولا من اسمِ القروبِ. القروبُ
 * الذي لا تعرفُهُ مدينةٌ يُعادُ لهُ `null` فتحكمُ عليهِ البوّابةُ بالرفضِ، ولا
 * يُخمَّنُ لهُ نسبةٌ بتحزُّزٍ.
 */
export function createUnsubscribedGroupCityDirectory(sql: Sql): UnsubscribedGroupCityDirectory {
  return {
    findByGroupChatId: (groupChatId) =>
      guard("groups.city_of_unsubscribed_group", async () => {
        const rows = await sql.unsafe<CityRow[]>(
          `select id, telegram_unsubscribed_drivers_group_id::text
             from cities
            where telegram_unsubscribed_drivers_group_id = $1::bigint
              and is_active`,
          [groupChatId],
        );
        const row = rows[0];
        if (row === undefined) return null satisfies UnsubscribedGroupRef | null;
        const ref: UnsubscribedGroupRef = {
          cityId: row.id as CityId,
          groupChatId: String(row.telegram_unsubscribed_drivers_group_id),
        };
        return ref;
      }),
  };
}

/**
 * كتابةُ قرارٍ واحدٍ — upsert على (قروبٍ × سائقٍ): آخرُ قرارٍ يظهرُ في الصفِّ،
 * وأوّلُ طلبٍ (`requested_at`) وأوّلُ قبولٍ (`first_approved_at`) **لا يُطمَسان**
 * أبدًا، فزمنُ الدخولِ الذي يقومُ عليهِ قياسُ التحويلِ يبقى صادقاً ولو تكرَّرَ
 * الطلبُ أو تبدَّلَ القرارُ.
 */
export function createGroupMembershipStore(sql: Sql): GroupMembershipStore {
  return {
    recordDecision: (decision: GroupMembershipDecision) =>
      guard("groups.record_membership_decision", async () => {
        await sql.unsafe(
          `insert into group_memberships
             (chat_id, driver_id, city_id, status, source, reason,
              first_approved_at, decided_at, decided_by)
           values ($1::bigint, $2::uuid, $3::uuid, $4, $5, $6,
                   case when $4 = 'approved' then now() else null end,
                   now(), $7)
           on conflict (chat_id, driver_id) do update
             set status = excluded.status,
                 reason = excluded.reason,
                 last_requested_at = now(),
                 first_approved_at = coalesce(
                   group_memberships.first_approved_at, excluded.first_approved_at),
                 decided_at = excluded.decided_at,
                 decided_by = excluded.decided_by,
                 updated_at = now()`,
          [
            decision.groupChatId,
            decision.driverId,
            decision.cityId,
            decision.status,
            decision.source,
            decision.reason,
            // صانعُ القرارِ اليومَ واحدٌ لا غيرُ — القيمةُ مقيدةٌ في الجدولِ
            // نفسِهِ (`decided_by` check) فلا يُكتَبُ كاتبٌ لم يُعرَف.
            "driver_bot",
          ],
        );
        return undefined;
      }),
  };
}
