/**
 * الغرض: محوّلاتُ الأماكنِ المحفوظةِ وآخرِ الوجهاتِ على PostgreSQL — نداءُ دالّةٍ
 *   واحدةٍ لكلِّ عمليّةٍ، لا SQL مبثوثٌ (البند `F2-02` · القاعدة 0.5).
 * الحالة: منفّذ فعلياً — البند `F2-02`.
 * ينتمي إلى: infrastructure/places
 * يُستخدم من: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ.
 *
 * ما لا يفعلُه هذا الملفُّ عن قصدٍ:
 *   ــ لا يبني `insert` ولا `on conflict` بنفسِه: الذرّيّةُ في `upsert_saved_place`.
 *   ــ لا يُحوِّلُ نقطةً: `st_x`/`st_y` تقعانِ في القاعدةِ، وههنا أعدادٌ.
 *   ــ لا يُمرِّرُ نصَّ خطأِ القاعدةِ إلى الأعلى: سببٌ مصنَّفٌ وحدَه.
 *   ــ لا يُنشئُ مستخدماً ولا مدينةً.
 */

import type {
  PlaceStoreFailure,
  RecentDestination,
  RecentDestinationReader,
  SavedPlace,
  SavedPlaceReader,
  SavedPlaceWriter,
  SavePlaceCommand,
  SavePlaceOutcome,
} from "../../application/places/ports.ts";
import { isSavedPlaceKind } from "../../domain/places/place-kinds.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

function failed(reason: PlaceStoreFailure["reason"]): PlaceStoreFailure {
  return { code: "PLACE_STORE_FAILED", reason };
}

/** كما في `consent-store.ts`: نصٌّ غيرُ رقميٍّ لا يُرسَلُ إلى `bigint` أصلاً. */
function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

function readMs(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // بعضُ برامجِ التشغيلِ تُعيدُ `double precision` نصّاً؛ فيُقرأُ ولا يُفترَضُ.
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

interface SavedPlaceRow {
  readonly place_id: string;
  readonly kind: string;
  readonly label: string;
  readonly lat: unknown;
  readonly lng: unknown;
  readonly updated_at: string | Date;
}

function readSavedPlace(row: SavedPlaceRow): SavedPlace | null {
  // نوعٌ لا يعرفُه النطاقُ **يُعلَنُ خطأً** ولا يُطرَحُ صامتاً: طرحُ الصفِّ يُخفي
  // مكاناً حفظَه المستخدمُ بنفسِه، وهوَ أسوأُ من إعلانِ عطبٍ يُقرأُ ويُصلَحُ.
  if (!isSavedPlaceKind(row.kind)) return null;
  const lat = readNumber(row.lat);
  const lng = readNumber(row.lng);
  const updatedAtMs = readMs(row.updated_at);
  if (lat === null || lng === null || updatedAtMs === null) return null;
  if (typeof row.place_id !== "string" || typeof row.label !== "string") return null;
  return { id: row.place_id, kind: row.kind, label: row.label, lat, lng, updatedAtMs };
}

export function createSavedPlaceReader(sql: Sql): SavedPlaceReader {
  return {
    listForTelegramUser: async (
      telegramUserId: string,
    ): Promise<Result<readonly SavedPlace[], PlaceStoreFailure>> => {
      const telegramId = asTelegramId(telegramUserId);
      // معرّفٌ لا يمكنُ أن يطابقَ صفّاً: قائمةٌ فارغةٌ بلا نداءِ قاعدةٍ.
      if (telegramId === null) return ok([]);

      let rows: SavedPlaceRow[];
      try {
        rows = await sql.unsafe<SavedPlaceRow[]>(
          "select place_id, kind, label, lat, lng, updated_at from list_saved_places($1)",
          [telegramId],
        );
      } catch {
        return err(failed("STORE_ERROR"));
      }

      const places: SavedPlace[] = [];
      for (const row of rows) {
        const place = readSavedPlace(row);
        if (place === null) return err(failed("STORE_ERROR"));
        places.push(place);
      }
      return ok(places);
    },
  };
}

interface SaveResultRow {
  readonly result: {
    readonly ok?: boolean;
    readonly error?: string;
    readonly status?: string;
    readonly place_id?: string;
    readonly kind?: string;
    readonly label?: string;
    readonly lat?: unknown;
    readonly lng?: unknown;
    readonly updated_at?: string | Date;
  };
}

export function createSavedPlaceWriter(sql: Sql): SavedPlaceWriter {
  return {
    save: async (
      command: SavePlaceCommand,
    ): Promise<Result<SavePlaceOutcome, PlaceStoreFailure>> => {
      const telegramId = asTelegramId(command.telegramUserId);
      // ههنا الغيابُ كتابةٌ لا صاحبَ لها: تُردُّ صريحةً لا تُطوى فارغةً.
      if (telegramId === null) return err(failed("USER_NOT_FOUND"));

      let rows: SaveResultRow[];
      try {
        rows = await sql.unsafe<SaveResultRow[]>(
          "select upsert_saved_place($1, $2, $3, $4, $5) as result",
          [telegramId, command.kind, command.label, command.lat, command.lng],
        );
      } catch {
        return err(failed("STORE_ERROR"));
      }

      const result = rows[0]?.result;
      if (result === undefined) return err(failed("STORE_ERROR"));
      if (result.ok !== true) {
        return err(failed(result.error === "USER_NOT_FOUND" ? "USER_NOT_FOUND" : "STORE_ERROR"));
      }
      if (result.status !== "created" && result.status !== "updated") {
        return err(failed("STORE_ERROR"));
      }

      const lat = readNumber(result.lat);
      const lng = readNumber(result.lng);
      const updatedAtMs = readMs(result.updated_at);
      if (
        typeof result.place_id !== "string" ||
        typeof result.label !== "string" ||
        !isSavedPlaceKind(result.kind) ||
        lat === null ||
        lng === null ||
        updatedAtMs === null
      ) {
        return err(failed("STORE_ERROR"));
      }

      return ok({
        status: result.status,
        place: {
          id: result.place_id,
          kind: result.kind,
          label: result.label,
          lat,
          lng,
          updatedAtMs,
        },
      });
    },
  };
}

interface RecentRow {
  readonly label: string;
  readonly lat: unknown;
  readonly lng: unknown;
  readonly last_used_at: string | Date;
}

export function createRecentDestinationReader(sql: Sql): RecentDestinationReader {
  return {
    listForTelegramUser: async (
      telegramUserId: string,
      limit: number,
    ): Promise<Result<readonly RecentDestination[], PlaceStoreFailure>> => {
      const telegramId = asTelegramId(telegramUserId);
      if (telegramId === null) return ok([]);
      if (!Number.isInteger(limit) || limit < 1) return err(failed("STORE_ERROR"));

      let rows: RecentRow[];
      try {
        rows = await sql.unsafe<RecentRow[]>(
          "select label, lat, lng, last_used_at from list_recent_destinations($1, $2)",
          [telegramId, limit],
        );
      } catch {
        return err(failed("STORE_ERROR"));
      }

      const destinations: RecentDestination[] = [];
      for (const row of rows) {
        const lat = readNumber(row.lat);
        const lng = readNumber(row.lng);
        const lastUsedAtMs = readMs(row.last_used_at);
        if (lat === null || lng === null || lastUsedAtMs === null) {
          return err(failed("STORE_ERROR"));
        }
        if (typeof row.label !== "string") return err(failed("STORE_ERROR"));
        destinations.push({ label: row.label, lat, lng, lastUsedAtMs });
      }
      return ok(destinations);
    },
  };
}
