/**
 * Structural types for the Telegram WebApp host object (F1-02).
 *
 * Every member is optional on purpose: the host is an object injected by the
 * Telegram client at runtime, and its surface differs by Bot API version and by
 * platform. Nothing here is trusted, and nothing here is a Telegram *decision*:
 * these are shapes only, transcribed from the official documentation
 * (https://core.telegram.org/bots/webapps).
 *
 * These types MUST NOT leak outside `tg/` — the wrapper maps them to neutral
 * shapes before anything else sees them (ADR 0031 §3, ADR 0035 §2).
 */

/** Callback style used by every Telegram storage API: `(error, value?)`. */
export type TgStorageCallback<T> = (error: string | null, value?: T) => void;

export type TgSafeAreaInsetLike = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export type TgBottomButtonLike = {
  text: string;
  isVisible: boolean;
  isActive: boolean;
  isProgressVisible: boolean;
  setText: (text: string) => unknown;
  onClick: (callback: () => void) => unknown;
  offClick: (callback: () => void) => unknown;
  show: () => unknown;
  hide: () => unknown;
  enable: () => unknown;
  disable: () => unknown;
  showProgress: (leaveActive?: boolean) => unknown;
  hideProgress: () => unknown;
};

export type TgIconButtonLike = {
  isVisible: boolean;
  onClick: (callback: () => void) => unknown;
  offClick: (callback: () => void) => unknown;
  show: () => unknown;
  hide: () => unknown;
};

export type TgHapticFeedbackLike = {
  impactOccurred: (style: string) => unknown;
  notificationOccurred: (type: string) => unknown;
  selectionChanged: () => unknown;
};

/** `CloudStorage` (Bot API 6.9+). */
export type TgCloudStorageLike = {
  setItem: (key: string, value: string, callback?: TgStorageCallback<boolean>) => unknown;
  getItem: (key: string, callback: TgStorageCallback<string>) => unknown;
  getItems: (keys: string[], callback: TgStorageCallback<Record<string, string>>) => unknown;
  removeItem: (key: string, callback?: TgStorageCallback<boolean>) => unknown;
  removeItems: (keys: string[], callback?: TgStorageCallback<boolean>) => unknown;
  getKeys: (callback: TgStorageCallback<string[]>) => unknown;
};

/** `DeviceStorage` (Bot API 9.0+). */
export type TgDeviceStorageLike = {
  setItem: (key: string, value: string, callback?: TgStorageCallback<boolean>) => unknown;
  getItem: (key: string, callback: TgStorageCallback<string>) => unknown;
  removeItem: (key: string, callback?: TgStorageCallback<boolean>) => unknown;
  clear: (callback?: TgStorageCallback<boolean>) => unknown;
};

/**
 * `SecureStorage` (Bot API 9.0+). `getItem` reports a third argument telling
 * whether a missing key is restorable on this device.
 */
export type TgSecureStorageLike = {
  setItem: (key: string, value: string, callback?: TgStorageCallback<boolean>) => unknown;
  getItem: (
    key: string,
    callback: (error: string | null, value?: string | null, canRestore?: boolean) => void,
  ) => unknown;
  restoreItem: (key: string, callback?: TgStorageCallback<string>) => unknown;
  removeItem: (key: string, callback?: TgStorageCallback<boolean>) => unknown;
  clear: (callback?: TgStorageCallback<boolean>) => unknown;
};

/** `BiometricManager` (Bot API 7.2+). */
export type TgBiometricManagerLike = {
  isInited: boolean;
  isBiometricAvailable: boolean;
  biometricType: string;
  isAccessRequested: boolean;
  isAccessGranted: boolean;
  isBiometricTokenSaved: boolean;
  deviceId: string;
  init: (callback?: () => void) => unknown;
  requestAccess: (params: { reason?: string }, callback?: (granted: boolean) => void) => unknown;
  authenticate: (
    params: { reason?: string },
    callback?: (ok: boolean, token?: string) => void,
  ) => unknown;
  updateBiometricToken: (token: string, callback?: (updated: boolean) => void) => unknown;
  openSettings: () => unknown;
};

/** `LocationData` as delivered by Telegram — snake_case, never used outside `tg/`. */
export type TgLocationDataLike = {
  latitude: number;
  longitude: number;
  altitude: number | null;
  course: number | null;
  speed: number | null;
  horizontal_accuracy: number | null;
  vertical_accuracy: number | null;
  course_accuracy: number | null;
  speed_accuracy: number | null;
};

/** `LocationManager` (Bot API 8.0+). */
export type TgLocationManagerLike = {
  isInited: boolean;
  isLocationAvailable: boolean;
  isAccessRequested: boolean;
  isAccessGranted: boolean;
  init: (callback?: () => void) => unknown;
  getLocation: (callback: (data: TgLocationDataLike | null) => void) => unknown;
  openSettings: () => unknown;
};

export type TgPopupButtonLike = {
  id?: string;
  type?: "default" | "ok" | "close" | "cancel" | "destructive";
  text?: string;
};

export type TgPopupParamsLike = {
  title?: string;
  message: string;
  buttons?: TgPopupButtonLike[];
};

/**
 * Optional part of the host surface, added incrementally by Telegram across Bot
 * API versions. Presence of a member is never sufficient — the wrapper also
 * gates on `isVersionAtLeast` (ROADMAP §4.4 derived rule, ADR 0031 §4).
 */
export type TelegramHostExtras = {
  isActive?: boolean;
  isFullscreen?: boolean;
  safeAreaInset?: TgSafeAreaInsetLike;
  contentSafeAreaInset?: TgSafeAreaInsetLike;

  BackButton?: TgIconButtonLike;
  SettingsButton?: TgIconButtonLike;
  MainButton?: TgBottomButtonLike;
  SecondaryButton?: TgBottomButtonLike;
  HapticFeedback?: TgHapticFeedbackLike;
  CloudStorage?: TgCloudStorageLike;
  DeviceStorage?: TgDeviceStorageLike;
  SecureStorage?: TgSecureStorageLike;
  BiometricManager?: TgBiometricManagerLike;
  LocationManager?: TgLocationManagerLike;

  onEvent?: (eventType: string, handler: (payload?: unknown) => void) => unknown;
  offEvent?: (eventType: string, handler: (payload?: unknown) => void) => unknown;

  showAlert?: (message: string, callback?: () => void) => unknown;
  showConfirm?: (message: string, callback?: (confirmed: boolean) => void) => unknown;
  showPopup?: (params: TgPopupParamsLike, callback?: (buttonId?: string) => void) => unknown;
  showScanQrPopup?: (
    params: { text?: string },
    callback?: (text: string) => boolean | undefined,
  ) => unknown;
  closeScanQrPopup?: () => unknown;
  requestContact?: (callback?: (shared: boolean) => void) => unknown;
  requestWriteAccess?: (callback?: (granted: boolean) => void) => unknown;

  openLink?: (url: string, options?: { try_instant_view?: boolean }) => unknown;
  openTelegramLink?: (url: string) => unknown;

  requestFullscreen?: () => unknown;
  exitFullscreen?: () => unknown;
  addToHomeScreen?: () => unknown;
  checkHomeScreenStatus?: (callback?: (status: string) => void) => unknown;

  enableClosingConfirmation?: () => unknown;
  disableClosingConfirmation?: () => unknown;
};
