/**
 * الغرض: تخزين حالة الحوار بين رسالتين، بمهلة انتهاء حتى لا تبقى جلسة معلَّقة للأبد.
 * الحالة: منفّذ فعلياً — المرحلة 2.1. هذا تنفيذ في الذاكرة يعمل فعلاً لعملية واحدة؛
 *   محوّل Upstash Redis يُكتب عند وصول رابط Redis ورمزه، وينفّذ نفس المنفذ بلا تغيير أي حوار.
 * ينتمي إلى: apps/gateway/src/bots/shared
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts
 * ملاحظات مستقبلية: مع تعدّد نسخ الخادم على Render يصبح Redis إلزامياً لا تحسيناً.
 */

import type { DialogState, SessionStore } from "../../../../../packages/application/bots/types.ts";
import type { PortFailureError } from "../../../../../packages/application/ports/index.ts";
import type { Clock } from "../../../../../packages/shared/kernel/index.ts";
import { ok, type Result } from "../../../../../packages/shared/result/index.ts";

/** مهلة الجلسة التقنية (ليست قيمة تجارية): حوار متروك نصف ساعة يُنسى. */
export const SESSION_TTL_SECONDS = 1800;

interface StoredEntry {
  readonly state: DialogState;
  readonly expiresAtMs: number;
}

export function createMemorySessionStore(
  clock: Clock,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): SessionStore & { readonly size: () => number } {
  const entries = new Map<string, StoredEntry>();

  function purgeExpired(nowMs: number): void {
    for (const [key, entry] of entries) {
      if (entry.expiresAtMs <= nowMs) entries.delete(key);
    }
  }

  return {
    size: () => entries.size,

    load: async (telegramUserId): Promise<Result<DialogState | null, PortFailureError>> => {
      const nowMs = clock.now().getTime();
      purgeExpired(nowMs);
      const entry = entries.get(telegramUserId);
      return ok(entry === undefined ? null : entry.state);
    },

    save: async (telegramUserId, state): Promise<Result<void, PortFailureError>> => {
      const nowMs = clock.now().getTime();
      purgeExpired(nowMs);
      entries.set(telegramUserId, { state, expiresAtMs: nowMs + ttlSeconds * 1000 });
      return ok(undefined);
    },

    clear: async (telegramUserId): Promise<Result<void, PortFailureError>> => {
      entries.delete(telegramUserId);
      return ok(undefined);
    },
  };
}
