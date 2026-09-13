/**
 * الغرض: محوّلا البحثِ عن الوجهاتِ ومصادقةِ الدبّوسِ على PostgreSQL — نداءُ دالّةٍ
 *   واحدةٍ لكلِّ عمليّةٍ، لا SQL مبثوثٌ (البند `F2-03` · القاعدة 0.5).
 * الحالة: منفّذ فعلياً — البند `F2-03`.
 * ينتمي إلى: infrastructure/destinations
 * يُستخدم من: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ.
 *
 * ما لا يفعلُه هذا الملفُّ عن قصدٍ:
 *   ــ **لا يُطبِّعُ نصَّ البحثِ**: يأتيه مُطبَّعاً من النطاقِ، والتطبيعُ ههنا
 *      طبقةٌ ثالثةٌ تتباعدُ عن اثنتَينِ (القاعدة 0.6).
 *   ــ **لا يحكمُ على هندسةٍ**: `st_covers` و`<->` في القاعدةِ، وههنا أعدادٌ.
 *   ــ **لا يُترجِمُ رفضاً إلى عطبٍ**: `ok:false` من `resolve_destination` حكمٌ
 *      يُنقَلُ كما هوَ، ولا يصيرُ `STORE_ERROR` إلّا إن كانَ رمزاً لا نعرفُه —
 *      ورمزٌ مجهولٌ عطبُ عقدٍ يُعلَنُ ولا يُسكَتُ عنه.
 *   ــ لا يُنشئُ مستخدماً ولا مدينةً ولا حدَّ خدمةٍ.
 */

import type {
  AcceptedDestination,
  DestinationCity,
  DestinationResolver,
  DestinationSearcher,
  DestinationStoreFailure,
  DestinationSuggestion,
  DestinationVerdict,
  NearestLandmark,
} from "../../application/destinations/ports.ts";
import {
  isDestinationRefusal,
  isDestinationSource,
} from "../../domain/destinations/landmark-kinds.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

function failed(reason: DestinationStoreFailure["reason"]): DestinationStoreFailure {
  return { code: "DESTINATION_STORE_FAILED", reason };
}

/** كما في `places-store.ts`: نصٌّ غيرُ رقميٍّ لا يُرسَلُ إلى `bigint` أصلاً. */
function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
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

function readOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

interface SuggestionRow {
  readonly source: string;
  readonly ref_id: string | null;
  readonly kind: string | null;
  readonly label_ar: string;
  readonly label_en: string | null;
  readonly lat: unknown;
  readonly lng: unknown;
  readonly match_rank: unknown;
}

function readSuggestion(row: SuggestionRow): DestinationSuggestion | null {
  if (!isDestinationSource(row.source)) return null;
  if (typeof row.label_ar !== "string" || row.label_ar.length === 0) return null;
  const lat = readNumber(row.lat);
  const lng = readNumber(row.lng);
  const matchRank = readNumber(row.match_rank);
  if (lat === null || lng === null || matchRank === null) return null;
  return {
    source: row.source,
    refId: readOptionalText(row.ref_id),
    kind: readOptionalText(row.kind),
    labelAr: row.label_ar,
    labelEn: readOptionalText(row.label_en),
    lat,
    lng,
    matchRank,
  };
}

export function createDestinationSearcher(sql: Sql): DestinationSearcher {
  return {
    searchForTelegramUser: async (
      telegramUserId: string,
      normalizedQuery: string,
      limit: number,
    ): Promise<Result<readonly DestinationSuggestion[], DestinationStoreFailure>> => {
      const telegramId = asTelegramId(telegramUserId);
      // معرّفٌ لا يمكنُ أن يطابقَ صفّاً: قائمةٌ فارغةٌ بلا نداءِ قاعدةٍ. والبحثُ
      // قراءةٌ لا كتابةٌ، فالغيابُ فيه «لا نتيجةَ» لا «لا صاحبَ».
      if (telegramId === null) return ok([]);
      if (!Number.isInteger(limit) || limit < 1) return err(failed("STORE_ERROR"));
      if (normalizedQuery.length === 0) return err(failed("STORE_ERROR"));

      let rows: SuggestionRow[];
      try {
        rows = await sql.unsafe<SuggestionRow[]>(
          "select source, ref_id, kind, label_ar, label_en, lat, lng, match_rank from search_destinations($1, $2, $3)",
          [telegramId, normalizedQuery, limit],
        );
      } catch {
        return err(failed("STORE_ERROR"));
      }

      const suggestions: DestinationSuggestion[] = [];
      for (const row of rows) {
        const suggestion = readSuggestion(row);
        // صفٌّ لا يُقرأُ **يُعلَنُ عطباً** ولا يُطرَحُ صامتاً: قائمةٌ ناقصةٌ بلا
        // خبرٍ تجعلَ المستخدمَ يظنُّ وجهتَه غيرَ موجودةٍ فيكتبُ عنواناً خاطئاً.
        if (suggestion === null) return err(failed("STORE_ERROR"));
        suggestions.push(suggestion);
      }
      return ok(suggestions);
    },
  };
}

