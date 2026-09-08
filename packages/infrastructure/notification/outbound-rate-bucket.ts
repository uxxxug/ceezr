/**
 * الغرض: دلوُ معدّلٍ **مشتركٌ** للصادرِ إلى تيليجرام (`CAP-002`/`F6-04`). حدُّ Bot API
 *   حدٌّ على **البوتِ** لا على النسخةِ، فدلوٌ في ذاكرةِ كلِّ نسخةٍ يعني ضربَ الحدِّ
 *   المُعلَنِ في عددِ النسخِ — وهو بعينِه ما يُنتِجُ `429`. فالدلوُ الإنتاجيُّ على
 *   Redis مشتركٌ بينَ النسخِ، بسكربتِ Lua واحدٍ ذرّيٍّ عبرَ `EVAL`.
 * الحالة: منفّذٌ فعلياً — `CAP-002`/`F6-04`.
 * ينتمي إلى: infrastructure/notification
 * يُستخدم من: packages/infrastructure/notification/rate-aware-telegram-sender.ts
 * ملاحظات مستقبلية: المنفذُ لا يعرفُ تيليجرام؛ فأيُّ صادرٍ آخرَ محكومٍ بحدٍّ عالميٍّ
 *   (بريدٌ أو رسائلُ نصّيّةٌ) يستعملُ الدلوَ نفسَه بنطاقٍ آخرَ بلا تغييرِ سطرٍ ههنا.
 */

import type { RedisClient } from "../redis/upstash.ts";

/**
 * نطاقُ الحدِّ. تيليجرام يفرضُ حدَّينِ مختلفَينِ في طبيعتِهما لا في مقدارِهما وحدَه:
 * سقفٌ **عالميٌّ** على البوتِ كلِّه، وسقفٌ **لكلِّ محادثةٍ** على حِدَةٍ. من عدَّهما
 * عدّاداً واحداً إمّا خنقَ البوتَ كلَّه لأجلِ محادثةٍ ثرثارةٍ، وإمّا أطلقَ محادثةً
 * واحدةً حتى تستهلكَ حصّةَ البوتِ كلِّها.
 */
export type OutboundRateScope = "global" | "chat";

/** حكمُ الدلوِ: إمّا فتحةٌ مُنِحَت الآنَ، وإمّا انتظارٌ بمقدارٍ مُعلَنٍ. */
export interface OutboundRateSlot {
  readonly granted: boolean;
  /** مللي ثانيةٍ حتى تُتوقَّعَ فتحةٌ. صفرٌ عندَ المنحِ. تقديرٌ لا وعدٌ. */
  readonly waitMs: number;
}

export interface OutboundRateBucket {
  /**
   * يحاولُ حجزَ فتحةٍ واحدةٍ. **لا يرمي أبداً ولا ينامُ**: يُعيدُ الحكمَ، والانتظارُ
   * قرارُ المُرسِلِ لا قرارُ الدلوِ — فمن نامَ داخلَ الدلوِ حجبَ عن مُنادِيه القدرةَ
   * على تفضيلِ رسالةٍ حرجةٍ على أخرى أو التخلّي عن غيرِ الحرجةِ.
   */
  acquire(scope: OutboundRateScope, key: string): Promise<OutboundRateSlot>;
}

/** حدٌّ واحدٌ: كم فتحةً في كم مللي ثانيةٍ. */
export interface OutboundRateLimit {
  readonly limit: number;
  readonly windowMs: number;
}

export interface OutboundRateLimits {
  readonly global: OutboundRateLimit;
  readonly chat: OutboundRateLimit;
}

/**
 * الحدودُ الافتراضيّةُ مشتقّةٌ من حدودِ Bot API المُعلَنةِ في
 * https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this
 * (نحوَ ثلاثينَ رسالةً في الثانيةِ للبوتِ، ونحوَ رسالةٍ في الثانيةِ للمحادثةِ
 * الواحدةِ). **وهذه حدودُ منصّةٍ تقنيّةٍ لا سياسةُ تسعيرٍ**، فموضعُها الإعدادُ لا
 * `platform_settings`: لا تختلفُ من مدينةٍ إلى مدينةٍ ولا يملكُ المشغِّلُ تغييرَها —
 * تيليجرام يملكُها. ولذلك لا تخالفُ القاعدةَ 0.3 من `MASTER_DIRECTIVE`.
 *
 * وهي **دونَ** الحدِّ المُعلَنِ قصداً: من سارَ على الحافّةِ بالضبطِ اصطدمَ بها عندَ
 * أوّلِ تفاوتِ ساعاتٍ بينَ نسخةٍ وأخرى.
 */
