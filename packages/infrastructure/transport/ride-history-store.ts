/**
 * الغرض: محوِّلُ سجلِّ الرحلاتِ وتفاصيلِها — نداءُ `rider_ride_history`
 *   و`rider_ride_detail`، وقراءةُ حمولتِهما **بلا افتراضٍ**، وترجمةُ **كلِّ**
 *   رمزِ خطأٍ إلى رمزِ عقدٍ (البند `F2-08` · `SR-09` · `SR-10`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-08`، ومقيسٌ في
 *   `tests/integration/ride-history.test.ts` على قاعدةٍ حقيقيّةٍ.
 * ينتمي إلى: packages/infrastructure/transport
 * يُستخدم من: `apps/gateway/src/index.ts` (تركيبُ تبعيّاتِ مساراتِ الرحلاتِ)
 * يُتوقع أن يستخدمه لاحقاً: `F2-11` (تصديرُ بياناتي) يُنادي القارئَ نفسَه.
 * ملاحظات مستقبلية: **لا حقلَ مبلغٍ يُقرأُ ههنا ولا خانةً له** قبلَ `DEC-11`.
 *
 * ## لماذا معرِّفُ تلغرامَ **نصٌّ** يُرسَلُ ولا يُحوَّلُ بـ`Number`
 *
 * `bigint` تلغرامَ يفوقُ مدى الأعدادِ الصحيحةِ الآمنةِ في جاواسكربت، و`Number`
 * تُدوِّرُه صامتةً فيُقرأُ **سجلُّ مستخدمٍ آخرَ**. فالنصُّ يُفحَصُ رقميّاً ثمَّ
 * يُرسَلُ نصّاً، والقاعدةُ تُحوِّلُه بدقّتِها.
 *
 * ## ولماذا صفٌّ ناقصٌ **يُسقِطُ الصفحةَ كلَّها** ولا يُسقَطُ وحدَه
 *
 * صفٌّ بلا معرِّفٍ أو بلا مفتاحِ شهرٍ **عطبُ عقدٍ**، لا بيانٌ ناقصٌ. ولو أُسقِطَ
 * صامتاً لَرأى الراكبُ سجلّاً فيه ثقبٌ لا يعرفُ به، ولَظنَّ رحلةً محذوفةً —
 * و«اختفت رحلةٌ من سجلّي» شكوى لا تُكذَّبُ. فالعطبُ يُعلَنُ `STORE_ERROR`
 * ويُصلَحُ في مصدرِه.
 *
 * ## ولماذا لحظةُ المؤشِّرِ **تُعادُ نصّاً كما وردَت**
 *
 * تحويلُها إلى `Date` ثمَّ إلى نصٍّ يُفقِدُ دقّةَ الميكروثانيةِ التي تحفظُها
 * `timestamptz` — ومفتاحُ الصفحةِ يقارَنُ بها في القاعدةِ. فرقُ ميكروثانيةٍ
 * يعني صفّاً يُقرأُ مرّتَينِ أو يُقفَزُ عنه. **فالنصُّ يُنقَلُ ولا يُفسَّرُ.**
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 *   ــ **لا يبني نمطَ بحثٍ** — النمطُ في القاعدةِ، وبناؤُه ههنا يعني حرفَ
 *      `%` من مُدخلِ مستخدمٍ يصيرُ جزءاً من الاستعلامِ.
 *   ــ **لا يُعيدُ ترتيبَ صفٍّ ولا حدثٍ** — الترتيبُ حكمُ القاعدةِ.
 *   ــ **لا يقرأُ مبلغاً ولا إيصالاً** (`ADR 0039` §٤ · `م13-7`).
 */

import type {
  RideDetailDriver,
  RideDetailReader,
  RideDetailState,
  RideDetailVerdict,
  RideHistoryCursor,
  RideHistoryPage,
  RideHistoryReader,
  RideHistoryVerdict,
} from "../../application/transport/ride-history-ports.ts";
import type { RideStoreFailure } from "../../application/transport/ride-request-ports.ts";
import {
  isRideEventKind,
  type RideEvent,
  type RideHistoryRow,
} from "../../domain/transport/ride-history.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

function failed(reason: RideStoreFailure["reason"]): RideStoreFailure {
  return { reason };
}

