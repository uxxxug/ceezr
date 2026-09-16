/**
 * الغرض: اختزالُ حالة خريطة العمليات الحيّة من مجرى SSE.
 * الحالة: مُضافة في المرحلة ١٣ — F4-06 (ربط الخريطة بالمجرى المشترك).
 * ينتمي إلى: packages/maps
 *
 * ## لماذا وحدةٌ منفصلة لا نصٌّ مضمَّن
 *
 * لأن المنطق قابلٌ للاختبار: اللقطة تُستبدَل كاملةً (مصالحةٌ تامّة)، والدلتا
 * تُطبَّق بفاصل الترتيب (BUG-009 / ADR 0053). وهذا المنطق إن كُتب داخل الصفحة
 * كنصٍّ مُغلَّف لا يمكن اختباره بلا متصفّح.
 */

import type { LiveMapDriverRow } from "../../apps/admin-dashboard/src/pages/live-map.ts";

/** سجلٌّ واحدٌ من اللقطة — نفس شكل الصفّ في `LiveMapDriverRow`. */
export interface SnapshotRow extends LiveMapDriverRow {
  readonly sessionSequence?: number;
  readonly sessionId?: string | null;
}

/** دلتا موقٍّ لحظيٍّ من مجرى التتبّع. */
export interface TrackingDelta {
  readonly type: string;
  readonly driverId: string;
  readonly tripId: string | null;
  readonly sessionId: string;
  readonly sequence: number;
  readonly cityId: string | null;
  readonly position: { readonly lat: number; readonly lng: number } | null;
  readonly at: string;
}

/** حالةُ الخريطة الحيّة على العميل. */
export interface LiveMapState {
  readonly rows: readonly SnapshotRow[];
  readonly lastSeq: number | null;
  readonly lastSessionId: string | null;
  readonly lastSnapshotAt: string | null;
}

/** حالةٌ فارغةٌ قبل أول لقطة. */
export const EMPTY_LIVE_MAP_STATE: LiveMapState = {
  rows: [],
  lastSeq: null,
  lastSessionId: null,
  lastSnapshotAt: null,
};

/**
 * اللقطة تُستبدَل كاملةً: ما في المجرى هو الحقيقةُ الحاليّة، وما قبله يُنسى.
 * وآخرُ تسلسلٍ مُلاحَظ يُضبَط من الصفّ المُطابق إن وُجد.
 */
export function applySnapshot(
  _state: LiveMapState,
  at: string,
  rows: readonly SnapshotRow[],
): LiveMapState {
  const latest = rows
    .filter(
      (row) =>
        row.sessionSequence !== undefined && row.sessionId !== undefined && row.sessionId !== null,
    )
    .sort((a, b) => (b.sessionSequence ?? 0) - (a.sessionSequence ?? 0))[0];

  return {
    rows,
    lastSeq: latest?.sessionSequence ?? null,
    lastSessionId: latest?.sessionId ?? null,
    lastSnapshotAt: at,
  };
}

/**
 * الدلتا تُطبَّق بفاصل الترتيب (BUG-009):
 *
 * ١. تبدُّلُ `sessionId` فجوةٌ تُوجب لقطةً، لا تراجعاً يُسقَط (ADR 0053 §٤-ب/٢).
 *    فلو وصل حدثٌ من جلسةٍ أخرى وهو أحدثُ من آخر لقطة، يُؤجَّل حتى لقطةٌ تُصحّح.
 * ٢. حدثٌ بتسلسلٍ أقلَّ أو مساوٍ لآخر ما طُبِّق يُسقَط: لا تراجع.
 * ٣. الموضع `null` (بدء جلسةٍ مثلًا) لا يحرّك الدبوس، لكنه يحدّث التسلسل.
 */
export function applyTrackingDelta(state: LiveMapState, delta: TrackingDelta): LiveMapState {
  if (state.lastSessionId !== null && delta.sessionId !== state.lastSessionId) {
    // جلسةٌ مختلفة — يُنتظر اللقطة الدورية، لا يُطبَّق الدلتا.
    return state;
  }

  if (state.lastSeq !== null && delta.sequence <= state.lastSeq) {
    // تراجعٌ أو تكرار — يُسقَط.
    return state;
  }

  const position =
    delta.position === null ? null : { lat: delta.position.lat, lng: delta.position.lng };

  const updatedRows = state.rows.map((row) => {
    if (row.driverId !== delta.driverId) return row;
    if (position === null) return row;
    return { ...row, lat: position.lat, lng: position.lng, lastFixAt: delta.at };
  });

  return {
    rows: updatedRows,
    lastSeq: delta.sequence,
    lastSessionId: delta.sessionId,
    lastSnapshotAt: state.lastSnapshotAt,
  };
}
