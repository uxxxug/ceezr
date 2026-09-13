/**
 * الغرض: محوّلُ حكمِ الاقتباسِ على PostgreSQL — نداءُ `quote_ride` واحدٌ، وقراءةُ
 *   حمولتِه بلا افتراضٍ (البند `F2-04` · القاعدة 0.5).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-04` (نصفُه المشروعُ).
 * ينتمي إلى: infrastructure/quote
 * يُستخدم من: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ.
 * يُتوقع أن يستخدمه لاحقاً: `F2-05` يستدعي المحوّلَ نفسَه قبلَ إنشاءِ الرحلةِ.
 *
 * ## ما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 *   ــ **لا يحكمُ على هندسةٍ**: `st_covers` و`st_distance` في القاعدةِ، وههنا
 *      أعدادٌ ونصوصٌ.
 *   ــ **لا يحسبُ مسافةً ولا مدّةً**: المسافةُ من القاعدةِ موسومةً، والمدّةُ من
 *      `packages/domain/eta` عبرَ طبقةِ التطبيقِ (`ADR 0024`).
 *   ــ **لا يُترجِمُ رفضاً إلى عطبٍ**: `ok:false` برمزٍ معروفٍ حكمٌ يُنقَلُ كما
 *      هوَ؛ ورمزٌ **مجهولٌ** عطبُ عقدٍ يُعلَنُ `STORE_ERROR` ولا يُسكَتُ عنه —
 *      لأنَّ رمزاً لا نعرفُه قد يكونُ رفضاً أشدَّ لا نُحسِنُ عرضَه.
 *   ــ **لا يقرأُ أجرةً ولا حقلاً مُعَدّاً لها**: لا حقلَ كذاكَ في الحمولةِ
 *      أصلاً (`ADR 0039` §٤ · `م13-7`).
 */

import type {
  AcceptedQuote,
  QuoteCity,
  QuoteJudge,
  QuotePoint,
  QuoteStoreFailure,
  QuoteVerdict,
} from "../../application/quote/ports.ts";
import { SERVICE_KINDS } from "../../domain/quote/service-offer.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

const QUOTE_REFUSALS = [
  "INVALID_POINT",
  "CITY_HAS_NO_SERVICE_AREA",
  "ORIGIN_OUTSIDE_SERVICE_AREA",
  "DESTINATION_OUTSIDE_SERVICE_AREA",
] as const;

type QuoteRefusalCode = (typeof QUOTE_REFUSALS)[number];

function isQuoteRefusal(value: unknown): value is QuoteRefusalCode {
  return typeof value === "string" && (QUOTE_REFUSALS as readonly string[]).includes(value);
}

function failed(reason: QuoteStoreFailure["reason"]): QuoteStoreFailure {
  return { reason };
}

/** كما في `places-store.ts` و`destinations-store.ts`: لا نصَّ غيرَ رقميٍّ يُرسَلُ إلى `bigint`. */
function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // بعضُ برامجِ التشغيلِ تُعيدُ `numeric` نصّاً؛ فيُقرأُ ولا يُفترَضُ.
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

interface QuotePayload {
  readonly ok?: unknown;
  readonly error?: unknown;
  readonly city_code?: unknown;
  readonly city_name_ar?: unknown;
  readonly city_name_en?: unknown;
  readonly area_version?: unknown;
  readonly distance_kind?: unknown;
  readonly distance_m?: unknown;
  readonly served_services?: unknown;
}

interface QuoteRow {
  readonly result: QuotePayload | null;
}

/** `null` منها = لم تُقرَأْ مدينةٌ بعدُ، وذاكَ حالُ `INVALID_POINT` وحدَه. */
function readCity(payload: QuotePayload): QuoteCity | null {
  const code = readText(payload.city_code);
  const nameAr = readText(payload.city_name_ar);
  const nameEn = readText(payload.city_name_en);
  if (code === null || nameAr === null || nameEn === null) return null;
  return { code, nameAr, nameEn };
}

/**
 * أسماءُ الخدماتِ تُصفّى بقائمةِ النطاقِ: خدمةٌ في القاعدةِ لا يعرفُها النطاقُ
 * **لا تُمرَّرُ**، لأنَّ الشاشةَ لا تملكُ لها نصّاً فتعرضُ رمزاً خاماً.
 */
function readServices(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const known: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    if ((SERVICE_KINDS as readonly string[]).includes(entry)) known.push(entry);
  }
  return known;
}

export function createQuoteJudge(sql: Sql): QuoteJudge {
  return {
    judge: async (input: {
      readonly telegramUserId: string;
      readonly origin: QuotePoint;
      readonly destination: QuotePoint;
    }): Promise<Result<QuoteVerdict, QuoteStoreFailure>> => {
      const telegramId = asTelegramId(input.telegramUserId);
      // الغيابُ ههنا سؤالٌ بلا سائلٍ: يُردُّ صريحاً ولا يُطوى قبولاً.
      if (telegramId === null) return err(failed("USER_NOT_FOUND"));

      let rows: QuoteRow[];
      try {
        rows = await sql.unsafe<QuoteRow[]>("select quote_ride($1, $2, $3, $4, $5) as result", [
          telegramId,
          input.origin.lat,
          input.origin.lng,
          input.destination.lat,
          input.destination.lng,
        ]);
      } catch {
        return err(failed("STORE_ERROR"));
      }

      const result = rows[0]?.result;
      if (result === null || result === undefined) return err(failed("STORE_ERROR"));

      if (result.ok !== true) {
        const code = result.error;
        // غيابُ صفِّ المستخدمِ عطبُ حسابٍ لا رفضُ اقتباسٍ، فيُترجَمُ 404 لا 200.
        if (code === "USER_NOT_FOUND") return err(failed("USER_NOT_FOUND"));
        if (!isQuoteRefusal(code)) return err(failed("STORE_ERROR"));
        return ok({ accepted: false, refusal: code, city: readCity(result) });
      }

      const city = readCity(result);
      const areaVersion = readText(result.area_version);
      const meters = readNumber(result.distance_m);
      const services = readServices(result.served_services);
      // الوسمُ يُقابَلُ نصّاً: قيمةٌ أخرى تعني أنَّ القاعدةَ صارت تُعيدُ صنفاً لا
      // يعرفُه النطاقُ، وتمريرُه يهدمُ ما بُنيَ الوسمُ لأجلِه (`ADR 0024`).
      if (result.distance_kind !== "STRAIGHT_LINE") return err(failed("STORE_ERROR"));
      if (city === null || areaVersion === null || meters === null || services === null) {
        return err(failed("STORE_ERROR"));
      }

      const quote: AcceptedQuote = {
        city,
        areaVersion,
        distance: { kind: "STRAIGHT_LINE", meters },
        servedServices: services,
      };
      return ok({ accepted: true, quote });
    },
  };
}
