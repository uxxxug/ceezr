/**
 * الغرض: محوِّلُ ملخَّصِ الرحلةِ المنتهيةِ وتقييمِها — نداءُ
 *   `completed_ride_summary` و`submit_rating_with_tags`، وقراءةُ حمولتِهما
 *   **بلا افتراضٍ**، وترجمةُ **كلِّ** رمزِ خطأٍ إلى رمزِ عقدٍ (البند `F2-07`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-07`، ومقيسٌ في
 *   `tests/integration/ride-summary.test.ts` على قاعدةٍ حقيقيّةٍ.
 * ينتمي إلى: packages/infrastructure/transport
 * يُستخدم من: `apps/gateway/src/index.ts` (تركيبُ تبعيّاتِ مساراتِ الرحلاتِ)
 * يُتوقع أن يستخدمه لاحقاً: `SD-09` يُنادي `createRideRatingCommand` نفسَه من
 *   سطحِ السائقِ بلا حرفٍ جديدٍ ههنا.
 * ملاحظات مستقبلية: **لا حقلَ مبلغٍ يُقرأُ ههنا ولا خانةً له** قبلَ `DEC-11`.
 *
 * ## لماذا معرِّفُ تلغرامَ **نصٌّ** يُرسَلُ ولا يُحوَّلُ بـ`Number`
 *
 * `bigint` تلغرامَ يفوقُ مدى الأعدادِ الصحيحةِ الآمنةِ في جاواسكربت، و`Number`
 * تُدوِّرُه صامتةً فيُقرأُ **مستخدمٌ آخرُ** أو لا يُقرأُ أحدٌ. فالنصُّ يُفحَصُ
 * رقميّاً (`asTelegramId`) ثمَّ يُرسَلُ نصّاً، والقاعدةُ تُحوِّلُه بدقّتِها.
 *
 * ## ولماذا كلُّ رمزِ خطأٍ يُترجَمُ ولا يُطوى واحدٌ منها في «عطبٍ»
 *
 * رمزُ القاعدةِ **حكمٌ مقيسٌ**: `ALREADY_RATED` تقييمٌ مكتوبٌ سلفاً،
 * و`RATING_WINDOW_CLOSED` وقتٌ انقضى، و`ORDER_NOT_FOUND` رحلةٌ ليسَت لهذا
 * الراكبِ **أو** معرِّفٌ معدومٌ — وثلاثتُها تُقالُ للراكبِ نصّاً. وطيُّها في
 * `STORE_ERROR` يجعلُ السطحَ يُعيدُ المحاولةَ بلا أملٍ. **ورمزٌ لم يُترجَمْ
 * يُعلَنُ عطباً** ولا يُقرأُ نجاحاً صامتاً.
 *
 * ## وما لا يفعلُه هذا المحوِّلُ عن قصدٍ
 *
 *   ــ **لا يكتبُ `sql` بجدولٍ مباشرةً**: نداءُ دالّةٍ وحدَه — المِلكيّةُ
 *      والنافذةُ والتكرارُ أحكامٌ في القاعدةِ، وأيُّ `select` من `orders`
 *      ههنا يُنشئُ حكماً ثانياً يفترقُ عن الأوّلِ.
 *   ــ **لا يفحصُ الأهليّةَ قبلَ الإرسالِ**: فحصٌ ثمَّ كتابةٌ **سباقٌ**.
 *   ــ **لا يُحوِّلُ حالةَ الرحلةِ إلى اتّحادٍ مُغلَقٍ**: حالةٌ جديدةٌ في
 *      القاعدةِ (`orders.status`) لا يجوزُ أن تُسقِطَ قراءةَ ملخَّصٍ.
 *   ــ **لا يُنشِئُ صفّاً ولا مستخدماً** (`ADR 0035`).
 */

import type { RideStoreFailure } from "../../application/transport/ride-request-ports.ts";
import type {
  RideRatingCommand,
  RideRatingRefusal,
  RideRatingVerdict,
  RideSummaryDriver,
  RideSummaryReader,
  RideSummaryRider,
  RideSummaryState,
  RideSummaryVerdict,
} from "../../application/transport/ride-summary-ports.ts";
import { isRatingTag, type RatingTag } from "../../domain/transport/ride-summary.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

function failed(reason: RideStoreFailure["reason"]): RideStoreFailure {
  return { reason };
}

/** كما في `active-ride-store.ts`: لا نصَّ غيرَ رقميٍّ يُرسَلُ إلى `bigint`. */
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

function readDriver(value: unknown): RideSummaryDriver | null {
  if (!isRecord(value)) return null;
  return {
    firstName: readText(value.first_name),
    vehicleType: readText(value.vehicle_type),
    plateNumber: readText(value.plate_number),
    ratingAverage: readNumber(value.rating_average),
    ratingCount: readCount(value.rating_count) ?? 0,
  };
}

function readRider(value: unknown): RideSummaryRider | null {
  if (!isRecord(value)) return null;
  return {
    firstName: readText(value.first_name),
    ratingAverage: readNumber(value.rating_average),
    ratingCount: readCount(value.rating_count) ?? 0,
  };
}

/** الوسومُ المنشورةُ — ما ليسَ من المُعجَمِ **يُسقَطُ من القراءةِ** ولا يُخترَعُ. */
function readTags(value: unknown): readonly RatingTag[] {
  if (!Array.isArray(value)) return [];
  const tags: RatingTag[] = [];
  for (const entry of value) {
    if (isRatingTag(entry) && !tags.includes(entry)) tags.push(entry);
  }
  return tags;
}

interface SummaryRow {
  readonly result: Record<string, unknown> | null;
}

