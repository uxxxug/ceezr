/**
 * الغرض: مساراتُ الرحلةِ — `POST /v1/rides` (ترويسةُ `Idempotency-Key`
 *   **إلزاميّةٌ**) و`GET /v1/rides/:id/search` (حالةٌ صادقةٌ) و
 *   `POST /v1/rides/:id/cancel` (إلغاءٌ بلا عقوبةٍ قبلَ الإسنادِ) —
 *   البند `F2-05` · `SR-05` · `ARCH-006`.
 * الحالة: منفَّذٌ فعليّاً — البند `F2-05`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ، وشاشةُ البحثِ
 *   في `apps/miniapp/src/surfaces/rider/search`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-06` يزيدُ `GET /v1/rides/:id` للرحلةِ النشطةِ على
 *   النسقِ نفسِه، و`F3` لا يزيدُ ههنا شيئاً: البثُّ عملُ عاملٍ لا مسارٍ.
 * ملاحظات مستقبلية: لا حقلَ أجرةٍ ولا وسيلةَ دفعٍ ولا عقوبةَ إلغاءٍ في أيِّ من
 *   هذه الحمولاتِ قبلَ `DEC-11` و`F12-16` (`ADR 0039` §٤ · `م13-7`).
 *
 * ## لماذا المفتاحُ ترويسةٌ لا حقلٌ في الجسمِ
 *
 * لأنَّه **صفةُ الأمرِ لا صفةُ الرحلةِ**: الرحلةُ لها مبدأٌ ومقصدٌ وخدمةٌ، وأمّا
 * «هذا نداءٌ واحدٌ لا نداءانِ» فشأنُ النقلِ. وترويسةُ `Idempotency-Key` عُرفٌ
 * مقروءٌ في الوسائطِ والوكلاءِ والسجلّاتِ، ويُقرأُ في المراجعةِ دونَ فتحِ الجسمِ.
 * وغيابُها **رمزٌ مُعلَنٌ** `IDEMPOTENCY_KEY_REQUIRED` بـ`400`، لا مفتاحٌ يختلقُه
 * الخادمُ — فمفتاحٌ جديدٌ لكلِّ نداءٍ يُبطِلُ `ARCH-006` نصّاً ومعنًى.
 *
 * ## ولماذا الرفضُ ههنا `200` والعطبُ `4xx`/`5xx`
 *
 * كما في `F2-03` و`F2-04`: «خارجَ منطقةِ الخدمةِ» و«لديكَ رحلةٌ قائمةٌ» **أجوبةٌ
 * صحيحةٌ** عن سؤالٍ صحيحٍ، وتُنشَرُ `200` بـ`accepted:false` ورمزٍ يُترجَمُ نصّاً
 * في الشاشةِ. وأمّا «لا ترويسةَ» و«جلسةٌ ساقطةٌ» و«المخزنُ معطَّلٌ» فعطبُ طلبٍ أو
 * بيئةٍ، ورمزُ الحالةِ فيها هوَ الجوابُ.
 *
 * ## ولماذا `reused` يُنشَرُ للعميلِ
 *
 * كي تعرفَ الشاشةُ أنَّ ضغطتَها الثانيةَ **لم تُنشئْ رحلةً ثانيةً** فتنتقلَ إلى
 * الرحلةِ القائمةِ بلا إنذارٍ مُخيفٍ. وطيُّه يجعلُ الإعادةَ تبدو إنشاءً جديداً،
 * فيُحسَبُ في أيِّ قياسٍ لاحقٍ رحلتَينِ حيثُ رحلةٌ واحدةٌ.
 *
 * ## وما لا تفعلُه هذه المساراتُ عن قصدٍ
 *
 *   ــ **لا تُسنِدُ سائقاً ولا تبثُّ عرضاً**: الإنشاءُ يُنتِجُ `searching` وحدَها.
 *   ــ **لا تقرأُ مدينةً ولا معرّفَ راكبٍ من الجسمِ**: الهويّةُ من الرمزِ الموقَّعِ
 *      والمدينةُ من صفِّ صاحبِ الحسابِ في القاعدةِ (القاعدة 0.4).
 *   ــ **لا تُعيدُ نصّاً معروضاً**: مفاتيحُ ورموزٌ وأعدادٌ وأختامٌ (القسم 9.11).
 *   ــ **لا تُفرِّقُ «ليسَ لك» من «غيرُ موجودٍ»**: `ORDER_NOT_FOUND` للأمرَينِ، كي
 *      لا يصيرَ المسارُ عدَّادَ معرّفاتٍ صحيحةً لمن يجرِّبُها.
 */

