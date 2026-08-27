/**
 * Waslah internal session — client-side holder only.
 * Session is issued by the server after HMAC verification of Telegram initData
 * (ROADMAP §9.8, ADR 0035 path: Bot → Mini App → verify → Waslah Session → API).
 *
 * F1-01: holder + types only. Exchange endpoint is F1-03 / F1-04.
 * Mini App MUST NOT invent users or domain sessions (ADR 0035).
 */

export type WaslahSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  role: "rider" | "driver" | "admin" | "unknown";
};

let current: WaslahSession | null = null;

export function getSession(): WaslahSession | null {
  return current;
}

export function setSession(session: WaslahSession | null): void {
  current = session;
}

export function hasValidSession(now = Date.now()): boolean {
  return current !== null && current.expiresAt > now;
}

/** Clear local holder only — server revocation is a separate API call. */
export function clearSession(): void {
  current = null;
}
