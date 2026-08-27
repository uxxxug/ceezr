/**
 * Behaviour of the wrapped surface against a fake host (F1-02).
 *
 * What these tests establish: the wrapper forwards exactly one host call per
 * function, normalises what comes back, and degrades to a described outcome —
 * never a throw — when Telegram is absent or too old. What they do NOT establish:
 * how a real Telegram client behaves. That remains unmeasured.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  addAppToHomeScreen,
  checkHomeScreenStatus,
  closeApp,
  expandApp,
  notifyReady,
  openExternalLink,
  openTelegramDeepLink,
  requestFullscreenMode,
  setClosingConfirmation,
} from "./app.ts";
import {
  onBackButtonClick,
  onMainButtonClick,
  setBackButtonVisible,
  setMainButton,
  setSecondaryButton,
  setSettingsButtonVisible,
} from "./buttons.ts";
import {
  requestContactPermission,
  requestWriteAccessPermission,
  scanQrOnce,
  showTelegramAlert,
  showTelegramConfirm,
  showTelegramPopup,
} from "./dialogs.ts";
import { onTelegramEvent, TG_EVENT_NAMES } from "./events.ts";
import { hapticImpact, hapticNotification, hapticSelectionChanged } from "./haptics.ts";
import { locationAccess, requestLocation } from "./location.ts";
import { cloudStorageGet, cloudStorageKeys, cloudStorageSet } from "./storage.ts";
import { installFakeHost, removeFakeHost } from "./test-host.ts";
import { getContentSafeAreaInsets, getSafeAreaInsets, getViewport } from "./viewport.ts";

afterEach(() => {
  removeFakeHost();
});

describe("lifecycle and links", () => {
  test("forwards ready, expand and close", () => {
    const host = installFakeHost();
    expect(notifyReady().ok).toBe(true);
    expect(expandApp().ok).toBe(true);
    expect(closeApp().ok).toBe(true);
    expect(host.names()).toEqual(["ready", "expand", "close"]);
  });

  test("degrades without Telegram instead of throwing", () => {
    removeFakeHost();
    const outcome = notifyReady();
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false ? outcome.reason : "").toBe("no-telegram");
  });

  test("only http(s) links reach the host", () => {
    const host = installFakeHost();
    expect(openExternalLink("https://example.com").ok).toBe(true);
    const rejected = openExternalLink("javascript:alert(1)");
    expect(rejected.ok).toBe(false);
    expect(openExternalLink("not a url").ok).toBe(false);
    expect(host.names().filter((name) => name === "openLink")).toHaveLength(1);
  });

  test("telegram deep links go through the dedicated host call", () => {
    const host = installFakeHost();
    expect(openTelegramDeepLink("https://t.me/example").ok).toBe(true);
    expect(host.names()).toContain("openTelegramLink");
  });

  test("fullscreen and home screen are gated at 8.0", () => {
    installFakeHost({}, "7.10");
    expect(requestFullscreenMode().ok).toBe(false);
    expect(addAppToHomeScreen().ok).toBe(false);
  });

  test("home screen status is reported as the host reports it", async () => {
    installFakeHost({}, "8.0");
    const outcome = await checkHomeScreenStatus();
    expect(outcome.ok === true ? outcome.value : "").toBe("added");
  });

  test("closing confirmation toggles both directions", () => {
    const host = installFakeHost();
    setClosingConfirmation(true);
    setClosingConfirmation(false);
    expect(host.names()).toEqual(["enableClosingConfirmation", "disableClosingConfirmation"]);
  });
});

describe("buttons", () => {
  test("state is applied member by member, and only what was asked", () => {
    const host = installFakeHost();
    expect(setMainButton({ text: "تأكيد", visible: true, active: true }).ok).toBe(true);
    expect(host.names()).toEqual(["MainButton.setText", "MainButton.enable", "MainButton.show"]);
  });

  test("progress and disabling are forwarded", () => {
    const host = installFakeHost();
    setMainButton({ progress: true, active: false, visible: false });
    expect(host.names()).toEqual([
      "MainButton.disable",
      "MainButton.showProgress",
      "MainButton.hide",
    ]);
  });

  test("the secondary button needs 7.10", () => {
    installFakeHost({}, "7.0");
    const outcome = setSecondaryButton({ text: "لاحقاً" });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false ? outcome.reason : "").toBe("unsupported-version");
  });

  test("back and settings buttons show and hide", () => {
    const host = installFakeHost();
    setBackButtonVisible(true);
    setSettingsButtonVisible(false);
    expect(host.names()).toEqual(["BackButton.show", "SettingsButton.hide"]);
  });

  test("click subscriptions attach and detach through events", () => {
    const host = installFakeHost();
    let main = 0;
    let back = 0;
    const offMain = onMainButtonClick(() => {
      main += 1;
    });
    const offBack = onBackButtonClick(() => {
      back += 1;
    });

    host.emit("mainButtonClicked");
    host.emit("backButtonClicked");
    offMain();
    offMain(); // idempotent
    host.emit("mainButtonClicked");
    offBack();

    expect(main).toBe(1);
    expect(back).toBe(1);
    expect(host.names().filter((name) => name === "offEvent")).toHaveLength(2);
  });
});

describe("haptics", () => {
  test("all three kinds are forwarded", () => {
    const host = installFakeHost();
    hapticImpact("medium");
    hapticNotification("success");
    hapticSelectionChanged();
    expect(host.names()).toEqual(["impactOccurred", "notificationOccurred", "selectionChanged"]);
    expect(host.calls[0]?.args[0]).toBe("medium");
  });

  test("absence is reported, and callers may ignore it", () => {
    installFakeHost({ HapticFeedback: undefined });
    expect(hapticImpact("light").ok).toBe(false);
  });
});

describe("dialogs and permissions", () => {
  test("alert resolves when the host closes it", async () => {
    const host = installFakeHost();
    expect((await showTelegramAlert("مرحباً")).ok).toBe(true);
    expect(host.names()).toContain("showAlert");
  });

  test("confirm returns the answer, and false is an answer", async () => {
    installFakeHost({
      showConfirm: (_message: string, cb?: (ok: boolean) => void) => cb?.(false),
    });
    const outcome = await showTelegramConfirm("متأكد؟");
    expect(outcome.ok).toBe(true);
    expect(outcome.ok === true ? outcome.value : true).toBe(false);
  });

  test("popup returns the pressed button id", async () => {
    const outcome = await (() => {
      installFakeHost();
      return showTelegramPopup({ message: "اختر", buttons: [{ id: "ok", type: "ok" }] });
    })();
    expect(outcome.ok === true ? outcome.value : null).toBe("ok");
  });

  test("popup with no pressed button resolves null, not a failure", async () => {
    installFakeHost({ showPopup: (_p: unknown, cb?: (id: string) => void) => cb?.("") });
    const outcome = await showTelegramPopup({ message: "اختر" });
    expect(outcome.ok).toBe(true);
    expect(outcome.ok === true ? outcome.value : "x").toBeNull();
  });

  test("popups are gated at 6.2", async () => {
    installFakeHost({}, "6.1");
    const outcome = await showTelegramAlert("مرحباً");
    expect(outcome.ok === false ? outcome.reason : "").toBe("unsupported-version");
  });

  test("the QR scanner resolves with the first code", async () => {
    const host = installFakeHost();
    const outcome = await scanQrOnce("امسح");
    expect(outcome.ok === true ? outcome.value : "").toBe("CODE-1");
    expect(host.names()).toContain("showScanQrPopup");
  });

  test("contact and write-access return the user's decision only", async () => {
    installFakeHost();
    const contact = await requestContactPermission();
    const write = await requestWriteAccessPermission();
    expect(contact.ok === true ? contact.value : null).toBe(true);
    expect(write.ok === true ? write.value : null).toBe(false);
    expect(JSON.stringify(contact)).not.toContain("phone");
  });
});

describe("viewport", () => {
  test("reads the numbers the host reports", () => {
    installFakeHost();
    expect(getViewport()).toEqual({
      height: 600,
      stableHeight: 580,
      isExpanded: false,
      isFullscreen: false,
      isActive: true,
    });
  });

  test("null outside Telegram", () => {
    removeFakeHost();
    expect(getViewport()).toBeNull();
  });

  test("insets are numbers, with zeros for anything missing", () => {
    installFakeHost({ safeAreaInset: { top: 44 } }, "8.0");
    const safe = getSafeAreaInsets();
    expect(safe.ok === true ? safe.value : null).toEqual({
      top: 44,
      bottom: 0,
      left: 0,
      right: 0,
    });
    const content = getContentSafeAreaInsets();
    expect(content.ok === true ? content.value.top : null).toBe(12);
  });

  test("insets are unavailable before 8.0 rather than guessed", () => {
    installFakeHost({}, "7.10");
    expect(getSafeAreaInsets().ok).toBe(false);
  });
});

describe("cloud storage", () => {
  test("callbacks become promises", async () => {
    const host = installFakeHost();
    expect((await cloudStorageSet("k", "v")).ok).toBe(true);
    const read = await cloudStorageGet("k");
    expect(read.ok === true ? read.value : null).toBe("stored");
    const keys = await cloudStorageKeys();
    expect(keys.ok === true ? keys.value : null).toEqual(["a"]);
    expect(host.names()).toContain("CloudStorage.setItem");
  });

  test("a host error becomes a described failure, not a rejection", async () => {
    installFakeHost({
      CloudStorage: {
        getItem: (_k: string, cb?: (e: string | null) => void) => cb?.("QUOTA_EXCEEDED"),
      },
    });
    const outcome = await cloudStorageGet("k");
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false ? outcome.reason : "").toBe("failed");
  });

  test("cloud storage is gated at 6.9 and no local substitute is invented here", async () => {
    installFakeHost({}, "6.4");
    const outcome = await cloudStorageGet("k");
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false ? outcome.reason : "").toBe("unsupported-version");
  });
});

describe("location", () => {
  test("access state is reported without asking for a fix", () => {
    installFakeHost({}, "8.0");
    expect(locationAccess()).toEqual({
      inited: true,
      available: true,
      accessRequested: true,
      accessGranted: true,
    });
  });

  test("a fix is normalised to neutral field names", async () => {
    installFakeHost({}, "8.0");
    const outcome = await requestLocation();
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.latitude).toBe(24.47);
      expect(outcome.value.horizontalAccuracy).toBe(12);
    }
  });

  test("a refusal is reported as declined, never as a coordinate", async () => {
    installFakeHost(
      {
        LocationManager: {
          isInited: true,
          isLocationAvailable: true,
          isAccessRequested: true,
          isAccessGranted: false,
          init: (cb?: () => void) => cb?.(),
          getLocation: (cb?: (data: unknown) => void) => cb?.(null),
          openSettings: () => undefined,
        },
      },
      "8.0",
    );
    const outcome = await requestLocation();
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false ? outcome.reason : "").toBe("declined");
  });

  test("no browser geolocation is substituted outside Telegram", async () => {
    removeFakeHost();
    const outcome = await requestLocation();
    expect(outcome.ok === false ? outcome.reason : "").toBe("no-telegram");
  });
});

describe("events", () => {
  test("payloads are normalised out of snake_case", () => {
    const host = installFakeHost();
    let buttonId: string | null = "unset";
    const off = onTelegramEvent("popupClosed", (payload) => {
      buttonId = payload.buttonId;
    });
    host.emit("popupClosed", { button_id: "cancel" });
    off();
    expect(buttonId).toBe("cancel");
  });

  test("subscribing outside Telegram is a silent no-op", () => {
    removeFakeHost();
    let fired = 0;
    const off = onTelegramEvent("themeChanged", () => {
      fired += 1;
    });
    expect(() => off()).not.toThrow();
    expect(fired).toBe(0);
  });

  test("every adopted event has a normaliser and payment events are absent", () => {
    expect(TG_EVENT_NAMES.length).toBeGreaterThan(0);
    expect(TG_EVENT_NAMES).not.toContain("invoiceClosed");
    const host = installFakeHost();
    for (const name of TG_EVENT_NAMES) {
      const off = onTelegramEvent(name, () => undefined);
      expect(() => host.emit(name, { unexpected: true })).not.toThrow();
      off();
    }
  });
});
