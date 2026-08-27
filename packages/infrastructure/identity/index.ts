/**
 * الغرض: محوّلات (Adapters) وحدة identity — تنفيذ منافذ طبقة التطبيق
 * الحالة: منفّذ جزئياً — البند `F1-03`: التحقّق من `initData` وإصدار جلسة داخلية.
 * ينتمي إلى: infrastructure/identity
 * يُتوقع أن يستخدمه لاحقاً: apps/* عبر حقن التبعيات فقط، ولا يستوردها
 *   packages/domain/identity إطلاقاً
 * ملاحظات مستقبلية: استمرارُ الجلسةِ وإبطالُها وتجديدُها = البند `F1-04`، ويُنفَّذ
 *   محوّلاً بديلاً خلف نفس المنفذ لا تعديلاً في العقد.
 */
export {
  createMiniAppSessionIssuer,
  MINIAPP_SESSION_SECRET_MIN_LENGTH,
  MINIAPP_SESSION_TTL_SECONDS,
  type MiniAppSessionIssuerOptions,
  readMiniAppSession,
  type SessionReadRejection,
  type VerifiedMiniAppSession,
} from "./miniapp-session.ts";
export {
  createTelegramInitDataVerifier,
  dataCheckString,
  type SigningBot,
  TELEGRAM_INIT_DATA_FUTURE_SKEW_SECONDS,
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
  type TelegramInitDataVerifierOptions,
} from "./telegram-init-data.ts";
