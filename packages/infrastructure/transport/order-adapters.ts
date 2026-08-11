/**
 * الغرض: قراءة الطلب وكتابته فعلاً: إنشاء طلب بموقع جغرافي حقيقي، وإلغاؤه من العميل نفسه فقط.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة 2.1.
 * ينتمي إلى: infrastructure/transport
 * يُتوقع أن يستخدمه لاحقاً: بوت العميل، عامل انتهاء المهل، لوحة الإدارة (2.4)
 * ملاحظات مستقبلية: الانتقالات (بدء/إنهاء الرحلة) تُضاف بدوال RPC لا بتحديث مباشر.
 */

import type {
  ActiveOrderSummary,
  CancelNotifyTarget,
  CreateOrderInput,
  OrderWriter,
} from "../../application/bots/types.ts";
import type { OrderRepository } from "../../application/ports/index.ts";
import type { Order, OrderStatus } from "../../domain/transport/entity.ts";
import type { CityId, DriverId, OrderId, RiderId, ServiceType } from "../../shared/kernel/index.ts";
import { guard, type Sql } from "../db/client.ts";

interface OrderRow {
  readonly id: string;
  readonly city_id: string;
  readonly service: string;
  readonly status: string;
  readonly pickup_lat: number;
  readonly pickup_lng: number;
  readonly dropoff_lat: number | null;
  readonly dropoff_lng: number | null;
  readonly assigned_driver_id: string | null;
  readonly broadcast_round: number;
}

function toOrder(row: OrderRow): Order {
  return {
    id: row.id as OrderId,
    cityId: row.city_id as CityId,
    service: row.service as ServiceType,
    status: row.status as OrderStatus,
    pickup: { latitude: Number(row.pickup_lat), longitude: Number(row.pickup_lng) },
    dropoff:
      row.dropoff_lat === null || row.dropoff_lng === null
        ? null
        : { latitude: Number(row.dropoff_lat), longitude: Number(row.dropoff_lng) },
    assignedDriverId: row.assigned_driver_id as DriverId | null,
    broadcastRound: row.broadcast_round,
  };
}

const ORDER_SELECT = `
  select id, city_id, service, status,
         st_y(pickup::geometry) as pickup_lat, st_x(pickup::geometry) as pickup_lng,
         st_y(dropoff::geometry) as dropoff_lat, st_x(dropoff::geometry) as dropoff_lng,
         assigned_driver_id, broadcast_round
    from orders
`;

export function createOrderRepository(sql: Sql): OrderRepository {
  return {
    findById: (orderId: OrderId) =>
      guard("orders.findById", async () => {
        const rows = await sql.unsafe<OrderRow[]>(`${ORDER_SELECT} where id = $1`, [orderId]);
        const row = rows[0];
        return row === undefined ? null : toOrder(row);
      }),
  };
}