import { type Context, Hono } from "hono";
import {
  type CancelRideRequestDeps,
  cancelRideRequest,
} from "../../../../packages/application/transport/cancel-ride-request.ts";
import {
  type ReadActiveRideDeps,
  readActiveRide,
} from "../../../../packages/application/transport/read-active-ride.ts";
import {
  type ReadRideSearchDeps,
  readRideSearch,
} from "../../../../packages/application/transport/read-ride-search.ts";
import {
  type RequestRideDeps,
  type RequestRidePublicErrorCode,
  requestRide,
} from "../../../../packages/application/transport/request-ride.ts";
import { bearerTokenFrom } from "./me.ts";
import { readBounded } from "./telegram-webhook.ts";

export interface RidesRouteDependencies {
  /** غيابُها يُعطِّلُ الإنشاءَ بـ503 ولا يجعلُه يُجيبُ بلا كتابةٍ. */
  readonly request?: RequestRideDeps;
  readonly search?: ReadRideSearchDeps;
  /** قارئُ الرحلةِ النشطةِ (`F2-06`) — غيابُه يُعطِّلُ المسارَ بـ503 صادقاً. */
  readonly active?: ReadActiveRideDeps;
  readonly cancel?: CancelRideRequestDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/**
 * أربعةُ حقولٍ عشريّةٍ وخدمةٌ وملاحظةٌ حدُّها 280 محرفاً.
 *
 * و2048 بايتاً تكفي الملاحظةَ بالعربيّةِ في UTF-8 (ثلاثةُ بايتاتٍ للمحرفِ في
 * أسوأِ حالٍ شائعٍ) ولا تدعُ بابَ حمولةٍ كبيرةٍ مفتوحاً. حدُّ نقلٍ لا قيمةُ
 * منتَجٍ (القاعدة 0.3)، وحدُّ الملاحظةِ نفسُه في النطاقِ وفي القاعدةِ.
 */
export const RIDE_REQUEST_MAX_BYTES = 2048;

const STATUS_BY_ERROR: Readonly<Record<RequestRidePublicErrorCode, 400 | 401 | 404 | 503>> = {
  SESSION_REQUIRED: 401,
  SESSION_INVALID: 401,
  SESSION_EXPIRED: 401,
  SESSION_NOT_AVAILABLE: 503,
  MALFORMED: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_INVALID: 400,
  UNKNOWN_SERVICE: 400,
  NOTES_TOO_LONG: 400,
  // الجلسةُ صحيحةٌ ولا صفَّ مستخدمٍ: `404` لا `401`، ولا يُنشَأُ الصفُّ (`ADR 0035`).
  ACCOUNT_NOT_FOUND: 404,
  RIDER_NOT_REGISTERED: 404,
  RIDE_STORE_NOT_AVAILABLE: 503,
};

function rejected(c: Context, error: RequestRidePublicErrorCode) {
  return c.json({ ok: false, error }, STATUS_BY_ERROR[error]);
}

/** ترويسةُ المفتاحِ — تُقرأُ بالاسمِ المُعرَّفِ لا بأيِّ مرادفٍ. */
export const IDEMPOTENCY_HEADER = "idempotency-key";

export function createRidesRoutes(deps: RidesRouteDependencies): Hono {
  const app = new Hono();

  app.post("/v1/rides", async (c) => {
    if (deps.request === undefined) {
      deps.log?.("rides.create_disabled", {});
      return rejected(c, "RIDE_STORE_NOT_AVAILABLE");
    }

    const declaredLength = Number(c.req.header("content-length") ?? Number.NaN);
    if (Number.isFinite(declaredLength) && declaredLength > RIDE_REQUEST_MAX_BYTES) {
      return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    }
    const raw = await readBounded(c.req.raw.body, RIDE_REQUEST_MAX_BYTES);
    if (raw === null) return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ ok: false, error: "INVALID_JSON" }, 400);
    }

