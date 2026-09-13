/**
 * الغرض: مساراتُ شاشةِ الراكبِ الأولى — `GET /v1/me/places` و`POST /v1/me/places`
 *   و`GET /v1/me/recent-destinations` (البند `F2-02` · SR-02 · القسم 9.8).
 * الحالة: منفّذ فعلياً — البند `F2-02`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ، وشاشةُ الراكبِ
 *   في `apps/miniapp`.
 * ملاحظات مستقبلية: `SR-12` (إدارةُ الأماكنِ) يحتاجُ `DELETE /v1/me/places/:id`
 *   وهوَ عقدٌ غيرُ معلَنٍ في §9.8 اليومَ فلا يُخترَعُ ههنا؛ و`F2-03` يحتاجُ قراءةَ
 *   الأماكنِ القريبةِ من نقطةٍ وذاكَ عقدٌ ثالثٌ لا وسيطٌ اختياريٌّ على هذا.
 *
 * ## لماذا لا يُطلَبُ `Idempotency-Key` على حفظِ المكانِ
 *
 * كما في `consents.ts`: تماثُلُ الأمرِ **بنيويٌّ**. الفهرسُ الفريدُ الجزئيُّ
 * `(user_id, kind) where kind in ('home','work')` يجعلُ النداءَ الثانيَ على
 * المنزلِ تحديثاً لا صفّاً ثانياً، والردُّ يقولُ `updated` صريحاً. و`other`
 * قائمةٌ مفتوحةٌ بطبيعتِها: نقرتانِ تعنيانِ مكانَينِ، وهذا **مقصودٌ** لا سِباقٌ.
 *
 * ## وما لا تفعلُه هذه المساراتُ عن قصدٍ
 *
 *   ــ **لا تقرأُ هويّةً من الطلبِ**: لا معرّفَ مستخدمٍ ولا مدينةً ولا دوراً.
 *   ــ لا تقبلُ ختماً زمنيّاً: `updated_at` من القاعدةِ.
 *   ــ لا تكتبُ وجهةً أخيرةً: الوجهاتُ الأخيرةُ **قراءةٌ** من `orders`، ولا
 *      مسارَ كتابةٍ لها ههنا ولا في غيرِه.
 *   ــ لا تُعيدُ قائمةً فارغةً عندَ غيابِ التبعياتِ: `503` لا `200`.
 */

import { type Context, Hono } from "hono";
import {
  listRecentDestinations,
  listSavedPlaces,
  type PlacesDeps,
  type PlacesPublicErrorCode,
  readRecentLimit,
  savePlace,
} from "../../../../packages/application/places/manage-places.ts";
import { bearerTokenFrom } from "./me.ts";
import { readBounded } from "./telegram-webhook.ts";

export interface PlacesRouteDependencies {
  /** غيابُها يُعطِّلُ المساراتِ بـ503 ولا يجعلُها تُجيبُ بلا تحقّقٍ. */
  readonly places?: PlacesDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/**
 * جسمُ الطلبِ أربعةُ حقولٍ قصيرةٍ، واللافتةُ محدودةٌ بثمانينَ محرفاً في النطاقِ.
 * والحدُّ ههنا حدُّ نقلٍ لا قيمةٌ تجاريّةٌ (القاعدة 0.3): لا مدينةَ تُغيِّرُه.
 */
export const PLACE_MAX_BYTES = 1024;

const STATUS_BY_ERROR: Readonly<Record<PlacesPublicErrorCode, 400 | 401 | 404 | 503>> = {
  SESSION_REQUIRED: 401,
  SESSION_INVALID: 401,
  SESSION_EXPIRED: 401,
  SESSION_NOT_AVAILABLE: 503,
  MALFORMED: 400,
  // نوعٌ لا يعرفُه العقدُ: خطأُ طلبٍ مفصولٌ عن `MALFORMED` كي يعرفَ العميلُ أنَّ
  // بناءَه سليمٌ وأنَّ الكلمةَ وحدَها مرفوضةٌ.
  UNKNOWN_PLACE_KIND: 400,
  // الجلسةُ صحيحةٌ ولا صفَّ مستخدمٍ: `404` لا `401`، ولا يُنشَأُ الصفُّ (ADR 0035).
  ACCOUNT_NOT_FOUND: 404,
  PLACE_STORE_NOT_AVAILABLE: 503,
};

function rejected(c: Context, error: PlacesPublicErrorCode) {
  return c.json({ ok: false, error }, STATUS_BY_ERROR[error]);
}

/** المكانُ كما يُعرَضُ: ختمٌ بـISO لا بالمِلّيِ، كما في `consents.ts`. */
function publish(place: {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
  readonly updatedAtMs: number;
}) {
  return {
    id: place.id,
    kind: place.kind,
    label: place.label,
    lat: place.lat,
    lng: place.lng,
    updatedAt: new Date(place.updatedAtMs).toISOString(),
  };
}

export function createPlacesRoutes(deps: PlacesRouteDependencies): Hono {
  const app = new Hono();

  app.get("/v1/me/places", async (c) => {
    if (deps.places === undefined) {
      deps.log?.("places.route_disabled", {});
      return rejected(c, "PLACE_STORE_NOT_AVAILABLE");
    }

    const accessToken = bearerTokenFrom(c.req.header("authorization"));
    const result = await listSavedPlaces(deps.places, { accessToken });
    if (!result.ok) return rejected(c, result.error);

    return c.json({ ok: true, places: result.value.places.map(publish) });
  });

  app.post("/v1/me/places", async (c) => {
    if (deps.places === undefined) {
      deps.log?.("places.route_disabled", {});
      return rejected(c, "PLACE_STORE_NOT_AVAILABLE");
    }

    const declaredLength = Number(c.req.header("content-length") ?? Number.NaN);
    if (Number.isFinite(declaredLength) && declaredLength > PLACE_MAX_BYTES) {
      return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    }
    const raw = await readBounded(c.req.raw.body, PLACE_MAX_BYTES);
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

    // الحقولُ تُمرَّرُ كما وصلَت ولا تُخشَّنُ ههنا: لو حُوِّلَ `lat` بـ`Number(...)`
    // لصارَ `""` صفراً — إحداثيّةً صحيحةً في خليجِ غينيا. والقبولُ قرارُ النطاقِ.
    const result = await savePlace(deps.places, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      body,
    });
    if (!result.ok) return rejected(c, result.error);

    return c.json({ ok: true, status: result.value.status, place: publish(result.value.place) });
  });

  app.get("/v1/me/recent-destinations", async (c) => {
    if (deps.places === undefined) {
      deps.log?.("places.route_disabled", {});
      return rejected(c, "PLACE_STORE_NOT_AVAILABLE");
    }

    const limit = readRecentLimit(c.req.query("limit") ?? null);
    if (limit === null) return rejected(c, "MALFORMED");

    const result = await listRecentDestinations(deps.places, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      limit,
    });
    if (!result.ok) return rejected(c, result.error);

    return c.json({
      ok: true,
      destinations: result.value.destinations.map((d) => ({
        label: d.label,
        lat: d.lat,
        lng: d.lng,
        lastUsedAt: new Date(d.lastUsedAtMs).toISOString(),
      })),
    });
  });

  return app;
}
