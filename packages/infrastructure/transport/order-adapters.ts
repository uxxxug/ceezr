/**
 * الغرض: قراءة الطلب وكتابته فعلاً: إنشاء طلب بموقع جغرافي حقيقي، وإلغاؤه من العميل نفسه فقط.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة 2.1.
 * ينتمي إلى: infrastructure/transport
 * يُتوقع أن يستخدمه لاحقاً: بوت العميل، عامل انتهاء المهل، لوحة الإدارة (2.4)
 * ملاحظات مستقبلية: الانتقالات (بدء/إنهاء الرحلة) تُضاف بدوال RPC لا بتحديث مباشر.
 */

import type { CreateOrderInput, OrderWriter } from "../../application/bots/types.ts";
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
          insert into orders (city_id, rider_id, service, status, pickup, dropoff)
          values (
            ${input.cityId}, ${input.riderId}, ${input.service}::service_type, 'searching',
            st_setsrid(st_makepoint(${input.pickup.longitude}, ${input.pickup.latitude}), 4326)::geography,
            ${
              input.dropoff === null
                ? sql`null`
                : sql`st_setsrid(st_makepoint(${input.dropoff.longitude}, ${input.dropoff.latitude}), 4326)::geography`
            }
          )
          returning id
        `;
        const id = rows[0]?.id;
        if (id === undefined) throw new Error("تعذّر إنشاء الطلب");
        return id as OrderId;
      }),

    /** الإلغاء مشروط بملكية العميل للطلب وبكونه قابلاً للإلغاء — لا إلغاء لطلب مكتمل. */
    cancelByRider: (orderId: OrderId, riderId: RiderId) =>
      guard("orders.cancelByRider", async () => {
        const rows = await sql<{ id: string }[]>`
          update orders
             set status = 'cancelled',
                 cancelled_reason = 'rider_cancelled',
                 updated_at = now()
           where id = ${orderId}
             and rider_id = ${riderId}
             and status in ('searching', 'matched')
          returning id
        `;
        return rows.length > 0;
      }),
  };
}

/** آخر طلب نشط للعميل — ما يُلغى عند /cancel. */
export function createActiveOrderLookup(sql: Sql) {
  return async (riderId: RiderId): Promise<OrderId | null> => {
    const rows = await sql<{ id: string }[]>`
      select id from orders
       where rider_id = ${riderId}
         and status in ('searching', 'matched', 'in_progress')
       order by created_at desc
       limit 1
    `;
    const id = rows[0]?.id;
    return id === undefined ? null : (id as OrderId);
  };
}
