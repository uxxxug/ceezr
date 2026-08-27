/**
 * `LocationManager` adapter (Bot API 8.0+) — F1-02.
 *
 * Thin pass-through only: initialise, read one location, open the settings
 * sheet. No streaming policy, no cadence, no filtering, no persistence — the
 * adaptive broadcast of a driver's location is `F3-04` and is NOT implemented
 * here. Telegram's snake_case `LocationData` is mapped to a neutral shape so no
 * Telegram-specific type escapes `tg/` (ADR 0035 §2).
 */

import { resolveCapability } from "./capabilities.ts";
import type { TgLocationDataLike } from "./host-types.ts";
import { type TgOutcome, tgOk, tgUnavailable } from "./outcome.ts";

export type TgLocation = {
  latitude: number;
  longitude: number;
  altitude: number | null;
  course: number | null;
  speed: number | null;
  horizontalAccuracy: number | null;
  verticalAccuracy: number | null;
  courseAccuracy: number | null;
  speedAccuracy: number | null;
};

export type TgLocationAccess = {
  inited: boolean;
  available: boolean;
  accessRequested: boolean;
  accessGranted: boolean;
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Maps Telegram's payload to the neutral shape; `null` when unusable. */
export function normalizeLocation(raw: unknown): TgLocation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const data = raw as Partial<TgLocationDataLike>;
  const latitude = num(data.latitude);
  const longitude = num(data.longitude);
  if (latitude === null || longitude === null) return null;
  return {
    latitude,
    longitude,
    altitude: num(data.altitude),
    course: num(data.course),
    speed: num(data.speed),
    horizontalAccuracy: num(data.horizontal_accuracy),
    verticalAccuracy: num(data.vertical_accuracy),
    courseAccuracy: num(data.course_accuracy),
    speedAccuracy: num(data.speed_accuracy),
  };
}

/** Location access state, or `null` when the capability is not usable. */
export function locationAccess(): TgLocationAccess | null {
  const gate = resolveCapability("location");
  if (gate.host === null) return null;
  const manager = gate.host.LocationManager;
  if (!manager) return null;
  return {
    inited: manager.isInited === true,
    available: manager.isLocationAvailable === true,
    accessRequested: manager.isAccessRequested === true,
    accessGranted: manager.isAccessGranted === true,
  };
}

/** Initialises `LocationManager`; resolves once Telegram reports it ready. */
export function initLocation(): Promise<TgOutcome<true>> {
  const gate = resolveCapability("location");
  if (gate.host === null) return Promise.resolve(tgUnavailable<true>(gate.reason));
  const manager = gate.host.LocationManager;
  if (!manager) return Promise.resolve(tgUnavailable<true>("missing-api"));
  return new Promise((resolve) => {
    try {
      manager.init(() => resolve(tgOk(true as const)));
    } catch (error) {
      resolve(tgUnavailable<true>("failed", String(error)));
    }
  });
}

/**
 * One location reading. Telegram passes `null` when access was not granted —
 * that is `declined`, not an error, and the caller decides the fallback
 * (ADR 0031 §4 names the browser Geolocation API as the fallback path; choosing
 * and wiring it is not this layer's decision).
 */
export function requestLocation(): Promise<TgOutcome<TgLocation>> {
  const gate = resolveCapability("location");
  if (gate.host === null) return Promise.resolve(tgUnavailable<TgLocation>(gate.reason));
  const manager = gate.host.LocationManager;
  if (!manager) return Promise.resolve(tgUnavailable<TgLocation>("missing-api"));
  return new Promise((resolve) => {
    try {
      manager.getLocation((data) => {
        const normalized = normalizeLocation(data);
        resolve(normalized === null ? tgUnavailable<TgLocation>("declined") : tgOk(normalized));
      });
    } catch (error) {
      resolve(tgUnavailable<TgLocation>("failed", String(error)));
    }
  });
}

/** Opens Telegram's location settings. Must be called from a user gesture. */
export function openLocationSettings(): TgOutcome<true> {
  const gate = resolveCapability("location");
  if (gate.host === null) return tgUnavailable<true>(gate.reason);
  const manager = gate.host.LocationManager;
  if (!manager) return tgUnavailable<true>("missing-api");
  try {
    manager.openSettings();
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}
