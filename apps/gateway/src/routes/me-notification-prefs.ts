/**
 * الغرض: مسارُ `GET/PUT /v1/me/notification-preferences` — قراءةُ وتحديثُ
 *   تفضيلاتِ الإشعاراتِ غيرِ التشغيليّةِ لصاحبِ الجلسةِ (DEC-42).
 * الحالة: منفَّذ.
 * ينتمي إلى: apps/gateway/src/routes
 */

import { type Context, Hono } from "hono";
import {
  type NotificationPrefsDeps,
  type NotificationPrefsPublicErrorCode,
  readNotificationPrefs,
  upsertNotificationPrefs,
} from "../../../../packages/application/safety/notification-prefs.ts";
import { bearerTokenFrom } from "./me.ts";

export interface NotificationPrefsRouteDependencies {
  readonly notificationPrefs?: NotificationPrefsDeps;
  readonly log?: (event: string, payload: Record<string, unknown>) => void;
}

const STATUS_BY_ERROR: Readonly<Record<NotificationPrefsPublicErrorCode, 400 | 401 | 404 | 503>> = {
  SESSION_REQUIRED: 401,
  SESSION_REJECTED: 401,
  MALFORMED: 400,
  ACCOUNT_NOT_FOUND: 404,
  NOTIFICATION_PREFS_STORE_NOT_AVAILABLE: 503,
};

function rejected(c: Context, error: NotificationPrefsPublicErrorCode) {
  return c.json({ ok: false, error }, STATUS_BY_ERROR[error]);
}

export function createNotificationPrefsRoutes(deps: NotificationPrefsRouteDependencies): Hono {
  const app = new Hono();

  // GET /v1/me/notification-preferences
  app.get("/v1/me/notification-preferences", async (c) => {
    if (deps.notificationPrefs === undefined) {
      deps.log?.("notification_prefs.route_disabled", {});
      return c.json({ ok: false, error: "NOTIFICATION_PREFS_STORE_NOT_AVAILABLE" }, 503);
    }

    const accessToken = bearerTokenFrom(c.req.header("Authorization"));
    const result = await readNotificationPrefs(deps.notificationPrefs, { accessToken });
    if (!result.ok) return rejected(c, result.error);

    const prefs = result.value;
    return c.json({
      ok: true,
      offersEnabled: prefs?.offersEnabled ?? true,
      updatesEnabled: prefs?.updatesEnabled ?? true,
    });
  });

  // PUT /v1/me/notification-preferences
  app.put("/v1/me/notification-preferences", async (c) => {
    if (deps.notificationPrefs === undefined || deps.notificationPrefs.writer === undefined) {
      deps.log?.("notification_prefs.route_disabled", {});
      return c.json({ ok: false, error: "NOTIFICATION_PREFS_STORE_NOT_AVAILABLE" }, 503);
    }

    const accessToken = bearerTokenFrom(c.req.header("Authorization"));

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "MALFORMED" }, 400);
    }

    const result = await upsertNotificationPrefs(deps.notificationPrefs, { accessToken, body });
    if (!result.ok) return rejected(c, result.error);

    return c.json({ ok: true, status: "saved" });
  });

  return app;
}
