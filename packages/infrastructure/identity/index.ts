/**
 * الغرض: محوّلات (Adapters) وحدة identity — تنفيذ منافذ طبقة التطبيق
 * الحالة: منفّذ جزئياً — البند `F1-03`: التحقّق من `initData` وإصدار جلسة داخلية.
 * ينتمي إلى: infrastructure/identity
 * يُتوقع أن يستخدمه لاحقاً: apps/* عبر حقن التبعيات فقط، ولا يستوردها
 *   packages/domain/identity إطلاقاً
 * ملاحظات مستقبلية: التجديدُ نُفِّذ في `F1-04` (`miniapp-refresh.ts`) محوّلاً بلا
 *   حالةٍ خلفَ منفذٍ صريح. أمّا استمرارُ الجلسةِ على الخادمِ وإبطالُها الفوريُّ
 *   فغيرُ منفَّذَين ولا مُدَّعيَين — قرارٌ معلَنٌ لا نقصٌ مسكوتٌ عنه.
 */

export { createMemoryInitDataReplayGuard } from "./memory-init-data-replay-guard.ts";
export {
  createMiniAppRefreshTokens,
  MINIAPP_REFRESH_TTL_SECONDS,
  MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS,
  type MiniAppRefreshIssuerOptions,
} from "./miniapp-refresh.ts";
export {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
  MINIAPP_SESSION_SECRET_MIN_LENGTH,
  MINIAPP_SESSION_TTL_SECONDS,
  type MiniAppSessionIssuerOptions,
  readMiniAppSession,
  type SessionReadRejection,
  type VerifiedMiniAppSession,
} from "./miniapp-session.ts";
export { createRedisInitDataReplayGuard } from "./redis-init-data-replay-guard.ts";
export {
  createTelegramInitDataVerifier,
  dataCheckString,
  type SigningBot,
  TELEGRAM_INIT_DATA_FUTURE_SKEW_SECONDS,
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
  type TelegramInitDataVerifierOptions,
} from "./telegram-init-data.ts";
export { createViewerAccountReader } from "./viewer-account.ts";