export function createRideSummaryReader(sql: Sql): RideSummaryReader {
  return {
    read: async (input): Promise<Result<RideSummaryVerdict, RideStoreFailure>> => {
      const telegramId = asTelegramId(input.telegramUserId);
      if (telegramId === null) return err(failed("USER_NOT_FOUND"));

      let rows: SummaryRow[];
      try {
        rows = await sql.unsafe<SummaryRow[]>("select completed_ride_summary($1, $2) as result", [
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
      const status = readText(result.status);
      const service = readText(result.service);
      const createdAtMs = readInstantMs(result.created_at);
      const rating = result.rating;
      if (
        orderId === null ||
        status === null ||
        service === null ||
        createdAtMs === null ||
        !isRecord(rating) ||
        typeof rating.already_rated !== "boolean" ||
        typeof rating.window_closed !== "boolean" ||
        typeof rating.can_rate !== "boolean"
      ) {
        return err(failed("STORE_ERROR"));
      }

      const windowHours = readNumber(rating.window_hours);
      if (windowHours === null) return err(failed("STORE_ERROR"));

      const direction = readText(rating.direction);
      if (direction === null) return err(failed("STORE_ERROR"));

      const state: RideSummaryState = {
        orderId,
        status,
        service,
        pickupLabel: readText(result.pickup_label),
        dropoffLabel: readText(result.dropoff_label),
        createdAtMs,
        matchedAtMs: readInstantMs(result.matched_at),
        startedAtMs: readInstantMs(result.started_at),
        completedAtMs: readInstantMs(result.completed_at),
        // العَدَمُ يُنقَلُ عَدَماً: حكمُه في النطاقِ (`MISSING_STAMP`) لا ههنا،
        // و**صفرٌ مكانَه يُقرأُ «رحلةً لحظيّةً»**.
        durationSeconds: readCount(result.duration_seconds),
        // و**العَدَمُ ههنا يعني «لا وجهةَ»** لا «صفرَ أمتارٍ».
        straightLineMeters: readNumber(result.straight_line_meters),
        driver: readDriver(result.driver),
        rider: readRider(result.rider),
        rating: {
          direction,
          alreadyRated: rating.already_rated,
          windowHours,
          windowClosed: rating.window_closed,
          canRate: rating.can_rate,
        },
      };
      return ok({ found: true, state });
    },
  };
}

/**
 * رموزُ رفضِ القاعدةِ المعروفةُ — **مُحصاةٌ حرفاً**. وما ليسَ فيها يُعلَنُ
 * `STORE_ERROR`: رمزٌ جديدٌ في الهجراتِ لا يجوزُ أن يُقرأَ نجاحاً.
 */
const RATING_REFUSALS: Readonly<Record<string, RideRatingRefusal>> = {
  STARS_OUT_OF_RANGE: "STARS_OUT_OF_RANGE",
  ORDER_NOT_FOUND: "ORDER_NOT_FOUND",
  ORDER_NOT_COMPLETED: "ORDER_NOT_COMPLETED",
  RATER_NOT_PARTY_TO_ORDER: "RATER_NOT_PARTY_TO_ORDER",
  RATING_WINDOW_CLOSED: "RATING_WINDOW_CLOSED",
  ALREADY_RATED: "ALREADY_RATED",
  UNKNOWN_RATING_TAG: "UNKNOWN_RATING_TAG",
  TOO_MANY_RATING_TAGS: "TOO_MANY_RATING_TAGS",
  DUPLICATE_RATING_TAG: "DUPLICATE_RATING_TAG",
};

interface RatingRow {
  readonly result: Record<string, unknown> | null;
}

export function createRideRatingCommand(sql: Sql): RideRatingCommand {
  return {
    submit: async (input): Promise<Result<RideRatingVerdict, RideStoreFailure>> => {
      const telegramId = asTelegramId(input.telegramUserId);
      if (telegramId === null) return err(failed("USER_NOT_FOUND"));

      let rows: RatingRow[];
      try {
        rows = await sql.unsafe<RatingRow[]>(
          "select submit_rating_with_tags($1, $2, $3, $4, $5) as result",
          [
            input.orderId,
            telegramId,
            input.stars,
            input.comment,
            // مصفوفةٌ فارغةٌ تُرسَلُ `null`: الوجهانِ لمعنىً واحدٍ لا يُخزَّنانِ.
            input.tags.length === 0 ? null : [...input.tags],
          ],
        );
      } catch {
        return err(failed("STORE_ERROR"));
      }

      const result = rows[0]?.result;
      if (result === null || result === undefined) return err(failed("STORE_ERROR"));

      if (result.ok !== true) {
        const code = readText(result.error);
        // «المُقيِّمُ غيرُ موجودٍ» **ليسَ رفضَ تقييمٍ** بل نقصُ حسابٍ، فيُعلَنُ
        // بالرمزِ الذي تعرفُه بقيّةُ المساراتِ (`ACCOUNT_NOT_FOUND` عندَ الحدِّ).
        if (code === "RATER_NOT_FOUND") return err(failed("USER_NOT_FOUND"));
        const refusal = code === null ? undefined : RATING_REFUSALS[code];
        if (refusal === undefined) return err(failed("STORE_ERROR"));
        return ok({ accepted: false, refusal });
      }

      const ratingId = readText(result.rating_id);
      const direction = readText(result.direction);
      const stars = readCount(result.stars);
      if (ratingId === null || direction === null || stars === null) {
        return err(failed("STORE_ERROR"));
      }

      return ok({
        accepted: true,
        rating: { ratingId, direction, stars, tags: readTags(result.tags) },
      });
    },
  };
}
