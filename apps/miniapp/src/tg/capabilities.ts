/**
 * Capability gate for the Telegram wrapper (F1-02).
 *
 * ROADMAP §4.4 derived rule, verbatim: «لا تُستخدَم قدرة بلا فحص
 * `WebApp.isVersionAtLeast` وبلا تراجع رشيد — شرط ADR 0031 البند ٤».
 *
 * So a capability is usable only when BOTH hold:
 *   1. the client's Bot API version is at least the documented minimum, and
 *   2. the member actually exists on the host object at runtime.
 *
 * Minimum versions are transcribed from ROADMAP §4.4 (including correction ت-6)
 * and the official documentation (https://core.telegram.org/bots/webapps).
 * `null` means the documentation states no minimum version.
 */

import type { TelegramWebAppLike } from "./webapp.ts";
import { getWebApp } from "./webapp.ts";

type CapabilitySpec = {
  /** Documented minimum Bot API version, or `null` when none is documented. */
  readonly minVersion: string | null;
  /** Runtime presence probe — the member the wrapper is about to touch. */
  readonly present: (host: TelegramWebAppLike) => boolean;
};

const CAPABILITIES = {
  mainButton: { minVersion: null, present: (h) => typeof h.MainButton?.setText === "function" },
  themeParams: { minVersion: null, present: (h) => typeof h.themeParams === "object" },
  haptics: {
    minVersion: "6.1",
    present: (h) => typeof h.HapticFeedback?.impactOccurred === "function",
  },
  backButton: { minVersion: "6.1", present: (h) => typeof h.BackButton?.show === "function" },
  headerColor: { minVersion: "6.1", present: (h) => typeof h.setHeaderColor === "function" },
  backgroundColor: {
    minVersion: "6.1",
    present: (h) => typeof h.setBackgroundColor === "function",
  },
  openTelegramLink: {
    minVersion: "6.1",
    present: (h) => typeof h.openTelegramLink === "function",
  },
  popups: { minVersion: "6.2", present: (h) => typeof h.showAlert === "function" },
  closingConfirmation: {
    minVersion: "6.2",
    present: (h) => typeof h.enableClosingConfirmation === "function",
  },
  openLink: { minVersion: "6.4", present: (h) => typeof h.openLink === "function" },
  scanQr: { minVersion: "6.4", present: (h) => typeof h.showScanQrPopup === "function" },
  cloudStorage: {
    minVersion: "6.9",
    present: (h) => typeof h.CloudStorage?.getItem === "function",
  },
  requestContact: { minVersion: "6.9", present: (h) => typeof h.requestContact === "function" },
  requestWriteAccess: {
    minVersion: "6.9",
    present: (h) => typeof h.requestWriteAccess === "function",
  },
  settingsButton: {
    minVersion: "7.0",
    present: (h) => typeof h.SettingsButton?.show === "function",
  },
  biometrics: {
    minVersion: "7.2",
    present: (h) => typeof h.BiometricManager?.init === "function",
  },
  bottomBarColor: { minVersion: "7.10", present: (h) => typeof h.setBottomBarColor === "function" },
  secondaryButton: {
    minVersion: "7.10",
    present: (h) => typeof h.SecondaryButton?.setText === "function",
  },
  fullscreen: { minVersion: "8.0", present: (h) => typeof h.requestFullscreen === "function" },
  safeArea: { minVersion: "8.0", present: (h) => typeof h.safeAreaInset === "object" },
  addToHomeScreen: { minVersion: "8.0", present: (h) => typeof h.addToHomeScreen === "function" },
  location: {
    minVersion: "8.0",
    present: (h) => typeof h.LocationManager?.getLocation === "function",
  },
  deviceStorage: {
    minVersion: "9.0",
    present: (h) => typeof h.DeviceStorage?.getItem === "function",
  },
  secureStorage: {
    minVersion: "9.0",
    present: (h) => typeof h.SecureStorage?.getItem === "function",
  },
} as const satisfies Record<string, CapabilitySpec>;

export type TgCapability = keyof typeof CAPABILITIES;

export const TG_CAPABILITY_MIN_VERSION: Readonly<Record<TgCapability, string | null>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(CAPABILITIES).map(([name, spec]) => [name, spec.minVersion]),
    ) as Record<TgCapability, string | null>,
  );

/** Numeric dotted-version comparison: negative, zero, positive. */
export function compareVersions(left: string, right: string): number {
  const l = left.split(".");
  const r = right.split(".");
  const length = Math.max(l.length, r.length);
  for (let i = 0; i < length; i += 1) {
    const a = Number.parseInt(l[i] ?? "0", 10);
    const b = Number.parseInt(r[i] ?? "0", 10);
    const av = Number.isNaN(a) ? 0 : a;
    const bv = Number.isNaN(b) ? 0 : b;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/**
 * Version check as required by ROADMAP §4.4. The host's own
 * `isVersionAtLeast` is authoritative when present; the dotted comparison of
 * `version` is a fallback for hosts that predate it.
 */
export function isVersionAtLeast(version: string): boolean {
  const host = getWebApp();
  if (!host) return false;
  try {
    if (typeof host.isVersionAtLeast === "function") {
      return host.isVersionAtLeast(version) === true;
    }
  } catch {
    /* fall through to the string comparison */
  }
  if (typeof host.version !== "string" || host.version.length === 0) return false;
  return compareVersions(host.version, version) >= 0;
}

/** True only when the version gate passes AND the member exists on the host. */
export function hasCapability(capability: TgCapability): boolean {
  const host = getWebApp();
  if (!host) return false;
  const spec: CapabilitySpec = CAPABILITIES[capability];
  if (spec.minVersion !== null && !isVersionAtLeast(spec.minVersion)) return false;
  try {
    return spec.present(host);
  } catch {
    return false;
  }
}

/** Diagnostic snapshot — carries no user data, safe to log. */
export function capabilityReport(): Record<TgCapability, boolean> {
  const entries = (Object.keys(CAPABILITIES) as TgCapability[]).map(
    (name) => [name, hasCapability(name)] as const,
  );
  return Object.fromEntries(entries) as Record<TgCapability, boolean>;
}

/**
 * Shared gate used by every wrapper module: resolves the host or explains why
 * the capability is not usable. Returns `null` host with a reason instead of
 * throwing.
 */
export function resolveCapability(
  capability: TgCapability,
):
  | { host: TelegramWebAppLike }
  | { host: null; reason: "no-telegram" | "unsupported-version" | "missing-api" } {
  const host = getWebApp();
  if (!host) return { host: null, reason: "no-telegram" };
  const spec: CapabilitySpec = CAPABILITIES[capability];
  if (spec.minVersion !== null && !isVersionAtLeast(spec.minVersion)) {
    return { host: null, reason: "unsupported-version" };
  }
  let present = false;
  try {
    present = spec.present(host);
  } catch {
    present = false;
  }
  return present ? { host } : { host: null, reason: "missing-api" };
}