/** كما في `ride-summary-store.ts`: لا نصَّ غيرَ رقميٍّ يُرسَلُ إلى `bigint`. */
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

/** صفُّ سجلٍّ — `null` تعني **عطبَ عقدٍ** لا صفّاً يُتخطّى. */
function readHistoryRow(value: unknown): RideHistoryRow | null {
  if (!isRecord(value)) return null;
  const orderId = readText(value.order_id);
  const status = readText(value.status);
  const service = readText(value.service);
  const monthKey = readText(value.month_key);
  const createdAtMs = readInstantMs(value.created_at);
  if (
    orderId === null ||
    status === null ||
    service === null ||
    monthKey === null ||
    createdAtMs === null
  ) {
    return null;
  }
  return {
    orderId,
    status,
    service,
    pickupLabel: readText(value.pickup_label),
    dropoffLabel: readText(value.dropoff_label),
    createdAtMs,
    // العَدَمُ يُنقَلُ عَدَماً: رحلةٌ لم تنتهِ لا لحظةَ انتهاءٍ لها.
    completedAtMs: readInstantMs(value.completed_at),
    monthKey,
  };
}

function readCursor(value: unknown): RideHistoryCursor | null {
  if (!isRecord(value)) return null;
  const createdAt = readText(value.created_at);
  const id = readText(value.id);
  if (createdAt === null || id === null) return null;
  return { createdAt, id };
}

function readDriver(value: unknown): RideDetailDriver | null {
  if (!isRecord(value)) return null;
  return {
    firstName: readText(value.first_name),
    vehicleType: readText(value.vehicle_type),
    plateNumber: readText(value.plate_number),
    ratingAverage: readNumber(value.rating_average),
    ratingCount: readCount(value.rating_count) ?? 0,
  };
}

/**
 * حدثٌ — ونوعٌ لا يعرفُه النطاقُ **يُنقَلُ خامّاً** مُصنَّفاً `UNKNOWN` ولا
 * يُسقَطُ: سجلٌّ ناقصٌ يُقرأُ سجلّاً تامّاً، وذاكَ أخطرُ من سطرٍ غيرِ مُترجَمٍ.
 */
function readEvent(value: unknown): RideEvent | null {
  if (!isRecord(value)) return null;
  const rawKind = readText(value.kind);
  const source = readText(value.source);
  if (rawKind === null || source === null) return null;
  return {
    kind: isRideEventKind(rawKind) ? rawKind : "UNKNOWN",
    rawKind,
    // `null` = **حدثٌ بلا ختمٍ مكتوبٍ** (إلغاءٌ بلا صفِّ تدقيقٍ). ولا يُستبدَلُ.
    atMs: readInstantMs(value.at),
    source,
    detail: isRecord(value.detail) ? value.detail : {},
  };
}

interface ResultRow {
  readonly result: Record<string, unknown> | null;
}

