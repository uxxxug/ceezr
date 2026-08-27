/**
 * Telegram event subscription (F1-02).
 *
 * `onEvent`/`offEvent` are never called from outside this module. Subscribing
 * returns an unsubscribe function, so no caller has to hold the raw handler that
 * Telegram needs for `offEvent` — the commonest leak of a Telegram detail into
 * product code.
 *
 * Only the events adopted in the design (ROADMAP §4.4) are exposed. Payloads are
 * normalised to neutral shapes: Telegram's snake_case never leaves `tg/`.
 * `invoiceClosed` is deliberately absent — payment is out of scope entirely.
 */

import { normalizeLocation, type TgLocation } from "./location.ts";
import { getWebApp } from "./webapp.ts";

export type TgPermissionStatus = "allowed" | "cancelled" | "sent" | "unknown";

export type TgEventPayloadMap = {
  activated: null;
  deactivated: null;
  themeChanged: null;
  viewportChanged: { isStateStable: boolean };
  safeAreaChanged: null;
  contentSafeAreaChanged: null;
  mainButtonClicked: null;
  secondaryButtonClicked: null;
  backButtonClicked: null;
  settingsButtonClicked: null;
  popupClosed: { buttonId: string | null };
  qrTextReceived: { text: string };
  scanQrPopupClosed: null;
  writeAccessRequested: { status: TgPermissionStatus };
  contactRequested: { status: TgPermissionStatus };
  biometricManagerUpdated: null;
  biometricAuthRequested: { isAuthenticated: boolean };
  biometricTokenUpdated: { isUpdated: boolean };
  fullscreenChanged: null;
  fullscreenFailed: { error: string };
  homeScreenAdded: null;
  homeScreenChecked: { status: string };
  locationManagerUpdated: null;
  locationRequested: { location: TgLocation | null };
};

export type TgEventName = keyof TgEventPayloadMap;

/** Unsubscribe handle. Calling it twice is safe. */
export type TgUnsubscribe = () => void;

function record(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : {};
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function permissionStatus(value: unknown): TgPermissionStatus {
  return value === "allowed" || value === "cancelled" || value === "sent" ? value : "unknown";
}

const NORMALIZERS: {
  [K in TgEventName]: (payload: unknown) => TgEventPayloadMap[K];
} = {
  activated: () => null,
  deactivated: () => null,
  themeChanged: () => null,
  viewportChanged: (p) => ({ isStateStable: record(p).isStateStable === true }),
  safeAreaChanged: () => null,
  contentSafeAreaChanged: () => null,
  mainButtonClicked: () => null,
  secondaryButtonClicked: () => null,
  backButtonClicked: () => null,
  settingsButtonClicked: () => null,
  popupClosed: (p) => {
    const id = record(p).button_id;
    return { buttonId: typeof id === "string" ? id : null };
  },
  qrTextReceived: (p) => ({ text: str(record(p).data, "") }),
  scanQrPopupClosed: () => null,
  writeAccessRequested: (p) => ({ status: permissionStatus(record(p).status) }),
  contactRequested: (p) => ({ status: permissionStatus(record(p).status) }),
  biometricManagerUpdated: () => null,
  biometricAuthRequested: (p) => ({ isAuthenticated: record(p).isAuthenticated === true }),
  biometricTokenUpdated: (p) => ({ isUpdated: record(p).isUpdated === true }),
  fullscreenChanged: () => null,
  fullscreenFailed: (p) => ({ error: str(record(p).error, "UNKNOWN") }),
  homeScreenAdded: () => null,
  homeScreenChecked: (p) => ({ status: str(record(p).status, "unknown") }),
  locationManagerUpdated: () => null,
  locationRequested: (p) => ({ location: normalizeLocation(record(p).locationData) }),
};

export const TG_EVENT_NAMES = Object.freeze(Object.keys(NORMALIZERS) as TgEventName[]);

const NOOP: TgUnsubscribe = () => {
  /* nothing was subscribed */
};

/**
 * Subscribes to a Telegram event. Outside Telegram — or on a host without
 * `onEvent` — this is a silent no-op returning a no-op unsubscribe, so callers
 * need no environment branch of their own.
 */
export function onTelegramEvent<K extends TgEventName>(
  event: K,
  handler: (payload: TgEventPayloadMap[K]) => void,
): TgUnsubscribe {
  const host = getWebApp();
  if (!host || typeof host.onEvent !== "function") return NOOP;

  const bridge = (payload?: unknown): void => {
    handler(NORMALIZERS[event](payload));
  };

  try {
    host.onEvent(event, bridge);
  } catch {
    return NOOP;
  }

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    try {
      host.offEvent?.(event, bridge);
    } catch {
      /* host went away — nothing to detach */
    }
  };
}
