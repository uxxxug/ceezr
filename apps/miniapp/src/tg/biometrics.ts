/**
 * `BiometricManager` adapter (Bot API 7.2+) — F1-02.
 *
 * Forwarding only. Biometrics is NOT identity here: whatever token Telegram
 * returns is a device-held secret whose meaning is decided by the session item
 * (`F1-04`), and the server remains the only authority on identity
 * (ROADMAP §9.8, ADR 0035 §1). This module trusts nothing and stores nothing.
 */

import { resolveCapability } from "./capabilities.ts";
import { type TgOutcome, tgOk, tgUnavailable } from "./outcome.ts";

export type TgBiometricState = {
  inited: boolean;
  available: boolean;
  type: "finger" | "face" | "unknown";
  accessRequested: boolean;
  accessGranted: boolean;
  tokenSaved: boolean;
};

export type TgBiometricAuth = { authenticated: boolean; token: string | null };

/** State snapshot, or `null` when biometrics is not usable on this client. */
export function biometricState(): TgBiometricState | null {
  const gate = resolveCapability("biometrics");
  if (gate.host === null) return null;
  const manager = gate.host.BiometricManager;
  if (!manager) return null;
  const type = manager.biometricType;
  return {
    inited: manager.isInited === true,
    available: manager.isBiometricAvailable === true,
    type: type === "finger" || type === "face" ? type : "unknown",
    accessRequested: manager.isAccessRequested === true,
    accessGranted: manager.isAccessGranted === true,
    tokenSaved: manager.isBiometricTokenSaved === true,
  };
}

export function initBiometrics(): Promise<TgOutcome<true>> {
  const gate = resolveCapability("biometrics");
  if (gate.host === null) return Promise.resolve(tgUnavailable<true>(gate.reason));
  const manager = gate.host.BiometricManager;
  if (!manager) return Promise.resolve(tgUnavailable<true>("missing-api"));
  return new Promise((resolve) => {
    try {
      manager.init(() => resolve(tgOk(true as const)));
    } catch (error) {
      resolve(tgUnavailable<true>("failed", String(error)));
    }
  });
}

/** `reason` is caller-supplied copy; this layer writes no user-facing text. */
export function requestBiometricAccess(reason?: string): Promise<TgOutcome<boolean>> {
  const gate = resolveCapability("biometrics");
  if (gate.host === null) return Promise.resolve(tgUnavailable<boolean>(gate.reason));
  const manager = gate.host.BiometricManager;
  if (!manager) return Promise.resolve(tgUnavailable<boolean>("missing-api"));
  return new Promise((resolve) => {
    try {
      manager.requestAccess(reason === undefined ? {} : { reason }, (granted) =>
        resolve(tgOk(granted === true)),
      );
    } catch (error) {
      resolve(tgUnavailable<boolean>("failed", String(error)));
    }
  });
}

/** A refusal resolves `ok` with `authenticated: false` — it is an answer. */
export function authenticateBiometric(reason?: string): Promise<TgOutcome<TgBiometricAuth>> {
  const gate = resolveCapability("biometrics");
  if (gate.host === null) return Promise.resolve(tgUnavailable<TgBiometricAuth>(gate.reason));
  const manager = gate.host.BiometricManager;
  if (!manager) return Promise.resolve(tgUnavailable<TgBiometricAuth>("missing-api"));
  return new Promise((resolve) => {
    try {
      manager.authenticate(reason === undefined ? {} : { reason }, (ok, token) =>
        resolve(
          tgOk({
            authenticated: ok === true,
            token: typeof token === "string" && token.length > 0 ? token : null,
          }),
        ),
      );
    } catch (error) {
      resolve(tgUnavailable<TgBiometricAuth>("failed", String(error)));
    }
  });
}

/** An empty string removes the stored token, per the documented behaviour. */
export function updateBiometricToken(token: string): Promise<TgOutcome<boolean>> {
  const gate = resolveCapability("biometrics");
  if (gate.host === null) return Promise.resolve(tgUnavailable<boolean>(gate.reason));
  const manager = gate.host.BiometricManager;
  if (!manager) return Promise.resolve(tgUnavailable<boolean>("missing-api"));
  return new Promise((resolve) => {
    try {
      manager.updateBiometricToken(token, (updated) => resolve(tgOk(updated === true)));
    } catch (error) {
      resolve(tgUnavailable<boolean>("failed", String(error)));
    }
  });
}

/** Opens Telegram's biometric settings. Must follow a user gesture. */
export function openBiometricSettings(): TgOutcome<true> {
  const gate = resolveCapability("biometrics");
  if (gate.host === null) return tgUnavailable<true>(gate.reason);
  const manager = gate.host.BiometricManager;
  if (!manager) return tgUnavailable<true>("missing-api");
  try {
    manager.openSettings();
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}
