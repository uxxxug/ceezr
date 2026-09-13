/**
 * الغرض: مساراتُ شاشةِ «إلى أين؟» — `GET /v1/destinations/search`
 *   و`POST /v1/destinations/resolve` (البند `F2-03` · `SR-03` · القسم 10.2).
 * الحالة: منفّذ فعلياً — البند `F2-03`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ، وشاشةُ الوجهةِ
 *   في `apps/miniapp`.
 * ملاحظات مستقبلية: `F2-04` (إنشاءُ الطلبِ) يُصادِقُ الوجهةَ بذاتِ الدالّةِ في
 *   القاعدةِ لا بنداءٍ لهذا المسارِ من الخادمِ إلى نفسِه.
 *
 * ## لماذا الرفضُ `200` لا `4xx`
 *
 * «هذه النقطةُ خارجَ منطقةِ الخدمةِ» **جوابٌ كاملٌ** عن سؤالٍ صحيحٍ الصياغةِ
 * ومُصرَّحٍ به. و`4xx` معناه «طلبُك خاطئٌ» وليسَ كذلكَ: الطلبُ صحيحٌ والجوابُ
 * «لا». ولو رُفِعَ رمزُ حالةٍ لَخلطَته كلُّ طبقةِ عميلٍ ووسيطٍ بعطبٍ، فظهرَ
 * «تعذَّرَ الاتصالُ» لمَن يحتاجُ أن يقرأَ «نخدمُ جدةَ اليومَ».
 *
 * والحمولةُ تُفرِّقُ صريحاً: `accepted: true|false`. أمّا `ok` فيبقى دلالتَه في
 * كلِّ المشروعِ: «وصلَ السؤالُ وجُوِّبَ» لا «كانَ الجوابُ مُوافِقاً».
 *
 * ## وما لا تفعلُه هذه المساراتُ عن قصدٍ
 *
 *   ــ **لا تقرأُ هويّةً ولا مدينةً من الطلبِ**: المدينةُ من صفِّ المستخدمِ
 *      (القاعدة 0.4)، وقَبولُها من العميلِ بابُ «ابحَثْ في مدينةِ غيرِك».
 *   ــ **لا تُطبِّعُ النصَّ ههنا**: التطبيعُ في النطاقِ، والمسارُ ناقلٌ.
 *   ــ **لا تُعيدُ نصّاً معروضاً**: لا اسمَ رفضٍ ولا وصفَ مسافةٍ — مفاتيحُ
 *      وأعدادٌ، والنصُّ في `packages/shared/i18n` (القسم 9.11).
 *   ــ **لا تُعيدُ قائمةً فارغةً عندَ غيابِ التبعياتِ**: `503` لا `200`.
 */

import { type Context, Hono } from "hono";
import {
  type DestinationsDeps,
  type DestinationsPublicErrorCode,
  readSearchLimit,
  resolveDestination,
  searchDestinations,
} from "../../../../packages/application/destinations/choose-destination.ts";
import type { DestinationVerdict } from "../../../../packages/application/destinations/ports.ts";
import { bearerTokenFrom } from "./me.ts";
import { readBounded } from "./telegram-webhook.ts";

