/**
 * Storage adapters (F1-02): `CloudStorage` (6.9+), `DeviceStorage` (9.0+),
 * `SecureStorage` (9.0+).
 *
 * Callback APIs are promisified and nothing else. This layer holds NO storage
 * policy: it does not choose keys, does not decide what may be stored, does not
 * fall back to `localStorage`, and does not touch the session. ADR 0031 §4 makes
 * local storage the fallback when `CloudStorage` is absent, and ROADMAP §4.4
 * limits `SecureStorage` to a device session token — deciding and wiring that is
 * `F1-04`, which will call these functions rather than Telegram directly.
 */

import { resolveCapability } from "./capabilities.ts";
import type { TgStorageCallback } from "./host-types.ts";
import { type TgOutcome, tgOk, tgUnavailable } from "./outcome.ts";

/** Wraps Telegram's `(error, value)` callback in a promise. */
function promisify<T>(
  invoke: (callback: TgStorageCallback<T>) => void,
  empty: () => TgOutcome<T>,
): Promise<TgOutcome<T>> {
  return new Promise((resolve) => {
    try {
      invoke((error, value) => {
        if (error) {
          resolve(tgUnavailable<T>("failed", String(error)));
          return;
        }
        resolve(value === undefined ? empty() : tgOk(value));
      });
    } catch (thrown) {
      resolve(tgUnavailable<T>("failed", String(thrown)));
    }
  });
}

/* ─────────────────────────── CloudStorage (6.9+) ─────────────────────────── */

export function cloudStorageSet(key: string, value: string): Promise<TgOutcome<boolean>> {
  const gate = resolveCapability("cloudStorage");
  if (gate.host === null) return Promise.resolve(tgUnavailable<boolean>(gate.reason));
  const store = gate.host.CloudStorage;
  if (!store) return Promise.resolve(tgUnavailable<boolean>("missing-api"));
  return promisify<boolean>(
    (cb) => store.setItem(key, value, cb),
    () => tgOk(true),
  );
}

/** Resolves `null` when the key is absent. */
export function cloudStorageGet(key: string): Promise<TgOutcome<string | null>> {
  const gate = resolveCapability("cloudStorage");
  if (gate.host === null) return Promise.resolve(tgUnavailable<string | null>(gate.reason));
  const store = gate.host.CloudStorage;
  if (!store) return Promise.resolve(tgUnavailable<string | null>("missing-api"));
  return promisify<string | null>(
    (cb) => store.getItem(key, cb as TgStorageCallback<string>),
    () => tgOk(null),
  );
}

export function cloudStorageGetMany(keys: string[]): Promise<TgOutcome<Record<string, string>>> {
  const gate = resolveCapability("cloudStorage");
  if (gate.host === null)
    return Promise.resolve(tgUnavailable<Record<string, string>>(gate.reason));
  const store = gate.host.CloudStorage;
  if (!store) return Promise.resolve(tgUnavailable<Record<string, string>>("missing-api"));
  return promisify<Record<string, string>>(
    (cb) => store.getItems(keys, cb),
    () => tgOk({}),
  );
}

export function cloudStorageRemove(key: string): Promise<TgOutcome<boolean>> {
  const gate = resolveCapability("cloudStorage");
  if (gate.host === null) return Promise.resolve(tgUnavailable<boolean>(gate.reason));
  const store = gate.host.CloudStorage;
  if (!store) return Promise.resolve(tgUnavailable<boolean>("missing-api"));
  return promisify<boolean>(
    (cb) => store.removeItem(key, cb),
    () => tgOk(true),
  );
}

export function cloudStorageKeys(): Promise<TgOutcome<string[]>> {
  const gate = resolveCapability("cloudStorage");
  if (gate.host === null) return Promise.resolve(tgUnavailable<string[]>(gate.reason));
  const store = gate.host.CloudStorage;
  if (!store) return Promise.resolve(tgUnavailable<string[]>("missing-api"));
  return promisify<string[]>(
    (cb) => store.getKeys(cb),
    () => tgOk([]),
  );
}

/* ─────────────────────────── DeviceStorage (9.0+) ────────────────────────── */

