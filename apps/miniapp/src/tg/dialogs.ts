/**
 * Native dialog and permission adapters (F1-02): alert, confirm, popup, QR
 * scanner, contact request, write-access request.
 *
 * The wrapper carries no copy of its own: every string comes from the caller, so
 * user-facing text stays with the screens and the i18n dictionaries. No dialog
 * here decides anything.
 *
 * `openInvoice` is deliberately NOT wrapped: payment is outside the sanctioned
 * scope, and a wrapper for it would be a structure prepared for it.
 */

import { resolveCapability } from "./capabilities.ts";
import { type TgOutcome, tgOk, tgUnavailable } from "./outcome.ts";

export type TgPopupButton = {
  id?: string;
  type?: "default" | "ok" | "close" | "cancel" | "destructive";
  text?: string;
};

export type TgPopupRequest = {
  title?: string;
  message: string;
  buttons?: TgPopupButton[];
};

export function showTelegramAlert(message: string): Promise<TgOutcome<true>> {
  const gate = resolveCapability("popups");
  if (gate.host === null) return Promise.resolve(tgUnavailable<true>(gate.reason));
  const show = gate.host.showAlert;
  if (!show) return Promise.resolve(tgUnavailable<true>("missing-api"));
  return new Promise((resolve) => {
    try {
      show.call(gate.host, message, () => resolve(tgOk(true as const)));
    } catch (error) {
      resolve(tgUnavailable<true>("failed", String(error)));
    }
  });
}

/** Resolves with the user's answer; `false` is an answer, not a failure. */
export function showTelegramConfirm(message: string): Promise<TgOutcome<boolean>> {
  const gate = resolveCapability("popups");
  if (gate.host === null) return Promise.resolve(tgUnavailable<boolean>(gate.reason));
  const show = gate.host.showConfirm;
  if (!show) return Promise.resolve(tgUnavailable<boolean>("missing-api"));
  return new Promise((resolve) => {
    try {
      show.call(gate.host, message, (confirmed) => resolve(tgOk(confirmed === true)));
    } catch (error) {
      resolve(tgUnavailable<boolean>("failed", String(error)));
    }
  });
}

/** Resolves with the pressed button id, or `null` when none was pressed. */
export function showTelegramPopup(request: TgPopupRequest): Promise<TgOutcome<string | null>> {
  const gate = resolveCapability("popups");
  if (gate.host === null) return Promise.resolve(tgUnavailable<string | null>(gate.reason));
  const show = gate.host.showPopup;
  if (!show) return Promise.resolve(tgUnavailable<string | null>("missing-api"));
  return new Promise((resolve) => {
    try {
      show.call(gate.host, request, (buttonId) =>
        resolve(tgOk(typeof buttonId === "string" && buttonId.length > 0 ? buttonId : null)),
      );
    } catch (error) {
      resolve(tgUnavailable<string | null>("failed", String(error)));
    }
  });
}

/**
 * Opens the native scanner and resolves with the FIRST code read, then closes
 * the popup. Returning `true` from Telegram's callback is what closes it.
 */
export function scanQrOnce(prompt?: string): Promise<TgOutcome<string>> {
  const gate = resolveCapability("scanQr");
  if (gate.host === null) return Promise.resolve(tgUnavailable<string>(gate.reason));
  const show = gate.host.showScanQrPopup;
  if (!show) return Promise.resolve(tgUnavailable<string>("missing-api"));
  return new Promise((resolve) => {
    try {
      show.call(gate.host, prompt === undefined ? {} : { text: prompt }, (text) => {
        resolve(
          typeof text === "string" && text.length > 0 ? tgOk(text) : tgUnavailable("declined"),
        );
        return true;
      });
    } catch (error) {
      resolve(tgUnavailable<string>("failed", String(error)));
    }
  });
}

export function closeQrScanner(): TgOutcome<true> {
  const gate = resolveCapability("scanQr");
  if (gate.host === null) return tgUnavailable<true>(gate.reason);
  const close = gate.host.closeScanQrPopup;
  if (!close) return tgUnavailable<true>("missing-api");
  try {
    close.call(gate.host);
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}

/**
 * Asks for the user's phone number. Resolves with the user's decision only —
 * the number itself never arrives here: Telegram delivers it to the bot, and the
 * server is what may use it.
 */
export function requestContactPermission(): Promise<TgOutcome<boolean>> {
  const gate = resolveCapability("requestContact");
  if (gate.host === null) return Promise.resolve(tgUnavailable<boolean>(gate.reason));
  const request = gate.host.requestContact;
  if (!request) return Promise.resolve(tgUnavailable<boolean>("missing-api"));
  return new Promise((resolve) => {
    try {
      request.call(gate.host, (shared) => resolve(tgOk(shared === true)));
    } catch (error) {
      resolve(tgUnavailable<boolean>("failed", String(error)));
    }
  });
}

/** Asks permission for the bot to message the user (Bot API 6.9+). */
export function requestWriteAccessPermission(): Promise<TgOutcome<boolean>> {
  const gate = resolveCapability("requestWriteAccess");
  if (gate.host === null) return Promise.resolve(tgUnavailable<boolean>(gate.reason));
  const request = gate.host.requestWriteAccess;
  if (!request) return Promise.resolve(tgUnavailable<boolean>("missing-api"));
  return new Promise((resolve) => {
    try {
      request.call(gate.host, (granted) => resolve(tgOk(granted === true)));
    } catch (error) {
      resolve(tgUnavailable<boolean>("failed", String(error)));
    }
  });
}
