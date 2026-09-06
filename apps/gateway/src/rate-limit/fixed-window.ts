/**
 * الغرض: تحديدُ معدّلِ الطلبات — في الذاكرة (نافذةٌ ثابتةٌ)، وعلى Redis عند تعدّدِ
 *   النسخ حيث لا معنى لحدٍّ يعدُّ كلُّ نسخةٍ وحدها. حدُّ Redis نافذةٌ منزلقةٌ ذرّيّةٌ
 *   في سكربتِ Lua واحدٍ يُرسَل عبرَ `EVAL` على منفذِ Upstash REST نفسِه — فلا أمرانِ
 *   منفصلانِ (`INCR` ثمَّ `EXPIRE`) تُفقدُ مهلتُهما بينَهما فيبقى المفتاحُ بلا انتهاءٍ.
 * الحالة: منفّذٌ فعلياً — `BUG-006` (ADR 0055).
 * ينتمي إلى: apps/gateway/src/rate-limit
 * يُتوقَّع أن يستخدمه لاحقاً: apps/gateway/src/routes/telegram-webhook.ts
 * ملاحظاتٌ مستقبليّةٌ: النافذةُ المنزلقةُ لا تسمحُ بضعفِ الحدِّ على حدِّ نافذتينِ
 *   متجاورتينِ كما تفعلُ النافذةُ الثابتةُ. ولو احتيجَ حدٌّ أدقُّ فالـtoken bucket
 *   نفسُ المنفذِ بلا تغييرِ أيِّ مسارٍ.
 */

import type { RedisClient } from "../redis/upstash.ts";

export interface RateDecision {
  readonly allowed: boolean;
  /** ما تبقّى من الحدّ بعد احتساب هذا الطلب. سالبٌ لا يُعاد: الأدنى صفر. */
  readonly remaining: number;
  /** ثوانٍ حتى يُفتحَ مجالٌ جديدٌ — تُرسَل في Retry-After. */
  readonly resetSeconds: number;
}

export interface RateLimiter {
  /** يحتسب طلباً واحداً على المفتاح ويقرّر. لا يرمي أبداً. */
  hit(key: string): Promise<RateDecision>;
}

export interface WindowOptions {
  /** أقصى عدد طلبات مسموح في النافذة. */
  readonly limit: number;
  /** طول النافذة بالثواني. */
  readonly windowSeconds: number;
}

/**
 * حدٌّ في ذاكرةِ العمليةِ بنافذةٍ ثابتةٍ. صالحٌ لنسخةٍ واحدةٍ، وصالحٌ للاختبارِ
 * دائماً. مع نسختَينِ يصيرُ الحدُّ الفعليُّ ضِعفَ المُعلَن — وهذا مذكورٌ صريحاً لا
 * مسكوتٌ عنه، ولذلك يوجدُ البديلُ الموزَّعُ أدناه.
 */
export function createMemoryRateLimiter(
  options: WindowOptions,
  nowMs: () => number = Date.now,
): RateLimiter & { readonly size: () => number } {
  const windowMs = options.windowSeconds * 1000;
  const counters = new Map<string, { count: number; startedAtMs: number }>();

  return {
    size: () => counters.size,
    hit: async (key: string): Promise<RateDecision> => {
      const now = nowMs();
      // التنظيف مع كل نداء: العدّادات المنتهية لا تُترك تتكدّس بمفاتيح مهاجم
      // يبدّل عنوانه كل طلب — وهو أوّل من يُتوقَّع منه ذلك.
      for (const [existing, entry] of counters) {
        if (now - entry.startedAtMs >= windowMs) counters.delete(existing);
      }

      const entry = counters.get(key);
      if (entry === undefined) {
        counters.set(key, { count: 1, startedAtMs: now });
        return {
          allowed: true,
          remaining: options.limit - 1,
          resetSeconds: options.windowSeconds,
        };
      }

      entry.count += 1;
      const elapsedMs = now - entry.startedAtMs;
      const resetSeconds = Math.max(1, Math.ceil((windowMs - elapsedMs) / 1000));
      return {
        allowed: entry.count <= options.limit,
        remaining: Math.max(0, options.limit - entry.count),
        resetSeconds,
      };
    },
  };
}

export interface RedisRateLimiterOptions extends WindowOptions {
  readonly prefix?: string;
  readonly onFailure?: (detail: string) => void;
  /**
   * ساعةٌ قابلةٌ للحقنِ للاختبارِ. في الإنتاجِ `Date.now`. تُمرَّر إلى السكربتِ
   * حجّةً، فلا يعتمدُ على ساعةِ الخادمِ ولا على فرقِ التوقيتِ بينَ الجانبَينِ.
   */
  readonly nowMs?: () => number;
}

/** بادئةُ مفاتيحِ الحدِّ، منفصلةٌ عن بادئةِ الجلساتِ فلا يُمحى أحدُهما مع الآخر. */
export const RATE_LIMIT_PREFIX = "waslah:rate";

