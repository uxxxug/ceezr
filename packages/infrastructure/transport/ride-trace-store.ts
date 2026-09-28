/**
 * الغرض: قارئُ أثرِ موقعِ رحلةٍ منتهيةٍ من `driver_location_history` — **منفذٌ
 *   ضيّقٌ يعيدُ صفوفاً فقط** لا حسابَ فيها (`ADR 0208` §٣ · البند `F2-07`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-07` (الشقُّ المملوكُ للمستودَعِ).
 * ينتمي إلى: packages/infrastructure/transport
 * يُستخدم من: `apps/gateway/src/index.ts` يُوصِلُه بتبعيّاتِ ملخَّصِ الرحلةِ.
 *
 * ## لماذا لا `st_distance` على الأزواجِ هنا
 *
 * `ADR 0208` §٣: الحسابُ في طبقةٍ واحدةٍ في TypeScript — العتبةُ
 * (`DEFAULT_GPS_POLICY.maxAccuracyMeters`) والمسافةُ (`haversineKm`) مصدرُهما
 * واحدٌ، ونسخُ العتبةِ في SQL يُبعِدُ الحكمَ عن مصدرِه عندَ أوّلِ تصحيحٍ. فهذا
 * القارئُ يعيدُ النقاطَ خاماً (طابعُها · إحداثيّاتُها · حكمُها المخزَّنُ ·
 * دقّتُها) ويقيسُ النطاقُ.
 *
 * ## ولماذا النافذةُ تُقرأُ من `orders` هنا لا من حمولةِ الملخَّصِ
 *
 * مصدرٌ واحدٌ للختمَينِ: `orders.started_at` و`orders.completed_at` هما اللذان
 * يقيسُ بهما النطاقُ، وقراءتُهما مرّتَينِ (ملخَّصاً وأثراً) من الجدولِ نفسِه في
 * الاستعلامِ نفسِهِ لا تُنشئُ مصدرَ حقيقةٍ ثانياً — وافتراقُ القارئَينِ عن
 * الجدولِ عطبٌ يُرى في الاختبارِ لا صمتٌ.
 *
 * ## وما لا يفعلُه هذا القارئُ عن قصدٍ
 *
 *   ــ **لا يُعيدُ تقييمَ إصلاحةٍ**: `quality` و`accuracy_m` يُعادانِ كما
 *      خُزِّنا (`ADR 0015`) — الحكمُ في النطاقِ يقرأُ ولا يعيدُ.
 *   ــ **لا يقرأُ أثرَ سائقٍ آخرَ ولا رحلةً أخرى**: القيدُ في الاستعلامِ
 *      نفسِهِ (السائقُ المُسنَدُ · المدينةُ · النافذةُ) لا في الشيفرةِ بعدَها.
 *   ــ **لا يفترضُ سقفَ فجوةٍ**: `driver_location_hot_ttl_seconds` يُقرأُ كما
 *      هوَ، وغيابُه `null` يُقالُ — عطلٌ مُسمّىً لا رقمٌ يُخترَعُ (`§٥`).
 */

import type { RideStoreFailure } from "../../application/transport/ride-request-ports.ts";
import type {
  RideTracePoint,
  RideTraceRead,
  RideTraceReader,
} from "../../application/transport/ride-summary-ports.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

function failed(reason: RideStoreFailure["reason"]): RideStoreFailure {
  return { reason };
}

interface OrderRow {
  readonly assigned_driver_id: string | null;
  readonly city_id: string;
  readonly started_at: Date | null;
  readonly completed_at: Date | null;
  readonly gap_limit: string | null;
}

interface TraceRow {
  readonly recorded_at: Date;
  readonly lat: number;
  readonly lng: number;
  readonly accuracy_m: number | null;
  readonly quality: string;
}

/** سقفُ الفجوةِ كما يُقرأُ من `platform_settings` — موجبٌ أو `null` (خرقٌ مُسمّىً). */
function gapLimitOf(raw: string | null): number | null {
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function createRideTraceReader(sql: Sql): RideTraceReader {
  return {
    read: async (
      input,
    ): Promise<
      Result<
        { readonly found: true; readonly trace: RideTraceRead } | { readonly found: false },
        RideStoreFailure
      >
    > => {
      let orderRows: OrderRow[];
      let traceRows: TraceRow[];
      try {
        orderRows = await sql<OrderRow[]>`
          select o.assigned_driver_id,
                 o.city_id,
                 o.started_at,
                 o.completed_at,
                 (select s.value #>> '{}'
                    from platform_settings s
                   where s.city_id = o.city_id
                     and s.key = 'driver_location_hot_ttl_seconds') as gap_limit
            from orders o
           where o.id = ${input.orderId}::uuid
        `;
        const order = orderRows[0];
        if (
          order === undefined ||
          order.assigned_driver_id === null ||
          order.started_at === null ||
          order.completed_at === null
        ) {
          traceRows = [];
        } else {
          traceRows = await sql<TraceRow[]>`
            select recorded_at,
                   st_y(position::geometry) as lat,
                   st_x(position::geometry) as lng,
                   accuracy_m,
                   quality
              from driver_location_history
             where city_id = ${order.city_id}::uuid
               and driver_id = ${order.assigned_driver_id}::uuid
               and recorded_at >= ${order.started_at}
               and recorded_at <= ${order.completed_at}
             order by recorded_at asc
          `;
        }
      } catch {
        // معرّفٌ ليسَ `uuid` يُسقِطُ التحويلَ في القاعدةِ قبلَ الاستعلامِ — يُعلَنُ
        // عطباً ولا يُطوى نجاحاً (عينُ حكمِ قارئِ الملخَّصِ نفسِهِ).
        return err(failed("STORE_ERROR"));
      }
      const order = orderRows[0];
      // لا سائقَ مُسنَداً أو لا ختمَينِ ⇒ لا نافذةَ ⇒ السؤالُ لا يُسألُ (`§١`).
      if (
        order === undefined ||
        order.assigned_driver_id === null ||
        order.started_at === null ||
        order.completed_at === null
      ) {
        return ok({ found: false });
      }

      const points: RideTracePoint[] = traceRows.map((row) => ({
        recordedAtMs: new Date(row.recorded_at).getTime(),
        latitude: row.lat,
        longitude: row.lng,
        quality: row.quality,
        accuracyMeters: row.accuracy_m,
      }));

      return ok({
        found: true,
        trace: {
          driverId: order.assigned_driver_id,
          cityId: order.city_id,
          startedAtMs: new Date(order.started_at).getTime(),
          completedAtMs: new Date(order.completed_at).getTime(),
          gapLimitSeconds: gapLimitOf(order.gap_limit),
          points,
        },
      });
    },
  };
}
