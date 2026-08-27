/**
 * Telegram button adapters (F1-02): `MainButton`, `SecondaryButton`,
 * `BackButton`, `SettingsButton`.
 *
 * The wrapper exposes state setters and click subscriptions only. Which screen
 * shows which action, and what the action does, is product behaviour and lives
 * outside this layer (ROADMAP §9.1 UX-1 is a screen rule, not a wrapper rule).
 *
 * Click handlers go through the documented event aliases, so the caller never
 * holds the raw callback that `offClick` would need.
 */

import { resolveCapability } from "./capabilities.ts";
import { onTelegramEvent, type TgUnsubscribe } from "./events.ts";
import type { TgBottomButtonLike, TgIconButtonLike } from "./host-types.ts";
import { type TgOutcome, tgOk, tgUnavailable } from "./outcome.ts";

export type TgBottomButtonState = {
  text?: string;
  visible?: boolean;
  active?: boolean;
  progress?: boolean;
};

function applyBottomButton(
  button: TgBottomButtonLike,
  state: TgBottomButtonState,
): TgOutcome<true> {
  try {
    if (state.text !== undefined) button.setText(state.text);
    if (state.active !== undefined) {
      if (state.active) button.enable();
      else button.disable();
    }
    if (state.progress !== undefined) {
      if (state.progress) button.showProgress();
      else button.hideProgress();
    }
    if (state.visible !== undefined) {
      if (state.visible) button.show();
      else button.hide();
    }
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}

/** Sets the primary bottom button. */
export function setMainButton(state: TgBottomButtonState): TgOutcome<true> {
  const gate = resolveCapability("mainButton");
  if (gate.host === null) return tgUnavailable<true>(gate.reason);
  const button = gate.host.MainButton;
  if (!button) return tgUnavailable<true>("missing-api");
  return applyBottomButton(button, state);
}

/** Sets the secondary bottom button (Bot API 7.10+). */
export function setSecondaryButton(state: TgBottomButtonState): TgOutcome<true> {
  const gate = resolveCapability("secondaryButton");
  if (gate.host === null) return tgUnavailable<true>(gate.reason);
  const button = gate.host.SecondaryButton;
  if (!button) return tgUnavailable<true>("missing-api");
  return applyBottomButton(button, state);
}

export function onMainButtonClick(handler: () => void): TgUnsubscribe {
  return onTelegramEvent("mainButtonClicked", () => handler());
}

export function onSecondaryButtonClick(handler: () => void): TgUnsubscribe {
  return onTelegramEvent("secondaryButtonClicked", () => handler());
}

function setIconButtonVisible(
  button: TgIconButtonLike | undefined,
  visible: boolean,
): TgOutcome<true> {
  if (!button) return tgUnavailable<true>("missing-api");
  try {
    if (visible) button.show();
    else button.hide();
    return tgOk(true as const);
  } catch (error) {
    return tgUnavailable<true>("failed", String(error));
  }
}

/** Header back button (Bot API 6.1+). */
export function setBackButtonVisible(visible: boolean): TgOutcome<true> {
  const gate = resolveCapability("backButton");
  if (gate.host === null) return tgUnavailable<true>(gate.reason);
  return setIconButtonVisible(gate.host.BackButton, visible);
}

export function onBackButtonClick(handler: () => void): TgUnsubscribe {
  return onTelegramEvent("backButtonClicked", () => handler());
}

/** Settings entry in the Mini App context menu (Bot API 7.0+). */
export function setSettingsButtonVisible(visible: boolean): TgOutcome<true> {
  const gate = resolveCapability("settingsButton");
  if (gate.host === null) return tgUnavailable<true>(gate.reason);
  return setIconButtonVisible(gate.host.SettingsButton, visible);
}

export function onSettingsButtonClick(handler: () => void): TgUnsubscribe {
  return onTelegramEvent("settingsButtonClicked", () => handler());
}
