/**
 * Viewport and safe-area readers (F1-02).
 *
 * Reads only. Binding these values to CSS variables and to the map/active-ride
 * screens is `F1-06` and `F1-07`, and is NOT done here — this layer just makes
 * the numbers reachable without touching `window.Telegram`.
 */

import { resolveCapability } from "./capabilities.ts";
import { type TgOutcome, tgOk, tgUnavailable } from "./outcome.ts";
import { getWebApp } from "./webapp.ts";

export type TgViewport = {
  height: number;
  stableHeight: number;
  isExpanded: boolean;
  isFullscreen: boolean;
  isActive: boolean;
};

export type TgInsets = { top: number; bottom: number; left: number; right: number };

/** `null` outside Telegram — the browser's own layout applies there. */
export function getViewport(): TgViewport | null {
  const host = getWebApp();
  if (!host) return null;
  return {
    height: typeof host.viewportHeight === "number" ? host.viewportHeight : 0,
    stableHeight: typeof host.viewportStableHeight === "number" ? host.viewportStableHeight : 0,
    isExpanded: host.isExpanded === true,
    isFullscreen: host.isFullscreen === true,
    /** Older clients have no `isActive`; an app that is running is treated as active. */
    isActive: host.isActive !== false,
  };
}

function readInsets(raw: unknown): TgInsets {
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const px = (key: string): number => {
    const n = value[key];
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
  };
  return { top: px("top"), bottom: px("bottom"), left: px("left"), right: px("right") };
}

/** Device safe-area insets (Bot API 8.0+). */
export function getSafeAreaInsets(): TgOutcome<TgInsets> {
  const gate = resolveCapability("safeArea");
  if (gate.host === null) return tgUnavailable<TgInsets>(gate.reason);
  return tgOk(readInsets(gate.host.safeAreaInset));
}

/** Insets clear of Telegram's own UI (Bot API 8.0+). */
export function getContentSafeAreaInsets(): TgOutcome<TgInsets> {
  const gate = resolveCapability("safeArea");
  if (gate.host === null) return tgUnavailable<TgInsets>(gate.reason);
  return tgOk(readInsets(gate.host.contentSafeAreaInset));
}
