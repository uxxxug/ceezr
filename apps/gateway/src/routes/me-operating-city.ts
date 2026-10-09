/**
 * الغرض: `GET`/`POST /v1/me/operating-city` — المدينةُ التشغيليّةُ للراكبِ من آخرِ موقعٍ صالح
 *   (R1 · ADR 0252). `POST` يقبلُ `{ lat, lng }` وحدَهما؛ والمدينةُ حكمُ القاعدةِ لا مُدخَل.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/gateway/routes
 */

import { type Context, Hono } from "hono";
import {
  locateOperatingCity,
  type OperatingCity,
  type OperatingCityDeps,
  type OperatingCityPublicErrorCode,
  readOperatingCity,
} from "../../../../packages/application/rider-city/operating-city.ts";
import { bearerTokenFrom } from "./me.ts";

export interface OperatingCityRouteDependencies {
  readonly operatingCity?: OperatingCityDeps;
  readonly log?: (event: string, payload: Record<string, unknown>) => void;
}

type ErrorCode = OperatingCityPublicErrorCode;

const STATUS_BY_ERROR: Readonly<Record<ErrorCode, 400 | 401 | 403 | 404 | 422 | 503>> = {
  SESSION_REQUIRED: 401,
  SESSION_REJECTED: 401,
  MALFORMED: 400,
  INVALID_POINT: 422,
  ACCOUNT_NOT_FOUND: 404,
  NOT_A_RIDER: 403,
  OPERATING_CITY_STORE_NOT_AVAILABLE: 503,
};

function rejected(c: Context, error: OperatingCityPublicErrorCode) {
  return c.json({ ok: false, error }, STATUS_BY_ERROR[error]);
}

function cityJson(city: OperatingCity | null) {
  return city === null
    ? null
    : { code: city.code, name_ar: city.nameAr, name_en: city.nameEn, is_active: city.isActive };
}

export function createOperatingCityRoutes(deps: OperatingCityRouteDependencies): Hono {
  const app = new Hono();

  app.get("/v1/me/operating-city", async (c) => {
    if (deps.operatingCity === undefined) {
      deps.log?.("operating_city.route_disabled", {});
      return c.json({ ok: false, error: "OPERATING_CITY_STORE_NOT_AVAILABLE" }, 503);
    }
    const accessToken = bearerTokenFrom(c.req.header("Authorization"));
    const result = await readOperatingCity(deps.operatingCity, { accessToken });
    if (!result.ok) return rejected(c, result.error);
    return c.json({ ok: true, city: cityJson(result.value) });
  });

  app.post("/v1/me/operating-city", async (c) => {
    if (deps.operatingCity === undefined) {
      deps.log?.("operating_city.route_disabled", {});
      return c.json({ ok: false, error: "OPERATING_CITY_STORE_NOT_AVAILABLE" }, 503);
    }
    const accessToken = bearerTokenFrom(c.req.header("Authorization"));
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "MALFORMED" }, 400);
    }
    const result = await locateOperatingCity(deps.operatingCity, { accessToken, body });
    if (!result.ok) return rejected(c, result.error);
    return c.json({ ok: true, outcome: result.value.outcome, city: cityJson(result.value.city) });
  });

  return app;
}
