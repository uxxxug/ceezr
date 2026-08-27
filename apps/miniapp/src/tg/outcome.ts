/**
 * Uniform result of every Telegram call made through the wrapper (F1-02).
 *
 * The wrapper never throws for a missing host, a missing capability, or a user
 * refusal: those are ordinary, expected states outside Telegram and on older
 * clients, and callers must be able to branch on them (ADR 0031 §4 — graceful
 * degradation, not breakage). Only the caller decides what the fallback is; the
 * wrapper decides nothing (no business logic in `tg/`).
 */

export type TgUnavailableReason =
  /** No Telegram WebApp host at all — plain browser or test environment. */
  | "no-telegram"
  /** Host present, but the client's Bot API version is below the requirement. */
  | "unsupported-version"
  /** Version is high enough, yet the member is absent on this host. */
  | "missing-api"
  /** The user refused, or Telegram reported failure. */
  | "declined"
  /** The host threw, or reported an error string. */
  | "failed";

export type TgOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: TgUnavailableReason; readonly detail?: string };

export function tgOk<T>(value: T): TgOutcome<T> {
  return { ok: true, value };
}

export function tgUnavailable<T>(reason: TgUnavailableReason, detail?: string): TgOutcome<T> {
  return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };
}
