/**
 * Fake Telegram host for the wrapper's own tests (F1-02).
 *
 * TEST-ONLY: not re-exported from `index.ts`, so no product code can reach it.
 *
 * الحدُّ المعرفيُّ الصريح: هذا مضيفٌ مُصطنَع. يُثبِت أن الطبقةَ تُمرِّر الاستدعاءَ
 * الصحيحَ وأنها تصمُد أمامَ غيابِ المضيف — ولا يُثبِت شيئاً عن سلوكِ تيليجرامَ
 * الحقيقيِّ على جهازٍ حقيقيّ. ذلك يُقاس على الجهاز، ولم يُقَس بعد.
 */

import type { TelegramWebAppLike } from "./webapp.ts";

export type HostCall = { readonly name: string; readonly args: readonly unknown[] };

export type FakeHost = {
  readonly webApp: TelegramWebAppLike;
  readonly calls: HostCall[];
  /** Names of the calls recorded so far, in order. */
  names(): string[];
  /** Fires a subscribed event with a raw Telegram-shaped payload. */
  emit(event: string, payload?: unknown): void;
};

/** Installs `globalThis.window.Telegram.WebApp`; returns the recorder. */
/**
 * `overrides` is loosely typed on purpose: a test must be able to say «this
 * member is absent on this client» by passing `undefined`, which the strict
 * optional-property rules forbid on the real host type.
 */
