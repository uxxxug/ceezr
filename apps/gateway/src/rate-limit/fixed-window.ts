/**
 * الغرض: عدّاد نافذة ثابتة لتحديد معدّل الطلبات — في الذاكرة، وعلى Redis عند تعدّد
 *   النسخ حيث لا معنى لحدٍّ يعدّ كل نسخة وحدها.
 * الحالة: منفّذ فعلياً — القسم 2 البند د.4.
 * ينتمي إلى: apps/gateway/src/rate-limit
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/telegram-webhook.ts
 * ملاحظات مستقبلية: النافذة الثابتة تسمح بضِعف الحدّ على حدّ نافذتين متجاورتين؛
 *   لو صار هذا مهمّاً فالنافذة المنزلقة بـ ZSET نفس المنفذ بلا تغيير أي مسار.
 */

import type { RedisClient } from "../redis/upstash.ts";

export interface RateDecision {
  readonly allowed: boolean;
  /** ما تبقّى من الحدّ بعد احتساب هذا الطلب. سالبٌ لا يُعاد: الأدنى صفر. */
  readonly remaining: number;
  /** ثوانٍ حتى تُفتح النافذة التالية — تُرسَل في Retry-After. */
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
 * حدٌّ في ذاكرة العملية. صالح لنسخة واحدة، وصالح للاختبار دائماً. مع نسختين يصير
 * الحدّ الفعلي ضِعف المُعلَن — وهذا مذكور صريحاً لا مسكوتٌ عنه، ولذلك يوجد البديل.
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
}

/** بادئة مفاتيح الحدّ، منفصلة عن بادئة الجلسات فلا يُمحى أحدهما مع الآخر. */
export const RATE_LIMIT_PREFIX = "waslah:rate";

/**
 * الحدّ على Redis: `INCR` ثم `EXPIRE` عند أول طلب في النافذة وحده — لا مع كل طلب،
 * وإلا لتجدّدت النافذة بلا نهاية فلم تنتهِ أبداً ما دام المهاجم يطرق.
 *
 * سياسة الفشل: **يُسمح** عند عجز Redis لا يُمنع. حدّ المعدّل حماية لا مصادقة؛ ومن
 * جعل انقطاع Redis يمنع كل تحديثات تلغرام حوّل خدمةً مساعِدة إلى نقطة فشل للمنصّة
 * كلّها — نفس المبدأ الذي بُني عليه ADR 0010. والسرّ المشترك يبقى قائماً بلا Redis.
 */
export function createRedisRateLimiter(
  redis: RedisClient,
  options: RedisRateLimiterOptions,
): RateLimiter {
  const prefix = options.prefix ?? RATE_LIMIT_PREFIX;

  return {
    hit: async (key: string): Promise<RateDecision> => {
      const allowOnFailure: RateDecision = {
        allowed: true,
        remaining: options.limit,
        resetSeconds: options.windowSeconds,
      };
      const fullKey = `${prefix}:${key}`;
      const incremented = await redis.command(["INCR", fullKey]);
      if (!incremented.ok) {
        options.onFailure?.(`${incremented.error.kind}: ${incremented.error.detail}`);
        return allowOnFailure;
      }

      const count = Number(incremented.value);
      if (!Number.isFinite(count)) {
        options.onFailure?.("جواب INCR ليس رقماً");
        return allowOnFailure;
      }

      if (count === 1) {
        const expired = await redis.command(["EXPIRE", fullKey, options.windowSeconds]);
        if (!expired.ok) options.onFailure?.(`EXPIRE: ${expired.error.detail}`);
      }

      return {
        allowed: count <= options.limit,
        remaining: Math.max(0, options.limit - count),
        // النافذة الثابتة لا تُخبرنا بالمتبقّي بلا نداء ثالث (TTL). طول النافذة
        // تقديرٌ آمن: يُطيل انتظار المتجاوز ولا يُقصّره.
        resetSeconds: options.windowSeconds,
      };
    },
  };
}