export const DEFAULT_OUTBOUND_RATE_LIMITS: OutboundRateLimits = {
  global: { limit: 25, windowMs: 1000 },
  chat: { limit: 1, windowMs: 1000 },
};

function limitFor(limits: OutboundRateLimits, scope: OutboundRateScope): OutboundRateLimit {
  return scope === "global" ? limits.global : limits.chat;
}

/**
 * دلوٌ في ذاكرةِ العمليةِ. **صالحٌ لنسخةٍ واحدةٍ وللاختبارِ، وغيرُ صالحٍ لتعدّدِ
 * النسخِ** — وهذا مذكورٌ صريحاً لا مسكوتٌ عنه، ولذلك يوجدُ البديلُ المشتركُ أدناه.
 * نافذةٌ منزلقةٌ بطوابعَ زمنيّةٍ لا نافذةٌ ثابتةٌ: الثابتةُ تسمحُ بضِعفِ الحدِّ على
 * حدِّ نافذتَينِ متجاورتَينِ، وضِعفُ الحدِّ ههنا `429` من تيليجرام لا رقمٌ في تقرير.
 */
export function createMemoryOutboundRateBucket(
  limits: OutboundRateLimits = DEFAULT_OUTBOUND_RATE_LIMITS,
  nowMs: () => number = Date.now,
): OutboundRateBucket & { readonly size: () => number } {
  const hits = new Map<string, number[]>();

  return {
    size: () => hits.size,
    acquire: async (scope, key) => {
      const { limit, windowMs } = limitFor(limits, scope);
      const now = nowMs();
      const cutoff = now - windowMs;
      const full = `${scope}:${key}`;

      // تنظيفٌ شاملٌ مع كلِّ نداءٍ: مفاتيحُ المحادثاتِ لا حدَّ لعددِها، ومن تركَها
      // تتكدّسُ سرَّبَ ذاكرةً بعددِ من راسلَهم البوتُ منذُ الإقلاعِ.
      for (const [existing, stamps] of hits) {
        const kept = stamps.filter((at) => at > cutoff);
        if (kept.length === 0) hits.delete(existing);
        else hits.set(existing, kept);
      }

      const stamps = hits.get(full) ?? [];
      if (stamps.length < limit) {
        stamps.push(now);
        hits.set(full, stamps);
        return { granted: true, waitMs: 0 };
      }
      const oldest = stamps[0] ?? now;
      return { granted: false, waitMs: Math.max(1, oldest + windowMs - now) };
    },
  };
}

/**
 * سكربتُ Lua الواحدُ الذرّيُّ: يُزيلُ ما خرجَ من النافذةِ، يعدُّ الباقيَ، فإن كان
 * دونَ الحدِّ أضافَ عضواً وضبطَ المهلةَ — كلُّ ذلك خطوةً واحدةً على الخادمِ. ولو
 * كانَ أمرَينِ (`ZCARD` ثمَّ `ZADD`) لَسبقَت نسختانِ إحداهما الأخرى بينَهما فتجاوزَتا
 * الحدَّ معاً — وهو بعينِه العيبُ الذي كانَ في حدِّ الوارِدِ وأُصلِحَ في `BUG-006`.
 *
 * `KEYS[1]` مفتاحُ الدلوِ (ZSET) · `ARGV[1]` الحدُّ · `ARGV[2]` طولُ النافذةِ
 * بالمللي · `ARGV[3]` الآنَ بالمللي · `ARGV[4]` معرّفُ عضوٍ فريدٌ لكلِّ محاولةٍ
 * (وإلّا حدَّثَ `ZADD` عضواً موجوداً فعُدَّ واحداً مكانَ اثنَينِ).
 *
 * العائدُ ثنائيٌّ: `[مُنِحَ (١/٠)، مللي الانتظارِ]`.
 */
