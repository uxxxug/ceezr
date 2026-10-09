/**
 * الغرض: مساراتُ التسجيلِ من التطبيقِ المصغَّرِ — `GET /v1/onboarding` (الجمهورُ والمدنُ وإثباتُ
 *   الرقم) و`POST /v1/onboarding/rider` (الاسمُ والمدينةُ) و`POST /v1/onboarding/driver`
 *   (`PRD-105` · `ADR 0257`). بها لا يحتاجُ الجديدُ إلى حوارِ البوتِ ليبدأَ (`ADR 0213` · `DEC-22`).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/server.ts · apps/miniapp/src/surfaces/onboarding
 *
 * المسارُ رقيقٌ عمداً: المصادقةُ والتحقّقُ والكتابةُ في `packages/application/identity/onboard-rider.ts`،
 * وهنا ترجمةُ النتيجةِ إلى رمزِ حالةٍ فقط. والهويّةُ من الرمزِ (`bearerTokenFrom`) لا من الجسمِ.
 */

import { type Context, Hono } from "hono";
import {
  type DriverOnboardingDeps,
  onboardDriver,
} from "../../../../packages/application/identity/onboard-driver.ts";
import {
  type OnboardingDeps,
  type OnboardingErrorCode,
  onboardRider,
  readOnboardingStatus,
} from "../../../../packages/application/identity/onboard-rider.ts";
import { bearerTokenFrom } from "./me.ts";

export interface OnboardingRouteDependencies {
  readonly onboarding?: OnboardingDeps;
  /** غيابُه ⇒ `POST /v1/onboarding/driver` يُردُّ `503` صريحاً لا تسجيلٌ بلا إثباتِ رقم. */
  readonly driverOnboarding?: DriverOnboardingDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/** حدُّ الجسمِ: اسمٌ ومدينةٌ ولغةٌ (وللسائقِ خدمةٌ ومركبةٌ ولوحةٌ وهويّةٌ) — أقلُّ من كيلوبايتين. */
export const ONBOARDING_MAX_BYTES = 2 * 1024;

const ERROR_STATUS: Readonly<Record<OnboardingErrorCode, 400 | 401 | 403 | 409 | 503>> = {
  SESSION_REQUIRED: 401,
  SESSION_INVALID: 401,
  SESSION_EXPIRED: 401,
  SESSION_NOT_AVAILABLE: 503,
  ACCOUNT_BLOCKED: 403,
  PROFILE_NOT_AVAILABLE: 503,
  ALREADY_REGISTERED: 409,
  ONBOARDING_IN_BOT: 409,
  NAME_INVALID: 400,
  CITY_NOT_AVAILABLE: 400,
  CITIES_NOT_AVAILABLE: 503,
  REGISTRATION_FAILED: 503,
  WRONG_AUDIENCE: 409,
  PHONE_NOT_VERIFIED: 409,
  SERVICE_INVALID: 400,
  VEHICLE_TYPE_INVALID: 400,
  PLATE_INVALID: 400,
  NATIONAL_ID_INVALID: 400,
  NATIONAL_ID_TAKEN: 409,
};

/** الرموزُ التي يُلحَقُ بها سببُها: `NAME_TOO_SHORT` · `PLATE_MISSING_DIGITS` · `NATIONAL_ID_BAD_PREFIX`. */
const REASON_PREFIX: Partial<Record<OnboardingErrorCode, string>> = {
  NAME_INVALID: "NAME",
  PLATE_INVALID: "PLATE",
  NATIONAL_ID_INVALID: "NATIONAL_ID",
};

/**
 * سببُ رفضِ الاسمِ يُرمَّزُ في الرمزِ نفسِه (`NAME_TOO_SHORT` …) لا في حقلٍ جانبيٍّ: العميلُ يبني
 * قرارَه على `error` وحدَه ولا يقرأُ نصَّ رسالةٍ (`apps/miniapp/src/api/client.ts`).
 */
export function publicOnboardingCode(code: OnboardingErrorCode, reason?: string): string {
  const prefix = REASON_PREFIX[code];
  return prefix !== undefined && reason !== undefined ? `${prefix}_${reason.toUpperCase()}` : code;
}

function rejected(c: Context, code: OnboardingErrorCode, reason?: string) {
  return c.json({ ok: false, error: publicOnboardingCode(code, reason) }, ERROR_STATUS[code]);
}

export function createOnboardingRoutes(deps: OnboardingRouteDependencies): Hono {
  const app = new Hono();

  app.get("/v1/onboarding", async (c) => {
    if (deps.onboarding === undefined) {
      deps.log?.("onboarding.route_disabled", {});
      return rejected(c, "SESSION_NOT_AVAILABLE");
    }
    const accessToken = bearerTokenFrom(c.req.header("authorization"));
    const status = await readOnboardingStatus(accessToken, deps.onboarding);
    if (!status.ok) return rejected(c, status.error.code);
    return c.json({ ok: true, ...status.value });
  });

  app.post("/v1/onboarding/rider", async (c) => {
    if (deps.onboarding === undefined) {
      deps.log?.("onboarding.route_disabled", {});
      return rejected(c, "SESSION_NOT_AVAILABLE");
    }
    const declared = Number(c.req.header("content-length") ?? Number.NaN);
    if (Number.isFinite(declared) && declared > ONBOARDING_MAX_BYTES) {
      return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    }
    const accessToken = bearerTokenFrom(c.req.header("authorization"));
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ ok: false, error: "INVALID_BODY" }, 400);
    }
    const result = await onboardRider(
      {
        accessToken,
        fullName: body.fullName,
        cityId: body.cityId,
        language: body.language,
      },
      deps.onboarding,
    );
    if (!result.ok) return rejected(c, result.error.code, result.error.reason);
    return c.json({ ok: true, cityName: result.value.cityName }, 201);
  });

  app.post("/v1/onboarding/driver", async (c) => {
    if (deps.driverOnboarding === undefined) {
      deps.log?.("onboarding.driver_route_disabled", {});
      return rejected(c, "SESSION_NOT_AVAILABLE");
    }
    const declared = Number(c.req.header("content-length") ?? Number.NaN);
    if (Number.isFinite(declared) && declared > ONBOARDING_MAX_BYTES) {
      return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    }
    const accessToken = bearerTokenFrom(c.req.header("authorization"));
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ ok: false, error: "INVALID_BODY" }, 400);
    }
    // لا `phone` ولا `verificationStatus` ولا `role` من الجسم: تُتجاهَلُ إن أُرسِلَت.
    const result = await onboardDriver(
      {
        accessToken,
        fullName: body.fullName,
        cityId: body.cityId,
        service: body.service,
        vehicleType: body.vehicleType,
        plateNumber: body.plateNumber,
        nationalId: body.nationalId,
        language: body.language,
      },
      deps.driverOnboarding,
    );
    if (!result.ok) return rejected(c, result.error.code, result.error.reason);
    return c.json({ ok: true, cityName: result.value.cityName, verification: "pending" }, 201);
  });

  return app;
}
