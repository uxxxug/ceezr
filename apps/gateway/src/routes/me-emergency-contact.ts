/**
 * الغرض: مسارُ `GET/PUT /v1/me/emergency-contact` — قراءةُ وتحديثُ جهةِ
 *   الاتصالِ في الطوارئ لصاحبِ الجلسةِ (DEC-41).
 * الحالة: منفَّذ.
 * ينتمي إلى: apps/gateway/src/routes
 */

import { type Context, Hono } from "hono";
import type { MiniAppSessionReader } from "../../../../packages/application/identity/ports.ts";
import {
  type EmergencyContactDeps,
  type EmergencyContactPublicErrorCode,
  readEmergencyContact,
  upsertEmergencyContact,
} from "../../../../packages/application/safety/emergency-contact.ts";
import type {
  EmergencyContactReader,
  EmergencyContactWriter,
} from "../../../../packages/application/safety/ports.ts";
import { bearerTokenFrom } from "./me.ts";

export interface EmergencyContactRouteDependencies {
  readonly emergencyContact?: EmergencyContactDeps;
  readonly log?: (event: string, payload: Record<string, unknown>) => void;
}

const STATUS_BY_ERROR: Readonly<Record<EmergencyContactPublicErrorCode, 400 | 401 | 404 | 503>> = {
  SESSION_REQUIRED: 401,
  SESSION_REJECTED: 401,
  MALFORMED: 400,
  ACCOUNT_NOT_FOUND: 404,
  EMERGENCY_CONTACT_STORE_NOT_AVAILABLE: 503,
};

function rejected(c: Context, error: EmergencyContactPublicErrorCode) {
  return c.json({ ok: false, error }, STATUS_BY_ERROR[error]);
}

export function createEmergencyContactRoutes(deps: EmergencyContactRouteDependencies): Hono {
  const app = new Hono();

  // GET /v1/me/emergency-contact
  app.get("/v1/me/emergency-contact", async (c) => {
    if (deps.emergencyContact === undefined) {
      deps.log?.("emergency_contact.route_disabled", {});
      return c.json({ ok: false, error: "EMERGENCY_CONTACT_STORE_NOT_AVAILABLE" }, 503);
    }

    const accessToken = bearerTokenFrom(c.req.header("Authorization"));
    const result = await readEmergencyContact(deps.emergencyContact, { accessToken });
    if (!result.ok) return rejected(c, result.error);

    const contact = result.value;
    return c.json({
      ok: true,
      name: contact?.name ?? null,
      phone: contact?.phone ?? null,
    });
  });

  // PUT /v1/me/emergency-contact
  app.put("/v1/me/emergency-contact", async (c) => {
    if (deps.emergencyContact === undefined || deps.emergencyContact.writer === undefined) {
      deps.log?.("emergency_contact.route_disabled", {});
      return c.json({ ok: false, error: "EMERGENCY_CONTACT_STORE_NOT_AVAILABLE" }, 503);
    }

    const accessToken = bearerTokenFrom(c.req.header("Authorization"));

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "MALFORMED" }, 400);
    }

    const result = await upsertEmergencyContact(deps.emergencyContact, { accessToken, body });
    if (!result.ok) return rejected(c, result.error);

    return c.json({ ok: true, status: "saved" });
  });

  return app;
}

export type { EmergencyContactReader, EmergencyContactWriter, MiniAppSessionReader };