export function installFakeHost(
  overrides: Record<string, unknown> = {},
  version = "9.0",
): FakeHost {
  const calls: HostCall[] = [];
  const listeners = new Map<string, Set<(payload?: unknown) => void>>();
  const record = (name: string, ...args: unknown[]): void => {
    calls.push({ name, args });
  };

  const button = (prefix: string) => ({
    setText: (text: string) => record(`${prefix}.setText`, text),
    show: () => record(`${prefix}.show`),
    hide: () => record(`${prefix}.hide`),
    enable: () => record(`${prefix}.enable`),
    disable: () => record(`${prefix}.disable`),
    showProgress: () => record(`${prefix}.showProgress`),
    hideProgress: () => record(`${prefix}.hideProgress`),
  });

  const base = {
    initData: "auth_date=1&hash=abc&user=%7B%22id%22%3A1%7D",
    initDataUnsafe: {},
    version,
    platform: "tdesktop",
    colorScheme: "light" as const,
    themeParams: { bg_color: "#ffffff", text_color: "#000000" },
    isExpanded: false,
    viewportHeight: 600,
    viewportStableHeight: 580,
    isFullscreen: false,
    isActive: true,
    safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
    contentSafeAreaInset: { top: 12, bottom: 0, left: 0, right: 0 },
    ready: () => record("ready"),
    expand: () => record("expand"),
    close: () => record("close"),
    isVersionAtLeast: (wanted: string) => {
      const l = version.split(".").map((n) => Number.parseInt(n, 10) || 0);
      const r = wanted.split(".").map((n) => Number.parseInt(n, 10) || 0);
      for (let i = 0; i < Math.max(l.length, r.length); i += 1) {
        const a = l[i] ?? 0;
        const b = r[i] ?? 0;
        if (a !== b) return a > b;
      }
      return true;
    },
    onEvent: (event: string, handler: (payload?: unknown) => void) => {
      record("onEvent", event);
      const set = listeners.get(event) ?? new Set();
      set.add(handler);
      listeners.set(event, set);
    },
    offEvent: (event: string, handler: (payload?: unknown) => void) => {
      record("offEvent", event);
      listeners.get(event)?.delete(handler);
    },
    setHeaderColor: (color: string) => record("setHeaderColor", color),
    setBackgroundColor: (color: string) => record("setBackgroundColor", color),
    setBottomBarColor: (color: string) => record("setBottomBarColor", color),
    openLink: (url: string, options?: unknown) => record("openLink", url, options),
    openTelegramLink: (url: string) => record("openTelegramLink", url),
    requestFullscreen: () => record("requestFullscreen"),
    exitFullscreen: () => record("exitFullscreen"),
    addToHomeScreen: () => record("addToHomeScreen"),
    checkHomeScreenStatus: (cb?: (status: string) => void) => {
      record("checkHomeScreenStatus");
      cb?.("added");
    },
    enableClosingConfirmation: () => record("enableClosingConfirmation"),
    disableClosingConfirmation: () => record("disableClosingConfirmation"),
    showAlert: (message: string, cb?: () => void) => {
      record("showAlert", message);
      cb?.();
    },
    showConfirm: (message: string, cb?: (ok: boolean) => void) => {
      record("showConfirm", message);
      cb?.(true);
    },
    showPopup: (params: unknown, cb?: (buttonId: string) => void) => {
      record("showPopup", params);
      cb?.("ok");
    },
    showScanQrPopup: (params: unknown, cb?: (text: string) => boolean | undefined) => {
      record("showScanQrPopup", params);
      cb?.("CODE-1");
    },
    closeScanQrPopup: () => record("closeScanQrPopup"),
    requestContact: (cb?: (shared: boolean) => void) => {
      record("requestContact");
      cb?.(true);
    },
    requestWriteAccess: (cb?: (granted: boolean) => void) => {
      record("requestWriteAccess");
      cb?.(false);
    },
    MainButton: button("MainButton"),
    SecondaryButton: button("SecondaryButton"),
    BackButton: { show: () => record("BackButton.show"), hide: () => record("BackButton.hide") },
    SettingsButton: {
      show: () => record("SettingsButton.show"),
      hide: () => record("SettingsButton.hide"),
    },
    HapticFeedback: {
      impactOccurred: (style: string) => record("impactOccurred", style),
      notificationOccurred: (type: string) => record("notificationOccurred", type),
      selectionChanged: () => record("selectionChanged"),
    },
    CloudStorage: {
      setItem: (key: string, value: string, cb?: (e: string | null, ok?: boolean) => void) => {
        record("CloudStorage.setItem", key, value);
        cb?.(null, true);
      },
      getItem: (key: string, cb?: (e: string | null, value?: string) => void) => {
        record("CloudStorage.getItem", key);
        cb?.(null, "stored");
      },
      getItems: (keys: string[], cb?: (e: string | null, v?: Record<string, string>) => void) => {
        record("CloudStorage.getItems", keys);
        cb?.(null, { a: "1" });
      },
      removeItem: (key: string, cb?: (e: string | null, ok?: boolean) => void) => {
        record("CloudStorage.removeItem", key);
        cb?.(null, true);
      },
      getKeys: (cb?: (e: string | null, keys?: string[]) => void) => {
        record("CloudStorage.getKeys");
        cb?.(null, ["a"]);
      },
    },
    LocationManager: {
      isInited: true,
      isLocationAvailable: true,
      isAccessRequested: true,
      isAccessGranted: true,
      init: (cb?: () => void) => {
        record("LocationManager.init");
        cb?.();
      },
      getLocation: (cb?: (data: unknown) => void) => {
        record("LocationManager.getLocation");
        cb?.({ latitude: 24.47, longitude: 39.61, horizontal_accuracy: 12 });
      },
      openSettings: () => record("LocationManager.openSettings"),
    },
  } as unknown as TelegramWebAppLike;

  const webApp = { ...base, ...overrides } as TelegramWebAppLike;
  const container = globalThis as unknown as { window?: unknown };
  container.window = {
    ...(typeof container.window === "object" ? container.window : {}),
    Telegram: { WebApp: webApp },
  };

  return {
    webApp,
    calls,
    names: () => calls.map((call) => call.name),
    emit: (event, payload) => {
      for (const handler of listeners.get(event) ?? []) handler(payload);
    },
  };
}

/** Removes the fake host: the browser/test case with no Telegram at all. */
export function removeFakeHost(): void {
  delete (globalThis as unknown as { window?: unknown }).window;
}

/**
 * Minimal `document.documentElement` so theme writes can be observed: CSS custom
 * properties, plus `lang`/`dir` for the direction layer (`F1-06`).
 */
export type FakeDocument = {
  /** CSS custom properties written through `style.setProperty`. */
  readonly variables: Map<string, string>;
  /** Current `<html lang>` / `<html dir>`. */
  root(): { lang: string; dir: string };
};

export function installFakeDocument(): FakeDocument {
  const variables = new Map<string, string>();
  const element = {
    lang: "",
    dir: "",
    style: {
      setProperty: (name: string, value: string) => {
        variables.set(name, value);
      },
    },
  };
  const container = globalThis as unknown as { document?: unknown };
  container.document = { documentElement: element };
  return {
    variables,
    root: () => ({ lang: element.lang, dir: element.dir }),
  };
}

export function removeFakeDocument(): void {
  delete (globalThis as unknown as { document?: unknown }).document;
}
