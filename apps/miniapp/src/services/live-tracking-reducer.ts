/**
 * الغرض: محوّلُ حالةِ التتبُّعِ الحيِّ في Mini App — يدمجُ لقطةً مرجعيّةً من HTTP
 *   فوقَها أحداثُ Socket.IO، بحارسِ تسلسلٍ يُسقِطُ القديمَ والمُكرَّر (البندانِ
 *   `F2-06` و`F4-04` · BUG-009 · ADR 0053).
 * الحالة: مبنيّ — البندانِ `F2-06` و`F4-04`.
 * ينتمي إلى: apps/miniapp/src/services
 * يُستخدم من: `ActiveRideScreen.tsx` لتحديث الموقعِ المرسومِ بلا استقصاء.
 *
 * ## لماذا حارسُ تسلسلٍ ههنا أيضًا
 *
 * الشاشةُ في Mini App تستهلكُ أحداثاً من ناقلٍ واحدٍ، لكنَّ الناقلَ نفسَه
 * يُبَثُّ من نسخٍ متعدّدةٍ (F5-06) وقد يصلُ حدثٌ متأخِّرٌ بعدَ حدثٍ أحدثَ.
 * فالحارسُ ههنا عينُ حكمِ الخادم: `sequence <= lastApplied` يُسقَطُ، و`sessionId`
 * مختلفٌ يُلزِمُ تحديثًا كاملًا لا دمجًا.
 *
 * ## ولا يُحتفَظُ بحالةٍ هنا
 *
 * هذا محوّلٌ نقيٌّ: دالّةٌ تُعطي حالةً وحدثًا فتُعيدُ حالةً. والتخزينُ في
 * الشاشةِ وحدها — ولا مصدرَ حقيقةٍ ثانٍ (ADR 0035 §٢).
 */

import type { RideChannelEvent } from "./ride-channel-client.ts";

/** حالةُ التتبُّعِ الحيِّ — آخرُ موقعٍ معروفٌ وتسلسلُه وجلسةُ المُرسِل. */
export interface LiveTrackingState {
  readonly position: { readonly lat: number; readonly lng: number } | null;
  readonly sequence: number;
  readonly sessionId: string | null;
}

/** الحالةُ الابتدائيّةُ — لا موقعَ ولا تسلسلَ ولا جلسة. */
export const INITIAL_TRACKING_STATE: LiveTrackingState = {
  position: null,
  sequence: 0,
  sessionId: null,
};

/**
 * يطبِّقُ حدثَ تتبُّعٍ على الحالةِ:
 *   ــ حدثٌ أحدثُ (`sequence > last`) يُحدِّثُ الموقعَ والتسلسلَ والجلسة.
 *   ــ حدثٌ مساوٍ أو أقدمُ يُسقَطُ (BUG-009).
 *   ــ `sessionId` مختلفٌ يُعيدُ الضبطَ ثمَّ يطبِّقُ — جلَّ الحقيقةِ تبدَّلَت.
 *   ــ `position === null` يُسقِطُ الموقعَ لكن لا التسلسلَ: انقطاعٌ لا تراجعٌ.
 */
export function applyTrackingEvent(
  state: LiveTrackingState,
  event: RideChannelEvent,
): LiveTrackingState {
  const sessionChanged = state.sessionId !== null && event.sessionId !== state.sessionId;

  if (sessionChanged) {
    return {
      position: event.position,
      sequence: event.sequence,
      sessionId: event.sessionId,
    };
  }

  if (event.sequence <= state.sequence) {
    return state;
  }

  return {
    position: event.position,
    sequence: event.sequence,
    sessionId: event.sessionId,
  };
}

/**
 * هل يجبُ طلبُ تحديثٍ كاملٍ من HTTP؟
 *
 * نعم متى تبدَّلَت الجلسةُ (`sessionId` مختلفٌ) — فالناقلُ قد فاتهُ سلسلةٌ
 * لا تُعوَّضُ بالأحداثِ المتأخِّرة. ولا يُطلبُ التحديثُ لمجرّدِ فجوةٍ في
 * التسلسل: الأحداثُ المُتأخِّرةُ تصلُ، والجهازُ يحتملُ ثوانيَ بلا موقعٍ.
 */
export function shouldRefreshFromHttp(
  previous: LiveTrackingState,
  current: LiveTrackingState,
): boolean {
  if (previous.sessionId === null) return false;
  return previous.sessionId !== current.sessionId;
}
