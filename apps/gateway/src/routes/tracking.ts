/**
 * الغرض: مسار استقبال تحديثات GPS من بوت السائق أو الواجهة.
 *   POST /track/gps — يستقبل موقع السائق ويمرّره عبر TrackingService.
 *   GET /track/:driverId — يقرأ الموقع الحالي للسائق (للواجهة).
 *   POST /track/session/start — يبدأ جلسة تتبّع.
 *   POST /track/session/end — ينهي جلسة تتبّع.
 *
 * الأمن: كل مسار يطلب رمز تتبّع صالح في ترويسة Authorization: Bearer <token>.
 *   driverId يُشتقّ من الرمز لا من body — لا يمكن للعميل انتحال هوية سائق آخر.
 *
 * الحالة: منفّذ فعلياً — المرحلة P0 (أمن التتبّع).
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: الواجهة الأمامية، بوت السائق
 */

import { Hono } from "hono";
import type { LocationStore, TrackingService } from "../../../../packages/tracking/index.ts";
import {
  extractBearerToken,
  type TrackingAuthResult,
  type TrackingTokenStore,
  toAuthResult,
} from "../../../../packages/tracking/index.ts";
import type { GpsUpdate } from "../../../../packages/tracking/types.ts";

export interface TrackingRouteDeps {
  readonly tracking: TrackingService;
  readonly store: LocationStore;
  readonly tokenStore: TrackingTokenStore;
  readonly log?: (message: string, meta?: Record<string, unknown>) => void;
}

/** مدة صلاحية رمز التتبّع بالثواني (8 ساعات). */
const TRACKING_TOKEN_TTL_SECONDS = 28800;

const UNAUTHORIZED_STATUS = 401 as const;

function authErrorResponse(result: Extract<TrackingAuthResult, { ok: false }>): string {
  return result.error;
}

export function createTrackingRoutes(deps: TrackingRouteDeps): Hono {
  const app = new Hono();

  /**
   * مصادقة: تستخرج الرمز من الترويسة وتتحقق منه.
   * تُرجع الهوية أو تستجيب بـ 401 مباشرة.
   */
  async function requireAuth(
    c: import("hono").Context,
  ): Promise<
    { ok: true; driverId: string; tripId: string | null } | { ok: false; response: Response }
  > {
    const authHeader = c.req.header("authorization");
    const token = extractBearerToken(authHeader);
    if (token === null) {
      return { ok: false, response: c.json({ ok: false, error: "MISSING_TOKEN" }, 401) };
    }
    const payload = await deps.tokenStore.verify(token);
    const result = toAuthResult(payload);
    if (!result.ok) {
      return {
        ok: false,
        response: c.json({ ok: false, error: authErrorResponse(result) }, UNAUTHORIZED_STATUS),
      };
    }
    return { ok: true, driverId: result.payload.driverId, tripId: result.payload.tripId };
  }

  /**
   * POST /track/gps
   * Body: { lat, lng, heading?, speed?, accuracy?, timestamp }
   * driverId يُشتقّ من الرمز لا من body.
   */
  app.post("/gps", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) return auth.response;

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "INVALID_JSON" }, 400);
    }

    const lat = Number(body.lat);
    const lng = Number(body.lng);

    // `Number.isNaN` وحدها كانت تُمرّر Infinity: `Number("Infinity")` ليس NaN.
    // الحدود والمدى يفحصهما المجال بعدُ، وهذا فحص شكل المدخل لا صحّته الجغرافية.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return c.json({ ok: false, error: "MISSING_REQUIRED_FIELDS" }, 400);
    }

    // منع العميل من تحديد driverId في body — الهوية من الرمز فقط
    if (body.driverId !== undefined && String(body.driverId) !== auth.driverId) {
      deps.log?.("GPS update with mismatched driverId in body", {
        tokenDriverId: auth.driverId,
        bodyDriverId: body.driverId,
      });
      return c.json({ ok: false, error: "DRIVER_ID_MISMATCH" }, 403);
    }

    const heading = body.heading !== undefined ? Number(body.heading) : undefined;
    const speed = body.speed !== undefined ? Number(body.speed) : undefined;
    const accuracy = body.accuracy !== undefined ? Number(body.accuracy) : undefined;

    const update: GpsUpdate = {
      driverId: auth.driverId,
      tripId: auth.tripId,
      position: { lat, lng },
      timestamp: body.timestamp !== undefined ? Number(body.timestamp) : Date.now(),
      ...(heading !== undefined ? { heading } : {}),
      ...(speed !== undefined ? { speed } : {}),
      ...(accuracy !== undefined ? { accuracy } : {}),
    };

    const result = await deps.tracking.handleGpsUpdate(update);

    // الرموز مُعرَّفة لا نصوص حرّة: العميل يستطيع التفريع عليها، والسجلّ يُجمَّع بها.
    const rejections = result.assessment.findings
      .filter((f) => f.severity === "REJECT")
      .map((f) => f.code);

    if (!result.accepted) {
      deps.log?.("GPS update rejected", { driverId: auth.driverId, reasons: rejections });
      return c.json({ ok: false, error: "REJECTED", reasons: rejections }, 422);
    }

    // المقبول بتحفّظ يُبلَّغ به العميل: تطبيق السائق يستطيع أن يطلب إصلاحة أدقّ
    // بدل أن يظنّ موقعه سليماً. الحجب الصامت للجودة يُخفي عن الطرفين ما يخصّهما.
    return c.json({
      ok: true,
      quality: result.assessment.verdict,
      findings: result.assessment.findings.map((f) => f.code),
    });
  });

  /**
   * GET /track/:driverId — يقرأ الموقع الحالي للسائق.
   * يتطلب رمزاً صالحاً. لا يمكن قراءة موقع سائق آخر.
   */
  app.get("/:driverId", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) return auth.response;

    // منع قراءة موقع سائق آخر
    const requestedDriverId = c.req.param("driverId");
    if (requestedDriverId !== auth.driverId) {
      deps.log?.("Attempted to read another driver's location", {
        tokenDriverId: auth.driverId,
        requestedDriverId,
      });
      return c.json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const current = await deps.store.getCurrent(auth.driverId);
    if (current === null) {
      return c.json({ ok: false, error: "NO_LOCATION" }, 404);
    }
    return c.json({
      ok: true,
      position: current.position,
      timestamp: current.timestamp,
      metadata: current.metadata,
    });
  });

  /**
   * POST /track/session/start — يبدأ جلسة تتبّع.
   * يصدر رمزاً جديداً مرتبطاً بالسائق والرحلة.
   * Body: { tripId? }
   */
  app.post("/session/start", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) return auth.response;

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    const tripId = body.tripId !== undefined && body.tripId !== null ? String(body.tripId) : null;

    await deps.tracking.startSession(auth.driverId, tripId);

    // إصدار رمز جديد مرتبط بالرحلة
    const token = await deps.tokenStore.issue(auth.driverId, tripId, TRACKING_TOKEN_TTL_SECONDS);

    return c.json({ ok: true, token });
  });

  /**
   * POST /track/session/end — ينهي جلسة تتبّع.
   * يُبطل الرمز. لا يقبل driverId من body.
   */
  app.post("/session/end", async (c) => {
    const auth = await requireAuth(c);
    if (!auth.ok) return auth.response;

    await deps.tracking.endSession(auth.driverId, auth.tripId);

    // إبطال الرمز المستخدم
    const token = extractBearerToken(c.req.header("authorization"));
    if (token !== null) {
      await deps.tokenStore.revoke(token);
    }

    return c.json({ ok: true });
  });

  return app;
}
