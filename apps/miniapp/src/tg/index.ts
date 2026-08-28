/**
 * The ONLY entry point to Telegram for the whole product (F1-02).
 *
 * Everything the app is allowed to know about Telegram is re-exported here, and
 * `scripts/check-telegram-wrapper-isolation.ts` fails the build when any file
 * outside `apps/miniapp/src/tg/` touches `window.Telegram`, imports a `tg/`
 * module other than this barrel, or logs raw `initData`
 * (ADR 0031 §3 · ARCH-014 · ROADMAP §9.2).
 *
 * Not exported on purpose: `initDataUnsafe` in any form — client-side identity is
 * never trusted (ROADMAP §4.2, §9.8; verification is `F1-03`) — and any wrapper
 * for `openInvoice`, since payment is out of scope.
 */

export {
  addAppToHomeScreen,
  checkHomeScreenStatus,
  closeApp,
  exitFullscreenMode,
  expandApp,
  notifyReady,
  openExternalLink,
  openTelegramDeepLink,
  requestFullscreenMode,
  setClosingConfirmation,
} from "./app.ts";
export {
  authenticateBiometric,
  biometricState,
  initBiometrics,
  openBiometricSettings,
  requestBiometricAccess,
  type TgBiometricAuth,
  type TgBiometricState,
  updateBiometricToken,
} from "./biometrics.ts";
export {
  onBackButtonClick,
  onMainButtonClick,
  onSecondaryButtonClick,
  onSettingsButtonClick,
  setBackButtonVisible,
  setMainButton,
  setSecondaryButton,
  setSettingsButtonVisible,
  type TgBottomButtonState,
} from "./buttons.ts";
export {
  capabilityReport,
  compareVersions,
  hasCapability,
  isVersionAtLeast,
  TG_CAPABILITY_MIN_VERSION,
  type TgCapability,
} from "./capabilities.ts";
export {
  closeQrScanner,
  requestContactPermission,
  requestWriteAccessPermission,
  scanQrOnce,
  showTelegramAlert,
  showTelegramConfirm,
  showTelegramPopup,
  type TgPopupButton,
  type TgPopupRequest,
} from "./dialogs.ts";
export {
  onTelegramEvent,
  TG_EVENT_NAMES,
  type TgEventName,
  type TgEventPayloadMap,
  type TgPermissionStatus,
  type TgUnsubscribe,
} from "./events.ts";
export {
  hapticImpact,
  hapticNotification,
  hapticSelectionChanged,
  type TgImpactStyle,
  type TgNotificationType,
} from "./haptics.ts";
export {
  initLocation,
  locationAccess,
  openLocationSettings,
  requestLocation,
  type TgLocation,
  type TgLocationAccess,
} from "./location.ts";
export type { TgOutcome, TgUnavailableReason } from "./outcome.ts";
export {
  cloudStorageGet,
  cloudStorageGetMany,
  cloudStorageKeys,
  cloudStorageRemove,
  cloudStorageSet,
  deviceStorageGet,
  deviceStorageRemove,
  deviceStorageSet,
  secureStorageGet,
  secureStorageRemove,
  secureStorageRestore,
  secureStorageSet,
  type TgSecureRead,
} from "./storage.ts";
export {
  applyTelegramSafeArea,
  applyTelegramTheme,
  bindTelegramTheme,
  TG_COLOR_SCHEME_VARIABLE,
  TG_SAFE_AREA_CSS_VARIABLES,
  TG_THEME_CSS_VARIABLES,
  type TgColorScheme,
  type TgSafeAreaReport,
  type TgThemeReport,
} from "./theme.ts";
export {
  getContentSafeAreaInsets,
  getSafeAreaInsets,
  getViewport,
  type TgInsets,
  type TgViewport,
} from "./viewport.ts";
// `getWebApp`, `TelegramWebAppLike` and `ThemeParams` are intentionally NOT
// re-exported: the raw host object and Telegram's own snake_case shapes stay
// inside this directory, so «طبقة واحدة قابلة للاستبدال» stays true (ROADMAP §9.2).
export {
  describeInitData,
  getHostInfo,
  getRawInitData,
  isInsideTelegram,
} from "./webapp.ts";
