/**
 * الغرض: مسار استقبال تحديثات GPS من بوت السائق أو الواجهة.
 *   POST /track/gps — يستقبل موقع السائق ويمرّره عبر TrackingService.
 *   GET /track/:driverId — يقرأ الموقع الحالي للسائق (للواجهة).
 * الحالة: منفّذ فعلياً — المرحلة 7.
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: الواجهة الأمامية، بوت السائق
 */

import { Hono } from "hono";
import type { TrackingService, LocationStore } from "../../../../packages/tracking/index.ts";

export interface TrackingRouteDeps {
  readonly tracking: TrackingService;
  readonly store: LocationStore;
  readonly log?: (message: string, meta?: Record<string, unknown>) => void;
}

export function createTrackingRoutes(deps: TrackingRouteDeps): Hono {
  const app = new Hono();

  /**
   * POST /track/gps
   * Body: { driverId, tripId?, lat, lng, heading?, speed?, accuracy?, timestamp }
   */
  app.post("/gps", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "INVALID_JSON" }, 400);
    }

    const driverId = String(body.driverId ?? "");
    const lat = Number(body.lat);
    const lng = Number(body.lng);

    if (driverId === "" || Number.isNaN(lat) || Number.isNaN(lng)) {
      return c.json({ ok: false, error: "MISSING_REQUIRED_FIELDS" }, 400);
    }

    const tripId = body.tripId !== undefined && body.tripId !== null
      ? String(body.tripId)
      : null;

    const heading = body.heading !== undefined ? Number(body.heading) : undefined;
    const speed = body.speed !== undefined ? Number(body.speed) : undefined;
    const accuracy = body.accuracy !== undefined ? Number(body.accuracy) : undefined;

    const update: import("../../../../packages/tracking/types.ts").GpsUpdate = {
      driverId,
      tripId,
      position: { lat, lng },
      timestamp: body.timestamp !== undefined ? Number(body.timestamp) : Date.now(),
      ...(heading !== undefined ? { heading } : {}),
      ...(speed !== undefined ? { speed } : {}),
      ...(accuracy !== undefined ? { accuracy } : {}),
    };

    const result = await deps.tracking.handleGpsUpdate(update);

    if (!result.accepted) {
      deps.log?.("GPS update rejected", { driverId, reason: result.reason });
      return c.json({ ok: false, error: result.reason ?? "REJECTED" }, 422);
    }

    return c.json({ ok: true });
  });

  /**
   * GET /track/:driverId — يقرأ الموقع الحالي للسائق.
   */
  app.get("/:driverId", async (c) => {
    const driverId = c.req.param("driverId");
    const current = await deps.store.getCurrent(driverId);
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
   * Body: { driverId, tripId? }
   */
  app.post("/session/start", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "INVALID_JSON" }, 400);
    }

    const driverId = String(body.driverId ?? "");
    const tripId = body.tripId !== undefined && body.tripId !== null
      ? String(body.tripId)
      : null;

    if (driverId === "") {
      return c.json({ ok: false, error: "MISSING_DRIVER_ID" }, 400);
    }

    await deps.tracking.startSession(driverId, tripId);
    return c.json({ ok: true });
  });

  /**
   * POST /track/session/end — ينهي جلسة تتبّع.
   * Body: { driverId, tripId? }
   */
  app.post("/session/end", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "INVALID_JSON" }, 400);
    }

    const driverId = String(body.driverId ?? "");
    const tripId = body.tripId !== undefined && body.tripId !== null
      ? String(body.tripId)
      : null;

    if (driverId === "") {
      return c.json({ ok: false, error: "MISSING_DRIVER_ID" }, 400);
    }

    await deps.tracking.endSession(driverId, tripId);
    return c.json({ ok: true });
  });

  return app;
}
