/**
 * الغرض: تجميع منافذ وحالات استخدام وحدة identity
 * الحالة: منفّذ جزئياً — البند `F1-03` أضاف منفذَي الهوية والجلسة وحالةَ المبادلة.
 * ينتمي إلى: application/identity
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway (مسار الجلسة)، وبندُ `F1-04` عند التجديد.
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
} from "./exchange-telegram-session.ts";
export type {
  IssuedMiniAppSession,
  MiniAppSessionIssuer,
  SessionIssueFailure,
  TelegramIdentityProof,
  TelegramIdentityVerifier,
  TelegramProofRejection,
  TelegramProofRejectionReason,
} from "./ports.ts";
