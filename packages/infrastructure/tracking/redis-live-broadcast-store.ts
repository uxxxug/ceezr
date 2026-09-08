/**
 * الغرض: تنفيذُ Redis (Upstash REST) لـ`LiveBroadcastStore` — مخزنُ البثّ المشترك
 *   للإنتاج. يحلُّ `SCL-005`: حالةٌ مشتركةٌ بينَ النسخِ + ادّعاءٌ ذرّيٌّ لبدءِ البثّ.
 * الحالة: منفّذ فعلياً — `SCL-005`.
 * ينتمي إلى: infrastructure/tracking
 *
 * ## لماذا Redis لا عمودُ `orders`
 *
 * هذا مقبضٌ عابرٌ لقناةِ تلغرام لا حقيقةُ مجالٍ دائمة: له TTL طبيعيٌّ يزولُ فيه
 * من تلقاءِ نفسِه، وسيُحذفُ كليّاً مع `F4-07`. وعمودُ `orders` يطلبُ هجرةً ومعاملةً
 * حولَ نداءِ تلغرام الخارجيّ. والـ`SET NX` في Redis يمنحُ الادّعاءَ الذرّيَّ بلا
 * جدولٍ ولا قفلِ صفٍّ — وهذا جوهرُ منعِ فتحِ رسالتَي بثٍّ متزامنتَين.
 *
 * ## الفشلُ غيرُ قاتل
 *
 * كلُّ أمرٍ يعيدُ `Result`. والإخفاقُ (انقطاعُ Redis) لا يُسقطُ الحدثَ صامتاً بل
 * يُسجَّلُ: فالعرضُ نقطةٌ واحدةٌ تُستبدَلُ بأحدثِ ما وصل، والحدثُ التالي يُعيدُ
 * المحاولة. وهذا يُحاكي سلوكَ `channel.update` نفسَه (لا يرمي).
 */

import type { RedisClient } from "../../../apps/gateway/src/redis/upstash.ts";
import type {
  BroadcastState,
  LiveBroadcastStore,
} from "../../../packages/application/tracking/live-broadcast-store.ts";

const STATE_PREFIX = "live:broadcast:state:";
const CLAIM_PREFIX = "live:broadcast:claim:";

/** سكربتُ Lua لتحريرِ الادّعاءِ بأمان: يحذفُ المفتاحَ فقط إن كان الرمزُ صاحبَه. */
const RELEASE_CLAIM_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export function createRedisLiveBroadcastStore(redis: RedisClient): LiveBroadcastStore {
  return {
    async get(tripId: string): Promise<BroadcastState | null> {
      const result = await redis.command(["GET", `${STATE_PREFIX}${tripId}`]);
      if (!result.ok) return null;
      const raw = result.value;
      if (typeof raw !== "string" || raw.length === 0) return null;
      try {
        const parsed = JSON.parse(raw) as BroadcastState;
        if (
          typeof parsed.chatId !== "string" ||
          typeof parsed.messageId !== "string" ||
          typeof parsed.sessionId !== "string"
        ) {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    },

    async save(tripId: string, state: BroadcastState, ttlMs: number): Promise<void> {
      await redis.command([
        "SET",
        `${STATE_PREFIX}${tripId}`,
        JSON.stringify(state),
        "PX",
        String(Math.max(1, Math.floor(ttlMs))),
      ]);
    },

    async delete(tripId: string): Promise<void> {
      await redis.command(["DEL", `${STATE_PREFIX}${tripId}`]);
    },

    async claimStart(tripId: string, token: string, ttlMs: number): Promise<boolean> {
      const result = await redis.command([
        "SET",
        `${CLAIM_PREFIX}${tripId}`,
        token,
        "NX",
        "PX",
        String(Math.max(1, Math.floor(ttlMs))),
      ]);
      // Upstash يردّ "OK" عند النجاح، و`null` عند وجود المفتاح مسبقاً.
      return result.ok && result.value === "OK";
    },

    async releaseClaim(tripId: string, token: string): Promise<void> {
      await redis.command(["EVAL", RELEASE_CLAIM_LUA, "1", `${CLAIM_PREFIX}${tripId}`, token]);
    },
  };
}
