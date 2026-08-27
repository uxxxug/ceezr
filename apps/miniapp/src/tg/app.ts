/**
 * App-level Telegram actions (F1-02): lifecycle, links, fullscreen, home-screen
 * shortcut, closing confirmation.
 *
 * No screen logic and no navigation decisions: each function forwards one host
 * call and reports whether it was delivered.
 */

import { resolveCapability } from "./capabilities.ts";
import { type TgOutcome, tgOk, tgUnavailable } from "./outcome.ts";
import { getWebApp } from "./webapp.ts";

/** `ready()` — tells Telegram the app may be shown. */
export function notifyReady(): TgOutcome<true> {
  const host = getWebApp();
  if (!host) return tgUnavailable<true>("no-telegram");
  try {
    host.ready();
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}

export function expandApp(): TgOutcome<true> {
  const host = getWebApp();
  if (!host) return tgUnavailable<true>("no-telegram");
  try {
    host.expand();
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}

export function closeApp(): TgOutcome<true> {
  const host = getWebApp();
  if (!host) return tgUnavailable<true>("no-telegram");
  try {
    host.close();
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}

/**
 * Opens an external link. Only `http`/`https` is forwarded — hygiene, so a
 * `javascript:` or `data:` string cannot reach the host through this layer. The
 * single-origin policy for the app's own assets is `F1-10`, not this check.
 */
export function openExternalLink(url: string, tryInstantView = false): TgOutcome<true> {
  let scheme = "";
  try {
    scheme = new URL(url).protocol;
  } catch {
    return tgUnavailable<true>("failed", "invalid-url");
  }
  if (scheme !== "http:" && scheme !== "https:") {
    return tgUnavailable<true>("failed", "unsupported-scheme");
  }
  const gate = resolveCapability("openLink");
  if (gate.host === null) return tgUnavailable<true>(gate.reason);
  const open = gate.host.openLink;
  if (!open) return tgUnavailable<true>("missing-api");
  try {
    open.call(gate.host, url, { try_instant_view: tryInstantView });
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}

/** Opens a Telegram link inside the Telegram client (Bot API 6.1+). */
export function openTelegramDeepLink(url: string): TgOutcome<true> {
  const gate = resolveCapability("openTelegramLink");
  if (gate.host === null) return tgUnavailable<true>(gate.reason);
  const open = gate.host.openTelegramLink;
  if (!open) return tgUnavailable<true>("missing-api");
  try {
    open.call(gate.host, url);
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}

/** Fullscreen request (Bot API 8.0+); result arrives as `fullscreenChanged`. */
export function requestFullscreenMode(): TgOutcome<true> {
  const gate = resolveCapability("fullscreen");
  if (gate.host === null) return tgUnavailable<true>(gate.reason);
  const request = gate.host.requestFullscreen;
  if (!request) return tgUnavailable<true>("missing-api");
  try {
    request.call(gate.host);
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}

export function exitFullscreenMode(): TgOutcome<true> {
  const gate = resolveCapability("fullscreen");
  if (gate.host === null) return tgUnavailable<true>(gate.reason);
  const exit = gate.host.exitFullscreen;
  if (!exit) return tgUnavailable<true>("missing-api");
  try {
    exit.call(gate.host);
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}

/** Prompts for a home-screen shortcut (Bot API 8.0+). */
export function addAppToHomeScreen(): TgOutcome<true> {
  const gate = resolveCapability("addToHomeScreen");
  if (gate.host === null) return tgUnavailable<true>(gate.reason);
  const add = gate.host.addToHomeScreen;
  if (!add) return tgUnavailable<true>("missing-api");
  try {
    add.call(gate.host);
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}

/** Reported status: `unsupported` · `unknown` · `added` · `missed`. */
export function checkHomeScreenStatus(): Promise<TgOutcome<string>> {
  const gate = resolveCapability("addToHomeScreen");
  if (gate.host === null) return Promise.resolve(tgUnavailable<string>(gate.reason));
  const check = gate.host.checkHomeScreenStatus;
  if (!check) return Promise.resolve(tgUnavailable<string>("missing-api"));
  return new Promise((resolve) => {
    try {
      check.call(gate.host, (status) =>
        resolve(typeof status === "string" ? tgOk(status) : tgUnavailable<string>("failed")),
      );
    } catch (error) {
      resolve(tgUnavailable<string>("failed", String(error)));
    }
  });
}

/** Confirmation prompt before the app closes (Bot API 6.2+). */
export function setClosingConfirmation(enabled: boolean): TgOutcome<true> {
  const gate = resolveCapability("closingConfirmation");
  if (gate.host === null) return tgUnavailable<true>(gate.reason);
  const enable = gate.host.enableClosingConfirmation;
  const disable = gate.host.disableClosingConfirmation;
  if (!enable || !disable) return tgUnavailable<true>("missing-api");
  try {
    if (enabled) enable.call(gate.host);
    else disable.call(gate.host);
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}
