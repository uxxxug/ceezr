/**
 * الغرض: طابورُ الموتى للصادرِ على Redis (`CAP-002`/`F6-04`). رسالةٌ استُنفِدَت
 *   محاولاتُها أو رُدَّت ردًّا دائماً **لا تُبتلَعُ صامتةً**: تُقيَّدُ في قائمةٍ
 *   محدودةِ الطولِ يقرؤها المشغِّلُ، فيُعرَفُ ما ضاعَ ولمن ولماذا.
 * الحالة: منفّذٌ فعلياً — `CAP-002`/`F6-04`.
 * ينتمي إلى: infrastructure/notification
 * يُستخدم من: apps/gateway/src/container.ts، apps/workers/src/container.ts
 * ملاحظات مستقبلية: **هذا سجلٌّ للتشخيصِ لا صندوقُ إعادةِ إرسالٍ.** وإعادةُ الإرسالِ
 *   من صندوقِ الصادرِ في PostgreSQL وحدَه — فهو الصامدُ المحكومُ بـ`city_id` و`RLS`.
 */

import type { RedisClient } from "../redis/upstash.ts";
import type { OutboundDeadLetter, OutboundDeadLetterSink } from "./rate-aware-telegram-sender.ts";

export const DEAD_LETTER_KEY = "waslah:outbound:dead";

export interface RedisDeadLetterOptions {
  readonly key?: string;
  /** أقصى عددِ قيودٍ محفوظةٍ. القديمُ يُقصَّ فلا ينمو المفتاحُ بلا حدٍّ. */
  readonly capacity?: number;
  /** عمرُ القائمةِ بالثواني. سجلُّ تشخيصٍ لا أرشيفٌ أبديٌّ. */
  readonly ttlSeconds?: number;
  readonly onFailure?: (detail: string) => void;
}

/**
 * `LPUSH` ثمَّ `LTRIM` ثمَّ `EXPIRE` في `MULTI` واحدٍ — لا ثلاثةُ طلباتٍ يُقطَعُ
 * بينَها فيبقى المفتاحُ بلا قصٍّ أو بلا مهلةٍ. وهو الدرسُ نفسُه المُستفادُ في
 * `BUG-006` حينَ فُقِدَت مهلةُ حدِّ الوارِدِ بينَ `INCR` و`EXPIRE`.
 */
const DEAD_LETTER_SCRIPT = [
  "local key = KEYS[1]",
  "local entry = ARGV[1]",
  "local capacity = tonumber(ARGV[2])",
  "local ttl = tonumber(ARGV[3])",
  "redis.call('LPUSH', key, entry)",
  "redis.call('LTRIM', key, 0, capacity - 1)",
  "redis.call('EXPIRE', key, ttl)",
  "return redis.call('LLEN', key)",
].join("\n");

/**
 * **لا يرمي أبداً ولا يُفشِلُ نداءَ الإرسالِ**: عجزُ سجلِّ التشخيصِ لا يجوزُ أن
 * يُضيفَ عطلاً ثانياً فوقَ العطلِ الذي جاءَ يُسجِّلُه. يُبلَّغُ العجزُ عبرَ
 * `onFailure` ويمضي.
 */
export function createRedisDeadLetterSink(
  redis: RedisClient,
  options: RedisDeadLetterOptions = {},
): OutboundDeadLetterSink {
  const key = options.key ?? DEAD_LETTER_KEY;
  const capacity = options.capacity ?? 500;
  const ttlSeconds = options.ttlSeconds ?? 7 * 24 * 60 * 60;

  return {
    record: async (letter: OutboundDeadLetter) => {
      let entry: string;
      try {
        entry = JSON.stringify(letter);
      } catch (error) {
        options.onFailure?.(`تعذّرَ ترميزُ القيدِ: ${String(error)}`);
        return;
      }
      const result = await redis.command([
        "EVAL",
        DEAD_LETTER_SCRIPT,
        "1",
        key,
        entry,
        String(capacity),
        String(ttlSeconds),
      ]);
      if (!result.ok) options.onFailure?.(`${result.error.kind}: ${result.error.detail}`);
    },
  };
}