const OUTBOUND_BUCKET_SCRIPT = [
  "local key = KEYS[1]",
  "local limit = tonumber(ARGV[1])",
  "local window_ms = tonumber(ARGV[2])",
  "local now = tonumber(ARGV[3])",
  "local member = ARGV[4]",
  "redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window_ms)",
  "local count = redis.call('ZCARD', key)",
  "if count < limit then",
  "  redis.call('ZADD', key, now, member)",
  "  redis.call('PEXPIRE', key, window_ms)",
  "  return {1, 0}",
  "end",
  "redis.call('PEXPIRE', key, window_ms)",
  "local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')",
  "local wait = window_ms",
  "if oldest ~= nil and oldest[2] ~= nil then",
  "  wait = math.floor(tonumber(oldest[2]) + window_ms - now)",
  "  if wait < 1 then wait = 1 end",
  "end",
  "return {0, wait}",
].join("\n");

/** بادئةُ مفاتيحِ دلوِ الصادرِ — منفصلةٌ عن بادئةِ حدِّ الوارِدِ وعن الجلساتِ. */
export const OUTBOUND_BUCKET_PREFIX = "waslah:outbound";

export interface RedisOutboundRateBucketOptions {
  readonly limits?: OutboundRateLimits;
  readonly prefix?: string;
  readonly nowMs?: () => number;
  readonly onFailure?: (detail: string) => void;
}

/**
 * الدلوُ المشتركُ على Redis. **وسياسةُ الفشلِ ههنا «مغلقٌ بانتظارٍ» لا «مفتوحٌ»** —
 * وهذا عكسُ حدِّ الوارِدِ في [ADR 0055](../../../docs/adr/0055-redis-rate-limit-is-atomic-lua-and-fails-open.md)،
 * والفرقُ مقصودٌ ومُعلَّلٌ: حدُّ الوارِدِ **حمايةٌ لنا** فتعطُّلُه يُسقِطُ حمايةً؛
 * وحدُّ الصادرِ **عقدٌ مع تيليجرام** فتعطُّلُه يُسقِطُ عقداً — ومن أرسلَ بلا حدٍّ لأنَّ
 * Redis عجزَ قابلَه `429` ثمَّ حظرٌ مؤقّتٌ للبوتِ كلِّه. فعندَ العجزِ يُعادُ
 * `granted: false` بانتظارِ نافذةٍ واحدةٍ: تباطؤٌ محسوسٌ لا انقطاعٌ ولا فيضٌ.
 */
export function createRedisOutboundRateBucket(
  redis: RedisClient,
  options: RedisOutboundRateBucketOptions = {},
): OutboundRateBucket {
  const limits = options.limits ?? DEFAULT_OUTBOUND_RATE_LIMITS;
  const prefix = options.prefix ?? OUTBOUND_BUCKET_PREFIX;
  const nowMs = options.nowMs ?? Date.now;
  const salt = Math.random().toString(36).slice(2, 8);
  let nonce = 0;

  return {
    acquire: async (scope, key) => {
      const { limit, windowMs } = limitFor(limits, scope);
      const now = nowMs();
      const member = `${now}:${salt}:${nonce}`;
      nonce += 1;
      const denyOnFailure: OutboundRateSlot = { granted: false, waitMs: windowMs };

      const result = await redis.command([
        "EVAL",
        OUTBOUND_BUCKET_SCRIPT,
        "1",
        `${prefix}:${scope}:${key}`,
        String(limit),
        String(windowMs),
        String(now),
        member,
      ]);
      if (!result.ok) {
        options.onFailure?.(`${result.error.kind}: ${result.error.detail}`);
        return denyOnFailure;
      }
      const value = result.value;
      if (!Array.isArray(value) || value.length < 2) {
        options.onFailure?.("جوابُ EVAL ليس ثنائيًّا");
        return denyOnFailure;
      }
      const granted = Number(value[0]) === 1;
      const waitMs = Number(value[1]);
      if (!Number.isFinite(waitMs)) {
        options.onFailure?.("جوابُ EVAL ليس أرقامًا");
        return denyOnFailure;
      }
      return granted
        ? { granted: true, waitMs: 0 }
        : { granted: false, waitMs: Math.max(1, waitMs) };
    },
  };
}