export interface DestinationsRouteDependencies {
  /** غيابُها يُعطِّلُ المساراتِ بـ503 ولا يجعلُها تُجيبُ بلا تحقّقٍ. */
  readonly destinations?: DestinationsDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/**
 * جسمُ المصادقةِ حقلانِ عشريّانِ. والحدُّ حدُّ نقلٍ لا قيمةُ منتَجٍ (القاعدة 0.3).
 */
export const DESTINATION_MAX_BYTES = 512;

const STATUS_BY_ERROR: Readonly<Record<DestinationsPublicErrorCode, 400 | 401 | 404 | 503>> = {
  SESSION_REQUIRED: 401,
  SESSION_INVALID: 401,
  SESSION_EXPIRED: 401,
  SESSION_NOT_AVAILABLE: 503,
  MALFORMED: 400,
  // استفهامٌ قصيرٌ: خطأُ عقدٍ مفصولٌ عن `MALFORMED` كي يعرفَ العميلُ أنَّ بناءَه
  // سليمٌ وأنَّ الحرفَ الواحدَ وحدَه مرفوضٌ — ويعرضَ إرشاداً لا عطباً.
  QUERY_TOO_SHORT: 400,
  // الجلسةُ صحيحةٌ ولا صفَّ مستخدمٍ: `404` لا `401`، ولا يُنشَأُ الصفُّ (ADR 0035).
  ACCOUNT_NOT_FOUND: 404,
  DESTINATION_STORE_NOT_AVAILABLE: 503,
};

function rejected(c: Context, error: DestinationsPublicErrorCode) {
  return c.json({ ok: false, error }, STATUS_BY_ERROR[error]);
}

/** المدينةُ كما تُعرَضُ: رمزٌ واسمانِ وإصدارُ حدٍّ — بلا هندسةٍ على السلكِ. */
function publishCity(city: {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly areaVersion: string | null;
}) {
  return {
    code: city.code,
    nameAr: city.nameAr,
    nameEn: city.nameEn,
    areaVersion: city.areaVersion,
  };
}

/**
 * الحكمُ كما يُنشَرُ. والمسافةُ تُعادُ **عدداً** ولا تُوصَفُ ههنا: «قربَ كذا»
 * حكمُ نطاقٍ (`describesPoint`) وعرضُه شأنُ الشاشةِ، ولو كُتِبَ في الناقلِ لَصارَ
 * حدُّ الألفِ والخمسِ مئةِ مترٍ رقماً في ثلاثةِ مواضعَ.
 */
function publishVerdict(verdict: DestinationVerdict) {
  if (!verdict.accepted) {
    return {
      accepted: false as const,
      refusal: verdict.refusal,
      city: verdict.city === null ? null : publishCity(verdict.city),
    };
  }
  const { destination } = verdict;
  return {
    accepted: true as const,
    destination: {
      lat: destination.lat,
      lng: destination.lng,
      city: publishCity(destination.city),
      nearest:
        destination.nearest === null
          ? null
          : {
              kind: destination.nearest.kind,
              nameAr: destination.nearest.nameAr,
              nameEn: destination.nearest.nameEn,
              straightDistanceM: destination.nearest.straightDistanceM,
            },
    },
  };
}

export function createDestinationsRoutes(deps: DestinationsRouteDependencies): Hono {
  const app = new Hono();

  app.get("/v1/destinations/search", async (c) => {
    if (deps.destinations === undefined) {
      deps.log?.("destinations.route_disabled", {});
      return rejected(c, "DESTINATION_STORE_NOT_AVAILABLE");
    }

    const limit = readSearchLimit(c.req.query("limit") ?? null);
    if (limit === null) return rejected(c, "MALFORMED");

    const result = await searchDestinations(deps.destinations, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      rawQuery: c.req.query("q") ?? null,
      limit,
    });
    if (!result.ok) return rejected(c, result.error);

    return c.json({
      ok: true,
      query: result.value.query,
      suggestions: result.value.suggestions.map((s) => ({
        source: s.source,
        refId: s.refId,
        kind: s.kind,
        labelAr: s.labelAr,
        labelEn: s.labelEn,
        lat: s.lat,
        lng: s.lng,
        matchRank: s.matchRank,
      })),
    });
  });

  app.post("/v1/destinations/resolve", async (c) => {
    if (deps.destinations === undefined) {
      deps.log?.("destinations.route_disabled", {});
      return rejected(c, "DESTINATION_STORE_NOT_AVAILABLE");
    }

    const declaredLength = Number(c.req.header("content-length") ?? Number.NaN);
    if (Number.isFinite(declaredLength) && declaredLength > DESTINATION_MAX_BYTES) {
      return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    }
    const raw = await readBounded(c.req.raw.body, DESTINATION_MAX_BYTES);
    if (raw === null) return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ ok: false, error: "INVALID_JSON" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({ ok: false, error: "INVALID_BODY" }, 400);
    }

    // الحقولُ تُمرَّرُ كما وصلَت ولا تُخشَّنُ ههنا: عينُ حكمِ `me-places.ts` —
    // `Number("")` صفرٌ، وهوَ إحداثيّةٌ صحيحةٌ في خليجِ غينيا.
    const result = await resolveDestination(deps.destinations, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      body,
    });
    if (!result.ok) return rejected(c, result.error);

    return c.json({ ok: true, ...publishVerdict(result.value.verdict) });
  });

  return app;
}