    const result = await requestRide(deps.request, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      idempotencyKey: c.req.header(IDEMPOTENCY_HEADER),
      body,
    });
    if (!result.ok) return rejected(c, result.error);

    const verdict = result.value;
    if (!verdict.accepted) {
      return c.json({
        ok: true,
        accepted: false as const,
        refusal: verdict.refusal,
        // طريقُ الخروجِ من الرفضِ يُنشَرُ معَه: رفضٌ بلا طريقٍ شاشةٌ مسدودةٌ.
        activeRide: verdict.activeRide,
      });
    }
    return c.json({
      ok: true,
      accepted: true as const,
      orderId: verdict.ride.orderId,
      createdAt: new Date(verdict.ride.createdAtMs).toISOString(),
      reused: verdict.ride.reused,
    });
  });

  app.get("/v1/rides/:id/search", async (c) => {
    if (deps.search === undefined) {
      deps.log?.("rides.search_disabled", {});
      return rejected(c, "RIDE_STORE_NOT_AVAILABLE");
    }

    const result = await readRideSearch(deps.search, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("id"),
    });
    if (!result.ok) return rejected(c, result.error);

    const read = result.value;
    if (!read.found) return c.json({ ok: true, found: false as const, refusal: read.refusal });

    const { state, phase, elapsedSeconds } = read.view;
    return c.json({
      ok: true,
      found: true as const,
      orderId: state.orderId,
      status: state.status,
      service: state.service,
      phase,
      broadcastRound: state.broadcastRound,
      createdAt: new Date(state.createdAtMs).toISOString(),
      // العددُ يُنشَرُ كما قاسَته القاعدةُ، **والصفرُ يُنشَرُ صفراً** (`ADR 0023`).
      notifiedDriverCount: state.notifiedDriverCount,
      elapsedSeconds,
      cancellableWithoutPenalty: state.cancellableWithoutPenalty,
    });
  });

  /**
   * لقطةُ الرحلةِ النشطةِ (`F2-06` · `SR-06`).
   *
   * **ولماذا لا يُنشَرُ موقعُ السائقِ إلّا معَ حكمِه**: الحكمُ (`show`) وسببُ
   * الحجبِ يُنشرانِ، ولا تُنشَرُ إحداثيّةٌ حُجِبَت. ولو نُشِرَت «للاحتياطِ» لَرسمَها
   * عميلٌ مستقبليٌّ يقرأُ الحقلَ ولا يقرأُ الحكمَ — فالحجبُ **في السلكِ** لا في
   * نيّةِ العميلِ.
   *
   * **ولا رقمَ هاتفٍ ولا رمزَ مشاركةٍ ولا زرَّ طوارئَ في هذا الردِّ**: `SR-06`
   * يطلبُها، ومساراتُها `F2-09` و`F2-10`، وحقلٌ فارغٌ لها اليومَ وعدٌ لا عقدٌ.
   */
  app.get("/v1/rides/:id", async (c) => {
    if (deps.active === undefined) {
      deps.log?.("rides.active_disabled", {});
      return rejected(c, "RIDE_STORE_NOT_AVAILABLE");
    }

    const result = await readActiveRide(deps.active, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("id"),
    });
    if (!result.ok) return rejected(c, result.error);

    const read = result.value;
    if (!read.found) return c.json({ ok: true, found: false as const, refusal: read.refusal });

    const { state, phase, position, eta, cancelPolicy, elapsedSeconds } = read.view;
    const driver = state.driver;
    return c.json({
      ok: true,
      found: true as const,
      orderId: state.orderId,
      status: state.status,
      service: state.service,
      phase,
      pickup: state.pickup,
      dropoff: state.dropoff,
      createdAt: new Date(state.createdAtMs).toISOString(),
      matchedAt: state.matchedAtMs === null ? null : new Date(state.matchedAtMs).toISOString(),
      startedAt: state.startedAtMs === null ? null : new Date(state.startedAtMs).toISOString(),
      completedAt:
        state.completedAtMs === null ? null : new Date(state.completedAtMs).toISOString(),
      elapsedSeconds,
      cancelPolicy,
      driver:
        driver === null
          ? null
          : {
              firstName: driver.firstName,
              vehicleType: driver.vehicleType,
              plateNumber: driver.plateNumber,
              // `null` = لا تقييمَ بعدُ، ولا يُستبدَلُ برقمٍ افتراضيٍّ.
              ratingAverage: driver.ratingAverage,
              ratingCount: driver.ratingCount,
            },
      position:
        position === null
          ? null
          : position.show
            ? {
                show: true as const,
                lat: position.position.lat,
                lng: position.position.lng,
                ageSeconds: position.ageSeconds,
              }
            : {
                show: false as const,
                reason: position.reason,
                ageSeconds: position.reason === "TOO_OLD" ? position.ageSeconds : null,
              },
      // المدّةُ حكمٌ مُصنَّفٌ لا رقمٌ عارٍ: `ROUTED` بدقائقِها، أو `UNAVAILABLE`
      // بسببِها — ولا صفرَ ولا شَرطةَ (`ADR 0024`).
      eta:
        eta === null
          ? null
          : eta.kind === "ROUTED"
            ? { kind: "ROUTED" as const, minutes: eta.minutes, source: eta.source }
            : { kind: "UNAVAILABLE" as const, reason: eta.reason },
    });
  });

  app.post("/v1/rides/:id/cancel", async (c) => {
    if (deps.cancel === undefined) {
      deps.log?.("rides.cancel_disabled", {});
      return rejected(c, "RIDE_STORE_NOT_AVAILABLE");
    }

    const result = await cancelRideRequest(deps.cancel, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      idempotencyKey: c.req.header(IDEMPOTENCY_HEADER),
      orderId: c.req.param("id"),
    });
    if (!result.ok) return rejected(c, result.error);

    const verdict = result.value;
    if (!verdict.cancelled) {
      return c.json({ ok: true, cancelled: false as const, refusal: verdict.refusal });
    }
    return c.json({ ok: true, cancelled: true as const });
  });

  return app;
}
