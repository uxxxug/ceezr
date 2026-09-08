/**
 * الغرض: مُصدِّرٌ مُعيدٌ لا أكثرَ. عميلُ Upstash نفسُه صارَ في
 *   `packages/infrastructure/redis/upstash.ts` منذُ CAP-002، لأنَّ العاملَ الخلفيَّ
 *   احتاجَ دلوَ الحدِّ الصادرِ المشتركَ، واستيرادُ `apps/workers` من `apps/gateway`
 *   خرقٌ لحدودِ التطبيقاتِ (والمسموحُ في هذه البنيةِ استيرادُ الأنواعِ وحدَها).
 *   وأُبقيَ هذا الملفُّ كي لا يتغيّرَ سطرٌ في ستّةَ عشرَ مُستورِداً قائماً.
 * الحالة: مُصدِّرٌ مُعيدٌ — لا منطقَ فيه (القاعدةُ 0.8).
 * ينتمي إلى: apps/gateway/src/redis
 */

export {
  createUpstashRedis,
  REDIS_TIMEOUT_MS,
  type RedisClient,
  type RedisFailure,
  type UpstashOptions,
} from "../../../../packages/infrastructure/redis/upstash.ts";