export function createRideHistoryReader(sql: Sql): RideHistoryReader {
  return {
    read: async (input): Promise<Result<RideHistoryVerdict, RideStoreFailure>> => {
      const telegramId = asTelegramId(input.telegramUserId);
      if (telegramId === null) return err(failed("USER_NOT_FOUND"));

      let rows: ResultRow[];
      try {
        rows = await sql.unsafe<ResultRow[]>(
          "select rider_ride_history($1, $2, $3, $4, $5) as result",
          [
            telegramId,
            input.query,
            input.cursor === null ? null : input.cursor.createdAt,
            input.cursor === null ? null : input.cursor.id,
            input.limit,
          ],
        );
      } catch {
        // مؤشِّرٌ ليسَ `uuid` أو ليسَ لحظةً يُسقِطُ التحويلَ في القاعدةِ قبلَ
        // جسمِ الدالّةِ، فلا يُقرأُ رفضاً مُصنَّفاً — ويُعلَنُ عطباً.
        return err(failed("STORE_ERROR"));
      }

      const result = rows[0]?.result;
      if (result === null || result === undefined) return err(failed("STORE_ERROR"));

      if (result.ok !== true) {
        const code = result.error;
        if (code === "USER_NOT_FOUND") return err(failed("USER_NOT_FOUND"));
        if (code === "RIDER_NOT_REGISTERED") return err(failed("RIDER_NOT_REGISTERED"));
        if (code === "INVALID_LIMIT") return ok({ ok: false, refusal: "INVALID_PAGE_SIZE" });
        if (code === "INVALID_CURSOR") return ok({ ok: false, refusal: "INVALID_CURSOR" });
        return err(failed("STORE_ERROR"));
      }

      const monthTimezone = readText(result.month_timezone);
      const monthTimezoneSource = readText(result.month_timezone_source);
      const rawRides = result.rides;
      if (
        monthTimezone === null ||
        monthTimezoneSource === null ||
        typeof result.has_more !== "boolean" ||
        !Array.isArray(rawRides)
      ) {
        return err(failed("STORE_ERROR"));
      }

      const rides: RideHistoryRow[] = [];
      for (const raw of rawRides) {
        const row = readHistoryRow(raw);
        if (row === null) return err(failed("STORE_ERROR"));
        rides.push(row);
      }

      // مؤشِّرٌ معطوبٌ معَ `has_more` صادقةٍ **عطبٌ**: صفحةٌ تاليةٌ مُعلَنةٌ بلا
      // طريقٍ إليها تُوقِفُ التصفُّحَ صامتةً.
      const nextCursor = readCursor(result.next_cursor);
      if (result.has_more && nextCursor === null) return err(failed("STORE_ERROR"));

      const page: RideHistoryPage = {
        rides,
        hasMore: result.has_more,
        nextCursor: result.has_more ? nextCursor : null,
        monthTimezone,
        monthTimezoneSource,
      };
      return ok({ ok: true, page });
    },
  };
}

export function createRideDetailReader(sql: Sql): RideDetailReader {
  return {
    read: async (input): Promise<Result<RideDetailVerdict, RideStoreFailure>> => {
      const telegramId = asTelegramId(input.telegramUserId);
      if (telegramId === null) return err(failed("USER_NOT_FOUND"));

      let rows: ResultRow[];
      try {
        rows = await sql.unsafe<ResultRow[]>("select rider_ride_detail($1, $2) as result", [
          telegramId,
          input.orderId,
        ]);
      } catch {
        return err(failed("STORE_ERROR"));
      }

      const result = rows[0]?.result;
      if (result === null || result === undefined) return err(failed("STORE_ERROR"));

      if (result.ok !== true) {
        const code = result.error;
        if (code === "USER_NOT_FOUND") return err(failed("USER_NOT_FOUND"));
        if (code === "RIDER_NOT_REGISTERED") return err(failed("RIDER_NOT_REGISTERED"));
        if (code === "INVALID_ORDER_ID") return ok({ found: false, refusal: "INVALID_ORDER_ID" });
        return err(failed("STORE_ERROR"));
      }

      if (result.found !== true) {
        const refusal = result.refusal;
        if (refusal === "ORDER_NOT_FOUND") return ok({ found: false, refusal: "ORDER_NOT_FOUND" });
        if (refusal === "INVALID_ORDER_ID")
          return ok({ found: false, refusal: "INVALID_ORDER_ID" });
        return err(failed("STORE_ERROR"));
      }

      const orderId = readText(result.order_id);
      const status = readText(result.status);
      const service = readText(result.service);
      const rawEvents = result.events;
      if (orderId === null || status === null || service === null || !Array.isArray(rawEvents)) {
        return err(failed("STORE_ERROR"));
      }

      const events: RideEvent[] = [];
      for (const raw of rawEvents) {
        const event = readEvent(raw);
        if (event === null) return err(failed("STORE_ERROR"));
        events.push(event);
      }

      // سجلٌّ بلا حدثٍ **عطبٌ**: كلُّ رحلةٍ لها `created_at` على الأقلِّ، فصفرُ
      // أحداثٍ يعني حمولةً لم تُقرأْ لا رحلةً بلا تاريخٍ.
      if (events.length === 0) return err(failed("STORE_ERROR"));

      const state: RideDetailState = {
        orderId,
        status,
        service,
        pickupLabel: readText(result.pickup_label),
        dropoffLabel: readText(result.dropoff_label),
        cancelledReason: readText(result.cancelled_reason),
        driver: readDriver(result.driver),
        events,
      };
      return ok({ found: true, state });
    },
  };
}