export function deviceStorageSet(key: string, value: string): Promise<TgOutcome<boolean>> {
  const gate = resolveCapability("deviceStorage");
  if (gate.host === null) return Promise.resolve(tgUnavailable<boolean>(gate.reason));
  const store = gate.host.DeviceStorage;
  if (!store) return Promise.resolve(tgUnavailable<boolean>("missing-api"));
  return promisify<boolean>(
    (cb) => store.setItem(key, value, cb),
    () => tgOk(true),
  );
}

export function deviceStorageGet(key: string): Promise<TgOutcome<string | null>> {
  const gate = resolveCapability("deviceStorage");
  if (gate.host === null) return Promise.resolve(tgUnavailable<string | null>(gate.reason));
  const store = gate.host.DeviceStorage;
  if (!store) return Promise.resolve(tgUnavailable<string | null>("missing-api"));
  return promisify<string | null>(
    (cb) => store.getItem(key, cb as TgStorageCallback<string>),
    () => tgOk(null),
  );
}

export function deviceStorageRemove(key: string): Promise<TgOutcome<boolean>> {
  const gate = resolveCapability("deviceStorage");
  if (gate.host === null) return Promise.resolve(tgUnavailable<boolean>(gate.reason));
  const store = gate.host.DeviceStorage;
  if (!store) return Promise.resolve(tgUnavailable<boolean>("missing-api"));
  return promisify<boolean>(
    (cb) => store.removeItem(key, cb),
    () => tgOk(true),
  );
}

/* ─────────────────────────── SecureStorage (9.0+) ────────────────────────── */

export type TgSecureRead = { value: string | null; canRestore: boolean };

export function secureStorageSet(key: string, value: string): Promise<TgOutcome<boolean>> {
  const gate = resolveCapability("secureStorage");
  if (gate.host === null) return Promise.resolve(tgUnavailable<boolean>(gate.reason));
  const store = gate.host.SecureStorage;
  if (!store) return Promise.resolve(tgUnavailable<boolean>("missing-api"));
  return promisify<boolean>(
    (cb) => store.setItem(key, value, cb),
    () => tgOk(true),
  );
}

/**
 * Reads a key from secure storage. A missing key is reported with
 * `canRestore`, which tells the caller whether `secureStorageRestore` may ask
 * the user to restore it — Telegram's third callback argument.
 */
export function secureStorageGet(key: string): Promise<TgOutcome<TgSecureRead>> {
  const gate = resolveCapability("secureStorage");
  if (gate.host === null) return Promise.resolve(tgUnavailable<TgSecureRead>(gate.reason));
  const store = gate.host.SecureStorage;
  if (!store) return Promise.resolve(tgUnavailable<TgSecureRead>("missing-api"));
  return new Promise((resolve) => {
    try {
      store.getItem(key, (error, value, canRestore) => {
        if (error) {
          resolve(tgUnavailable<TgSecureRead>("failed", String(error)));
          return;
        }
        resolve(
          tgOk({
            value: typeof value === "string" ? value : null,
            canRestore: canRestore === true,
          }),
        );
      });
    } catch (thrown) {
      resolve(tgUnavailable<TgSecureRead>("failed", String(thrown)));
    }
  });
}

/** Asks the user to restore a key that existed on this device before. */
export function secureStorageRestore(key: string): Promise<TgOutcome<string>> {
  const gate = resolveCapability("secureStorage");
  if (gate.host === null) return Promise.resolve(tgUnavailable<string>(gate.reason));
  const store = gate.host.SecureStorage;
  if (!store) return Promise.resolve(tgUnavailable<string>("missing-api"));
  return promisify<string>(
    (cb) => store.restoreItem(key, cb),
    () => tgUnavailable<string>("declined"),
  );
}

export function secureStorageRemove(key: string): Promise<TgOutcome<boolean>> {
  const gate = resolveCapability("secureStorage");
  if (gate.host === null) return Promise.resolve(tgUnavailable<boolean>(gate.reason));
  const store = gate.host.SecureStorage;
  if (!store) return Promise.resolve(tgUnavailable<boolean>("missing-api"));
  return promisify<boolean>(
    (cb) => store.removeItem(key, cb),
    () => tgOk(true),
  );
}