export function createOrderWriter(sql: Sql): OrderWriter {
  return {
    create: (input: CreateOrderInput) =>
      guard("orders.create", async () => {
        const rows = await sql<{ id: string }[]>`
          insert into orders (city_id, rider_id, service, status, pickup, dropoff, notes)
          values (
            ${input.cityId}, ${input.riderId}, ${input.service}::service_type, 'searching',
            st_setsrid(st_makepoint(${input.pickup.longitude}, ${input.pickup.latitude}), 4326)::geography,
            ${
              input.dropoff === null
                ? sql`null`
                : sql`st_setsrid(st_makepoint(${input.dropoff.longitude}, ${input.dropoff.latitude}), 4326)::geography`
            },
            ${input.notes ?? null}
          )
          returning id
        `;
        const id = rows[0]?.id;
        if (id === undefined) throw new Error("تعذّر إنشاء الطلب");
        return id as OrderId;
      }),

    /**
     * الإلغاء يمرّ عبر الدالّة الذرّية cancel_order_by_rider — لا تحديث مباشر هنا.
     * الدالّة تُلغي العروض المعلّقة وتُغلق التفاوض وتكتب في السجل تحت قفل واحد،
     * ثم تُعيد من يجب إخطارهم. الإخطار يجري خارج المعاملة عمداً: فشل تيليجرام
     * لا يصحّ أن يُرجِع إلغاءً وافق عليه العميل.
     */
    cancelByRider: (orderId: OrderId, riderId: RiderId) =>
      guard("orders.cancelByRider", async () => {
        const rows = await sql<{ cancel_order_by_rider: CancelRpcResult }[]>`
          select cancel_order_by_rider(${orderId}::uuid, ${riderId}::uuid, 'rider_cancelled')
        `;
        const result = rows[0]?.cancel_order_by_rider;
        if (result === undefined || !result.ok) {
          return result?.error === "ORDER_NOT_CANCELLABLE"
            ? ({ kind: "not_cancellable" } as const)
            : ({ kind: "not_found" } as const);
        }
        const notify: CancelNotifyTarget[] = result.offer_drivers.map((row) => ({
          driverId: row.driver_id as DriverId,
          wasAssigned: false,
        }));
        // المُسنَد قد يكون أيضاً صاحب عرض مقبول؛ لا نُخطره مرّتين
        const assigned = result.assigned_driver;
        if (assigned !== null) {
          const existing = notify.findIndex((row) => row.driverId === assigned.driver_id);
          if (existing === -1) {
            notify.push({ driverId: assigned.driver_id as DriverId, wasAssigned: true });
          } else {
            notify[existing] = { driverId: assigned.driver_id as DriverId, wasAssigned: true };
          }
        }
        return {
          kind: "cancelled",
          orderId: result.order_id as OrderId,
          service: result.service as ServiceType,
          previousStatus: result.previous_status,
          notify,
          groupMessageIds: result.group_cards
            .filter((card) => card.group_message_id !== null)
            .map((card) => String(card.group_message_id)),
        } as const;
      }),
  };
}

interface CancelRpcDriver {
  readonly driver_id: string;
  readonly telegram_id: string;
  readonly language: string;
}

type CancelRpcResult =
  | {
      readonly ok: true;
      readonly order_id: string;
      readonly service: string;
      readonly previous_status: string;
      readonly offer_drivers: readonly CancelRpcDriver[];
      readonly assigned_driver: CancelRpcDriver | null;
      readonly group_cards: readonly { readonly group_message_id: string | null }[];
      readonly error?: undefined;
    }
  | { readonly ok: false; readonly error: string };

/**
 * كل الطلبات النشطة للعميل — لا الأحدث وحده.
 *
 * كانت هذه الدالّة تُعيد طلباً واحداً بـ limit 1، فإذا كان للعميل مشوار وطرد
 * معاً ألغى /cancel الأحدث وسكت عن الآخر. وقع هذا فعلاً في الإنتاج: عميل ألغى
 * ما ظنّه مشواره، فأُلغي طرده، وبقي المشوار يبحث عن سائق خمس ساعات وهو يحسبه
 * منتهياً. الحدّ الأعلى يحمي الرسالة من الطول بلا أن يُخفي طلباً في الأحوال
 * الواقعية.
 */
const MAX_ACTIVE_ORDERS = 10;

export function createActiveOrdersLookup(sql: Sql) {
  return async (riderId: RiderId): Promise<readonly ActiveOrderSummary[]> => {
    const rows = await sql<
      {
        id: string;
        service: string;
        status: string;
        pickup_label: string | null;
        dropoff_label: string | null;
        created_at: Date;
      }[]
    >`
      select id, service, status, pickup_label, dropoff_label, created_at
        from orders
       where rider_id = ${riderId}
         and status in ('searching', 'matched', 'in_progress')
       order by created_at asc
       limit ${MAX_ACTIVE_ORDERS}
    `;
    return rows.map((row) => ({
      orderId: row.id as OrderId,
      service: row.service as ServiceType,
      status: row.status,
      pickupLabel: row.pickup_label,
      dropoffLabel: row.dropoff_label,
      createdAt: new Date(row.created_at),
    }));
  };
}
