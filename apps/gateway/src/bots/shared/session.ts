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
import { attachRevision, readRevision, SessionCasConflictError } from "./session-revision.ts";

/** مهلة الجلسة التقنية (ليست قيمة تجارية): حوار متروك نصف ساعة يُنسى. */
export const SESSION_TTL_SECONDS = 1800;

interface StoredEntry {
  readonly state: DialogState;
  /** مراجعة الجلسة لمقارنة CAS — تمنع الكتابة المتزامنة فوق حالة أحدث (BUG-007). */
  readonly revision: number;
  readonly expiresAtMs: number;
}

export function createMemorySessionStore(
  clock: Clock,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): SessionStore & { readonly size: () => number; readonly prune: () => number } {
  const entries = new Map<string, StoredEntry>();

  function purgeExpired(nowMs: number): void {
    for (const [key, entry] of entries) {
      if (entry.expiresAtMs <= nowMs) entries.delete(key);
    }
  }

  return {
    size: () => entries.size,

    /**
     * التنظيف يجري ضمناً عند كل قراءة أو كتابة، لكنه معلَّق على وجود حركة: ليلةٌ
     * هادئة تترك جلسات منتهية في الذاكرة حتى أول رسالة صباحاً. هذه الدالّة تجعل
     * التنظيف مستقلاً عن الحركة، وتعيد عدد ما أُسقط ليُرى في سجلّ المهمّة.
     */
    prune: (): number => {
      const before = entries.size;
      purgeExpired(clock.now().getTime());
      return before - entries.size;
    },

    load: async (telegramUserId): Promise<Result<DialogState | null, PortFailureError>> => {
      const nowMs = clock.now().getTime();
      purgeExpired(nowMs);
      const entry = entries.get(telegramUserId);
      // المراجعةُ تُرفق بالحالة كرمزٍ فيُحملها الحوار عبر الانتشار إلى `save`،
      // فلا يحتاج توقيعُ المنفذ إلى تغيير، ولا يعلم الحوارُ بوجودها.
      return ok(entry === undefined ? null : attachRevision(entry.state, entry.revision));
    },

    save: async (telegramUserId, state): Promise<Result<void, PortFailureError>> => {
      const nowMs = clock.now().getTime();
      purgeExpired(nowMs);
      // CAS: لا تكتب إلا إن كانت مراجعةُ الحالةُ المُمرَّرة تطابقُ مراجعةَ آخرِ تحميل.
      // تحديثان متزامنان لِنفس المستخدم: الأول ينجح ويرفع المراجعة، والثاني يرى
      // المراجعةَ تغيّرت فيرمي الإشارةَ فيعيدُ المحوّلُ المحاولةَ بعد إعادة التحميل.
      // أمّا إن لم تحمل الحالةُ مراجعةً (حالةٌ طازجةٌ كإعادةِ التعيين إلى INITIAL_STATE)
      // فالكتابةُ غيرُ مشروطةٍ: لا تعارضَ مع مراجعةٍ حمَّلها الحوارُ ولم يقرأها.
      const expected = readRevision(state);
      const existing = entries.get(telegramUserId);
      const currentRevision = existing?.revision ?? 0;
      const baseRevision = expected === undefined ? currentRevision : expected;
      if (baseRevision !== currentRevision) {
        throw new SessionCasConflictError(telegramUserId, baseRevision);
      }
      const newRevision = currentRevision + 1;
      entries.set(telegramUserId, {
        state,
        revision: newRevision,
        expiresAtMs: nowMs + ttlSeconds * 1000,
      });
      return ok(undefined);
    },

    clear: async (telegramUserId): Promise<Result<void, PortFailureError>> => {
      entries.delete(telegramUserId);
      return ok(undefined);
    },
  };
}
