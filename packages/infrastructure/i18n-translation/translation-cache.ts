/**
 * الغرض: ذاكرة ترجمة مؤقتة في العملية، بسقف حجم ومهلة صلاحية.
 * الحالة: منفّذ فعلياً — المرحلة 2.6.
 * ينتمي إلى: infrastructure/i18n-translation
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts
 * ملاحظات مستقبلية: محوّل Redis ينفّذ المنفذ نفسه فتُشارَك الذاكرة بين النسخ (القسم 5).
 */

import type { TranslationCache } from "../../application/i18n-translation/index.ts";
import type { Clock } from "../../shared/kernel/index.ts";

/** مهل تقنية لا تجارية: ترجمة النصّ نفسه لا تتغيّر، والسقف يمنع تسرّب الذاكرة. */
export const TRANSLATION_CACHE_TTL_SECONDS = 86_400;
export const TRANSLATION_CACHE_MAX_ENTRIES = 5000;

interface CacheEntry {
  readonly value: string;
  readonly expiresAtMs: number;
}

export interface MemoryTranslationCacheOptions {
  readonly ttlSeconds?: number;
  readonly maxEntries?: number;
}

/**
 * الإخراج بأقدم مُدخَل لا بأقلّ استعمالاً: رسائل التفاوض عناقيد زمنية —
 * ما تُرجم قبل ساعة أقلّ احتمالاً للتكرار ممّا تُرجم قبل دقيقة.
 */
export function createMemoryTranslationCache(
  clock: Clock,
  options: MemoryTranslationCacheOptions = {},
): TranslationCache & { readonly size: () => number } {
  const ttlMs = (options.ttlSeconds ?? TRANSLATION_CACHE_TTL_SECONDS) * 1000;
  const maxEntries = options.maxEntries ?? TRANSLATION_CACHE_MAX_ENTRIES;
  const entries = new Map<string, CacheEntry>();

  return {
    size: () => entries.size,

    get: async (key: string): Promise<string | null> => {
      const entry = entries.get(key);
      if (entry === undefined) return null;
      if (entry.expiresAtMs <= clock.now().getTime()) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    },

    set: async (key: string, value: string): Promise<void> => {
      if (entries.size >= maxEntries) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
      entries.set(key, { value, expiresAtMs: clock.now().getTime() + ttlMs });
    },
  };
}
