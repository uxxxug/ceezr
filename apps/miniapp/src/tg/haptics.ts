/**
 * `HapticFeedback` adapter (Bot API 6.1+) — F1-02.
 *
 * ADR 0031 §4: a missing `HapticFeedback` is ignored silently. So callers may
 * discard the outcome; nothing in the product may depend on haptics.
 */

import { resolveCapability } from "./capabilities.ts";
import { type TgOutcome, tgOk, tgUnavailable } from "./outcome.ts";

export type TgImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";
export type TgNotificationType = "error" | "success" | "warning";

function haptics() {
  const gate = resolveCapability("haptics");
  if (gate.host === null) return { feedback: null, reason: gate.reason } as const;
  const feedback = gate.host.HapticFeedback;
  return feedback
    ? ({ feedback, reason: null } as const)
    : ({ feedback: null, reason: "missing-api" } as const);
}

export function hapticImpact(style: TgImpactStyle): TgOutcome<true> {
  const { feedback, reason } = haptics();
  if (!feedback) return tgUnavailable<true>(reason);
  try {
    feedback.impactOccurred(style);
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}

export function hapticNotification(type: TgNotificationType): TgOutcome<true> {
  const { feedback, reason } = haptics();
  if (!feedback) return tgUnavailable<true>(reason);
  try {
    feedback.notificationOccurred(type);
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}

export function hapticSelectionChanged(): TgOutcome<true> {
  const { feedback, reason } = haptics();
  if (!feedback) return tgUnavailable<true>(reason);
  try {
    feedback.selectionChanged();
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}
