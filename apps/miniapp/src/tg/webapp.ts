/**
 * Telegram WebApp SDK wrapper (F1-02 foundation).
 * Every Telegram API call MUST go through this module (ADR 0031 / ARCH-014).
 * Outside Telegram the wrapper degrades: no crash, no invented identity.
 */

import type { TelegramHostExtras } from "./host-types.ts";

export type ThemeParams = {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  bottom_bar_bg_color?: string;
  accent_text_color?: string;
  section_bg_color?: string;
  section_header_text_color?: string;
  subtitle_text_color?: string;
  destructive_text_color?: string;
};

/**
 * Host surface the wrapper touches. The mandatory part below is what every
 * Telegram client has had since Mini Apps existed; everything added later is in
 * `TelegramHostExtras` and is optional, because a member's presence differs by
 * client version and platform (ROADMAP §4.4).
 */
export type TelegramWebAppLike = TelegramHostExtras & {
  initData: string;
  initDataUnsafe: Record<string, unknown>;
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  themeParams: ThemeParams;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  ready: () => void;
  expand: () => void;
  close: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  isVersionAtLeast?: (version: string) => boolean;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebAppLike;
    };
  }
}

export function getWebApp(): TelegramWebAppLike | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

/** True when running inside Telegram with a non-empty initData string. */
export function isInsideTelegram(): boolean {
  const wa = getWebApp();
  return Boolean(wa && typeof wa.initData === "string" && wa.initData.length > 0);
}

/**
 * Raw initData string for server HMAC verification.
 * NEVER trust initDataUnsafe for identity decisions (ROADMAP §9.8).
 */
export function getRawInitData(): string | null {
  const wa = getWebApp();
  if (!wa || typeof wa.initData !== "string" || wa.initData.length === 0) {
    return null;
  }
  return wa.initData;
}

/**
 * Safe description of `initData` for diagnostics.
 *
 * The raw string is a credential: it carries the user object and the `hash`
 * that the server verifies (F1-03). It MUST NOT be logged, so this returns the
 * KEY NAMES only — never a single value, never the hash, never the user object.
 */
export function describeInitData(): { present: boolean; length: number; keys: string[] } {
  const raw = getRawInitData();
  if (raw === null) return { present: false, length: 0, keys: [] };
  let keys: string[] = [];
  try {
    keys = [...new URLSearchParams(raw).keys()].sort();
  } catch {
    keys = [];
  }
  return { present: true, length: raw.length, keys };
}

/**
 * Host description with no user data in it: version, platform, color scheme.
 * `null` outside Telegram.
 */
export function getHostInfo(): {
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
} | null {
  const wa = getWebApp();
  if (!wa) return null;
  return {
    version: typeof wa.version === "string" ? wa.version : "",
    platform: typeof wa.platform === "string" ? wa.platform : "unknown",
    colorScheme: wa.colorScheme === "dark" ? "dark" : "light",
  };
}

export function applyThemeFromTelegram(): void {
  const wa = getWebApp();
  if (!wa) return;

  const tp = wa.themeParams ?? {};
  const root = document.documentElement;

  const map: Array<[keyof ThemeParams, string]> = [
    ["bg_color", "--tg-bg-color"],
    ["text_color", "--tg-text-color"],
    ["hint_color", "--tg-hint-color"],
    ["link_color", "--tg-link-color"],
    ["button_color", "--tg-button-color"],
    ["button_text_color", "--tg-button-text-color"],
    ["secondary_bg_color", "--tg-secondary-bg-color"],
    ["header_bg_color", "--tg-header-bg-color"],
    ["bottom_bar_bg_color", "--tg-bottom-bar-bg-color"],
    ["accent_text_color", "--tg-accent-text-color"],
    ["section_bg_color", "--tg-section-bg-color"],
    ["section_header_text_color", "--tg-section-header-text-color"],
    ["subtitle_text_color", "--tg-subtitle-text-color"],
    ["destructive_text_color", "--tg-destructive-text-color"],
  ];

  for (const [key, cssVar] of map) {
    const value = tp[key];
    if (typeof value === "string" && value.length > 0) {
      root.style.setProperty(cssVar, value);
    }
  }

  try {
    wa.ready();
    wa.expand();
    if (wa.isVersionAtLeast?.("6.1") && tp.bg_color) {
      wa.setBackgroundColor?.(tp.bg_color);
      wa.setHeaderColor?.(tp.header_bg_color ?? tp.bg_color);
    }
    if (wa.isVersionAtLeast?.("7.10") && tp.bottom_bar_bg_color) {
      wa.setBottomBarColor?.(tp.bottom_bar_bg_color);
    }
  } catch {
    /* non-Telegram hosts — ignore */
  }
}
