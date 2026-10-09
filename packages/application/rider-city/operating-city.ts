/**
 * الغرض: المدينةُ التشغيليّةُ للراكبِ من آخرِ موقعٍ صالح (R1 · ADR 0252) — قراءتُها، وتحديثُها
 *   بنقطةٍ يرسلُها العميلُ فتحكمُ القاعدةُ بالمدينةِ المفعَّلةِ التي تغطّيها. لا اختيارَ يدويّاً
 *   ولا مدينةَ من المُدخَل، ولا حقلَ جديداً في `GET /v1/me`.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: application/rider-city
 */

import type { Result } from "../../shared/result/index.ts";
import { err, ok } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";

export interface OperatingCity {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly isActive: boolean;
}

export type LocateOutcome = "CHANGED" | "SAME_CITY" | "OUTSIDE_ACTIVE_CITIES" | "ACTIVE_RIDE";

export interface OperatingCityStoreFailure {
  readonly code: "OPERATING_CITY_STORE_FAILED";
  readonly reason: "STORE_ERROR" | "USER_NOT_FOUND" | "NOT_A_RIDER" | "INVALID_POINT";
}

export interface OperatingCityStore {
  read(telegramUserId: string): Promise<Result<OperatingCity | null, OperatingCityStoreFailure>>;
  locate(input: {
    readonly telegramUserId: string;
    readonly lat: number;
    readonly lng: number;
  }): Promise<
    Result<
      { readonly outcome: LocateOutcome; readonly city: OperatingCity | null },
      OperatingCityStoreFailure
    >
  >;
}

export interface OperatingCityDeps {
  readonly sessions: MiniAppSessionReader;
  readonly store: OperatingCityStore;
  readonly now: () => Date;
}

export type OperatingCityPublicErrorCode =
  | "SESSION_REQUIRED"
  | "SESSION_REJECTED"
  | "MALFORMED"
  | "INVALID_POINT"
  | "ACCOUNT_NOT_FOUND"
  | "NOT_A_RIDER"
  | "OPERATING_CITY_STORE_NOT_AVAILABLE";

async function authenticate(
  deps: OperatingCityDeps,
  accessToken: string | undefined,
): Promise<Result<string, OperatingCityPublicErrorCode>> {
  if (accessToken === undefined || accessToken === "") return err("SESSION_REQUIRED");
  const session = await deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err("SESSION_REJECTED");
  return ok(session.value.telegramUserId);
}

function publicError(failure: OperatingCityStoreFailure): OperatingCityPublicErrorCode {
  switch (failure.reason) {
    case "USER_NOT_FOUND":
      return "ACCOUNT_NOT_FOUND";
    case "NOT_A_RIDER":
      return "NOT_A_RIDER";
    case "INVALID_POINT":
      return "INVALID_POINT";
    default:
      return "OPERATING_CITY_STORE_NOT_AVAILABLE";
  }
}

/** نقطةٌ صالحةٌ: عددانِ منتهيانِ في مداهما. والحكمُ نفسُه يُعادُ في القاعدة. */
export function parsePoint(body: unknown): { readonly lat: number; readonly lng: number } | null {
  if (typeof body !== "object" || body === null) return null;
  const { lat, lng } = body as Record<string, unknown>;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export async function readOperatingCity(
  deps: OperatingCityDeps,
  input: { readonly accessToken: string | undefined },
): Promise<Result<OperatingCity | null, OperatingCityPublicErrorCode>> {
  const identified = await authenticate(deps, input.accessToken);
  if (!identified.ok) return identified;
  const result = await deps.store.read(identified.value);
  if (!result.ok) return err(publicError(result.error));
  return ok(result.value);
}

export async function locateOperatingCity(
  deps: OperatingCityDeps,
  input: { readonly accessToken: string | undefined; readonly body: unknown },
): Promise<
  Result<
    { readonly outcome: LocateOutcome; readonly city: OperatingCity | null },
    OperatingCityPublicErrorCode
  >
> {
  const identified = await authenticate(deps, input.accessToken);
  if (!identified.ok) return identified;
  if (typeof input.body !== "object" || input.body === null) return err("MALFORMED");
  const point = parsePoint(input.body);
  if (point === null) return err("INVALID_POINT");
  const result = await deps.store.locate({ telegramUserId: identified.value, ...point });
  if (!result.ok) return err(publicError(result.error));
  return ok(result.value);
}
