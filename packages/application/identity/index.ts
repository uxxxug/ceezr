/**
 * الغرض: تجميع منافذ وحالات استخدام وحدة identity
 * الحالة: منفّذ جزئياً — `F1-03` أضاف منفذَي الهوية والجلسة وحالةَ المبادلة، و`F1-04`
 *   أضاف منافذَ التجديدِ وحالةَ استخدامِه، و`F1-05` أضاف قراءةَ الدورِ والحالة.
 * ينتمي إلى: application/identity
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway (مسارا الجلسةِ والتجديد).
 * ملاحظات مستقبلية: حوارُ البوتِ وربطُ المستخدمِ ما زالا في
 *   packages/application/bots/driver-dialog.ts ودوالِّ SQL في supabase/migrations —
 *   انظر admin_set_user_blocked وadmin_set_driver_verification. ولا يُنقلان إلى هنا
 *   إلا بأمرِ تفعيلٍ صريح.
 */
export {
  type ExchangeTelegramSessionDeps,
  type ExchangeTelegramSessionError,
  type ExchangeTelegramSessionInput,
  type ExchangeTelegramSessionOutput,
  exchangeTelegramSession,
  type PublicRejectionCode,
  publicCodeFor,
  type SessionRefreshChain,
} from "./exchange-telegram-session.ts";
export type {
  IssuedMiniAppRefresh,
  IssuedMiniAppRefreshWithGrant,
  IssuedMiniAppSession,
  MiniAppRefreshTokenIssuer,
  MiniAppSessionGrantIssuer,
  MiniAppSessionIssuer,
  MiniAppSessionReader,
  MiniAppSessionRenewalGrant,
  RefreshTokenRejection,
  RefreshTokenRejectionReason,
  SessionIssueFailure,
  TelegramIdentityProof,
  TelegramIdentityVerifier,
  TelegramProofRejection,
  TelegramProofRejectionReason,
  VerifiedViewerSession,
  ViewerAccount,
  ViewerAccountReader,
  ViewerLookupFailure,
  ViewerLookupFailureReason,
  ViewerRole,
  ViewerSessionRejection,
  ViewerSessionRejectionReason,
  ViewerStatus,
} from "./ports.ts";
export {
  type PublicRenewRejectionCode,
  publicRenewCodeFor,
  type RenewMiniAppSessionDeps,
  type RenewMiniAppSessionError,
  type RenewMiniAppSessionInput,
  type RenewMiniAppSessionOutput,
  renewMiniAppSession,
} from "./renew-miniapp-session.ts";
export {
  publicViewerCodeFor,
  type ResolvedViewerRole,
  type ResolveViewerDeps,
  type ResolveViewerError,
  type ResolveViewerInput,
  type ResolveViewerOutput,
  resolveViewer,
  type ViewerPublicErrorCode,
} from "./resolve-viewer.ts";
