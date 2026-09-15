/**
 * الغرض: مساراتُ مركبةِ السائقِ — `GET /v1/driver/vehicle` و
 *   `PATCH /v1/driver/vehicle` و`POST /v1/driver/vehicle/assets` (`F3-07` · `SD-11`).
 * الحالة: مبنيٌّ — البند `F3-07`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ.
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ## وما لا تفعلُه هذه المساراتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تقرأُ معرّفَ سائقٍ من الطلبِ**: من الرمزِ الموقَّعِ وحدَه.
 *   ــ **لا ترفعُ بايتاً**: رفعُ الشعارِ والباركودِ يمرُّ عبرَ `F3-01`.
 *   ــ **لا تُولِّدُ باركوداً**: توليدُهُ من الشعارِ عملُ عرضٍ في الشاشةِ.
 */

import { type Context, Hono } from "hono";
import {
  type DriverVehicleDeps,
  readDriverVehicle,
  updateDriverVehicle,
  updateDriverVehicleAssets,
} from "../../../../packages/application/driver/driver-vehicle.ts";

export interface DriverVehicleRouteDependencies {
  readonly vehicle?: DriverVehicleDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

const STATUS_BY_CODE: Readonly<Record<string, 401 | 403 | 422 | 503>> = {
  SESSION_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  SESSION_INVALID: 401,
  SESSION_NOT_AVAILABLE: 503,
  VEHICLE_STORE_NOT_AVAILABLE: 503,
  YEAR_INVALID: 422,
  USER_NOT_FOUND: 403,
  NOT_A_DRIVER: 403,
  CITY_NOT_READY: 503,
};

function rejected(c: Context, code: string) {
  const status = STATUS_BY_CODE[code] ?? 503;
  return c.json({ error: code }, status as 401 | 403 | 422 | 503);
}

function failClosed(c: Context, log?: (m: string, m2: Record<string, unknown>) => void) {
  log?.("driver-vehicle routes unavailable — deps not wired", {});
  return rejected(c, "VEHICLE_STORE_NOT_AVAILABLE");
}

function bearerTokenFrom(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7);
  return header;
}

export function createDriverVehicleRoutes(deps: DriverVehicleRouteDependencies): Hono {
  const vehicle = new Hono();

  vehicle.get("/", async (c) => {
    if (deps.vehicle === undefined) return failClosed(c, deps.log);
    const result = await readDriverVehicle(deps.vehicle, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
    });
    if (!result.ok) return rejected(c, result.error.code);
    if (result.value === null) return c.json(null, 200);
    return c.json(result.value, 200);
  });

  vehicle.patch("/", async (c) => {
    if (deps.vehicle === undefined) return failClosed(c, deps.log);
    const body = await c.req.json().catch(() => ({}));
    const input = {
      vehicleType: typeof body.vehicleType === "string" ? body.vehicleType : null,
      plateNumber: typeof body.plateNumber === "string" ? body.plateNumber : null,
      vehicleYear: typeof body.vehicleYear === "number" ? body.vehicleYear : null,
    };
    const result = await updateDriverVehicle(deps.vehicle, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      body: input,
    });
    if (!result.ok) return rejected(c, result.error.code);
    return c.json({ ok: true }, 200);
  });

  vehicle.post("/assets", async (c) => {
    if (deps.vehicle === undefined) return failClosed(c, deps.log);
    const body = await c.req.json().catch(() => ({}));
    const logoPath = typeof body.logoObjectPath === "string" ? body.logoObjectPath : null;
    const barcodePath = typeof body.barcodeObjectPath === "string" ? body.barcodeObjectPath : null;
    const result = await updateDriverVehicleAssets(deps.vehicle, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      logoPath,
      barcodePath,
    });
    if (!result.ok) return rejected(c, result.error.code);
    return c.json({ ok: true }, 200);
  });

  return vehicle;
}
