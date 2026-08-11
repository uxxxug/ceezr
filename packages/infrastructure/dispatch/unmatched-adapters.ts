/**
 * الغرض: قراءة الطلبات العالقة في البحث بلا أي عرض، وإشعار صاحبها ببوت الراكب.
 * الحالة: منفّذ ومُختبَر على قاعدة حقيقية.
 * ينتمي إلى: infrastructure/dispatch
 * يستخدمه: apps/workers/src/container.ts
 * ملاحظات مستقبلية: الاستعلام يقرأ فقط، والتصعيد نفسه يمرّ بدالّة ذرّية تقفل
 *   الصفّ — فتعدّد نسخ العامل لا يُنتج تصعيدين ولا رسالتين لنفس الطلب.
 */

import type {
  UnmatchedOrder,
  UnmatchedOrderFinder,
  UnmatchedRiderNotifier,
} from "../../application/dispatch/sweep-unmatched-orders.ts";
import type { CityId, OrderId, ServiceType } from "../../shared/kernel/index.ts";
import { guard, type Sql } from "../db/client.ts";
import type { OutboundSender } from "../notification/telegram-driver-notifier.ts";

interface StaleRow {
  readonly order_id: string;
  readonly city_id: string;
  readonly service: string;
  readonly telegram_id: string | number;
  readonly language_code: string | null;
  readonly waiting_seconds: string | number;
}

export function createUnmatchedOrderFinder(sql: Sql): UnmatchedOrderFinder {
  return {
    findStaleSearching: (cityId: CityId, olderThanSeconds: number) =>
      guard("unmatched.findStaleSearching", async (): Promise<readonly UnmatchedOrder[]> => {
        const rows = (await sql`
          select o.id            as order_id,
                 o.city_id       as city_id,
                 o.service::text as service,
                 u.telegram_id   as telegram_id,
                 u.language_code as language_code,
                 extract(epoch from (now() - o.created_at))::bigint as waiting_seconds
            from orders o
            join riders r on r.id = o.rider_id
            join users  u on u.id = r.user_id
           where o.city_id = ${cityId}::uuid
             and o.status = 'searching'
             and o.assigned_driver_id is null
             and o.created_at < now() - make_interval(secs => ${olderThanSeconds})
             -- "بلا أي عرض" لا "بلا عرض قائم": الطلب الذي عُرض ورُفض ما زال في
             -- مسار دورات البثّ، وتصعيده هنا يسبق أوانه ويُغرق قروب الإسناد.
             and not exists (select 1 from order_offers f where f.order_id = o.id)
           order by o.created_at asc
           limit 50
        `) as readonly StaleRow[];

        return rows.map((row) => ({
          orderId: row.order_id as OrderId,
          cityId: row.city_id as CityId,
          service: row.service as ServiceType,
          riderChatId: String(row.telegram_id),
          riderLanguage: row.language_code,
          waitingSeconds: Number(row.waiting_seconds),
        }));
      }),
  };
}

/**
 * الإشعار يُرسَل ببوت الراكب حصراً. إرساله ببوت السائق يفشل بـ403 لأن الراكب
 * لم يفتح محادثةً معه قط — وهو فشلٌ صامت لا يظهر في أي سجل مُراقَب.
 */
export function createUnmatchedRiderNotifier(
  riderOut: OutboundSender,
  render: (order: UnmatchedOrder) => string,
): UnmatchedRiderNotifier {
  return {
    noDriverFound: (order: UnmatchedOrder) =>
      guard("unmatched.noDriverFound", async (): Promise<void> => {
        await riderOut.send(order.riderChatId, render(order), null);
      }),
  };
}
