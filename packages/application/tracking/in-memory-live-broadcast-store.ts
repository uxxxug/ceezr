/**
 * الغرض: تنفيذٌ ذاكرتيٌّ لـ`LiveBroadcastStore` — للاختبارِ والتطويرِ بلا Redis.
 * الحالة: منفّذ فعلياً — `SCL-005`.
 * ينتمي إلى: application/tracking
 *
 * ## حدودُ الاستعمال
 *
 * هذا التنفيذُ غيرُ موزَّع: خريطتُه داخلَ العمليةِ وحدَها، فلا يصلحُ للإنتاجِ
 * متعدّدِ النسخ. يُستعمَلُ افتراضيّاً حين لا يُمرَّرُ مخزنٌ صامدٌ، فيبقى سلوكُ
 * النسخةِ الواحدةِ كما كانَ قبلَ `SCL-005`. والإنتاجُ يوصِّلُ تنفيذَ Redis.
 */

import type { BroadcastState, LiveBroadcastStore } from "./live-broadcast-store.ts";

export function createInMemoryLiveBroadcastStore(): LiveBroadcastStore {
  const states = new Map<string, BroadcastState>();
  /** رمزُ الادّعاءِ النشطِ لكلِّ رحلةٍ، أو `undefined` إن لم يُدَّعَ. */
  const claims = new Map<string, string>();

  return {
    async get(tripId: string): Promise<BroadcastState | null> {
      return states.get(tripId) ?? null;
    },
    async save(tripId: string, state: BroadcastState): Promise<void> {
      states.set(tripId, state);
    },
    async delete(tripId: string): Promise<void> {
      states.delete(tripId);
    },
    async claimStart(tripId: string, token: string): Promise<boolean> {
      if (claims.has(tripId)) return false;
      claims.set(tripId, token);
      return true;
    },
    async releaseClaim(tripId: string, token: string): Promise<void> {
      if (claims.get(tripId) === token) claims.delete(tripId);
    },
  };
}
