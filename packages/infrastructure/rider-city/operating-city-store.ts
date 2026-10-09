/**
 * الغرض: منفذُ المدينةِ التشغيليّةِ للراكب (R1 · ADR 0252) — نداءُ دالّتَي القاعدة
 *   `read_rider_operating_city` و`locate_rider_operating_city` وحدَهما.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: infrastructure/rider-city
 */

import type {
  LocateOutcome,
  OperatingCity,
  OperatingCityStore,
  OperatingCityStoreFailure,
} from "../../application/rider-city/operating-city.ts";
import { err, ok } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

const TELEGRAM_ID_PATTERN = /^[0-9]{1,19}$/;
const OUTCOMES: readonly LocateOutcome[] = [
  "CHANGED",
  "SAME_CITY",
  "OUTSIDE_ACTIVE_CITIES",
  "ACTIVE_RIDE",
];

interface RawCity {
  readonly code?: unknown;
  readonly name_ar?: unknown;
  readonly name_en?: unknown;
  readonly is_active?: unknown;
}

interface RawResult {
  readonly ok?: boolean;
  readonly error?: string;
  readonly outcome?: string;
  readonly city?: RawCity | null;
}

const failed = (reason: OperatingCityStoreFailure["reason"]): OperatingCityStoreFailure => ({
  code: "OPERATING_CITY_STORE_FAILED",
  reason,
});

function cityFrom(raw: RawCity | null | undefined): OperatingCity | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw.code !== "string" || typeof raw.name_ar !== "string") return null;
  return {
    code: raw.code,
    nameAr: raw.name_ar,
    nameEn: typeof raw.name_en === "string" ? raw.name_en : raw.name_ar,
    isActive: raw.is_active === true,
  };
}

function failureFrom(error: string | undefined): OperatingCityStoreFailure {
  if (error === "USER_NOT_FOUND" || error === "NOT_A_RIDER" || error === "INVALID_POINT") {
    return failed(error);
  }
  return failed("STORE_ERROR");
}

export function createOperatingCityStore(sql: Sql): OperatingCityStore {
  return {
    read: async (telegramUserId) => {
      if (!TELEGRAM_ID_PATTERN.test(telegramUserId)) return err(failed("USER_NOT_FOUND"));
      let rows: { readonly result: RawResult }[];
      try {
        rows = await sql.unsafe<{ readonly result: RawResult }[]>(
          "select read_rider_operating_city($1) as result",
          [telegramUserId],
        );
      } catch {
        return err(failed("STORE_ERROR"));
      }
      const result = rows[0]?.result;
      if (result === undefined) return err(failed("STORE_ERROR"));
      if (result.ok !== true) return err(failureFrom(result.error));
      return ok(cityFrom(result.city));
    },
    locate: async ({ telegramUserId, lat, lng }) => {
      if (!TELEGRAM_ID_PATTERN.test(telegramUserId)) return err(failed("USER_NOT_FOUND"));
      let rows: { readonly result: RawResult }[];
      try {
        rows = await sql.unsafe<{ readonly result: RawResult }[]>(
          "select locate_rider_operating_city($1, $2::double precision, $3::double precision) as result",
          [telegramUserId, lat, lng],
        );
      } catch {
        return err(failed("STORE_ERROR"));
      }
      const result = rows[0]?.result;
      if (result === undefined) return err(failed("STORE_ERROR"));
      if (result.ok !== true) return err(failureFrom(result.error));
      const outcome = OUTCOMES.find((o) => o === result.outcome);
      if (outcome === undefined) return err(failed("STORE_ERROR"));
      return ok({ outcome, city: cityFrom(result.city) });
    },
  };
}
