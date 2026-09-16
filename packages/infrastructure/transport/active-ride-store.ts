/**
 * الغرض: محوّلُ قراءةِ الرحلةِ النشطةِ على PostgreSQL — نداءُ
 *   `active_ride_snapshot` واحدٌ، وقراءةُ حمولتِه **بلا افتراضٍ** (البند `F2-06`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-06`.
 * ينتمي إلى: infrastructure/transport
 * يُستخدم من: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ.
 * يُتوقع أن يستخدمه لاحقاً: `F2-07` يقرأُ اللقطةَ نفسَها بعدَ `completed`.
 * ملاحظات مستقبلية: متى وُجِدَ ختمُ «وصلَ السائقُ» (`F3-03`) قُرِئَ ههنا حقلاً
 *   اختياريّاً ولا يُغيَّرُ ما قبلَه.
 *
 * ## لماذا نداءٌ واحدٌ لا ثلاثةٌ
 *
 * الملكيّةُ والسائقُ وعُمرُ نقطتِه أسئلةٌ يجبُ أن تُجابَ **بساعةٍ واحدةٍ**
 * (يُنظر رأسُ الهجرةِ). والمحوّلُ ههنا لا يُركِّبُ استفساراً: يُنادي دالّةً
 * ويقرأُ `jsonb`.
 *
 * ## ولماذا كلُّ حقلٍ يُقرأُ قراءةً لا يُفترَضُ
 *
 * `jsonb` لا عقدَ فيه للمُصرِّفِ. فالإحداثيّةُ تُقرأُ عدداً منتهياً أو تُعَدُّ
 * غائبةً، والعُمرُ عدداً صحيحاً غيرَ سالبٍ أو `null`، والتقييمُ عدداً أو `null`
 * — **ولا يُستبدَلُ غيابٌ بصفرٍ**: صفرُ ثوانٍ يعني «الآنَ»، وصفرُ نجومٍ يعني
 * «أسوأُ سائقٍ». كلاهما كذبٌ لو كانَ الأصلُ عَدَماً.
 *
 * ## ولماذا `null` في `st_y` يُقرأُ غياباً لا عطباً
 *
 * `drivers.last_location` عمودٌ يقبلُ العَدَمَ فعلاً (سائقٌ لم يُبلِّغْ بعدُ)،
 * فـ`st_y(null)` يعودُ `null` مشروعاً. أمّا نقطةٌ فيها خطُّ طولٍ بلا عرضٍ فهيَ
 * عطبُ عقدٍ — ولذلكَ يُشترَطُ الحقلانِ معاً أو لا شيءَ.
 */

import type {
  ActiveRideDriver,
  ActiveRideDriverPosition,
  ActiveRidePoint,
  ActiveRideReader,
  ActiveRideState,
  ActiveRideVerdict,
} from "../../application/transport/active-ride-ports.ts";
import type { RideStoreFailure } from "../../application/transport/ride-request-ports.ts";
import { isServiceKind } from "../../domain/quote/service-offer.ts";
import { isRideStatus } from "../../domain/transport/ride-request.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

function failed(reason: RideStoreFailure["reason"]): RideStoreFailure {
  return { reason };
}

/** كما في `ride-request-store.ts`: لا نصَّ غيرَ رقميٍّ يُرسَلُ إلى `bigint`. */
function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readInstantMs(value: unknown): number | null {
  const text = readText(value);
  if (text === null) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** عددٌ منتهٍ أو غيابٌ — و`numeric` قد يُنشَرَ نصّاً فيُقرأُ ولا يُفترَضُ. */
function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readCount(value: unknown): number | null {
  const parsed = readNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** نقطةٌ بلافتةٍ. `null` متى نقصَ أحدُ الإحداثيَّينِ — لا نصفَ نقطةٍ. */
function readPoint(value: unknown): ActiveRidePoint | null {
  if (!isRecord(value)) return null;
  const lat = readNumber(value.lat);
  const lng = readNumber(value.lng);
  if (lat === null || lng === null) return null;
  return { lat, lng, label: readText(value.label) };
}

function readDriverPosition(value: unknown): ActiveRideDriverPosition | null {
  if (!isRecord(value)) return null;
  const lat = readNumber(value.lat);
  const lng = readNumber(value.lng);
  if (lat === null || lng === null) return null;
  // العُمرُ المعدومُ يُنقَلُ معدوماً: حكمُه في النطاقِ (`NO_TIMESTAMP`) لا ههنا.
  return { lat, lng, ageSeconds: readCount(value.age_seconds) };
}

function readDriver(value: unknown): ActiveRideDriver | null {
  if (!isRecord(value)) return null;
  return {
    firstName: readText(value.first_name),
    vehicleType: readText(value.vehicle_type),
    plateNumber: readText(value.plate_number),
    ratingAverage: readNumber(value.rating_average),
    ratingCount: readCount(value.rating_count) ?? 0,
    position: readDriverPosition(value.position),
  };
}

interface SnapshotRow {
  readonly result: Record<string, unknown> | null;
}

export function createActiveRideReader(sql: Sql): ActiveRideReader {
  return {
    read: async (input): Promise<Result<ActiveRideVerdict, RideStoreFailure>> => {
      const telegramId = asTelegramId(input.telegramUserId);
      if (telegramId === null) return err(failed("USER_NOT_FOUND"));

      let rows: SnapshotRow[];
      try {
        rows = await sql.unsafe<SnapshotRow[]>("select active_ride_snapshot($1, $2) as result", [
          telegramId,
          input.orderId,
        ]);
      } catch {
        // معرّفٌ ليسَ `uuid` يُسقِطُ التحويلَ في القاعدةِ قبلَ جسمِ الدالّةِ،
        // فلا يُقرأُ رفضاً مُصنَّفاً — ويُعلَنُ عطباً ولا يُطوى نجاحاً.
        return err(failed("STORE_ERROR"));
      }

      const result = rows[0]?.result;
      if (result === null || result === undefined) return err(failed("STORE_ERROR"));

      if (result.ok !== true) {
        const code = result.error;
        if (code === "USER_NOT_FOUND") return err(failed("USER_NOT_FOUND"));
        if (code === "RIDER_NOT_REGISTERED") return err(failed("RIDER_NOT_REGISTERED"));
        if (code === "INVALID_ORDER_ID") return ok({ found: false, refusal: "INVALID_ORDER_ID" });
        if (code === "ORDER_NOT_FOUND") return ok({ found: false, refusal: "ORDER_NOT_FOUND" });
        return err(failed("STORE_ERROR"));
      }

      const orderId = readText(result.order_id);
      const service = readText(result.service);
      const status = result.status;
      const pickup = readPoint(result.pickup);
      const createdAtMs = readInstantMs(result.created_at);
      if (
        orderId === null ||
        service === null ||
        !isServiceKind(service) ||
        !isRideStatus(status) ||
        pickup === null ||
        createdAtMs === null
      ) {
        return err(failed("STORE_ERROR"));
      }

      const state: ActiveRideState = {
        orderId,
        status,
        service,
        pickup,
        dropoff: readPoint(result.dropoff),
        createdAtMs,
        matchedAtMs: readInstantMs(result.matched_at),
        startedAtMs: readInstantMs(result.started_at),
        arrivedAtMs: readInstantMs(result.arrived_at),
        completedAtMs: readInstantMs(result.completed_at),
        driver: readDriver(result.driver),
      };
      return ok({ found: true, state });
    },
  };
}