/**
 * سكربتُ Lua الواحدُ الذرّيُّ: يزيلُ القديمَ، يعدُّ الحاضرَ، فإن كان دونَ الحدِّ
 * أضافَ عضواً وضبطَ المهلةَ — كلُّ ذلك في خطوةٍ واحدةٍ على الخادمِ لا في طلبَينِ.
 * القيمةُ المعادةُ ثلاثيٌّ: `[مسموحٌ (١/٠)، متبقّي، مللي ثانية حتى الانفتاح]`.
 *
 * `KEYS[1]` = مفتاحُ الحدِّ (ZSET) · `ARGV[1]` = الحدُّ · `ARGV[2]` = طولُ النافذةِ
 * بالمللي ثانيةِ · `ARGV[3]` = الآنَ بالمللي ثانيةِ · `ARGV[4]` = معرّفُ عضوٍ فريدٌ
 * لكلِّ طلبٍ (الآن + ملحٌّ + عدّادٌ) حتّى لا يُحدِّثَ ZADD عضواً موجوداً فيُعدَّ ناقصاً.
 */
const RATE_LIMIT_SCRIPT = [
  "local key = KEYS[1]",
  "local limit = tonumber(ARGV[1])",
  "local window_ms = tonumber(ARGV[2])",
  "local now = tonumber(ARGV[3])",
  "local member = ARGV[4]",
  "local cutoff = now - window_ms",
  "redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)",
  "local count = redis.call('ZCARD', key)",
  "if count < limit then",
  "  redis.call('ZADD', key, now, member)",
  "  redis.call('PEXPIRE', key, window_ms)",
  "  return {1, limit - count - 1, window_ms}",
  "else",
  "  redis.call('PEXPIRE', key, window_ms)",
  "  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')",
  "  local reset_ms = window_ms",
  "  if oldest ~= nil and oldest[2] ~= nil then",
  "    reset_ms = math.floor(tonumber(oldest[2]) + window_ms - now)",
  "    if reset_ms < 1 then reset_ms = 1 end",
  "  end",
  "  return {0, 0, reset_ms}",
  "end",
].join("\n");

/**
 * الحدُّ على Redis: سكربتُ Lua واحدٌ ذرّيٌّ عبرَ `EVAL`. كانَ قبلاً `INCR` ثمَّ
 * `EXPIRE` عندَ أوّلِ طلبٍ في النافذةِ وحدَه — فإذا انقطعَ الطلبُ بينَ الأمرَينِ أو
 * خَفِقَ `EXPIRE` بقيَ المفتاحُ بلا مهلةٍ فلم ينتهِ أبداً. والآنَ العدُّ وضبطُ المهلةِ
 * خطوةٌ واحدةٌ على الخادمِ، فلا تُفقدُ المهلةُ ولا تُتجاوزُ الحدودُ عندَ التزامنِ.
 *
 * سياسةُ الفشلِ: **يُسمحُ** عندَ عجزِ Redis لا يُمنعُ. حدُّ المعدّلِ حمايةٌ لا مصادقةٌ؛
 * ومن جعلَ انقطاعَ Redis يمنعُ كلَّ تحديثاتِ تيليجرام حوّلَ خدمةً مساعِدةً إلى نقطةِ فشلٍ
 * للمنصّةِ كلِّها — نفسُ المبدأِ الذي بُنيَ عليهِ [ADR 0010](../adr/0010-translation-is-optional-service-not-bootstrap-requirement.md).
 * والسرُّ المشتركُ يبقى حاجزاً مستقلًّا بلا Redis. معتمدةٌ في [ADR 0055](../../docs/adr/0055-redis-rate-limit-is-atomic-lua-and-fails-open.md).
 */
export function createRedisRateLimiter(
  redis: RedisClient,
  options: RedisRateLimiterOptions,
): RateLimiter {
  const prefix = options.prefix ?? RATE_LIMIT_PREFIX;
  const nowMs = options.nowMs ?? Date.now;
  const windowMs = options.windowSeconds * 1000;
  // ملحٌّ لكلِّ محدِّدٍ + عدّادٌ متصاعدٌ: معرِّفُ عضوٍ فريدٌ عبرَ النسخِ والزمنِ.
  const salt = Math.random().toString(36).slice(2, 8);
  let nonce = 0;

  return {
    hit: async (key: string): Promise<RateDecision> => {
      const allowOnFailure: RateDecision = {
        allowed: true,
        remaining: options.limit,
        resetSeconds: options.windowSeconds,
      };
      const fullKey = `${prefix}:${key}`;
      const now = nowMs();
      const member = `${now}:${salt}:${nonce}`;
      nonce += 1;
      const result = await redis.command([
        "EVAL",
        RATE_LIMIT_SCRIPT,
        "1",
        fullKey,
        String(options.limit),
        String(windowMs),
        String(now),
        member,
      ]);
      if (!result.ok) {
        options.onFailure?.(`${result.error.kind}: ${result.error.detail}`);
        return allowOnFailure;
      }

      const value = result.value;
      if (!Array.isArray(value) || value.length < 3) {
        options.onFailure?.("جوابُ EVAL ليس ثلاثيًّا");
        return allowOnFailure;
      }
      const allowed = Number(value[0]) === 1;
      const remaining = Math.max(0, Math.floor(Number(value[1])));
      const resetMs = Number(value[2]);
      if (!Number.isFinite(remaining) || !Number.isFinite(resetMs)) {
        options.onFailure?.("جوابُ EVAL ليس أرقامًا");
        return allowOnFailure;
      }

      return {
        allowed,
        remaining,
        resetSeconds: Math.max(1, Math.ceil(resetMs / 1000)),
      };
    },
  };
}
