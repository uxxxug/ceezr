/**
 * الغرض: نموذجُ عرضِ ملخَّصِ الرحلةِ للسائقِ — بطاقةُ الراكبِ لا السائقِ،
 *   ونجومٌ وملاحظةٌ بلا وسومٍ (البند `F12-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F12-05`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/summary
 * يُستخدم من: `DriverRideSummaryScreen.tsx`.
 */

export type { DurationLine, StraightLineLine } from "../../rider/summary/ride-summary-view.ts";
export { durationLine, straightLineLine } from "../../rider/summary/ride-summary-view.ts";

/** بطاقةُ الراكبِ — الاسمُ والمتوسطُ والعددُ. */
export interface RiderCard {
  readonly firstName: string | null;
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
}

export function riderCard(
  rider: {
    readonly firstName: string | null;
    readonly ratingAverage: number | null;
    readonly ratingCount: number;
  } | null,
): RiderCard | null {
  if (rider === null) return null;
  return {
    firstName: rider.firstName,
    ratingAverage: rider.ratingAverage,
    ratingCount: rider.ratingCount,
  };
}