interface CityPayload {
  readonly city_code?: unknown;
  readonly city_name_ar?: unknown;
  readonly city_name_en?: unknown;
  readonly area_version?: unknown;
}

interface NearestPayload {
  readonly kind?: unknown;
  readonly name_ar?: unknown;
  readonly name_en?: unknown;
  readonly straight_distance_m?: unknown;
}

interface ResolvePayload extends CityPayload {
  readonly ok?: unknown;
  readonly error?: unknown;
  readonly lat?: unknown;
  readonly lng?: unknown;
  readonly nearest?: NearestPayload | null;
}

interface ResolveRow {
  readonly result: ResolvePayload | null;
}

/**
 * المدينةُ تُقرأُ في القبولِ والرفضِ سواءً، و`null` منها معناه «لم تُقرَأْ بعدُ»
 * — وذاكَ حالُ `USER_NOT_FOUND` وحدَه، لا حالُ مدينةٍ بلا حدٍّ.
 */
function readCity(payload: CityPayload): DestinationCity | null {
  const code = readOptionalText(payload.city_code);
  const nameAr = readOptionalText(payload.city_name_ar);
  const nameEn = readOptionalText(payload.city_name_en);
  if (code === null || nameAr === null || nameEn === null) return null;
  return { code, nameAr, nameEn, areaVersion: readOptionalText(payload.area_version) };
}

function readNearest(payload: NearestPayload | null | undefined): NearestLandmark | null {
  if (payload === null || payload === undefined) return null;
  const kind = readOptionalText(payload.kind);
  const nameAr = readOptionalText(payload.name_ar);
  const distance = readNumber(payload.straight_distance_m);
  if (kind === null || nameAr === null || distance === null) return null;
  return {
    kind,
    nameAr,
    nameEn: readOptionalText(payload.name_en) ?? nameAr,
    straightDistanceM: distance,
  };
}

export function createDestinationResolver(sql: Sql): DestinationResolver {
  return {
    resolveForTelegramUser: async (
      telegramUserId: string,
      lat: number,
      lng: number,
    ): Promise<Result<DestinationVerdict, DestinationStoreFailure>> => {
      const telegramId = asTelegramId(telegramUserId);
      // ههنا الغيابُ سؤالٌ بلا سائلٍ: يُردُّ صريحاً لا يُطوى قبولاً.
      if (telegramId === null) return err(failed("USER_NOT_FOUND"));

      let rows: ResolveRow[];
      try {
        rows = await sql.unsafe<ResolveRow[]>("select resolve_destination($1, $2, $3) as result", [
          telegramId,
          lat,
          lng,
        ]);
      } catch {
        return err(failed("STORE_ERROR"));
      }

      const result = rows[0]?.result;
      if (result === null || result === undefined) return err(failed("STORE_ERROR"));

      if (result.ok !== true) {
        const code = result.error;
        // غيابُ صفِّ المستخدمِ عطبُ حسابٍ لا رفضُ وجهةٍ، فيُترجَمُ 404 لا 200.
        if (code === "USER_NOT_FOUND") return err(failed("USER_NOT_FOUND"));
        if (!isDestinationRefusal(code)) return err(failed("STORE_ERROR"));
        return ok({ accepted: false, refusal: code, city: readCity(result) });
      }

      const acceptedLat = readNumber(result.lat);
      const acceptedLng = readNumber(result.lng);
      const city = readCity(result);
      if (acceptedLat === null || acceptedLng === null || city === null) {
        return err(failed("STORE_ERROR"));
      }

      const destination: AcceptedDestination = {
        lat: acceptedLat,
        lng: acceptedLng,
        city,
        nearest: readNearest(result.nearest),
      };
      return ok({ accepted: true, destination });
    },
  };
}
